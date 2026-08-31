import {
  assertFloat32MaskTile,
  createFloat32MaskTile,
  type Float32MaskTile,
} from '../effects/contracts';
import { createTileRegion } from '../tileGeometry';
import {
  IMAGE_EDIT_SELECTION_AA_SAMPLES_PER_AXIS_V3,
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

function combineCoverage(
  existing: number,
  selection: number,
  mode: ImageEditSelectionCombineModeV3,
): number {
  switch (mode) {
    case 'replace': return selection;
    case 'add': return Math.max(existing, selection);
    case 'subtract': return Math.max(0, existing - selection);
    case 'intersect': return Math.min(existing, selection);
    default: throw new Error('不支持的选区组合模式');
  }
}

function clippedLocalRange(
  start: number,
  end: number,
  origin: number,
  size: number,
): readonly [number, number] {
  return [
    Math.max(0, Math.min(size, Math.floor(start - origin))),
    Math.max(0, Math.min(size, Math.ceil(end - origin))),
  ];
}

function rasterizeRectangleCoverage(
  output: Float32Array,
  width: number,
  height: number,
  originX: number,
  originY: number,
  shape: Extract<ImageEditSelectionShapeV3, { type: 'rectangle' }>,
): void {
  const bounds = imageEditSelectionBoundsV3(shape);
  const [startX, endX] = clippedLocalRange(bounds.left, bounds.right, originX, width);
  const [startY, endY] = clippedLocalRange(bounds.top, bounds.bottom, originY, height);
  for (let y = startY; y < endY; y += 1) {
    const documentY = originY + y;
    const vertical = Math.max(
      0,
      Math.min(documentY + 1, bounds.bottom) - Math.max(documentY, bounds.top),
    );
    for (let x = startX; x < endX; x += 1) {
      const documentX = originX + x;
      const horizontal = Math.max(
        0,
        Math.min(documentX + 1, bounds.right) - Math.max(documentX, bounds.left),
      );
      output[y * width + x] = Math.min(1, horizontal * vertical);
    }
  }
}

function rasterizeEllipseCoverage(
  output: Float32Array,
  width: number,
  height: number,
  originX: number,
  originY: number,
  shape: Extract<ImageEditSelectionShapeV3, { type: 'ellipse' }>,
  signal?: AbortSignal,
): void {
  const bounds = imageEditSelectionBoundsV3(shape);
  const radiusX = (bounds.right - bounds.left) / 2;
  const radiusY = (bounds.bottom - bounds.top) / 2;
  if (radiusX <= 0 || radiusY <= 0) return;
  const centerX = bounds.left + radiusX;
  const centerY = bounds.top + radiusY;
  const samples = IMAGE_EDIT_SELECTION_AA_SAMPLES_PER_AXIS_V3;
  const [startX, endX] = clippedLocalRange(bounds.left, bounds.right, originX, width);
  const [startY, endY] = clippedLocalRange(bounds.top, bounds.bottom, originY, height);
  for (let y = startY; y < endY; y += 1) {
    if ((y & 31) === 0) throwIfAborted(signal);
    const documentY = originY + y;
    const nearY = centerY < documentY
      ? documentY - centerY
      : centerY > documentY + 1 ? centerY - documentY - 1 : 0;
    const farY = Math.max(Math.abs(documentY - centerY), Math.abs(documentY + 1 - centerY));
    for (let x = startX; x < endX; x += 1) {
      const documentX = originX + x;
      const nearX = centerX < documentX
        ? documentX - centerX
        : centerX > documentX + 1 ? centerX - documentX - 1 : 0;
      const nearest = (nearX / radiusX) ** 2 + (nearY / radiusY) ** 2;
      if (nearest >= 1) continue;
      const farX = Math.max(Math.abs(documentX - centerX), Math.abs(documentX + 1 - centerX));
      const farthest = (farX / radiusX) ** 2 + (farY / radiusY) ** 2;
      if (farthest <= 1) {
        output[y * width + x] = 1;
        continue;
      }
      let inside = 0;
      for (let sampleY = 0; sampleY < samples; sampleY += 1) {
        const dy = (documentY + (sampleY + 0.5) / samples - centerY) / radiusY;
        for (let sampleX = 0; sampleX < samples; sampleX += 1) {
          const dx = (documentX + (sampleX + 0.5) / samples - centerX) / radiusX;
          if (dx * dx + dy * dy <= 1) inside += 1;
        }
      }
      output[y * width + x] = inside / (samples * samples);
    }
  }
}

function addLassoSampleInterval(
  partialCounts: Uint8Array,
  fullPixelDifference: Int16Array,
  originX: number,
  left: number,
  right: number,
): void {
  const samples = IMAGE_EDIT_SELECTION_AA_SAMPLES_PER_AXIS_V3;
  const globalStart = originX * samples;
  const globalEnd = globalStart + partialCounts.length * samples;
  let start = Math.max(globalStart, Math.ceil(left * samples - 0.5));
  const end = Math.min(globalEnd, Math.ceil(right * samples - 0.5));
  if (end <= start) return;

  while (start < end && start % samples !== 0) {
    partialCounts[Math.floor((start - globalStart) / samples)] += 1;
    start += 1;
  }
  const fullEnd = end - ((end - globalStart) % samples);
  if (fullEnd > start) {
    const firstPixel = (start - globalStart) / samples;
    const afterPixel = (fullEnd - globalStart) / samples;
    fullPixelDifference[firstPixel] += samples;
    fullPixelDifference[afterPixel] -= samples;
    start = fullEnd;
  }
  while (start < end) {
    partialCounts[Math.floor((start - globalStart) / samples)] += 1;
    start += 1;
  }
}

function rasterizeLassoCoverage(
  output: Float32Array,
  width: number,
  height: number,
  originX: number,
  originY: number,
  shape: Extract<ImageEditSelectionShapeV3, { type: 'lasso' }>,
  signal?: AbortSignal,
): void {
  const bounds = imageEditSelectionBoundsV3(shape);
  const [startY, endY] = clippedLocalRange(bounds.top, bounds.bottom, originY, height);
  const samples = IMAGE_EDIT_SELECTION_AA_SAMPLES_PER_AXIS_V3;
  for (let y = startY; y < endY; y += 1) {
    if ((y & 31) === 0) throwIfAborted(signal);
    const partialCounts = new Uint8Array(width);
    const fullPixelDifference = new Int16Array(width + 1);
    for (let sampleY = 0; sampleY < samples; sampleY += 1) {
      const documentY = originY + y + (sampleY + 0.5) / samples;
      const intersections: number[] = [];
      let previous = shape.points[shape.points.length - 1];
      for (const current of shape.points) {
        if ((current.y > documentY) !== (previous.y > documentY)) {
          intersections.push(current.x
            + ((documentY - current.y) * (previous.x - current.x))
              / (previous.y - current.y));
        }
        previous = current;
      }
      intersections.sort((left, right) => left - right);
      for (let index = 0; index + 1 < intersections.length; index += 2) {
        addLassoSampleInterval(
          partialCounts,
          fullPixelDifference,
          originX,
          intersections[index],
          intersections[index + 1],
        );
      }
    }
    let fullSamples = 0;
    for (let x = 0; x < width; x += 1) {
      fullSamples += fullPixelDifference[x];
      output[y * width + x] = (fullSamples + partialCounts[x]) / (samples * samples);
    }
  }
}

function rasterizeSelectionCoverage(
  width: number,
  height: number,
  originX: number,
  originY: number,
  shape: ImageEditSelectionShapeV3,
  signal?: AbortSignal,
): Float32Array {
  const output = new Float32Array(width * height);
  if (shape.type === 'rectangle') {
    rasterizeRectangleCoverage(output, width, height, originX, originY, shape);
  } else if (shape.type === 'ellipse') {
    rasterizeEllipseCoverage(output, width, height, originX, originY, shape, signal);
  } else {
    rasterizeLassoCoverage(output, width, height, originX, originY, shape, signal);
  }
  return output;
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
    output[index] = combineCoverage(source[index], output[index], mode);
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

    let oldTile: Float32MaskTile | null = null;
    if (existing) {
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
    if (equalData(oldData, newData)) continue;

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
