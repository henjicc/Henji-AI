import { registry } from '@/core/ModelRegistry';
import { deriveSocketType, isSocketCompatible } from '@/core/types/SocketType';

import type { CanvasEdge, CanvasNode, CanvasNodeType } from '../domain/canvasNodes';
import {
  getCanvasNodeDefinition,
  getNodeMediaOutputs,
  getNodeValueOutput,
  isConnectionCompatible,
  nodeHasSourceHandle,
  nodeHasTargetHandle,
} from '../domain/nodeRegistry';
import {
  MODEL_PARAM_ID,
  PROMPT_PARAM_ID,
  mediaParamIdToKind,
  modelPortId,
  paramPortId,
  parseParamPortId,
  isParamPortId,
  promptPortId,
  resolveMediaTargetHandle,
  type RowMediaKind,
} from '../domain/socketTypes';
import {
  getDeclaredSourceMediaKind,
  resolveConnectionSourceMediaKind,
  resolveVisibleMediaInputPorts,
  sourceEmitsMediaKind,
  type ParamConnectionValidationResult,
} from './graphMediaPortResolver';
import {
  findParamForTargetNode,
  getSchemaMediaParamKind,
} from './graphValueSchema';

/**
 * 校验一条「源节点输出 → 目标节点参数端口」连线是否类型兼容。
 *
 * @param targetHandle 目标参数端口 handle id（形如 'param:duration'/'param:__image'/'param:__model'）
 * 媒体端口（__image/__video/__audio）校验上游媒体输出 kind；
 * 模型端口（__model）与提示词端口（__prompt）校验上游标量值输出的插槽类型；
 * 其余视为模型 schema 中的真实参数，按推导插槽类型校验。
 */
export function isParamConnectionCompatible(
  sourceNode: CanvasNode,
  targetNode: CanvasNode,
  targetHandle: string | null | undefined,
  sourceHandle?: string | null,
): boolean {
  const paramId = parseParamPortId(targetHandle);
  if (!paramId) {
    return false;
  }

  const mediaKind = mediaParamIdToKind(paramId) ?? getSchemaMediaParamKind(findParamForTargetNode(targetNode, paramId));
  if (mediaKind) {
    return resolveConnectionSourceMediaKind(
      sourceNode,
      targetNode,
      sourceHandle,
      targetHandle,
    ) === mediaKind || sourceEmitsMediaKind(sourceNode, mediaKind, sourceHandle);
  }

  if (paramId === MODEL_PARAM_ID) {
    const output = getNodeValueOutput(sourceNode.type, sourceNode.data);
    if (output?.socketType !== 'MODEL') {
      return false;
    }
    const generationType = getCanvasNodeDefinition(targetNode.type)?.generation?.modelType;
    if (!generationType) {
      return true;
    }
    if (typeof output.value !== 'string') {
      return false;
    }
    return registry.getModel(output.value)?.meta.type === generationType;
  }

  if (paramId === PROMPT_PARAM_ID) {
    const output = getNodeValueOutput(sourceNode.type, sourceNode.data);
    return Boolean(output) && isSocketCompatible(output!.socketType, 'STRING');
  }

  const output = getNodeValueOutput(sourceNode.type, sourceNode.data);
  if (!output) {
    return false;
  }
  const param = findParamForTargetNode(targetNode, paramId);
  if (!param) {
    return false;
  }
  return isSocketCompatible(output.socketType, deriveSocketType(param));
}

/**
 * 模型切换后回收失效连线：找出指向本节点参数端口、但目标端口在当前模型下已不存在
 * （schema 中无此参数 / 媒体类型已不被接受或上限降为 0 / 媒体连接数超出新上限）的 edge id。
 * 仅在节点自身 modelId 直接变化时调用；模型选择器连线覆盖模型的场景暂不在此处理。
 */
export function findStaleParamEdgeIds(
  targetNode: CanvasNode,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): string[] {
  const modelId = (targetNode.data as { modelId?: DynamicValue }).modelId;
  if (typeof modelId !== 'string' || !modelId || !registry.getModel(modelId)) {
    return [];
  }

  const schemaParamIds = new Set(registry.getSchema(modelId).map((item) => item.id));
  const visibleMediaPorts = new Map(
    resolveVisibleMediaInputPorts(targetNode, nodes, edges).map((port) => [port.handleId, port] as const),
  );
  const mediaUsage = new Map<string, number>();
  const staleEdgeIds: string[] = [];

  for (const edge of edges) {
    if (edge.target !== targetNode.id) {
      continue;
    }
    const paramId = parseParamPortId(edge.targetHandle);
    if (!paramId || paramId === MODEL_PARAM_ID || paramId === PROMPT_PARAM_ID) {
      continue;
    }

    const mediaKind = mediaParamIdToKind(paramId)
      ?? getSchemaMediaParamKind(findParamForTargetNode(targetNode, paramId));
    if (mediaKind) {
      const handleId = paramPortId(paramId);
      const port = visibleMediaPorts.get(handleId);
      const usedCount = mediaUsage.get(handleId) ?? 0;
      if (!port || usedCount >= port.maxCount) {
        staleEdgeIds.push(edge.id);
      } else {
        mediaUsage.set(handleId, usedCount + 1);
      }
      continue;
    }

    if (!schemaParamIds.has(paramId)) {
      staleEdgeIds.push(edge.id);
    }
  }

  return staleEdgeIds;
}

function isSameConnection(edge: CanvasEdge, sourceNode: CanvasNode, targetNode: CanvasNode, targetHandle: string): boolean {
  return edge.source === sourceNode.id &&
    edge.target === targetNode.id &&
    (edge.sourceHandle ?? 'source') === 'source' &&
    (edge.targetHandle ?? 'target') === targetHandle;
}

function countMediaConnections(
  targetNode: CanvasNode,
  mediaKind: RowMediaKind,
  targetHandle: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  sourceNode: CanvasNode
): number {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  let count = 0;

  for (const edge of edges) {
    if (edge.target !== targetNode.id || isSameConnection(edge, sourceNode, targetNode, targetHandle)) {
      continue;
    }

    if ((edge.targetHandle ?? 'target') !== targetHandle) {
      continue;
    }

    const edgeSourceNode = nodeById.get(edge.source);
    if (edgeSourceNode && sourceEmitsMediaKind(edgeSourceNode, mediaKind, edge.sourceHandle)) {
      count += 1;
    }
  }

  return count;
}

export function validateParamConnection(
  sourceNode: CanvasNode,
  targetNode: CanvasNode,
  targetHandle: string | null | undefined,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  sourceHandle?: string | null,
): ParamConnectionValidationResult {
  if (!isParamConnectionCompatible(sourceNode, targetNode, targetHandle, sourceHandle)) {
    return { compatible: false, reason: 'type-mismatch' };
  }

  const paramId = parseParamPortId(targetHandle);
  const param = paramId ? findParamForTargetNode(targetNode, paramId) : undefined;
  const mediaKind = paramId ? (mediaParamIdToKind(paramId) ?? getSchemaMediaParamKind(param)) : null;
  if (!mediaKind || !targetHandle) {
    return { compatible: true };
  }

  const port = resolveVisibleMediaInputPorts(targetNode, nodes, edges)
    .find((candidate) => candidate.handleId === targetHandle && candidate.kind === mediaKind);
  if (!port) return { compatible: false, reason: 'type-mismatch' };
  const maxCount = port.maxCount;
  const currentCount = countMediaConnections(targetNode, mediaKind, targetHandle, nodes, edges, sourceNode);

  return currentCount < maxCount
    ? { compatible: true }
    : { compatible: false, reason: 'media-limit-exceeded', mediaKind, maxCount };
}

function createPreviewNode(type: CanvasNodeType): CanvasNode | null {
  const definition = getCanvasNodeDefinition(type);
  if (!definition) {
    return null;
  }
  return {
    id: `preview-${type}`,
    type,
    position: { x: 0, y: 0 },
    data: definition.createDefaultData(),
  } as CanvasNode;
}

function resolveSchemaTargetHandle(sourceNode: CanvasNode, targetNode: CanvasNode): string | null {
  const output = getNodeValueOutput(sourceNode.type, sourceNode.data);
  const modelId = (targetNode.data as { modelId?: DynamicValue }).modelId;
  if (!output || typeof modelId !== 'string' || !modelId) {
    return null;
  }

  const param = registry.getSchema(modelId).find((item) =>
    isSocketCompatible(output.socketType, deriveSocketType(item))
  );
  return param ? paramPortId(param.id) : null;
}

export function resolveCompatibleTargetHandleForSource(
  sourceNode: CanvasNode,
  targetType: CanvasNodeType,
  sourceHandle?: string | null,
): string | null {
  if (!nodeHasTargetHandle(targetType)) {
    return null;
  }

  const targetNode = createPreviewNode(targetType);
  if (!targetNode) {
    return null;
  }

  const declaredKind = getDeclaredSourceMediaKind(sourceNode, sourceHandle)
  const targetAcceptedKinds = getCanvasNodeDefinition(targetType)?.ports?.target?.accepts
    ?.filter((kind): kind is RowMediaKind => (
      kind === 'image' || kind === 'video' || kind === 'audio'
    )) ?? []
  const inferredKind = !declaredKind
    && (sourceHandle ?? 'source') === 'source'
    && targetAcceptedKinds.length === 1
    ? targetAcceptedKinds[0]
    : null
  const connectionKind = declaredKind ?? inferredKind
  if (connectionKind) {
    const mediaTargetHandle = resolveMediaTargetHandle(targetType, connectionKind)
    if (isParamConnectionCompatible(sourceNode, targetNode, mediaTargetHandle, sourceHandle)) {
      return mediaTargetHandle
    }
    if (isConnectionCompatible(sourceNode.type, targetType, sourceHandle, sourceNode.data)) {
      return 'target'
    }
  }

  for (const output of getNodeMediaOutputs(sourceNode.type, sourceNode.data, sourceHandle ?? undefined)) {
    if (output.kind === 'image' || output.kind === 'video' || output.kind === 'audio') {
      if (isParamConnectionCompatible(
        sourceNode,
        targetNode,
        resolveMediaTargetHandle(targetType, output.kind as RowMediaKind),
        sourceHandle,
      )) {
        return resolveMediaTargetHandle(targetType, output.kind as RowMediaKind);
      }
      if (isConnectionCompatible(sourceNode.type, targetType, sourceHandle, sourceNode.data)) {
        return 'target';
      }
    }
  }

  const valueOutput = getNodeValueOutput(sourceNode.type, sourceNode.data);
  if (!valueOutput) {
    return null;
  }

  if (isParamConnectionCompatible(sourceNode, targetNode, modelPortId())) {
    return modelPortId();
  }
  if (isParamConnectionCompatible(sourceNode, targetNode, promptPortId())) {
    return promptPortId();
  }
  return resolveSchemaTargetHandle(sourceNode, targetNode);
}

export function canSourceTypeConnectToTargetHandle(
  sourceType: CanvasNodeType,
  targetNode: CanvasNode,
  targetHandle: string | null | undefined,
  sourceHandle?: string | null,
): boolean {
  if (!nodeHasSourceHandle(sourceType)) {
    return false;
  }

  const sourceNode = createPreviewNode(sourceType);
  if (!sourceNode) {
    return false;
  }

  return isParamPortId(targetHandle)
    ? isParamConnectionCompatible(sourceNode, targetNode, targetHandle, sourceHandle)
    : isConnectionCompatible(sourceType, targetNode.type, sourceHandle, sourceNode.data);
}
