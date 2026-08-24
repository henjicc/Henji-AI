import { registry } from '@/core/ModelRegistry';
import { resolveInputLimits } from '@/core/inputs/inputLimits';
import { LinkageEngine } from '@/core/linkage';
import type { ModelDefinition, ParamDef } from '@/core/types';
import { buildParamPresentationItems, type ParamPresentationItem } from '@/core/params/paramPresentation';
import { deriveSocketType, isSocketCompatible } from '@/core/types/SocketType';
import { isParamVisible } from '@/components/params/paramVisibility';
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

export interface VisibleMediaInputPort {
  kind: RowMediaKind;
  handleId: string;
  maxCount: number;
  source: 'primary' | 'schema';
  paramId: string;
}

export interface VisibleSchemaParamRows {
  visibleParams: ParamDef[];
  presentationItems: ParamPresentationItem[];
  displayedParams: ParamDef[];
  linkageEngine: LinkageEngine | null;
}

export function resolveVisibleSchemaParamRows(
  model: ModelDefinition | undefined,
  schema: ParamDef[],
  values: DynamicValueMap,
  excludedParamIds: ReadonlySet<string>,
  connectedParamIds: ReadonlySet<string>,
): VisibleSchemaParamRows {
  const linkageEngine = model?.linkages?.length ? new LinkageEngine(model.linkages) : null;
  const visibleParams = [...schema]
    .filter((param) => !excludedParamIds.has(param.id))
    .filter((param) => isParamVisible(param, values, linkageEngine))
    .map((param): ParamDef => {
      if (!linkageEngine || (param.type !== 'dropdown' && param.type !== 'radio')) return param;
      const options = linkageEngine.getFilteredOptions(param.id, values, schema);
      return !options.length || options === param.options ? param : { ...param, options } as ParamDef;
    })
    .sort((left, right) => left.order - right.order);
  const presentationItems = buildParamPresentationItems(visibleParams, model?.paramPresentation);
  const displayedParams = presentationItems.flatMap((item) => item.kind === 'param'
    ? [item.param]
    : item.params.filter((param) => connectedParamIds.has(param.id)));
  return { visibleParams, presentationItems, displayedParams, linkageEngine };
}

/** schema 上传参数对应的媒体类型；通用文件参数仅在 accept 明确为单一媒体族时参与自动连接。 */
export function getSchemaMediaParamKind(param: ParamDef | undefined): RowMediaKind | null {
  if (!param) return null;
  if (param.type === 'image-upload') return 'image';
  if (param.type === 'video-upload') return 'video';
  if (param.type !== 'file-upload') return null;
  const accepts = 'accept' in param && Array.isArray(param.accept) ? param.accept : [];
  const kinds = new Set<RowMediaKind>();
  for (const accept of accepts) {
    if (accept.startsWith('image/')) kinds.add('image');
    if (accept.startsWith('video/')) kinds.add('video');
    if (accept.startsWith('audio/')) kinds.add('audio');
  }
  return kinds.size === 1 ? [...kinds][0] : null;
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

export function findParamForTargetNode(targetNode: CanvasNode, paramId: string): ParamDef | undefined {
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
  const targetNode = nodeById.get(nodeId);
  for (const edge of incoming) {
    const paramId = parseParamPortId(edge.targetHandle);
    if (!paramId) {
      continue;
    }
    const sourceNode = nodeById.get(edge.source);
    if (!sourceNode) {
      continue;
    }
    const mediaKind = targetNode
      ? getSchemaMediaParamKind(findParamForTargetNode(targetNode, paramId))
      : null;
    if (mediaKind) {
      const previous = Array.isArray(overrides[paramId]) ? overrides[paramId] as DynamicValue[] : [];
      const nextUrls = getNodeMediaOutputs(sourceNode.type, sourceNode.data, edge.sourceHandle ?? undefined)
        .filter((output) => output.kind === mediaKind && Boolean(output.url))
        .map((output) => output.url);
      overrides[paramId] = [...new Set([...previous, ...nextUrls])];
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
