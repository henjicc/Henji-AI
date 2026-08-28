import { useEffect, useRef } from 'react';

import { createLogger } from '@/core/logging';
import { useCanvasGenerationProgressStore } from '@/stores/canvasGenerationProgressStore';
import { useCanvasStore } from '@/stores/canvasStore';

import {
  getRegisteredCanvasImageCapabilities,
  validateCanvasCapabilityResultPatch,
  type CanvasImageCapabilityDefinition,
} from '../capabilities';
import { getResultNodeMediaType } from '../domain/nodeRegistry';
import { readResumableServerTask } from '../domain/resumableTask';
import { persistGenerationResult } from '../generation/mediaResultPersist';
import { resumeCanvasGeneration } from '../generation/runGeneration';

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

      resumedTaskIdsRef.current.add(task.taskId);
      logger.info('[CanvasResume] 恢复未完成的异步生成', {
        event: 'canvas.resume_polling.start',
        taskId: task.taskId,
        modelId: task.modelId,
        context: { nodeId: node.id, mediaType },
      });

      void resumeNodeTask({
        nodeId: node.id,
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

    const resultPatch = await persistGenerationResult(mediaType, result.primary);
    if (sourceCapability) {
      validateCanvasCapabilityResultPatch(sourceCapability, resultPatch);
    }
    updateNodeData(nodeId, {
      ...resultPatch,
      isGenerating: false,
      generationStartedAt: null,
      generationError: null,
      serverTaskId: null,
      serverTaskModelId: null,
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
