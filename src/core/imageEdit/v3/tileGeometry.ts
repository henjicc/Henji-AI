export const IMAGE_EDIT_STORAGE_TILE_SIZE = 512;
export const IMAGE_EDIT_SUPERTILE_SIZE = 1024;

export interface ImageEditSize {
  width: number;
  height: number;
}

export interface ImageEditRect extends ImageEditSize {
  x: number;
  y: number;
}

export interface ImageEditTileCoordinate {
  mip: number;
  x: number;
  y: number;
}

export interface ImageEditTileRegion {
  coordinate: ImageEditTileCoordinate;
  outputRect: ImageEditRect;
  sourceRect: ImageEditRect;
  halo: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return value;
}

export function mipSize(source: ImageEditSize, mip: number): ImageEditSize {
  const width = positiveInteger(source.width, '图片宽度');
  const height = positiveInteger(source.height, '图片高度');
  if (!Number.isSafeInteger(mip) || mip < 0 || mip > 30) {
    throw new Error('mip 必须是 0～30 的整数');
  }
  const scale = 2 ** mip;
  return {
    width: Math.max(1, Math.ceil(width / scale)),
    height: Math.max(1, Math.ceil(height / scale)),
  };
}

export function chooseViewportMip(
  source: ImageEditSize,
  viewport: ImageEditSize,
  devicePixelRatio = 1,
): number {
  const sourceWidth = positiveInteger(source.width, '图片宽度');
  const sourceHeight = positiveInteger(source.height, '图片高度');
  const targetWidth = positiveInteger(Math.ceil(viewport.width * devicePixelRatio), '视口宽度');
  const targetHeight = positiveInteger(Math.ceil(viewport.height * devicePixelRatio), '视口高度');
  const ratio = Math.max(sourceWidth / targetWidth, sourceHeight / targetHeight);
  return Math.max(0, Math.min(30, Math.floor(Math.log2(Math.max(1, ratio)))));
}

export function tileGridSize(
  source: ImageEditSize,
  mip: number,
  tileSize = IMAGE_EDIT_STORAGE_TILE_SIZE,
): ImageEditSize {
  const size = mipSize(source, mip);
  const normalizedTileSize = positiveInteger(tileSize, '瓦片尺寸');
  return {
    width: Math.ceil(size.width / normalizedTileSize),
    height: Math.ceil(size.height / normalizedTileSize),
  };
}

export function createTileRegion(
  source: ImageEditSize,
  coordinate: ImageEditTileCoordinate,
  halo = 0,
  tileSize = IMAGE_EDIT_STORAGE_TILE_SIZE,
): ImageEditTileRegion {
  const size = mipSize(source, coordinate.mip);
  const grid = tileGridSize(source, coordinate.mip, tileSize);
  if (
    !Number.isSafeInteger(coordinate.x)
    || !Number.isSafeInteger(coordinate.y)
    || coordinate.x < 0
    || coordinate.y < 0
    || coordinate.x >= grid.width
    || coordinate.y >= grid.height
  ) throw new Error('瓦片坐标超出图片范围');
  if (!Number.isFinite(halo) || halo < 0) throw new Error('halo 不能为负数');

  const roundedHalo = Math.ceil(halo);
  const x = coordinate.x * tileSize;
  const y = coordinate.y * tileSize;
  const outputRect = {
    x,
    y,
    width: Math.min(tileSize, size.width - x),
    height: Math.min(tileSize, size.height - y),
  };
  const sourceX = Math.max(0, x - roundedHalo);
  const sourceY = Math.max(0, y - roundedHalo);
  const sourceRight = Math.min(size.width, x + outputRect.width + roundedHalo);
  const sourceBottom = Math.min(size.height, y + outputRect.height + roundedHalo);
  return {
    coordinate: { ...coordinate },
    outputRect,
    sourceRect: {
      x: sourceX,
      y: sourceY,
      width: sourceRight - sourceX,
      height: sourceBottom - sourceY,
    },
    halo: roundedHalo,
  };
}

export function enumerateTilesForRect(
  source: ImageEditSize,
  mip: number,
  rect: ImageEditRect,
  tileSize = IMAGE_EDIT_STORAGE_TILE_SIZE,
): ImageEditTileCoordinate[] {
  const size = mipSize(source, mip);
  const left = Math.max(0, Math.min(size.width, Math.floor(rect.x)));
  const top = Math.max(0, Math.min(size.height, Math.floor(rect.y)));
  const right = Math.max(left, Math.min(size.width, Math.ceil(rect.x + rect.width)));
  const bottom = Math.max(top, Math.min(size.height, Math.ceil(rect.y + rect.height)));
  if (right === left || bottom === top) return [];
  const startX = Math.floor(left / tileSize);
  const startY = Math.floor(top / tileSize);
  const endX = Math.floor((right - 1) / tileSize);
  const endY = Math.floor((bottom - 1) / tileSize);
  const coordinates: ImageEditTileCoordinate[] = [];
  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) coordinates.push({ mip, x, y });
  }
  return coordinates;
}

export function gaussianBlurHalo(radiusInDocumentPixels: number, mip: number): number {
  if (!Number.isFinite(radiusInDocumentPixels) || radiusInDocumentPixels < 0) {
    throw new Error('模糊半径不能为负数');
  }
  return Math.ceil((radiusInDocumentPixels / (2 ** mip)) * 3);
}
