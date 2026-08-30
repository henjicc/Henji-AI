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

export interface ImageEditTileExecutionPlanOptions {
  /** 每个执行单元在四周额外读取的像素，使用当前 mip 坐标。 */
  halo?: number;
  /** 单个像素在一个工作表面中的字节数，例如 rgba16float 为 8。 */
  bytesPerPixel?: number;
  /** 同时驻留的输入、输出及中间表面数量。 */
  workingSurfaceCount?: number;
  /** 单个执行单元可使用的硬工作集上限；不足时自动从 supertile 降为存储瓦片。 */
  maxWorkingSetBytes?: number;
  preferSupertile?: boolean;
}

export interface ImageEditTileExecutionPlan {
  mip: number;
  mipSize: ImageEditSize;
  storageTileSize: number;
  executionTileSize: number;
  storageGrid: ImageEditSize;
  executionGrid: ImageEditSize;
  storageTileCount: number;
  executionUnitCount: number;
  halo: number;
  maxSourceRegion: ImageEditSize;
  maxSourceRegionPixels: number;
  estimatedWorkingSetBytes: number;
  usesSupertile: boolean;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数`);
  }
  return value;
}

function safeProduct(values: readonly number[], name: string): number {
  const product = values.reduce((total, value) => total * value, 1);
  if (!Number.isSafeInteger(product)) throw new Error(`${name} 超出安全整数范围`);
  return product;
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

/**
 * 只计算瓦片执行几何与最坏工作集，不枚举像素，也不会创建整图表面。
 * 512 是权威存储粒度；1024 仅是预算允许时的调度 supertile。
 */
export function planTileExecution(
  source: ImageEditSize,
  mip: number,
  options: ImageEditTileExecutionPlanOptions = {},
): ImageEditTileExecutionPlan {
  const size = mipSize(source, mip);
  const halo = nonNegativeInteger(Math.ceil(options.halo ?? 0), 'halo');
  const bytesPerPixel = positiveInteger(options.bytesPerPixel ?? 8, '每像素字节数');
  const workingSurfaceCount = positiveInteger(
    options.workingSurfaceCount ?? 2,
    '工作表面数量',
  );
  const maxWorkingSetBytes = options.maxWorkingSetBytes === undefined
    ? Number.MAX_SAFE_INTEGER
    : nonNegativeInteger(options.maxWorkingSetBytes, '工作集预算');
  const candidates = options.preferSupertile === false
    ? [IMAGE_EDIT_STORAGE_TILE_SIZE]
    : [IMAGE_EDIT_SUPERTILE_SIZE, IMAGE_EDIT_STORAGE_TILE_SIZE];

  const estimate = (executionTileSize: number) => {
    const width = Math.min(size.width, executionTileSize + halo * 2);
    const height = Math.min(size.height, executionTileSize + halo * 2);
    const pixels = safeProduct([width, height], '瓦片来源区域像素数');
    const bytes = safeProduct(
      [pixels, bytesPerPixel, workingSurfaceCount],
      '瓦片执行工作集',
    );
    return { width, height, pixels, bytes };
  };
  const selected = candidates
    .map((executionTileSize) => ({ executionTileSize, estimate: estimate(executionTileSize) }))
    .find((candidate) => candidate.estimate.bytes <= maxWorkingSetBytes);
  if (!selected) {
    throw new Error('工作集预算不足以容纳一个 512×512 存储瓦片及其 halo');
  }

  const storageGrid = tileGridSize(source, mip, IMAGE_EDIT_STORAGE_TILE_SIZE);
  const executionGrid = tileGridSize(source, mip, selected.executionTileSize);
  return {
    mip,
    mipSize: size,
    storageTileSize: IMAGE_EDIT_STORAGE_TILE_SIZE,
    executionTileSize: selected.executionTileSize,
    storageGrid,
    executionGrid,
    storageTileCount: safeProduct([storageGrid.width, storageGrid.height], '存储瓦片数量'),
    executionUnitCount: safeProduct([executionGrid.width, executionGrid.height], '执行单元数量'),
    halo,
    maxSourceRegion: {
      width: selected.estimate.width,
      height: selected.estimate.height,
    },
    maxSourceRegionPixels: selected.estimate.pixels,
    estimatedWorkingSetBytes: selected.estimate.bytes,
    usesSupertile: selected.executionTileSize === IMAGE_EDIT_SUPERTILE_SIZE,
  };
}
