import { useEffect, useRef } from 'react';

import { createLogger } from '@/core/logging';
import { registry } from '@/core/ModelRegistry';
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { getPlatform } from '@/platform';

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
import { createCanvasGenerationFailurePatch } from '../domain/generationFailure';
import { resumeCanvasGeneration } from '../generation/runGeneration';
import {
  acquireCanvasGenerationResumeLease,
  isCanvasGenerationResumeLeaseCurrent,
  isCanvasGenerationTaskActive,
  releaseCanvasGenerationResumeLease,
  releaseCanvasGenerationResumeLeasesForProject,
} from '../generation/activeGenerationTasks';
import {
  commitCanvasGenerationOutputs,
  resolveGenerationOutputStrategy,
} from '../application/generationOutputApplicationService';
import { isCanvasNodeInputSignatureCurrent } from '../application/canvasExecutionService';
import { publishCanvasSuccessfulExecution } from '../application/canvasExecutionPublication';
import { commitLayerSeparationGeneration } from '../application/layerSeparationGenerationService';
import {
  commitLocalRedrawGeneration,
  LOCAL_REDRAW_CONTEXT_FIELD,
  parseLocalRedrawContext,
} from '../application/localRedrawGenerationService';
import {
  parseStoryboardGenerationResumeContext,
  prepareStoryboardGenerationOutputContract,
  STORYBOARD_GENERATION_RESUME_CONTEXT_FIELD,
} from '../application/storyboardGenerationOutputService';

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
  const projectId = useProjectStore((state) => state.currentProjectId);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const setNodeGenerationProgress = useCanvasGenerationProgressStore((state) => state.setProgress);

  const previousProjectIdRef = useRef<string | null>(projectId);

  useEffect(() => {
    const previousProjectId = previousProjectIdRef.current;
    if (previousProjectId !== projectId) {
      if (previousProjectId) releaseCanvasGenerationResumeLeasesForProject(previousProjectId);
      previousProjectIdRef.current = projectId;
    }
    if (!projectId) return;

    for (const node of nodes) {
      const task = readResumableServerTask(node.data as DynamicValueMap);
      if (
        !task
        || isCanvasGenerationTaskActive(task.taskId)
        // 已显示下载失败的结果等待用户明确续取，避免节点更新触发无限重试。
        || (node.data.resultKind === 'layer-stack' && Boolean(node.data.generationError))
      ) {
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
      const persistedSourceNodeId = typeof node.data.generationSourceNodeId === 'string'
        && node.data.generationSourceNodeId.trim().length > 0
        ? node.data.generationSourceNodeId
        : undefined;
      const sourceNodeId = persistedSourceNodeId
        ?? useCanvasStore.getState().edges.find((edge) => edge.target === node.id)?.source;

      const resumeLease = acquireCanvasGenerationResumeLease(projectId, task.taskId);
      if (!resumeLease) continue;
      logger.info('[CanvasResume] 恢复未完成的异步生成', {
        event: 'canvas.resume_polling.start',
        taskId: task.taskId,
        modelId: task.modelId,
        context: { nodeId: node.id, mediaType },
      });

      void resumeNodeTask({
        projectId,
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
        isContextCurrent: () => (
          useProjectStore.getState().currentProjectId === projectId
          && isCanvasGenerationResumeLeaseCurrent(projectId, task.taskId, resumeLease)
        ),
        releaseLease: () => releaseCanvasGenerationResumeLease(projectId, task.taskId, resumeLease),
      });
    }
  }, [nodes, projectId, setNodeGenerationProgress, updateNodeData]);
}

interface ResumeNodeTaskInput {
  projectId: string;
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
  isContextCurrent: () => boolean;
  releaseLease: () => void;
}

async function publishResumedExecution(input: {
  sourceNodeId?: string;
  resultNodeData: DynamicValueMap;
  resultNodeIds: string[];
}): Promise<void> {
  const inputSignature = input.resultNodeData.generationInputSignature;
  if (
    !input.sourceNodeId
    || typeof inputSignature !== 'string'
    || inputSignature.length === 0
    || !useCanvasStore.getState().nodes.some((node) => node.id === input.sourceNodeId)
  ) return;
  try {
    if (!await isCanvasNodeInputSignatureCurrent(input.sourceNodeId, inputSignature)) {
      logger.info('[CanvasResume] 来源输入已变化，保留恢复结果但跳过发布', {
        event: 'canvas.resume_polling.publication.skipped_stale',
        context: { sourceNodeId: input.sourceNodeId, resultNodeIds: input.resultNodeIds },
      });
      return;
    }
    publishCanvasSuccessfulExecution({
      sourceNodeId: input.sourceNodeId,
      inputSignature,
      outputMode: 'result-nodes',
      resultNodeIds: input.resultNodeIds,
    });
  } catch (error) {
    logger.error('[CanvasResume] 恢复结果发布失败', error, {
      event: 'canvas.resume_polling.publication.failed',
      context: { sourceNodeId: input.sourceNodeId, resultNodeIds: input.resultNodeIds },
    });
  }
}

async function resumeNodeTask(input: ResumeNodeTaskInput): Promise<void> {
  const {
    nodeId,
    projectId,
    sourceNodeId,
    resultNodeType,
    resultNodeData,
    mediaType,
    taskId,
    modelId,
    sourceCapability,
    updateNodeData,
    setNodeGenerationProgress,
    isContextCurrent,
    releaseLease,
  } = input;
  let createdFilePaths: string[] = [];

  try {
    if (!isContextCurrent()) return;
    updateNodeData(nodeId, { isGenerating: true, generationError: null });
    const localRedrawContext = sourceCapability?.outputPolicy.postProcess === 'local-redraw-composite'
      ? parseLocalRedrawContext(resultNodeData[LOCAL_REDRAW_CONTEXT_FIELD])
      : null;
    const result = await resumeCanvasGeneration({
      modelId,
      requestId: localRedrawContext?.requestId,
      mediaType,
      taskId,
      onProgress: (progress) => {
        if (isContextCurrent()) setNodeGenerationProgress(nodeId, progress);
      },
    });
    createdFilePaths = [...new Set(result.createdFilePaths ?? [])];
    if (!isContextCurrent()) return;
    // 兼容旧测试替身与旧进程边界只返回 primary 的形状；正式运行时始终优先消费 outputs。
    const resultOutputs = Array.isArray(result.outputs) && result.outputs.length > 0
      ? result.outputs
      : result.primary ? [result.primary] : [];

    const storyboardContextValue = resultNodeData[STORYBOARD_GENERATION_RESUME_CONTEXT_FIELD];
    if (storyboardContextValue !== undefined && storyboardContextValue !== null) {
      const storyboardContext = parseStoryboardGenerationResumeContext(storyboardContextValue);
      if (!storyboardContext) throw new Error('分镜生成恢复上下文无效或版本不受支持');
      const contract = await prepareStoryboardGenerationOutputContract({
        outputs: resultOutputs,
        context: storyboardContext,
      });
      if (!isContextCurrent()) return;
      const committed = await commitCanvasGenerationOutputs({
        sourceNodeId,
        placeholderNodeId: nodeId,
        resultNodeType,
        contract,
        completionId: `storyboard-grid:${nodeId}`,
        groupTitle: `${String(resultNodeData.displayName ?? '分镜输出')} · ${contract.outputs.length}`,
      });
      if (!isContextCurrent()) return;
      await publishResumedExecution({ sourceNodeId, resultNodeData, resultNodeIds: committed.resultNodeIds });
      logger.info('[CanvasResume] 分镜生成恢复完成', {
        event: 'canvas.resume_polling.storyboard.completed',
        taskId,
        modelId,
        context: { nodeId, outputCount: contract.outputs.length },
      });
      return;
    }

    if (sourceCapability?.outputPolicy.postProcess === 'local-redraw-composite') {
      if (!localRedrawContext) throw new Error('局部重绘恢复缺少裁剪上下文');
      const committed = await commitLocalRedrawGeneration({
        sourceNodeId,
        placeholderNodeId: nodeId,
        resultNodeType,
        completionId: `generation-output:${nodeId}`,
        context: localRedrawContext,
        result: { ...result, outputs: resultOutputs },
      });
      if (!isContextCurrent()) return;
      await publishResumedExecution({ sourceNodeId, resultNodeData, resultNodeIds: committed.resultNodeIds });
      logger.info('[CanvasResume] 局部重绘恢复完成', {
        event: 'canvas.resume_polling.local_redraw.completed',
        taskId,
        modelId,
        context: { nodeId },
      });
      return;
    }

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
      const committed = await commitLayerSeparationGeneration({
        sourceNodeId: resolvedSourceNodeId,
        placeholderNodeId: nodeId,
        resultNodeType,
        completionId: `generation-output:${nodeId}`,
        sourceImage,
        providerId,
        modelId,
        result: { ...result, outputs: resultOutputs },
      });
      if (!isContextCurrent()) return;
      await publishResumedExecution({
        sourceNodeId: resolvedSourceNodeId,
        resultNodeData,
        resultNodeIds: committed.resultNodeIds,
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
    const committed = await commitCanvasGenerationOutputs({
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
        ? (patch) => validateCanvasCapabilityResultPatch(
            sourceCapability,
            patch,
            resultNodeData.panoramaProjectionMode,
          )
        : undefined,
    });
    if (!isContextCurrent()) return;
    await publishResumedExecution({ sourceNodeId, resultNodeData, resultNodeIds: committed.resultNodeIds });
    logger.info('[CanvasResume] 异步生成恢复完成', {
      event: 'canvas.resume_polling.completed',
      taskId,
      modelId,
      context: { nodeId },
    });
  } catch (error) {
    if (!isContextCurrent()) return;
    const message = error instanceof Error ? error.message : String(error);
    updateNodeData(nodeId, createCanvasGenerationFailurePatch(error, resultNodeData.resultKind));
    logger.error('[CanvasResume] 异步生成恢复失败', error, {
      event: 'canvas.resume_polling.failed',
      taskId,
      modelId,
      context: { nodeId, message },
    });
  } finally {
    try {
      if (mediaType === 'image' && createdFilePaths.length > 0) {
        await getPlatform().image.releaseManagedGenerationMedia(createdFilePaths).catch((error) => {
          logger.error('[CanvasResume] 恢复任务临时媒体释放失败', error, {
            event: 'canvas.resume_polling.resources.release_failed',
            taskId,
            modelId,
            context: { nodeId, createdFileCount: createdFilePaths.length },
          });
        });
      }
      if (isContextCurrent() && useProjectStore.getState().currentProjectId === projectId) {
        setNodeGenerationProgress(nodeId, null);
      }
    } finally {
      releaseLease();
    }
  }
}
