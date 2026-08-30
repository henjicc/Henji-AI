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

export interface ImageEditMaskReferenceV3 {
  resourceId: string;
  inverted: boolean;
}

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
