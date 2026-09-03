import { createLogger } from '@/core/logging';
import { getPlatform } from '@/platform';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
} from '../domain/canvasNodes';
import {
  type CanvasGenerationOutputDescriptorV1,
} from '../domain/generationOutputs';
import { getResultNodeMediaType } from '../domain/nodeRegistry';
import type { RowMediaKind } from '../domain/socketTypes';
import { persistGenerationResult } from '../generation/mediaResultPersist';
import { createAssetGroupGraph, updateAssetGroupDataGraph } from './assetGroupGraph';
import { runCanvasTransaction } from './canvasBatchService';
import { requireCurrentCanvasProject } from './canvasApplicationService';
import { canvasNodeFactory } from './canvasServices';
import {
  GenerationOutputApplicationError,
  type CommitCanvasGenerationOutputsInput,
  type CommitCanvasGenerationOutputsResult,
} from './generationOutputApplicationContracts';
import { validateGenerationOutputBatchContract } from './generationOutputContract';
import { commitPreparedLayerStack } from './generationOutputLayerStackCommit';

const logger = createLogger('features.canvas.generation-output');

export { GenerationOutputApplicationError } from './generationOutputApplicationContracts';
export type {
  CommitCanvasGenerationOutputsInput,
  CommitCanvasGenerationOutputsResult,
} from './generationOutputApplicationContracts';
export {
  resolveGenerationOutputStrategy,
  validateGenerationOutputBatchContract,
} from './generationOutputContract';

function requireCurrentProjectId(): string {
  const project = useProjectStore.getState();
  if (!project.currentProjectId || project.currentProject?.id !== project.currentProjectId) {
    throw new GenerationOutputApplicationError('NOT_FOUND', '当前画布项目不可用');
  }
  return project.currentProjectId;
}

function validatePersistedMediaPatch(mediaType: RowMediaKind, patch: DynamicValueMap): void {
  const field = mediaType === 'image' ? 'imageUrl' : mediaType === 'video' ? 'videoUrl' : 'audioUrl';
  if (typeof patch[field] !== 'string' || patch[field].trim().length === 0) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', `多结果输出字段 ${field} 不能为空`);
  }
}

function findExistingCommit(
  completionId: string,
  resultNodeType: CanvasNodeType,
): { resultNodeIds: string[]; groupNodeId: string | null } | null {
  const canvas = useCanvasStore.getState();
  const members = canvas.nodes
    .filter((node) => node.type === resultNodeType && node.data.generationOutputCommitId === completionId)
    .sort((left, right) => {
      const leftOrder = left.data.generationOutputDescriptor?.order;
      const rightOrder = right.data.generationOutputDescriptor?.order;
      return (typeof leftOrder === 'number' ? leftOrder : 0) - (typeof rightOrder === 'number' ? rightOrder : 0);
    });
  if (members.length === 0) return null;
  const group = canvas.nodes.find((node) => (
    node.type === CANVAS_NODE_TYPES.assetGroup
    && node.data.generationOutputCommitId === completionId
  ));
  return { resultNodeIds: members.map((node) => node.id), groupNodeId: group?.id ?? null };
}

function createCompletedNodeData(
  placeholder: CanvasNode,
  patch: DynamicValueMap,
  descriptor: CanvasGenerationOutputDescriptorV1,
  completionId: string,
  appendLabel: boolean,
): Partial<CanvasNodeData> {
  const baseTitle = typeof placeholder.data.displayName === 'string'
    ? placeholder.data.displayName
    : '';
  const label = descriptor.semantic.label?.trim();
  return {
    ...placeholder.data,
    ...patch,
    ...(descriptor.mediaType === 'image' ? { resultKind: descriptor.semantic.resultKind } : {}),
    ...(appendLabel && label ? { displayName: `${baseTitle} · ${label}` } : {}),
    isGenerating: false,
    generationStartedAt: null,
    generationError: null,
    serverTaskId: null,
    serverTaskModelId: null,
    generationOutputCommitId: completionId,
    generationOutputDescriptor: descriptor,
  } as Partial<CanvasNodeData>;
}

function createResultGroupGraph(input: {
  memberIds: string[];
  completionId: string;
  title: string;
  descriptors: CanvasGenerationOutputDescriptorV1[];
  resultKind: 'image-group' | 'media-group';
}): { groupId: string } {
  const canvas = useCanvasStore.getState();
  const group = canvasNodeFactory.createNode(CANVAS_NODE_TYPES.assetGroup, { x: 0, y: 0 }, {
    displayName: input.title,
    memberOrder: [],
    coverMemberId: null,
    bindings: [],
    resultKind: input.resultKind,
    generationOutputCommitId: input.completionId,
    generationOutputStrategy: 'assetGroup',
    generationOutputDescriptors: input.descriptors,
  });
  const created = createAssetGroupGraph(canvas.nodes, canvas.edges, group, input.memberIds);
  if (!created) {
    throw new GenerationOutputApplicationError('CONFLICT', '无法从完整输出创建结果组');
  }
  const reordered = updateAssetGroupDataGraph(
    created.nodes,
    created.edges,
    group.id,
    { memberOrder: input.memberIds, coverMemberId: input.memberIds[0] },
  );
  if (!reordered) {
    throw new GenerationOutputApplicationError('CONFLICT', '无法保存结果组成员顺序');
  }
  useCanvasStore.getState().commitAssetGroupGraph(reordered, group.id);
  return { groupId: group.id };
}

export async function commitCanvasGenerationOutputs(
  input: CommitCanvasGenerationOutputsInput,
): Promise<CommitCanvasGenerationOutputsResult> {
  const ordered = validateGenerationOutputBatchContract(input.contract);
  const projectId = requireCurrentProjectId();
  requireCurrentCanvasProject(projectId);
  if (!input.placeholderNodeId && !input.completionId?.trim()) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '无占位节点的结果提交必须提供稳定完成键');
  }
  const completionId = input.completionId?.trim() || `generation-output:${input.placeholderNodeId}`;
  const existing = findExistingCommit(completionId, input.resultNodeType);
  if (existing) {
    return {
      projectId,
      completionId,
      strategy: input.contract.strategy,
      ...existing,
      idempotent: true,
    };
  }

  if (input.contract.strategy === 'layer-stack') {
    return await commitPreparedLayerStack({ ...input, completionId, ordered, projectId });
  }

  const before = useCanvasStore.getState();
  const sourceNode = input.sourceNodeId
    ? before.nodes.find((node) => node.id === input.sourceNodeId)
    : null;
  const storedPlaceholder = input.placeholderNodeId
    ? before.nodes.find((node) => node.id === input.placeholderNodeId)
    : null;
  if (
    (input.sourceNodeId && !sourceNode)
    || (input.placeholderNodeId && (!storedPlaceholder || storedPlaceholder.type !== input.resultNodeType))
  ) {
    throw new GenerationOutputApplicationError('NOT_FOUND', '生成来源或结果占位节点已不存在');
  }
  const placeholder = storedPlaceholder ?? canvasNodeFactory.createNode(
    input.resultNodeType,
    sourceNode
      ? before.findNodePosition(input.sourceNodeId as string, 384, 288)
      : { x: 0, y: 0 },
    input.resultNodeData,
  );
  if (ordered.some((item) => item.descriptor.mediaType !== ordered[0].descriptor.mediaType)) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '同一生成批次不能混合不同媒体类型');
  }
  const resultMediaType = getResultNodeMediaType(input.resultNodeType);
  if (!resultMediaType || resultMediaType !== ordered[0].descriptor.mediaType) {
    throw new GenerationOutputApplicationError(
      'INVALID_INPUT',
      `结果节点 ${input.resultNodeType} 不支持 ${ordered[0].descriptor.mediaType} 输出`,
    );
  }

  logger.info('生成结果原子落图开始', {
    event: 'canvas.generation_output.commit.start',
    projectId,
    sourceNodeId: input.sourceNodeId,
    placeholderNodeId: input.placeholderNodeId,
    outputCount: ordered.length,
    strategy: input.contract.strategy,
  });

  const createdFilePaths: string[] = [];
  let ownershipTransferred = false;
  try {
    const persistOutput = input.persistOutput ?? persistGenerationResult;
    const persistenceResults = await Promise.allSettled(ordered.map(async (item) => {
      const persisted = await persistOutput(item.descriptor.mediaType, item.source);
      return 'patch' in persisted && 'createdFilePaths' in persisted
        ? persisted
        : { patch: persisted, createdFilePaths: [] };
    }));
    for (const result of persistenceResults) {
      if (result.status === 'fulfilled') {
        createdFilePaths.push(...result.value.createdFilePaths);
      }
    }
    const failedPersistence = persistenceResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failedPersistence) {
      throw failedPersistence.reason;
    }
    const patches = persistenceResults.map((result, index) => {
      if (result.status !== 'fulfilled') {
        throw new GenerationOutputApplicationError('CONFLICT', '生成结果媒体准备未完成');
      }
      const patch = result.value.patch;
      validatePersistedMediaPatch(ordered[index].descriptor.mediaType, patch);
      input.validateResultPatch?.(patch, ordered[index].descriptor);
      return patch;
    });

    requireCurrentCanvasProject(projectId);
    const latest = useCanvasStore.getState();
    if (
      (input.sourceNodeId && !latest.nodes.some((node) => node.id === input.sourceNodeId))
      || (input.placeholderNodeId && !latest.nodes.some((node) => node.id === input.placeholderNodeId))
    ) {
      throw new GenerationOutputApplicationError('CONFLICT', '生成期间画布已变化，结果未落图');
    }

    const result = await runCanvasTransaction(
      projectId,
      ordered.length + (input.contract.strategy === 'assetGroup' ? 1 : 0),
      async () => {
        const resultNodeIds: string[] = [];
        const appendLabel = ordered.length > 1;
        const firstData = createCompletedNodeData(
          placeholder,
          patches[0],
          ordered[0].descriptor,
          completionId,
          appendLabel,
        );
        const firstNodeId = input.placeholderNodeId ?? useCanvasStore.getState().addNode(
          input.resultNodeType,
          placeholder.position,
          firstData,
        );
        if (input.placeholderNodeId) {
          useCanvasStore.getState().updateNodeData(input.placeholderNodeId, firstData);
        }
        if (input.sourceNodeId) {
          useCanvasStore.getState().addEdge(input.sourceNodeId, firstNodeId);
        }
        resultNodeIds.push(firstNodeId);

        for (let index = 1; index < ordered.length; index += 1) {
          const canvas = useCanvasStore.getState();
          // 素材组成员完成后都会隐藏在组内；预先把它们叠放在首项位置，避免隐藏成员的
          // 临时散列坐标把保存重开后的 fitView 边界撑大。独立输出仍保持逐项避让布局。
          const position = input.contract.strategy === 'assetGroup'
            ? placeholder.position
            : input.sourceNodeId
            ? canvas.findNodePosition(input.sourceNodeId, 384, 288)
            : {
                x: placeholder.position.x,
                y: placeholder.position.y + index * 304,
              };
          const nodeId = canvas.addNode(
            input.resultNodeType,
            position,
            createCompletedNodeData(
              placeholder,
              patches[index],
              ordered[index].descriptor,
              completionId,
              true,
            ),
          );
          if (input.sourceNodeId) {
            useCanvasStore.getState().addEdge(input.sourceNodeId, nodeId);
          }
          resultNodeIds.push(nodeId);
        }

        let groupNodeId: string | null = null;
        if (input.contract.strategy === 'assetGroup') {
          const groupTitle = input.groupTitle?.trim()
            || `${String(placeholder.data.displayName ?? '生成结果')} · ${ordered.length}`;
          groupNodeId = createResultGroupGraph({
            memberIds: resultNodeIds,
            completionId,
            title: groupTitle,
            descriptors: ordered.map((item) => item.descriptor),
            resultKind: input.contract.resultKind === 'image-group' ? 'image-group' : 'media-group',
          }).groupId;
        } else {
          useCanvasStore.getState().setSelectedNode(resultNodeIds.at(-1) ?? null);
        }

        return [{
          operation: 'generation-output',
          completionId,
          resultNodeIds,
          groupNodeId,
        }];
      },
      { completionId, strategy: input.contract.strategy },
    );
    const operation = result.appliedOperations[0];
    const resultNodeIds = Array.isArray(operation?.resultNodeIds)
      ? operation.resultNodeIds.filter((value): value is string => typeof value === 'string')
      : [];
    const groupNodeId = typeof operation?.groupNodeId === 'string' ? operation.groupNodeId : null;
    logger.info('生成结果原子落图完成', {
      event: 'canvas.generation_output.commit.completed',
      projectId,
      completionId,
      outputCount: resultNodeIds.length,
      groupNodeId,
    });
    ownershipTransferred = true;
    return {
      projectId,
      completionId,
      strategy: input.contract.strategy,
      resultNodeIds,
      groupNodeId,
      idempotent: false,
    };
  } catch (error) {
    logger.error('生成结果原子落图失败', error, {
      event: 'canvas.generation_output.commit.failed',
      projectId,
      context: { completionId, outputCount: ordered.length, strategy: input.contract.strategy },
    });
    // runCanvasTransaction 已负责图回滚；这里不删除占位节点，让现有失败态继续承载错误与重试。
    throw error;
  } finally {
    if (!ownershipTransferred && createdFilePaths.length > 0) {
      const releaseCreatedFiles = input.releaseCreatedFiles
        ?? ((filePaths: string[]) => getPlatform().image.releaseManagedGenerationMedia(filePaths));
      await releaseCreatedFiles([...new Set(createdFilePaths)]).catch((releaseError) => {
        logger.error('生成结果媒体回滚失败', releaseError, {
          event: 'canvas.generation_output.media_rollback.failed',
          projectId,
          context: { completionId, createdFileCount: createdFilePaths.length },
        });
      });
    }
  }
}
