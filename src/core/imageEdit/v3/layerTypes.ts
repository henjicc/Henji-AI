import type { MarkItem } from '../types';

export type ImageEditBlendModeV3 =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light';

export type ImageEditJsonPrimitiveV3 = string | number | boolean | null;
export type ImageEditJsonValueV3 =
  | ImageEditJsonPrimitiveV3
  | ImageEditJsonValueV3[]
  | { [key: string]: ImageEditJsonValueV3 };
export type ImageEditJsonObjectV3 = { [key: string]: ImageEditJsonValueV3 };

/** 2D 仿射矩阵，顺序与 CanvasTransform 的 a,b,c,d,e,f 一致。 */
export type ImageEditTransformV3 = readonly [number, number, number, number, number, number];

export const IMAGE_EDIT_MASK_TILE_SIZE_V3 = 512 as const;

/** V3 早期文档保存的单一栅格资源蒙版；永久保留读取能力。 */
export interface ImageEditLegacyMaskReferenceV3 {
  resourceId: string;
  inverted: boolean;
}

/**
 * 可编辑蒙版只保存不可变 Float32 瓦片的内容寻址引用。
 * 缺失瓦片等价于 defaultValue，不允许把整幅蒙版或 Data URL 写进文档。
 */
export interface ImageEditSparseMaskReferenceV3 {
  kind: 'sparse-mask';
  storage: 'mask-float32';
  maskId: string;
  tileSize: typeof IMAGE_EDIT_MASK_TILE_SIZE_V3;
  /** 缺失瓦片的值；普通图层蒙版默认 1，局部重绘/选区蒙版可显式使用 0。 */
  defaultValue: 0 | 1;
  /** `mip/x/y` → 内容寻址瓦片资源 ID。首版权威编辑只写 mip 0。 */
  tiles: Record<string, string>;
  inverted: boolean;
}

export type ImageEditMaskReferenceV3 =
  | ImageEditLegacyMaskReferenceV3
  | ImageEditSparseMaskReferenceV3;

export interface ImageEditLayerCommonV3 {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: ImageEditBlendModeV3;
  transform: ImageEditTransformV3;
  mask: ImageEditMaskReferenceV3 | null;
}

export type ImageEditRasterSourceV3 =
  | { kind: 'empty' }
  | { kind: 'resource'; resourceId: string };

export interface ImageEditRasterLayerV3 extends ImageEditLayerCommonV3 {
  type: 'raster';
  source: ImageEditRasterSourceV3;
  /** `mip/x/y` → 内容寻址瓦片资源 ID；空记录表示没有稀疏覆盖。 */
  tiles: Record<string, string>;
}

export interface ImageEditAnnotationLayerV3 extends ImageEditLayerCommonV3 {
  type: 'annotation';
  annotations: MarkItem[];
}

export interface ImageEditLegacyOperationV3 {
  sourceVersion: 2;
  operation: ImageEditJsonObjectV3;
}

export interface ImageEditEffectLayerV3 extends ImageEditLayerCommonV3 {
  type: 'effect';
  effectId: string;
  params: ImageEditJsonObjectV3;
  /** 未注册的旧操作仍可保存和移动，但渲染器必须跳过。 */
  renderable: boolean;
  legacyOperation?: ImageEditLegacyOperationV3;
}

export interface ImageEditAdjustmentLayerV3 extends ImageEditLayerCommonV3 {
  type: 'adjustment';
  adjustmentId: string;
  params: ImageEditJsonObjectV3;
  renderable: boolean;
}

export interface ImageEditGroupLayerV3 extends ImageEditLayerCommonV3 {
  type: 'group';
  children: ImageEditLayerV3[];
  /** 普通、全不透明、无蒙版时允许编译器走 pass-through 快路径。 */
  isolated: boolean;
}

export type ImageEditLayerV3 =
  | ImageEditRasterLayerV3
  | ImageEditAnnotationLayerV3
  | ImageEditEffectLayerV3
  | ImageEditAdjustmentLayerV3
  | ImageEditGroupLayerV3;

export const IMAGE_EDIT_BLEND_MODES_V3: readonly ImageEditBlendModeV3[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'soft-light',
];

export const IMAGE_EDIT_IDENTITY_TRANSFORM_V3: ImageEditTransformV3 = [1, 0, 0, 1, 0, 0];

export function createImageEditLayerCommonV3(
  id: string,
  name: string
): ImageEditLayerCommonV3 {
  return {
    id,
    name,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    transform: IMAGE_EDIT_IDENTITY_TRANSFORM_V3,
    mask: null,
  };
}

export function isImageEditGroupLayerV3(layer: ImageEditLayerV3): layer is ImageEditGroupLayerV3 {
  return layer.type === 'group';
}

export function isImageEditSparseMaskReferenceV3(
  mask: ImageEditMaskReferenceV3,
): mask is ImageEditSparseMaskReferenceV3 {
  return 'kind' in mask && mask.kind === 'sparse-mask';
}

export function isValidImageEditMaskReferenceV3(
  value: unknown,
): value is ImageEditMaskReferenceV3 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const mask = value as Record<string, unknown>;
  if (typeof mask.inverted !== 'boolean') return false;
  if (mask.kind !== 'sparse-mask') {
    return typeof mask.resourceId === 'string' && mask.resourceId.length > 0;
  }
  if (mask.storage !== 'mask-float32'
    || typeof mask.maskId !== 'string' || mask.maskId.length === 0
    || mask.tileSize !== IMAGE_EDIT_MASK_TILE_SIZE_V3
    || (mask.defaultValue !== 0 && mask.defaultValue !== 1)
    || !mask.tiles || typeof mask.tiles !== 'object' || Array.isArray(mask.tiles)) return false;
  return Object.entries(mask.tiles).every(([key, resourceId]) => (
    key.length > 0
    && key.length <= 128
    && !['__proto__', 'constructor', 'prototype'].includes(key)
    && typeof resourceId === 'string'
    && resourceId.length > 0
    && resourceId.length <= 512
  ));
}

export function createImageEditSparseMaskReferenceV3(
  maskId: string,
  inverted = false,
  defaultValue: 0 | 1 = 1,
): ImageEditSparseMaskReferenceV3 {
  if (!maskId) throw new Error('稀疏蒙版 ID 不能为空');
  return {
    kind: 'sparse-mask',
    storage: 'mask-float32',
    maskId,
    tileSize: IMAGE_EDIT_MASK_TILE_SIZE_V3,
    defaultValue,
    tiles: {},
    inverted,
  };
}

/** 返回蒙版持有的权威像素资源；maskId 不是资源引用。 */
export function collectImageEditMaskResourceIdsV3(
  mask: ImageEditMaskReferenceV3,
): string[] {
  return isImageEditSparseMaskReferenceV3(mask)
    ? [...new Set(Object.values(mask.tiles))]
    : [mask.resourceId];
}

/** 用于会话/实体稳定寻址，禁止把返回值当成像素资源引用。 */
export function getImageEditMaskIdentityV3(mask: ImageEditMaskReferenceV3): string {
  return isImageEditSparseMaskReferenceV3(mask) ? mask.maskId : mask.resourceId;
}

export function cloneImageEditMaskReferenceV3(
  mask: ImageEditMaskReferenceV3,
): ImageEditMaskReferenceV3 {
  return isImageEditSparseMaskReferenceV3(mask)
    ? { ...mask, tiles: { ...mask.tiles } }
    : { ...mask };
}

export function collectImageEditLayerIdsV3(layers: readonly ImageEditLayerV3[]): string[] {
  const ids: string[] = [];
  const visit = (entries: readonly ImageEditLayerV3[]): void => {
    for (const layer of entries) {
      ids.push(layer.id);
      if (layer.type === 'group') visit(layer.children);
    }
  };
  visit(layers);
  return ids;
}
