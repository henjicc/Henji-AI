import type { ImageEditColorDomain } from '../renderNodeDefinition';
import type { ImageEditTransferFunctionV3, ImageEditWorkingSpaceV3 } from '../colorTypes';
import type { ImageEditTileCoordinate } from '../tileGeometry';
import type {
  Float32MaskTile,
  Float32PremultipliedRgbaTile,
} from '../effects/contracts';

export const IMAGE_EDIT_BRUSH_TILE_SIZE_V3 = 512;

export type ImageEditBrushToolV3 = 'brush' | 'eraser';

export interface ImageEditBrushPointV3 {
  /** mip 0 图片坐标。 */
  x: number;
  y: number;
  /** 屏幕坐标只用于事件抽稀和路径简化。 */
  screenX: number;
  screenY: number;
  pressure?: number;
}

export interface BufferedImageEditBrushPointV3 {
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  pressure: number;
}

export interface ImageEditBrushShapeV3 {
  /** mip 0 图片像素中的直径。 */
  size: number;
  hardness: number;
  opacity: number;
}

export interface ImageEditRgbaBrushTargetV3 {
  kind: 'raster-rgba';
  colorDomain: ImageEditColorDomain;
  workingSpace: ImageEditWorkingSpaceV3;
  transferFunction: ImageEditTransferFunctionV3;
  referenceWhiteNits: number;
  /** 颜色与 Alpha 已预乘；橡皮擦仍要求显式颜色契约，但不会使用颜色。 */
  premultipliedColor: readonly [number, number, number, number];
}

export interface ImageEditMaskBrushTargetV3 {
  kind: 'mask';
  /** brush 向该值混合，eraser 始终向 0 混合。 */
  brushValue?: number;
}

export type ImageEditBrushTargetV3 =
  | ImageEditRgbaBrushTargetV3
  | ImageEditMaskBrushTargetV3;

export interface ImageEditBrushResourceReferenceV3 {
  resourceId: string;
  byteSize: number;
}

export type ImageEditBrushTileV3 =
  | Float32PremultipliedRgbaTile
  | Float32MaskTile;

export interface ImageEditBrushTileSnapshotV3 {
  tile: ImageEditBrushTileV3;
  /** 当前稀疏瓦片；null 表示内容来自底图或空白默认值。 */
  resource: ImageEditBrushResourceReferenceV3 | null;
}

export type ImageEditBrushTileLoaderV3 = (
  coordinate: ImageEditTileCoordinate,
  signal: AbortSignal,
) => Promise<ImageEditBrushTileSnapshotV3>;

export interface ImageEditBrushStrokeOptionsV3 {
  canvas: { width: number; height: number };
  tool: ImageEditBrushToolV3;
  shape: ImageEditBrushShapeV3;
  target: ImageEditBrushTargetV3;
  loadTile: ImageEditBrushTileLoaderV3;
  minScreenDistance?: number;
  simplifyScreenTolerance?: number;
  simplifyPressureTolerance?: number;
}

export interface ImageEditBrushPointBufferStatsV3 {
  inputPointCount: number;
  retainedPointCount: number;
  capacity: number;
  reallocationCount: number;
  copiedScalarCount: number;
}

export interface ImageEditBrushTileChangeV3 {
  tileKey: string;
  coordinate: ImageEditTileCoordinate;
  tile: ImageEditBrushTileV3;
  oldResource: ImageEditBrushResourceReferenceV3 | null;
  /** 持久化前的 Float32 字节数；资源压缩后的真实大小由上层注入。 */
  newRawByteSize: number;
}

export interface ImageEditBrushPendingHistoryV3 {
  oldResources: readonly ImageEditBrushResourceReferenceV3[];
  oldResourceBytes: number;
  pendingNewRawBytes: number;
}

export interface ImageEditBrushStrokeMetricsV3 extends ImageEditBrushPointBufferStatsV3 {
  simplifiedPointCount: number;
  loadedTileCount: number;
  changedTileCount: number;
}

export interface ImageEditBrushStrokeResultV3 {
  target: ImageEditBrushTargetV3;
  changes: readonly ImageEditBrushTileChangeV3[];
  history: ImageEditBrushPendingHistoryV3;
  metrics: ImageEditBrushStrokeMetricsV3;
}

export interface PersistedImageEditBrushTileV3 {
  tileKey: string;
  resourceId: string;
  byteSize: number;
}
