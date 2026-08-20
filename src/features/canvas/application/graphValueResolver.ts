import { registry } from '@/core/ModelRegistry';
import { resolveInputLimits } from '@/core/inputs/inputLimits';
import type { ParamDef } from '@/core/types';
import { deriveSocketType, isSocketCompatible } from '@/core/types/SocketType';
import type { CanvasEdge, CanvasNode, CanvasNodeType } from '../domain/canvasNodes';
import { getIncomingEdges, getNodeIndexById } from '../domain/connectionIndex';
import {
  getCanvasNodeDefinition,
  getNodeMediaOutputs,
  getNodeValueOutput,
  isConnectionCompatible,
  nodeHasSourceHandle,
  nodeHasTargetHandle,
  resolveNodeSourceMediaKind,
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

const MEDIA_LIMIT_KEY: Record<RowMediaKind, 'images' | 'videos' | 'audios'> = {
  image: 'images',
  video: 'videos',
  audio: 'audios',
};

export type ConnectionRejectionReason = 'type-mismatch' | 'media-limit-exceeded';

export interface ParamConnectionValidationResult {
  compatible: boolean;
  reason?: ConnectionRejectionReason;
  mediaKind?: RowMediaKind;
  maxCount?: number;
}

/**
 * 标量值注入解析（数值/源节点 → 下游参数端口）。
 *
 * 与 graphMediaResolver 对称：媒体走整节点端口，标量值走 `param:<id>` 参数端口。
 * 无节点类型特判——上游值由各节点 getValueOutput 声明。
 */
function getDeclaredSourceMediaKind(sourceNode: CanvasNode, sourceHandle?: string | null): RowMediaKind | null {
  return resolveNodeSourceMediaKind(sourceNode.type, sourceNode.data, sourceHandle) ?? null;
}

function sourceEmitsMediaKind(sourceNode: CanvasNode, mediaKind: RowMediaKind, sourceHandle?: string | null): boolean {
  if (getDeclaredSourceMediaKind(sourceNode, sourceHandle) === mediaKind) {
    return true;
  }
  return getNodeMediaOutputs(sourceNode.type, sourceNode.data, sourceHandle ?? undefined)
    .some((output) => output.kind === mediaKind);
}

function resolveTargetHandleMediaKind(
  targetNode: CanvasNode,
  targetHandle: string | null | undefined,
): RowMediaKind | null {
  const paramId = parseParamPortId(targetHandle)
  const handleKind = paramId ? mediaParamIdToKind(paramId) : null
  const acceptedKinds = getCanvasNodeDefinition(targetNode.type)?.ports?.target?.accepts
    ?.filter((kind): kind is RowMediaKind => (
      kind === 'image' || kind === 'video' || kind === 'audio'
    )) ?? []
  if (handleKind) {
    return acceptedKinds.includes(handleKind) ? handleKind : null
  }
  return acceptedKinds.length === 1 ? acceptedKinds[0] : null
}

/**
 * 解析一条具体连线上的媒体类型。普通节点使用声明端口；类型待定的单端口源节点
 * 在首条连线时从目标媒体行反推类型，锁定后则只允许同类型目标。
 */
export function resolveConnectionSourceMediaKind(
  sourceNode: CanvasNode,
  targetNode: CanvasNode,
  sourceHandle: string | null | undefined,
  targetHandle: string | null | undefined,
): RowMediaKind | undefined {
  const targetKind = resolveTargetHandleMediaKind(targetNode, targetHandle)
  if (!targetKind) {
    return undefined
  }

  const declaredKind = resolveNodeSourceMediaKind(sourceNode.type, sourceNode.data, sourceHandle)
  if (declaredKind) {
    return declaredKind === targetKind ? declaredKind : undefined
  }

  const definition = getCanvasNodeDefinition(sourceNode.type)
  const normalizedSourceHandle = sourceHandle ?? 'source'
  if (
    definition?.connectivity.lockSourceMediaOnFirstConnection !== true
    || normalizedSourceHandle !== 'source'
  ) {
    return undefined
  }
  const supportedKinds = Object.values(definition.ports?.source?.handles ?? {})
  return supportedKinds.includes(targetKind) ? targetKind : undefined
}

function findParamForTargetNode(targetNode: CanvasNode, paramId: string): ParamDef | undefined {
  const modelId = (targetNode.data as { modelId?: DynamicValue }).modelId;
  if (typeof modelId === 'string' && modelId) {
    const storedParam = registry.getSchema(modelId).find((item) => item.id === paramId);
    if (storedParam) {
      return storedParam;
    }
  }

  const generationType = getCanvasNodeDefinition(targetNode.type)?.generation?.modelType;
  if (!generationType) {
    return undefined;
  }

  return registry
    .getModelsByType(generationType)
    .flatMap((model) => model.params)
    .find((item) => item.id === paramId);
}

/** 返回连到本节点参数端口、且有边的 paramId 集合（不要求上游能解析出值） */
export function getConnectedParamIds(nodeId: string, edges: CanvasEdge[]): Set<string> {
  const connected = new Set<string>();
  for (const edge of getIncomingEdges(edges, nodeId)) {
    const paramId = parseParamPortId(edge.targetHandle);
    if (paramId) {
      connected.add(paramId);
    }
  }
  return connected;
}

/**
 * 收集连到本节点参数端口的上游标量值，返回 paramId → value 覆盖表。
 * 同一端口多条连线时后者覆盖前者。
 *
 * 与 collectInputMedia 同理：被节点级选择器高频调用，
 * 必须走 connectionIndex 的引用缓存索引，禁止函数内全量扫描。
 */
export function collectInputValues(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): DynamicValueMap {
  const overrides: DynamicValueMap = {};
  const incoming = getIncomingEdges(edges, nodeId);
  if (incoming.length === 0) {
    return overrides;
  }

  const nodeById = getNodeIndexById(nodes);
  for (const edge of incoming) {
    const paramId = parseParamPortId(edge.targetHandle);
    if (!paramId) {
      continue;
    }
    const sourceNode = nodeById.get(edge.source);
    if (!sourceNode) {
      continue;
    }
    const output = getNodeValueOutput(sourceNode.type, sourceNode.data);
    if (output) {
      overrides[paramId] = output.value;
    }
  }
  return overrides;
}

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

  const mediaKind = mediaParamIdToKind(paramId);
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

function resolveTargetModelId(targetNode: CanvasNode, nodes: CanvasNode[], edges: CanvasEdge[]): string | null {
  const injectedValues = collectInputValues(targetNode.id, nodes, edges);
  const injectedModelId = injectedValues[MODEL_PARAM_ID];
  if (typeof injectedModelId === 'string' && registry.getModel(injectedModelId)) {
    return injectedModelId;
  }

  const storedModelId = (targetNode.data as { modelId?: DynamicValue }).modelId;
  return typeof storedModelId === 'string' && registry.getModel(storedModelId)
    ? storedModelId
    : null;
}

function resolveTargetParams(targetNode: CanvasNode, nodes: CanvasNode[], edges: CanvasEdge[]): DynamicValueMap {
  const storedParams = (targetNode.data as { params?: DynamicValue }).params;
  return {
    ...(typeof storedParams === 'object' && storedParams !== null && !Array.isArray(storedParams)
      ? storedParams as DynamicValueMap
      : {}),
    ...collectInputValues(targetNode.id, nodes, edges),
  };
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

  const acceptedKinds = getCanvasNodeDefinition(targetNode.type)?.ports?.target?.accepts ?? [];
  const schemaParamIds = new Set(registry.getSchema(modelId).map((item) => item.id));
  const limits = resolveInputLimits(modelId, resolveTargetParams(targetNode, nodes, edges));
  const mediaUsage: Partial<Record<RowMediaKind, number>> = {};
  const staleEdgeIds: string[] = [];

  for (const edge of edges) {
    if (edge.target !== targetNode.id) {
      continue;
    }
    const paramId = parseParamPortId(edge.targetHandle);
    if (!paramId || paramId === MODEL_PARAM_ID || paramId === PROMPT_PARAM_ID) {
      continue;
    }

    const mediaKind = mediaParamIdToKind(paramId);
    if (mediaKind) {
      const maxCount = acceptedKinds.includes(mediaKind) ? limits[MEDIA_LIMIT_KEY[mediaKind]].max : 0;
      const usedCount = mediaUsage[mediaKind] ?? 0;
      if (usedCount >= maxCount) {
        staleEdgeIds.push(edge.id);
      } else {
        mediaUsage[mediaKind] = usedCount + 1;
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

    const edgeParamId = parseParamPortId(edge.targetHandle);
    if (edgeParamId && mediaParamIdToKind(edgeParamId) !== mediaKind) {
      continue;
    }
    if (!edgeParamId && edge.targetHandle !== 'target') {
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
  const mediaKind = paramId ? mediaParamIdToKind(paramId) : null;
  if (!mediaKind || !targetHandle) {
    return { compatible: true };
  }

  const modelId = resolveTargetModelId(targetNode, nodes, edges);
  if (!modelId) {
    return { compatible: true };
  }

  const limits = resolveInputLimits(modelId, resolveTargetParams(targetNode, nodes, edges));
  const maxCount = limits[MEDIA_LIMIT_KEY[mediaKind]].max;
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

/** 字符串集合内容相等比较（供 store selector 避免无效重渲染） */
export function areStringSetsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) {
    return true;
  }
  if (a.size !== b.size) {
    return false;
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false;
    }
  }
  return true;
}

/** 覆盖表内容相等比较（供 store selector 避免无效重渲染） */
export function areValueOverridesEqual(
  a: DynamicValueMap,
  b: DynamicValueMap
): boolean {
  if (a === b) {
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  return keysA.every((key) => Object.is(a[key], b[key]));
}
