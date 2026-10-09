import { combineRegionCoverage } from '../../../imaging/regions/coverage';
import { rasterizeRegionGeometry as rasterizeSelectionCoverage } from '../../../imaging/regions/rasterize';
export { rasterizeSelectionCoverage };
import {
  assertFloat32MaskTile,
  createFloat32MaskTile,
  type Float32MaskTile,
} from '../effects/contracts';
import { createTileRegion } from '../tileGeometry';
import {
  IMAGE_EDIT_SELECTION_TILE_SIZE_V3,
  type ImageEditSelectionCombineModeV3,
  type ImageEditSelectionMaskTileChangeV3,
  type ImageEditSelectionShapeV3,
  type RasterizeImageEditSelectionMaskOptionsV3,
} from './contracts';
import { imageEditSelectionBoundsV3 } from './geometry';
import { imageEditSelectionTileKeyV3 } from './plan';

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('选区转蒙版已取消');
  error.name = 'AbortError';
  throw error;
}

function isAllZero(data: Float32Array): boolean {
  for (const value of data) if (value !== 0) return false;
  return true;
}

function equalData(left: Float32Array, right: Float32Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function rasterizeTile(
  source: Float32Array,
  width: number,
  height: number,
  originX: number,
  originY: number,
  shape: ImageEditSelectionShapeV3,
  mode: ImageEditSelectionCombineModeV3,
  signal?: AbortSignal,
): Float32Array {
  const output = rasterizeSelectionCoverage(width, height, originX, originY, shape, signal);
  for (let index = 0; index < output.length; index += 1) {
    if ((index & 16_383) === 0) throwIfAborted(signal);
    output[index] = combineRegionCoverage(source[index], output[index], mode);
  }
  return output;
}

function validateExistingTile(
  tile: Float32MaskTile,
  width: number,
  height: number,
): void {
  assertFloat32MaskTile(tile);
  if (tile.width !== width || tile.height !== height) {
    throw new Error('选区蒙版瓦片尺寸与文档网格不一致');
  }
}

function regionIntersectsSelectionBounds(
  region: { x: number; y: number; width: number; height: number },
  shape: ImageEditSelectionShapeV3,
): boolean {
  const bounds = imageEditSelectionBoundsV3(shape);
  return bounds.right > region.x
    && bounds.bottom > region.y
    && bounds.left < region.x + region.width
    && bounds.top < region.y + region.height;
}

/**
 * 每次只分配一个 512×512 Float32 瓦片。调用方应在继续迭代前持久化并释放 newTile，
 * 因此 200MP 选区不会在 JS 中形成完整蒙版表面。
 */
export async function* rasterizeImageEditSelectionMaskTilesV3(
  options: RasterizeImageEditSelectionMaskOptionsV3,
): AsyncGenerator<ImageEditSelectionMaskTileChangeV3, void, void> {
  const { plan, signal } = options;
  for (const coordinate of plan.tileCoordinates) {
    throwIfAborted(signal);
    const tileKey = imageEditSelectionTileKeyV3(coordinate);
    const existing = plan.existingTiles.get(tileKey) ?? null;
    const region = createTileRegion(
      plan.canvas,
      coordinate,
      0,
      IMAGE_EDIT_SELECTION_TILE_SIZE_V3,
    );

    const intersectsBounds = regionIntersectsSelectionBounds(region.outputRect, plan.shape);
    if (existing
      && !intersectsBounds
      && (plan.combineMode === 'replace' || plan.combineMode === 'intersect')) {
      yield {
        tileKey,
        coordinate: { ...coordinate },
        oldResource: { ...existing.resource },
        newTile: null,
        newRawByteSize: 0,
      };
      continue;
    }

    let oldTile: Float32MaskTile | null = null;
    const needsExistingPixels = Boolean(existing) && plan.combineMode !== 'replace';
    if (existing && needsExistingPixels) {
      oldTile = await options.loadExistingTile(coordinate, existing, signal);
      throwIfAborted(signal);
      validateExistingTile(oldTile, region.outputRect.width, region.outputRect.height);
    }
    const oldData = oldTile?.data
      ?? new Float32Array(region.outputRect.width * region.outputRect.height);
    const newData = rasterizeTile(
      oldData,
      region.outputRect.width,
      region.outputRect.height,
      region.outputRect.x,
      region.outputRect.y,
      plan.shape,
      plan.combineMode,
      signal,
    );
    if ((needsExistingPixels || !existing) && equalData(oldData, newData)) continue;

    const newTile = isAllZero(newData)
      ? null
      : createFloat32MaskTile(region.outputRect.width, region.outputRect.height, newData);
    yield {
      tileKey,
      coordinate: { ...coordinate },
      oldResource: existing ? { ...existing.resource } : null,
      newTile,
      newRawByteSize: newTile?.data.byteLength ?? 0,
    };
  }
}
