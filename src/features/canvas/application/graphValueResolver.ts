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

/**
 * 标量值注入解析（数值/源节点 → 下游参数端口）。
 *
 * 与 graphMediaResolver 对称：媒体走整节点端口，标量值走 `param:<id>` 参数端口。
 * 无节点类型特判——上游值由各节点 getValueOutput 声明。
 */

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
    return getNodeMediaOutputs(sourceNode.type, sourceNode.data)
      .some((output) => output.kind === mediaKind);
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
  const modelId = (targetNode.data as { modelId?: DynamicValue }).modelId;
  if (typeof modelId !== 'string' || !modelId) {
    return false;
  }
  const param = registry.getSchema(modelId).find((item) => item.id === paramId);
  if (!param) {
    return false;
  }
  return isSocketCompatible(output.socketType, deriveSocketType(param));
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
