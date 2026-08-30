import {
  createDefaultImageEditColorModeV3,
  type ImageEditColorModeV3,
} from './colorTypes';
import {
  IMAGE_EDIT_DOCUMENT_VERSION_V3,
  type ImageEditCanvasGeometryV3,
  type ImageEditDocumentV3,
} from './documentTypes';
import {
  createImageEditLayerCommonV3,
  type ImageEditAdjustmentLayerV3,
  type ImageEditAnnotationLayerV3,
  type ImageEditEffectLayerV3,
  type ImageEditGroupLayerV3,
  type ImageEditJsonObjectV3,
  type ImageEditRasterLayerV3,
} from './layerTypes';

export type ImageEditIdFactoryV3 = (prefix: string) => string;

export interface CreateImageEditDocumentOptionsV3 {
  width: number;
  height: number;
  documentId?: string;
  sourceResourceId?: string;
  color?: ImageEditColorModeV3;
  idFactory?: ImageEditIdFactoryV3;
}

export function createImageEditIdV3(prefix: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${suffix}`;
}

export function createImageEditCanvasGeometryV3(
  width: number,
  height: number
): ImageEditCanvasGeometryV3 {
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new RangeError('图片编辑画布尺寸必须是正整数');
  }
  return {
    width,
    height,
    orientation: { rotate: 0, mirrored: false },
    crop: null,
  };
}

export function createImageEditRasterLayerV3(
  id: string,
  name: string,
  sourceResourceId?: string
): ImageEditRasterLayerV3 {
  return {
    ...createImageEditLayerCommonV3(id, name),
    type: 'raster',
    source: sourceResourceId
      ? { kind: 'resource', resourceId: sourceResourceId }
      : { kind: 'empty' },
    tiles: {},
  };
}

export function createImageEditAnnotationLayerV3(
  id: string,
  name: string
): ImageEditAnnotationLayerV3 {
  return {
    ...createImageEditLayerCommonV3(id, name),
    type: 'annotation',
    annotations: [],
  };
}

export function createImageEditEffectLayerV3(
  id: string,
  name: string,
  effectId: string,
  params: ImageEditJsonObjectV3,
  renderable = true
): ImageEditEffectLayerV3 {
  return {
    ...createImageEditLayerCommonV3(id, name),
    type: 'effect',
    effectId,
    params,
    renderable,
  };
}

export function createImageEditAdjustmentLayerV3(
  id: string,
  name: string,
  adjustmentId: string,
  params: ImageEditJsonObjectV3,
  renderable = true
): ImageEditAdjustmentLayerV3 {
  return {
    ...createImageEditLayerCommonV3(id, name),
    type: 'adjustment',
    adjustmentId,
    params,
    renderable,
  };
}

export function createImageEditGroupLayerV3(
  id: string,
  name: string
): ImageEditGroupLayerV3 {
  return {
    ...createImageEditLayerCommonV3(id, name),
    type: 'group',
    children: [],
    isolated: false,
  };
}

export function createImageEditDocumentV3(
  options: CreateImageEditDocumentOptionsV3
): ImageEditDocumentV3 {
  const idFactory = options.idFactory ?? createImageEditIdV3;
  const layers = options.sourceResourceId
    ? [createImageEditRasterLayerV3(idFactory('layer'), '原图', options.sourceResourceId)]
    : [];
  return {
    version: IMAGE_EDIT_DOCUMENT_VERSION_V3,
    id: options.documentId ?? idFactory('document'),
    revision: 0,
    geometry: createImageEditCanvasGeometryV3(options.width, options.height),
    color: options.color ?? createDefaultImageEditColorModeV3(),
    layers,
  };
}
