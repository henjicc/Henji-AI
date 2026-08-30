import type { ImageEditColorModeV3 } from './colorTypes';
import type { ImageEditLayerV3 } from './layerTypes';

export const IMAGE_EDIT_DOCUMENT_VERSION_V3 = 3 as const;

export type ImageEditRotationV3 = 0 | 90 | 180 | 270;

export interface ImageEditOrientationV3 {
  /** 先水平镜像，再顺时针旋转。 */
  rotate: ImageEditRotationV3;
  mirrored: boolean;
}

export interface ImageEditCropRectV3 {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageEditCanvasGeometryV3 {
  width: number;
  height: number;
  orientation: ImageEditOrientationV3;
  crop: ImageEditCropRectV3 | null;
}

export interface ImageEditDocumentV3 {
  version: typeof IMAGE_EDIT_DOCUMENT_VERSION_V3;
  id: string;
  revision: number;
  geometry: ImageEditCanvasGeometryV3;
  color: ImageEditColorModeV3;
  /** 自下而上的合成顺序；组内 children 同样自下而上。 */
  layers: ImageEditLayerV3[];
}
