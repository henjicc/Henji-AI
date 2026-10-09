import type { Coverage, RegionRect, RegionSnapshot } from '../contracts';
import type { SelectionAlgorithmOptions, SelectionPixels, SelectionPixelSource } from './contracts';

export function checkOptions(grid: { width: number; height: number }, options: SelectionAlgorithmOptions): number {
  if (![grid.width, grid.height].every(value => Number.isSafeInteger(value) && value > 0)
    || !Number.isSafeInteger(grid.width * grid.height)) throw new Error('区域尺寸无效');
  const size = options.tileSize ?? 512;
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('区域块尺寸无效');
  if (options.context.referenceGrid.width !== grid.width || options.context.referenceGrid.height !== grid.height) throw new Error('取样来源与参考网格不一致');
  options.context.signal?.throwIfAborted();
  return size;
}

export function* regions(grid: { width: number; height: number }, tileSize: number): Generator<RegionRect> {
  for (let y = 0; y < grid.height; y += tileSize) for (let x = 0; x < grid.width; x += tileSize) {
    yield { x, y, width: Math.min(tileSize, grid.width - x), height: Math.min(tileSize, grid.height - y) };
  }
}

export function emptySnapshot(grid: { width: number; height: number }, tileSize: number): RegionSnapshot {
  return { grid: { ...grid }, tileSize, defaultValue: 0, inverted: false, tiles: new Map() };
}

export function validatePixels(tile: SelectionPixels, region: RegionRect): void {
  if (tile.x !== region.x || tile.y !== region.y || tile.width !== region.width || tile.height !== region.height
    || tile.data.length !== region.width * region.height * 4) throw new Error('区域像素尺寸不匹配');
  for (let i = 0; i < tile.data.length; i++) {
    const value = tile.data[i];
    if (!Number.isFinite(value) || (i % 4 === 3 && (value < 0 || value > 1))) throw new Error('区域像素无效');
  }
}

/** Byte-budget LRU: source tiles may be reread; it never limits selected pixels. */
export function pixelReader(source: SelectionPixelSource, options: SelectionAlgorithmOptions, tileSize: number) {
  const cache = new Map<string, SelectionPixels>();
  let bytes = 0;
  const budget = Math.max(32 * 1024 * 1024, tileSize * tileSize * 16);
  return async (x: number, y: number): Promise<readonly [number, number, number, number]> => {
    options.context.signal?.throwIfAborted();
    const tx = Math.floor(x / tileSize), ty = Math.floor(y / tileSize), key = `${tx}/${ty}`;
    let tile = cache.get(key);
    if (!tile) {
      const region = { x: tx * tileSize, y: ty * tileSize, width: Math.min(tileSize, source.grid.width - tx * tileSize), height: Math.min(tileSize, source.grid.height - ty * tileSize) };
      tile = await source.read(region, options.context);
      options.context.signal?.throwIfAborted(); validatePixels(tile, region);
      while (cache.size && bytes + tile.data.byteLength > budget) {
        const first = cache.keys().next().value!;
        bytes -= cache.get(first)!.data.byteLength; cache.delete(first);
      }
      bytes += tile.data.byteLength;
    } else cache.delete(key);
    cache.set(key, tile);
    const i = ((y - tile.y) * tile.width + x - tile.x) * 4;
    return [tile.data[i], tile.data[i + 1], tile.data[i + 2], tile.data[i + 3]];
  };
}

export function writeCoverage(tiles: Map<string, Coverage>, grid: { width: number; height: number }, size: number, x: number, y: number, value: number): void {
  if (value === 0) return;
  const tx = Math.floor(x / size), ty = Math.floor(y / size), key = `${tx}/${ty}`;
  let tile = tiles.get(key);
  if (!tile) {
    const width = Math.min(size, grid.width - tx * size), height = Math.min(size, grid.height - ty * size);
    tile = { x: tx * size, y: ty * size, width, height, data: new Float32Array(width * height) }; tiles.set(key, tile);
  }
  tile.data[(y - tile.y) * tile.width + x - tile.x] = value;
}
