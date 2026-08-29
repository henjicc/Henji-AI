import { useEffect, useRef } from 'react';

import { createLogger } from '@/core/logging';
import { registry } from '@/core/ModelRegistry';
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useCanvasStore } from '@/stores/canvasStore';

import {
  resolveCanvasImageCapabilityExpectedOutputCount,
  getRegisteredCanvasImageCapabilities,
  validateCanvasCapabilityResultPatch,
  type CanvasImageCapabilityDefinition,
} from '../capabilities';
import { getResultNodeMediaType } from '../domain/nodeRegistry';
import type { CanvasNodeType } from '../domain/canvasNodes';
import { createDefaultGenerationOutputItems } from '../domain/generationOutputs';
import { readResumableServerTask } from '../domain/resumableTask';
import { resumeCanvasGeneration } from '../generation/runGeneration';
import {
  commitCanvasGenerationOutputs,
  resolveGenerationOutputStrategy,
} from '../application/generationOutputApplicationService';
import { commitLayerSeparationGeneration } from '../application/layerSeparationGenerationService';

const logger = createLogger('features.canvas.hooks.useCanvasResumePolling');

/**
 * 应用重启后恢复未完成的异步生成。
 *
 * 画布上的异步任务（尤其视频）在供应商侧可能跑很久，用户完全可能中途关掉软件。
 * 任务 ID 在创建时已写进结果节点并随项目持久化（见 GenerationNodeShell），
 * 这里在画布加载后把这些任务接着轮询到出结果或明确失败为止——与对话模式的
 * useAutoResumePolling 行为对齐。
 */
export function useCanvasResumePolling(): void {
  const nodes = useCanvasStore((state) => state.nodes);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setNodeGenerationProgress = useCanvasGenerationProgressStore((state) => state.setProgress);

  // 同一个任务只续查一次：nodes 每次变化都会重跑 effect，不去重会叠出多条轮询
  const resumedTaskIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const node of nodes) {
      const task = readResumableServerTask(node.data as DynamicValueMap);
      if (!task || resumedTaskIdsRef.current.has(task.taskId)) {
        continue;
      }

      const mediaType = getResultNodeMediaType(node.type);
      if (!mediaType) {
        continue;
      }
      const sourceCapabilityId = typeof node.data.sourceCapabilityId === 'string'
        ? node.data.sourceCapabilityId
        : null;
      const sourceCapability = sourceCapabilityId
        ? getRegisteredCanvasImageCapabilities().find(({ id }) => id === sourceCapabilityId)
        : undefined;
      const sourceNodeId = useCanvasStore.getState().edges.find((edge) => edge.target === node.id)?.source;

      resumedTaskIdsRef.current.add(task.taskId);
      logger.info('[CanvasResume] 恢复未完成的异步生成', {
        event: 'canvas.resume_polling.start',
        taskId: task.taskId,
        modelId: task.modelId,
        context: { nodeId: node.id, mediaType },
      });

      void resumeNodeTask({
        nodeId: node.id,
        sourceNodeId,
        resultNodeType: node.type,
        resultNodeData: node.data as DynamicValueMap,
        mediaType,
        taskId: task.taskId,
        modelId: task.modelId,
        sourceCapability,
        updateNodeData,
        setNodeGenerationProgress,
      });
    }
  }, [nodes, setNodeGenerationProgress, updateNodeData]);
}

interface ResumeNodeTaskInput {
  nodeId: string;
  sourceNodeId?: string;
  resultNodeType: CanvasNodeType;
  resultNodeData: DynamicValueMap;
  mediaType: 'image' | 'video' | 'audio';
  taskId: string;
  modelId: string;
  sourceCapability?: CanvasImageCapabilityDefinition;
  updateNodeData: ReturnType<typeof useCanvasStore.getState>['updateNodeData'];
  setNodeGenerationProgress: ReturnType<
    typeof useCanvasGenerationProgressStore.getState
  >['setProgress'];
}

async function resumeNodeTask(input: ResumeNodeTaskInput): Promise<void> {
  const {
    nodeId,
    sourceNodeId,
    resultNodeType,
    resultNodeData,
    mediaType,
    taskId,
    modelId,
    sourceCapability,
    updateNodeData,
    setNodeGenerationProgress,
  } = input;

  updateNodeData(nodeId, { isGenerating: true, generationError: null });

  try {
    const result = await resumeCanvasGeneration({
      modelId,
      mediaType,
      taskId,
      onProgress: (progress) => setNodeGenerationProgress(nodeId, progress),
    });
    // 兼容旧测试替身与旧进程边界只返回 primary 的形状；正式运行时始终优先消费 outputs。
    const resultOutputs = Array.isArray(result.outputs) && result.outputs.length > 0
      ? result.outputs
      : result.primary ? [result.primary] : [];

    if (result.structuredOutput?.kind === 'layer-stack' || resultNodeData.resultKind === 'layer-stack') {
      const persistedSourceNodeId = typeof resultNodeData.generationSourceNodeId === 'string'
        && resultNodeData.generationSourceNodeId.trim().length > 0
        ? resultNodeData.generationSourceNodeId
        : undefined;
      const sourceImage = Array.isArray(resultNodeData.generationInputImages)
        ? resultNodeData.generationInputImages.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : undefined;
      const model = registry.getModel(modelId);
      const persistedProviderId = typeof resultNodeData.generationProviderId === 'string'
        && resultNodeData.generationProviderId.trim().length > 0
        ? resultNodeData.generationProviderId
        : undefined;
      const resolvedSourceNodeId = persistedSourceNodeId ?? sourceNodeId;
      const providerId = persistedProviderId ?? model?.meta.provider;
      if (!resolvedSourceNodeId || !sourceImage || !providerId) {
        throw new Error('图层拆分恢复缺少来源节点、源图或模型信息');
      }
      await commitLayerSeparationGeneration({
        sourceNodeId: resolvedSourceNodeId,
        placeholderNodeId: nodeId,
        resultNodeType,
        completionId: `generation-output:${nodeId}`,
        sourceImage,
        providerId,
        modelId,
        result: { ...result, outputs: resultOutputs },
      });
      logger.info('[CanvasResume] 结构化图层生成恢复完成', {
        event: 'canvas.resume_polling.layer_stack.completed',
        taskId,
        modelId,
        context: { nodeId },
      });
      return;
    }

    const outputResultKind = sourceCapability?.outputPolicy.resultKind;
    const memberResultKind = outputResultKind === 'panorama' ? 'panorama' : mediaType;
    const strategy = resolveGenerationOutputStrategy({
      outputCount: resultOutputs.length,
      resultKind: outputResultKind,
    });
    const batchResultKind = strategy === 'assetGroup'
      ? mediaType === 'image' ? 'image-group' : 'media-group'
      : memberResultKind;
    await commitCanvasGenerationOutputs({
      sourceNodeId,
      placeholderNodeId: nodeId,
      resultNodeType,
      contract: {
        version: 1,
        strategy,
        resultKind: outputResultKind ?? batchResultKind,
        expectedOutputCount: sourceCapability
          ? resolveCanvasImageCapabilityExpectedOutputCount(
            sourceCapability.outputPolicy,
            resultNodeData.generationMappedParams && typeof resultNodeData.generationMappedParams === 'object'
              ? resultNodeData.generationMappedParams as DynamicValueMap
              : {},
          )
          : undefined,
        outputs: createDefaultGenerationOutputItems({
          sources: resultOutputs,
          mediaType,
          resultKind: memberResultKind,
          semanticKind: outputResultKind === 'panorama' ? 'panorama' : 'generated-media',
        }),
      },
      completionId: `generation-output:${nodeId}`,
      validateResultPatch: sourceCapability
        ? (patch) => validateCanvasCapabilityResultPatch(sourceCapability, patch)
        : undefined,
    });
    logger.info('[CanvasResume] 异步生成恢复完成', {
      event: 'canvas.resume_polling.completed',
      taskId,
      modelId,
      context: { nodeId },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateNodeData(nodeId, {
      isGenerating: false,
      generationStartedAt: null,
      generationError: message,
      serverTaskId: null,
      serverTaskModelId: null,
    });
    logger.error('[CanvasResume] 异步生成恢复失败', error, {
      event: 'canvas.resume_polling.failed',
      taskId,
      modelId,
      context: { nodeId, message },
    });
  } finally {
    setNodeGenerationProgress(nodeId, null);
  }
}
