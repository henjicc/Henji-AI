import type { ImageEditMaskTileDeltaCommandV3 } from '../commandTypes';
import type { Float32MaskTile } from '../effects/contracts';
import type { ImageEditTileCoordinate } from '../tileGeometry';

export const IMAGE_EDIT_SELECTION_TILE_SIZE_V3 = 512 as const;
export { REGION_AA_SAMPLES_PER_AXIS as IMAGE_EDIT_SELECTION_AA_SAMPLES_PER_AXIS_V3 } from '../../../imaging/regions/contracts';
export type {
  RegionPoint as ImageEditSelectionPointV3,
} from '../../../imaging/regions/contracts';
import type { RegionGeometry, RegionCombine } from '../../../imaging/regions/contracts';
export type ImageEditSelectionRectV3 = Extract<RegionGeometry, { type: 'rectangle' }>;
export type ImageEditSelectionEllipseV3 = Extract<RegionGeometry, { type: 'ellipse' }>;
export type ImageEditSelectionLassoV3 = Extract<RegionGeometry, { type: 'lasso' }>;
export type ImageEditSelectionShapeV3 = RegionGeometry;
export type ImageEditSelectionCombineModeV3 = Exclude<RegionCombine, 'paint' | 'erase'>;

export interface ImageEditSelectionMaskResourceReferenceV3 {
  resourceId: string;
  byteSize: number;
}

export interface ImageEditSelectionExistingMaskTileV3 {
  /** 只接受权威 mip 0 键：`0/x/y`。 */
  tileKey: string;
  resource: ImageEditSelectionMaskResourceReferenceV3;
}

export type ImageEditSelectionMaskTileLoaderV3 = (
  coordinate: ImageEditTileCoordinate,
  existing: ImageEditSelectionExistingMaskTileV3,
  signal?: AbortSignal,
) => Promise<Float32MaskTile>;

export interface ImageEditSelectionMaskPlanOptionsV3 {
  canvas: { width: number; height: number };
  shape: ImageEditSelectionShapeV3;
  combineMode: ImageEditSelectionCombineModeV3;
  /** 稀疏蒙版缺失瓦片恒为 0；已有条目必须包含真实资源字节数。 */
  existingTiles?: readonly ImageEditSelectionExistingMaskTileV3[];
}

export interface ImageEditSelectionMaskPlanV3 {
  canvas: { width: number; height: number };
  shape: ImageEditSelectionShapeV3;
  combineMode: ImageEditSelectionCombineModeV3;
  tileCoordinates: readonly ImageEditTileCoordinate[];
  existingTiles: ReadonlyMap<string, ImageEditSelectionExistingMaskTileV3>;
}

export interface ImageEditSelectionMaskTileChangeV3 {
  tileKey: string;
  coordinate: ImageEditTileCoordinate;
  oldResource: ImageEditSelectionMaskResourceReferenceV3 | null;
  /** null 表示删除稀疏覆盖，恢复 defaultValue=0。 */
  newTile: Float32MaskTile | null;
  newRawByteSize: number;
}

export interface RasterizeImageEditSelectionMaskOptionsV3 {
  plan: ImageEditSelectionMaskPlanV3;
  loadExistingTile: ImageEditSelectionMaskTileLoaderV3;
  signal?: AbortSignal;
}

export interface PersistedImageEditSelectionMaskTileChangeV3 {
  tileKey: string;
  oldResource: ImageEditSelectionMaskResourceReferenceV3 | null;
  newResource: ImageEditSelectionMaskResourceReferenceV3 | null;
}

export interface MaterializeImageEditSelectionMaskDeltaOptionsV3 {
  commandId: string;
  expectedRevision: number;
  layerId: string;
  maskId: string;
  changes: readonly PersistedImageEditSelectionMaskTileChangeV3[];
}

export type MaterializedImageEditSelectionMaskDeltaV3 = ImageEditMaskTileDeltaCommandV3;
