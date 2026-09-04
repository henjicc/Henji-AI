export const LAYER_STACK_VERSION = 1 as const;

export type LayerStackStatus = 'ready' | 'degraded';
export type LayerStackResourceStatus = 'ready' | 'missing';

export interface LayerStackMediaResourceV1 {
  version: 1;
  resourceId: string;
  status: LayerStackResourceStatus;
  filePath: string | null;
  mimeType: 'image/png' | 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
  hasAlpha: boolean;
  byteLength: number | null;
  sha256: string | null;
}

export interface LayerStackLayerV1 {
  version: 1;
  layerId: string;
  sourceOutputIndex: number;
  providerZIndex: number | null;
  order: number;
  role: 'base' | 'content';
  name: string;
  description?: string;
  resourceId: string;
  placement: { x: number; y: number; width: number; height: number };
  opacity: number;
  visible: boolean;
  blendMode: 'normal';
  alpha: 'opaque' | 'straight';
  sourceBounds?: {
    absolute?: [number, number, number, number];
    normalized?: [number, number, number, number];
  };
}

export interface LayerStackDocumentV1 {
  version: 1;
  stackId: string;
  status: LayerStackStatus;
  source: {
    capabilityId: 'image.layer-separation';
    sourceNodeId: string;
    inputResourceId: string;
    inputResourceStatus?: 'ready' | 'missing';
    providerId: string;
    modelId: string;
    providerRequestId?: string;
    completionId: string;
  };
  canvas: {
    width: number;
    height: number;
    colorSpace: 'srgb';
    alphaMode: 'straight';
    compositeOperation: 'source-over';
    clipPolicy: 'canvas-bounds';
  };
  compositeResourceId: string | null;
  thumbnailResourceId: string | null;
  layers: LayerStackLayerV1[];
  resources: LayerStackMediaResourceV1[];
}

export class LayerStackContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayerStackContractError';
  }
}

export function createStableLayerStackId(completionId: string): string {
  const normalized = requireString(completionId, 'completionId');
  return `layer-stack:${stableHash(normalized)}`;
}

export function createStableLayerId(stackId: string, sourceOutputIndex: number): string {
  requireIndex(sourceOutputIndex, 'sourceOutputIndex');
  return `${requireString(stackId, 'stackId')}:layer:${sourceOutputIndex}`;
}

export function createStableLayerResourceId(stackId: string, sourceOutputIndex: number): string {
  requireIndex(sourceOutputIndex, 'sourceOutputIndex');
  return `${requireString(stackId, 'stackId')}:resource:${sourceOutputIndex}`;
}

export function validateLayerStackDocument(value: LayerStackDocumentV1): LayerStackDocumentV1 {
  if (!value || typeof value !== 'object') throw new LayerStackContractError('图层栈必须为对象');
  if (value.version !== 1) throw new LayerStackContractError(`不支持的图层栈版本：${String(value.version)}`);
  requireString(value.stackId, 'stackId');
  if (!value.source || typeof value.source !== 'object') throw new LayerStackContractError('图层栈来源无效');
  if (value.stackId !== createStableLayerStackId(value.source.completionId)) {
    throw new LayerStackContractError('图层栈编号与 completionId 不一致');
  }
  if (value.source.capabilityId !== 'image.layer-separation') throw new LayerStackContractError('图层栈能力编号无效');
  requireString(value.source.sourceNodeId, 'sourceNodeId');
  requireString(value.source.inputResourceId, 'inputResourceId');
  if (value.source.inputResourceStatus !== undefined
    && value.source.inputResourceStatus !== 'ready'
    && value.source.inputResourceStatus !== 'missing') {
    throw new LayerStackContractError('图层栈来源资源状态无效');
  }
  requireString(value.source.providerId, 'providerId');
  requireString(value.source.modelId, 'modelId');
  if (value.status !== 'ready' && value.status !== 'degraded') throw new LayerStackContractError('图层栈状态无效');
  if (!value.canvas || typeof value.canvas !== 'object') throw new LayerStackContractError('图层栈画布无效');
  if (!Number.isInteger(value.canvas.width) || value.canvas.width < 1
    || !Number.isInteger(value.canvas.height) || value.canvas.height < 1) {
    throw new LayerStackContractError('画布宽高必须为正整数');
  }
  if (
    value.canvas.colorSpace !== 'srgb'
    || value.canvas.alphaMode !== 'straight'
    || value.canvas.compositeOperation !== 'source-over'
    || value.canvas.clipPolicy !== 'canvas-bounds'
  ) {
    throw new LayerStackContractError('图层栈 V1 合成规则无效');
  }
  if (!Array.isArray(value.layers) || value.layers.length < 1 || value.layers.length > 17) throw new LayerStackContractError('图层数量必须为 1..17');
  if (!Array.isArray(value.resources)) throw new LayerStackContractError('图层资源列表无效');
  const layerIds = new Set<string>();
  const resourceIds = new Set<string>();
  const sourceIndexes = new Set<number>();
  const resourceById = new Map<string, LayerStackMediaResourceV1>();
  for (const resource of value.resources) {
    if (resource.version !== 1) throw new LayerStackContractError('图层资源版本无效');
    requireString(resource.resourceId, 'resourceId');
    if (resourceIds.has(resource.resourceId)) throw new LayerStackContractError(`资源编号重复：${resource.resourceId}`);
    resourceIds.add(resource.resourceId);
    if (!Number.isInteger(resource.width) || resource.width < 1 || !Number.isInteger(resource.height) || resource.height < 1) {
      throw new LayerStackContractError(`资源尺寸无效：${resource.resourceId}`);
    }
    if (!['image/png', 'image/webp', 'image/jpeg'].includes(resource.mimeType)) {
      throw new LayerStackContractError(`资源 MIME 无效：${resource.resourceId}`);
    }
    if (typeof resource.hasAlpha !== 'boolean') throw new LayerStackContractError(`资源 alpha 标记无效：${resource.resourceId}`);
    if (resource.status === 'ready') {
      requireString(resource.filePath, `资源 ${resource.resourceId} filePath`);
      requireString(resource.sha256, `资源 ${resource.resourceId} sha256`);
      if (resource.byteLength !== null && (!Number.isInteger(resource.byteLength) || resource.byteLength < 1)) {
        throw new LayerStackContractError(`资源字节数无效：${resource.resourceId}`);
      }
    } else if (resource.status !== 'missing') {
      throw new LayerStackContractError(`资源状态无效：${resource.resourceId}`);
    } else if (resource.filePath !== null || resource.sha256 !== null || resource.byteLength !== null) {
      throw new LayerStackContractError(`缺失资源不能保留失效路径或哈希：${resource.resourceId}`);
    }
    resourceById.set(resource.resourceId, resource);
  }
  const ordered = [...value.layers].sort((left, right) => left.order - right.order);
  for (const [index, layer] of ordered.entries()) {
    if (layer.version !== 1) throw new LayerStackContractError('图层版本无效');
    requireString(layer.layerId, 'layerId');
    if (layerIds.has(layer.layerId)) throw new LayerStackContractError(`图层编号重复：${layer.layerId}`);
    layerIds.add(layer.layerId);
    requireIndex(layer.sourceOutputIndex, 'sourceOutputIndex');
    if (sourceIndexes.has(layer.sourceOutputIndex)) throw new LayerStackContractError(`来源索引重复：${layer.sourceOutputIndex}`);
    sourceIndexes.add(layer.sourceOutputIndex);
    if (layer.layerId !== createStableLayerId(value.stackId, layer.sourceOutputIndex)) {
      throw new LayerStackContractError(`图层编号不稳定：${layer.layerId}`);
    }
    if (layer.providerZIndex !== null) requireIndex(layer.providerZIndex, 'providerZIndex');
    if (layer.order !== index) throw new LayerStackContractError('图层顺序必须从 0 开始连续');
    if (layer.opacity < 0 || layer.opacity > 1 || !Number.isFinite(layer.opacity)) throw new LayerStackContractError('图层透明度必须位于 0..1');
    if (typeof layer.visible !== 'boolean') throw new LayerStackContractError('图层可见性无效');
    if (layer.blendMode !== 'normal') throw new LayerStackContractError('V1 仅支持 normal 混合模式');
    if (layer.role !== 'base' && layer.role !== 'content') throw new LayerStackContractError('图层角色无效');
    if (!Number.isInteger(layer.placement.x) || !Number.isInteger(layer.placement.y)
      || !Number.isInteger(layer.placement.width) || layer.placement.width < 1
      || !Number.isInteger(layer.placement.height) || layer.placement.height < 1) {
      throw new LayerStackContractError(`图层位置无效：${layer.layerId}`);
    }
    const resource = resourceById.get(layer.resourceId);
    if (!resource) throw new LayerStackContractError(`图层资源不存在：${layer.resourceId}`);
    if (layer.role === 'content' && (!resource.hasAlpha || resource.mimeType !== 'image/png')) {
      throw new LayerStackContractError(`内容层必须是含透明通道的 PNG：${layer.layerId}`);
    }
    if (resource.width !== layer.placement.width || resource.height !== layer.placement.height) {
      throw new LayerStackContractError(`图层位置尺寸与资源不一致：${layer.layerId}`);
    }
    if (layer.role === 'base' && (
      index !== 0
      || layer.placement.x !== 0
      || layer.placement.y !== 0
      || layer.placement.width !== value.canvas.width
      || layer.placement.height !== value.canvas.height
    )) throw new LayerStackContractError('底图必须覆盖画布并位于最底层');
  }
  if (ordered[0]?.role !== 'base') throw new LayerStackContractError('图层栈缺少底图');
  if (ordered.filter((layer) => layer.role === 'base').length !== 1) throw new LayerStackContractError('图层栈必须且只能包含一个底图');
  const expectedLayerResources = new Set(ordered.map((layer) => layer.resourceId));
  if (expectedLayerResources.size !== ordered.length) throw new LayerStackContractError('多个图层不能共享同一媒体资源');
  if (!value.compositeResourceId || !resourceById.has(value.compositeResourceId)) throw new LayerStackContractError('图层栈缺少合成资源');
  if (!value.thumbnailResourceId || !resourceById.has(value.thumbnailResourceId)) throw new LayerStackContractError('图层栈缺少缩略图资源');
  if (value.compositeResourceId === value.thumbnailResourceId) throw new LayerStackContractError('合成资源与缩略图资源不能相同');
  const hasMissing = value.source.inputResourceStatus === 'missing'
    || value.resources.some((resource) => resource.status === 'missing');
  if (value.status === 'ready' && hasMissing) throw new LayerStackContractError('ready 图层栈不能包含缺失资源');
  if (value.status === 'degraded' && !hasMissing) throw new LayerStackContractError('degraded 图层栈必须包含缺失资源');
  return value;
}

export function reconcileLayerStackMissingResources(
  document: LayerStackDocumentV1,
  existingPaths: ReadonlySet<string>,
): LayerStackDocumentV1 {
  const resources = document.resources.map((resource) => (
    resource.filePath && existingPaths.has(resource.filePath)
      ? resource
      : { ...resource, status: 'missing' as const, filePath: null, byteLength: null, sha256: null }
  ));
  const degraded = document.source.inputResourceStatus === 'missing'
    || resources.some((item) => item.status === 'missing');
  return validateLayerStackDocument({ ...document, status: degraded ? 'degraded' : 'ready', resources });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new LayerStackContractError(`${field} 不能为空`);
  return value.trim();
}

function requireIndex(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) throw new LayerStackContractError(`${field} 必须为非负整数`);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
