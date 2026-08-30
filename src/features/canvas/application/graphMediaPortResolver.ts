import { resolveInputLimits } from '@/core/inputs/inputLimits';
import { registry } from '@/core/ModelRegistry';

import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes';
import {
  getCanvasNodeDefinition,
  getNodeMediaOutputs,
  resolveNodeSourceMediaKind,
} from '../domain/nodeRegistry';
import {
  MODEL_PARAM_ID,
  mediaParamIdToKind,
  paramPortId,
  parseParamPortId,
  resolveMediaTargetHandle,
  type RowMediaKind,
} from '../domain/socketTypes';
import {
  collectInputValues,
  getConnectedParamIds,
} from './graphParamValueResolver';
import {
  findParamForTargetNode,
  getSchemaMediaParamKind,
  resolveVisibleSchemaParamRows,
} from './graphValueSchema';

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

export interface VisibleMediaInputPort {
  kind: RowMediaKind;
  handleId: string;
  maxCount: number;
  source: 'primary' | 'schema';
  paramId: string;
}

/**
 * 标量值注入解析（数值/源节点 → 下游参数端口）。
 *
 * 与 graphMediaResolver 对称：媒体走整节点端口，标量值走 `param:<id>` 参数端口。
 * 无节点类型特判——上游值由各节点 getValueOutput 声明。
 */
export function getDeclaredSourceMediaKind(sourceNode: CanvasNode, sourceHandle?: string | null): RowMediaKind | null {
  return resolveNodeSourceMediaKind(sourceNode.type, sourceNode.data, sourceHandle) ?? null;
}

export function sourceEmitsMediaKind(sourceNode: CanvasNode, mediaKind: RowMediaKind, sourceHandle?: string | null): boolean {
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
  const handleKind = paramId
    ? (mediaParamIdToKind(paramId) ?? getSchemaMediaParamKind(findParamForTargetNode(targetNode, paramId)))
    : null
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

/**
 * 返回目标节点当前真实可见的媒体输入端口，顺序与 NodeInputRows 一致：
 * 主媒体行（图→视频→音频）在前，随后是按 order 排列的 schema 上传参数。
 */
export function resolveVisibleMediaInputPorts(
  targetNode: CanvasNode,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): VisibleMediaInputPort[] {
  const definition = getCanvasNodeDefinition(targetNode.type);
  if (!definition?.connectivity.targetHandle) return [];

  if (definition.connectivity.targetHandleMode !== 'rows') {
    return (definition.ports?.target?.accepts ?? [])
      .filter((kind): kind is RowMediaKind => kind === 'image' || kind === 'video' || kind === 'audio')
      .map((kind) => ({ kind, handleId: 'target', maxCount: Number.POSITIVE_INFINITY, source: 'primary', paramId: MEDIA_LIMIT_KEY[kind] }));
  }

  const modelId = resolveTargetModelId(targetNode, nodes, edges);
  const values = resolveTargetParams(targetNode, nodes, edges);
  const acceptedKinds = definition.ports?.target?.accepts ?? [];
  const ports: VisibleMediaInputPort[] = [];

  if (modelId) {
    const limits = resolveInputLimits(modelId, values);
    for (const kind of ['image', 'video', 'audio'] as const) {
      const maxCount = acceptedKinds.includes(kind) ? limits[MEDIA_LIMIT_KEY[kind]].max : 0;
      if (maxCount > 0) {
        ports.push({
          kind,
          handleId: resolveMediaTargetHandle(targetNode.type, kind),
          maxCount,
          source: 'primary',
          paramId: parseParamPortId(resolveMediaTargetHandle(targetNode.type, kind)) ?? 'target',
        });
      }
    }

    const model = registry.getModel(modelId);
    const paramRows = resolveVisibleSchemaParamRows(
      model,
      registry.getSchema(modelId),
      values,
      new Set(),
      getConnectedParamIds(targetNode.id, edges),
    );
    for (const param of paramRows.displayedParams) {
      const kind = getSchemaMediaParamKind(param);
      if (!kind) continue;
      const maxCount = 'maxCount' in param && typeof param.maxCount === 'number'
        ? Math.max(0, param.maxCount)
        : 1;
      if (maxCount > 0) {
        ports.push({ kind, handleId: paramPortId(param.id), maxCount, source: 'schema', paramId: param.id });
      }
    }
    return ports;
  }

  for (const kind of ['image', 'video', 'audio'] as const) {
    if (acceptedKinds.includes(kind)) {
      ports.push({
        kind,
        handleId: resolveMediaTargetHandle(targetNode.type, kind),
        maxCount: Number.POSITIVE_INFINITY,
        source: 'primary',
        paramId: parseParamPortId(resolveMediaTargetHandle(targetNode.type, kind)) ?? 'target',
      });
    }
  }
  return ports;
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
