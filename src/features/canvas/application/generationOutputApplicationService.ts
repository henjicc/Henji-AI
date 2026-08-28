import { createLogger } from '@/core/logging';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

import {
  CANVAS_NODE_TYPES,
  type CanvasNode,
  type CanvasNodeData,
  type CanvasNodeType,
} from '../domain/canvasNodes';
import {
  CANVAS_GENERATION_RESULT_KINDS,
  CANVAS_GENERATION_OUTPUT_STRATEGIES,
  type CanvasGenerationOutputBatchContractV1,
  type CanvasGenerationOutputDescriptorV1,
  type CanvasGenerationOutputItem,
  type CanvasGenerationOutputStrategy,
} from '../domain/generationOutputs';
import { getResultNodeMediaType } from '../domain/nodeRegistry';
import type { RowMediaKind } from '../domain/socketTypes';
import { persistGenerationResult } from '../generation/mediaResultPersist';
import { createAssetGroupGraph, updateAssetGroupDataGraph } from './assetGroupGraph';
import { runCanvasTransaction } from './canvasBatchService';
import { requireCurrentCanvasProject } from './canvasApplicationService';
import { canvasNodeFactory } from './canvasServices';

const logger = createLogger('features.canvas.generation-output');

export class GenerationOutputApplicationError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'UNSUPPORTED_STRATEGY',
    message: string,
  ) {
    super(message);
    this.name = 'GenerationOutputApplicationError';
  }
}

export interface CommitCanvasGenerationOutputsInput {
  /** 旧工程可能在任务运行期间删除来源连线；缺省时仍恢复结果，但不补来源边。 */
  sourceNodeId?: string;
  placeholderNodeId: string;
  resultNodeType: CanvasNodeType;
  contract: CanvasGenerationOutputBatchContractV1;
  completionId?: string;
  groupTitle?: string;
  validateResultPatch?: (patch: DynamicValueMap, descriptor: CanvasGenerationOutputDescriptorV1) => void;
  /** 测试与后续本地处理器可注入；生产默认走统一媒体落盘入口。 */
  persistOutput?: (mediaType: RowMediaKind, source: string) => Promise<DynamicValueMap>;
}

export interface CommitCanvasGenerationOutputsResult {
  projectId: string;
  completionId: string;
  strategy: CanvasGenerationOutputStrategy;
  resultNodeIds: string[];
  groupNodeId: string | null;
  idempotent: boolean;
}

function requireCurrentProjectId(): string {
  const project = useProjectStore.getState();
  if (!project.currentProjectId || project.currentProject?.id !== project.currentProjectId) {
    throw new GenerationOutputApplicationError('NOT_FOUND', '当前画布项目不可用');
  }
  return project.currentProjectId;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', `多结果输出字段 ${field} 不能为空`);
  }
  return value.trim();
}

function validatePersistedMediaPatch(mediaType: RowMediaKind, patch: DynamicValueMap): void {
  const field = mediaType === 'image' ? 'imageUrl' : mediaType === 'video' ? 'videoUrl' : 'audioUrl';
  requireNonEmptyString(patch[field], field);
}

/**
 * 纯契约校验同时返回稳定顺序；调用方不得按网络完成顺序落图。
 */
export function validateGenerationOutputBatchContract(
  contract: CanvasGenerationOutputBatchContractV1,
): CanvasGenerationOutputItem[] {
  if (contract.version !== 1) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', `不支持的多结果契约版本：${String(contract.version)}`);
  }
  if (contract.outputs.length === 0) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '生成结果为空，无法创建结果节点');
  }
  if (!CANVAS_GENERATION_OUTPUT_STRATEGIES.includes(contract.strategy)) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', `未知的多结果落图策略：${String(contract.strategy)}`);
  }
  if (!CANVAS_GENERATION_RESULT_KINDS.includes(contract.resultKind)) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', `未知的结果语义：${String(contract.resultKind)}`);
  }
  if (
    contract.expectedOutputCount !== undefined
    && (!Number.isInteger(contract.expectedOutputCount) || contract.expectedOutputCount < 1)
  ) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '预期输出数量必须为正整数');
  }
  if (
    contract.expectedOutputCount !== undefined
    && contract.outputs.length !== contract.expectedOutputCount
  ) {
    throw new GenerationOutputApplicationError(
      'INVALID_INPUT',
      `生成结果数量不符：预期 ${contract.expectedOutputCount}，实际 ${contract.outputs.length}`,
    );
  }
  if (contract.strategy === 'single' && contract.outputs.length !== 1) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', 'single 策略必须且只能包含一个输出');
  }
  if (contract.strategy === 'assetGroup' && contract.outputs.length < 2) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', 'assetGroup 策略至少需要两个输出');
  }
  if (
    contract.strategy === 'assetGroup'
    && contract.resultKind !== 'image-group'
    && contract.resultKind !== 'media-group'
  ) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', 'assetGroup 策略的结果语义必须为 image-group 或 media-group');
  }
  if (contract.strategy === 'layer-stack' && contract.resultKind !== 'layer-stack') {
    throw new GenerationOutputApplicationError('INVALID_INPUT', 'layer-stack 策略的结果语义必须为 layer-stack');
  }

  const outputIds = new Set<string>();
  const sourceIndexes = new Set<number>();
  const orders = new Set<number>();
  for (const item of contract.outputs) {
    requireNonEmptyString(item.source, 'source');
    const descriptor = item.descriptor;
    if (descriptor.version !== 1) {
      throw new GenerationOutputApplicationError('INVALID_INPUT', '输出描述符版本必须为 1');
    }
    const outputId = requireNonEmptyString(descriptor.outputId, 'outputId');
    if (outputIds.has(outputId)) {
      throw new GenerationOutputApplicationError('INVALID_INPUT', `输出编号重复：${outputId}`);
    }
    outputIds.add(outputId);
    if (!Number.isInteger(descriptor.order) || descriptor.order < 0 || orders.has(descriptor.order)) {
      throw new GenerationOutputApplicationError('INVALID_INPUT', `输出顺序无效或重复：${descriptor.order}`);
    }
    orders.add(descriptor.order);
    if (
      !Number.isInteger(descriptor.sourceOutputIndex)
      || descriptor.sourceOutputIndex < 0
      || sourceIndexes.has(descriptor.sourceOutputIndex)
    ) {
      throw new GenerationOutputApplicationError(
        'INVALID_INPUT',
        `来源输出索引无效或重复：${descriptor.sourceOutputIndex}`,
      );
    }
    sourceIndexes.add(descriptor.sourceOutputIndex);
    requireNonEmptyString(descriptor.semantic.kind, 'semantic.kind');
    if (!CANVAS_GENERATION_RESULT_KINDS.includes(descriptor.semantic.resultKind)) {
      throw new GenerationOutputApplicationError('INVALID_INPUT', `未知的成员结果语义：${String(descriptor.semantic.resultKind)}`);
    }
    if (!['image', 'video', 'audio'].includes(descriptor.mediaType)) {
      throw new GenerationOutputApplicationError('INVALID_INPUT', `未知的媒体类型：${String(descriptor.mediaType)}`);
    }
    if (descriptor.profile) {
      requireNonEmptyString(descriptor.profile.id, 'profile.id');
      if (descriptor.profile.precision !== undefined) {
        requireNonEmptyString(descriptor.profile.precision, 'profile.precision');
      }
    }
    if (contract.strategy === 'layer-stack') {
      if (!descriptor.layer || descriptor.layer.index !== descriptor.order) {
        throw new GenerationOutputApplicationError('INVALID_INPUT', '图层栈输出必须提供与顺序一致的 layer.index');
      }
      if (
        descriptor.layer.opacity !== undefined
        && (!Number.isFinite(descriptor.layer.opacity)
          || descriptor.layer.opacity < 0
          || descriptor.layer.opacity > 1)
      ) {
        throw new GenerationOutputApplicationError('INVALID_INPUT', '图层透明度必须位于 0 到 1 之间');
      }
      if (descriptor.layer.blendMode !== undefined) {
        requireNonEmptyString(descriptor.layer.blendMode, 'layer.blendMode');
      }
    }
  }

  const ordered = [...contract.outputs].sort((left, right) => (
    left.descriptor.order - right.descriptor.order
    || left.descriptor.sourceOutputIndex - right.descriptor.sourceOutputIndex
  ));
  if (ordered.some((item, index) => item.descriptor.order !== index)) {
    throw new GenerationOutputApplicationError('INVALID_INPUT', '输出顺序必须从 0 开始且连续');
  }
  return ordered;
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

export function resolveGenerationOutputStrategy(input: {
  outputCount: number;
  resultKind?: string;
}): CanvasGenerationOutputStrategy {
  if (input.resultKind === 'layer-stack') return 'layer-stack';
  if (input.outputCount === 1) return 'single';
  return 'assetGroup';
}

export async function commitCanvasGenerationOutputs(
  input: CommitCanvasGenerationOutputsInput,
): Promise<CommitCanvasGenerationOutputsResult> {
  const ordered = validateGenerationOutputBatchContract(input.contract);
  if (input.contract.strategy === 'layer-stack') {
    throw new GenerationOutputApplicationError(
      'UNSUPPORTED_STRATEGY',
      '图层堆栈落图已建立契约，但需等待图层数据契约完成后才能提交',
    );
  }
  const projectId = requireCurrentProjectId();
  requireCurrentCanvasProject(projectId);
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

  const before = useCanvasStore.getState();
  const sourceNode = input.sourceNodeId
    ? before.nodes.find((node) => node.id === input.sourceNodeId)
    : null;
  const placeholder = before.nodes.find((node) => node.id === input.placeholderNodeId);
  if ((input.sourceNodeId && !sourceNode) || !placeholder || placeholder.type !== input.resultNodeType) {
    throw new GenerationOutputApplicationError('NOT_FOUND', '生成来源或结果占位节点已不存在');
  }
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

  try {
    const persistOutput = input.persistOutput ?? persistGenerationResult;
    const patches = await Promise.all(ordered.map(async (item) => {
      const patch = await persistOutput(item.descriptor.mediaType, item.source);
      validatePersistedMediaPatch(item.descriptor.mediaType, patch);
      input.validateResultPatch?.(patch, item.descriptor);
      return patch;
    }));

    requireCurrentCanvasProject(projectId);
    const latest = useCanvasStore.getState();
    if (
      (input.sourceNodeId && !latest.nodes.some((node) => node.id === input.sourceNodeId))
      || !latest.nodes.some((node) => node.id === input.placeholderNodeId)
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
        useCanvasStore.getState().updateNodeData(input.placeholderNodeId, firstData);
        if (input.sourceNodeId) {
          useCanvasStore.getState().addEdge(input.sourceNodeId, input.placeholderNodeId);
        }
        resultNodeIds.push(input.placeholderNodeId);

        for (let index = 1; index < ordered.length; index += 1) {
          const canvas = useCanvasStore.getState();
          const position = input.sourceNodeId
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
  }
}
