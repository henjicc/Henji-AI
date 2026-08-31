import { tileGridSize, type ImageEditTileCoordinate } from '../tileGeometry';
import {
  IMAGE_EDIT_SELECTION_MAX_TILES_V3,
  IMAGE_EDIT_SELECTION_TILE_SIZE_V3,
  type ImageEditSelectionExistingMaskTileV3,
  type ImageEditSelectionMaskPlanOptionsV3,
  type ImageEditSelectionMaskPlanV3,
  type ImageEditSelectionShapeV3,
} from './contracts';
import {
  assertImageEditSelectionCanvasV3,
  clipImageEditSelectionBoundsV3,
  imageEditSelectionBoundsV3,
  normalizeImageEditSelectionShapeV3,
} from './geometry';

const RESOURCE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/;
const TILE_KEY_PATTERN = /^0\/(0|[1-9]\d*)\/(0|[1-9]\d*)$/;

export function imageEditSelectionTileKeyV3(coordinate: ImageEditTileCoordinate): string {
  return `${coordinate.mip}/${coordinate.x}/${coordinate.y}`;
}

function parseExistingTiles(
  canvas: { width: number; height: number },
  entries: readonly ImageEditSelectionExistingMaskTileV3[],
): Map<string, ImageEditSelectionExistingMaskTileV3> {
  const grid = tileGridSize(canvas, 0, IMAGE_EDIT_SELECTION_TILE_SIZE_V3);
  const output = new Map<string, ImageEditSelectionExistingMaskTileV3>();
  for (const entry of entries) {
    const match = TILE_KEY_PATTERN.exec(entry.tileKey);
    if (!match) throw new Error(`选区蒙版瓦片键无效：${entry.tileKey}`);
    const coordinate = { mip: 0, x: Number(match[1]), y: Number(match[2]) };
    if (coordinate.x >= grid.width || coordinate.y >= grid.height) {
      throw new Error(`选区蒙版瓦片超出文档：${entry.tileKey}`);
    }
    if (output.has(entry.tileKey)) throw new Error(`选区蒙版瓦片键重复：${entry.tileKey}`);
    if (!RESOURCE_ID_PATTERN.test(entry.resource.resourceId)
      || !Number.isSafeInteger(entry.resource.byteSize) || entry.resource.byteSize < 0) {
      throw new Error(`选区蒙版瓦片资源无效：${entry.tileKey}`);
    }
    output.set(entry.tileKey, {
      tileKey: entry.tileKey,
      resource: { ...entry.resource },
    });
  }
  return output;
}

function shapeTileCoordinates(
  canvas: { width: number; height: number },
  shape: ImageEditSelectionShapeV3,
): ImageEditTileCoordinate[] {
  const bounds = clipImageEditSelectionBoundsV3(imageEditSelectionBoundsV3(shape), canvas);
  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) return [];
  const startX = Math.floor(bounds.left / IMAGE_EDIT_SELECTION_TILE_SIZE_V3);
  const startY = Math.floor(bounds.top / IMAGE_EDIT_SELECTION_TILE_SIZE_V3);
  const endX = Math.floor((Math.ceil(bounds.right) - 1) / IMAGE_EDIT_SELECTION_TILE_SIZE_V3);
  const endY = Math.floor((Math.ceil(bounds.bottom) - 1) / IMAGE_EDIT_SELECTION_TILE_SIZE_V3);
  const width = endX - startX + 1;
  const height = endY - startY + 1;
  if (!Number.isSafeInteger(width * height)) throw new Error('选区瓦片范围溢出');
  const output: ImageEditTileCoordinate[] = [];
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) output.push({ mip: 0, x, y });
  }
  return output;
}

function coordinateFromKey(tileKey: string): ImageEditTileCoordinate {
  const [, x, y] = tileKey.split('/');
  return { mip: 0, x: Number(x), y: Number(y) };
}

export function planImageEditSelectionMaskV3(
  options: ImageEditSelectionMaskPlanOptionsV3,
): ImageEditSelectionMaskPlanV3 {
  assertImageEditSelectionCanvasV3(options.canvas);
  const shape = normalizeImageEditSelectionShapeV3(options.shape);
  const existingTiles = parseExistingTiles(options.canvas, options.existingTiles ?? []);
  const shapeCoordinates = shapeTileCoordinates(options.canvas, shape);
  const shapeByKey = new Map(shapeCoordinates.map((coordinate) => [
    imageEditSelectionTileKeyV3(coordinate),
    coordinate,
  ]));

  let coordinateByKey: Map<string, ImageEditTileCoordinate>;
  switch (options.combineMode) {
    case 'add':
      coordinateByKey = shapeByKey;
      break;
    case 'subtract':
      coordinateByKey = new Map([...shapeByKey].filter(([key]) => existingTiles.has(key)));
      break;
    case 'intersect':
      coordinateByKey = new Map([...existingTiles].map(([key]) => [key, coordinateFromKey(key)]));
      break;
    case 'replace':
      coordinateByKey = new Map([...existingTiles].map(([key]) => [key, coordinateFromKey(key)]));
      shapeByKey.forEach((coordinate, key) => coordinateByKey.set(key, coordinate));
      break;
    default:
      throw new Error('不支持的选区组合模式');
  }

  const maxTiles = options.maxTiles ?? IMAGE_EDIT_SELECTION_MAX_TILES_V3;
  if (!Number.isSafeInteger(maxTiles) || maxTiles < 1
    || maxTiles > IMAGE_EDIT_SELECTION_MAX_TILES_V3) {
    throw new Error('选区瓦片上限无效');
  }
  if (coordinateByKey.size > maxTiles) {
    throw new Error(`选区涉及 ${coordinateByKey.size} 个瓦片，超过 ${maxTiles} 个安全上限`);
  }
  const tileCoordinates = [...coordinateByKey.values()].sort((left, right) => (
    left.y - right.y || left.x - right.x
  ));
  return {
    canvas: { ...options.canvas },
    shape,
    combineMode: options.combineMode,
    tileCoordinates,
    existingTiles,
  };
}
