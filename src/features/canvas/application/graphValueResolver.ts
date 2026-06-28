import { registry } from '@/core/ModelRegistry';
import { resolveInputLimits } from '@/core/inputs/inputLimits';
import type { ParamDef } from '@/core/types';
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
function getDeclaredSourceMediaKind(sourceNode: CanvasNode): RowMediaKind | null {
  const emits = getCanvasNodeDefinition(sourceNode.type)?.ports?.source?.emits;
  return emits === 'image' || emits === 'video' || emits === 'audio' ? emits : null;
}

function sourceEmitsMediaKind(sourceNode: CanvasNode, mediaKind: RowMediaKind): boolean {
  if (getDeclaredSourceMediaKind(sourceNode) === mediaKind) {
    return true;
  }
  return getNodeMediaOutputs(sourceNode.type, sourceNode.data)
    .some((output) => output.kind === mediaKind);
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
  for (const edge of edges) {
    if (edge.target !== nodeId) {
      continue;
    }
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
 */
export function collectInputValues(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[]
): DynamicValueMap {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const overrides: DynamicValueMap = {};
  for (const edge of edges) {
    if (edge.target !== nodeId) {
      continue;
    }
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
  targetHandle: string | null | undefined
): boolean {
  const paramId = parseParamPortId(targetHandle);
  if (!paramId) {
    return false;
  }

  const mediaKind = mediaParamIdToKind(paramId);
  if (mediaKind) {
    return sourceEmitsMediaKind(sourceNode, mediaKind);
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
    if (edgeSourceNode && sourceEmitsMediaKind(edgeSourceNode, mediaKind)) {
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
  edges: CanvasEdge[]
): ParamConnectionValidationResult {
  if (!isParamConnectionCompatible(sourceNode, targetNode, targetHandle)) {
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
  targetType: CanvasNodeType
): string | null {
  if (!nodeHasTargetHandle(targetType)) {
    return null;
  }

  const targetNode = createPreviewNode(targetType);
  if (!targetNode) {
    return null;
  }

  for (const output of getNodeMediaOutputs(sourceNode.type, sourceNode.data)) {
    if (output.kind === 'image' || output.kind === 'video' || output.kind === 'audio') {
      if (isParamConnectionCompatible(sourceNode, targetNode, resolveMediaTargetHandle(targetType, output.kind as RowMediaKind))) {
        return resolveMediaTargetHandle(targetType, output.kind as RowMediaKind);
      }
      if (isConnectionCompatible(sourceNode.type, targetType)) {
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
  targetHandle: string | null | undefined
): boolean {
  if (!nodeHasSourceHandle(sourceType)) {
    return false;
  }

  const sourceNode = createPreviewNode(sourceType);
  if (!sourceNode) {
    return false;
  }

  return isParamPortId(targetHandle)
    ? isParamConnectionCompatible(sourceNode, targetNode, targetHandle)
    : isConnectionCompatible(sourceType, targetNode.type);
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
