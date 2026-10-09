import type { Coverage, RegionRect, RegionSnapshot } from '../contracts';
import type { SelectionAlgorithm, SelectionAlgorithmOptions, SelectionPixelSource } from './contracts';
import { checkOptions, emptySnapshot, regions, validatePixels } from './tiles';
import { filterCoverage } from './modify';

/** PhotoCraft's modified-Laplacian energy; tiled halos preserve the full-resolution phase. */
async function energy(source: SelectionPixelSource, region: RegionRect, radius: number, options: SelectionAlgorithmOptions): Promise<Float32Array> {
  const halo = radius + 1;
  const clip = { x: Math.max(0, region.x - halo), y: Math.max(0, region.y - halo), width: Math.min(source.grid.width, region.x + region.width + halo) - Math.max(0, region.x - halo), height: Math.min(source.grid.height, region.y + region.height + halo) - Math.max(0, region.y - halo) };
  const tile = await source.read(clip, options.context); options.context.signal?.throwIfAborted(); validatePixels(tile, clip);
  const at = (x: number, y: number): number => {
    const i = (Math.max(0, Math.min(clip.height - 1, y)) * clip.width + Math.max(0, Math.min(clip.width - 1, x))) * 4;
    return tile.data[i + 3] === 0 ? 0 : tile.data[i] * 0.299 + tile.data[i + 1] * 0.587 + tile.data[i + 2] * 0.114;
  };
  const lap = new Float32Array(clip.width * clip.height);
  for (let y = 0; y < clip.height; y++) for (let x = 0; x < clip.width; x++) {
    const center = at(x, y);
    lap[y * clip.width + x] = Math.abs(2 * center - at(x - 1, y) - at(x + 1, y)) + Math.abs(2 * center - at(x, y - 1) - at(x, y + 1));
  }
  const mean = filterCoverage(lap, clip.width, clip.height, radius, 'mean');
  const output = new Float32Array(region.width * region.height);
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    const i = (region.y - clip.y + y) * clip.width + region.x - clip.x + x;
    output[y * region.width + x] = tile.data[i * 4 + 3] > 0 ? mean[i] : 0;
  }
  return output;
}

export async function focusSelection(source: SelectionPixelSource, algorithm: Extract<SelectionAlgorithm, { kind: 'focus' }>, options: SelectionAlgorithmOptions): Promise<RegionSnapshot> {
  const tileSize = checkOptions(source.grid, options);
  if (![algorithm.range, algorithm.noise].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error('焦点范围与去噪必须为 0 到 1');
  const radius = Math.max(3, Math.floor(Math.min(source.grid.width, source.grid.height) / 60));
  const count = Math.ceil(source.grid.width / tileSize) * Math.ceil(source.grid.height / tileSize); let done = 0;
  // A bounded histogram replaces a full-image sorted array; no pixel/subject-count limit.
  let maximum = 0;
  options.onProgress?.(0, count * 3);
  for (const region of regions(source.grid, tileSize)) {
    options.context.signal?.throwIfAborted();
    for (const value of await energy(source, region, radius, options)) maximum = Math.max(maximum, value);
    options.onProgress?.(++done, count * 3);
  }
  const result = emptySnapshot(source.grid, tileSize);
  if (maximum <= 1e-12) { options.onProgress?.(count * 3, count * 3); return result; }
  const histogram = new Float64Array(4096);
  for (const region of regions(source.grid, tileSize)) {
    options.context.signal?.throwIfAborted();
    for (const value of await energy(source, region, radius, options)) histogram[Math.min(histogram.length - 1, Math.floor(value / maximum * (histogram.length - 1)))]++;
    options.onProgress?.(++done, count * 3);
  }
  const rank = Math.floor(source.grid.width * source.grid.height * 0.99); let accumulated = 0, bin = 0;
  while (bin < histogram.length - 1 && accumulated + histogram[bin] <= rank) accumulated += histogram[bin++];
  const p99 = Math.max(maximum / (histogram.length - 1), maximum * bin / (histogram.length - 1));
  const floor = algorithm.noise * 0.5, threshold = 0.05 + 0.9 * (1 - algorithm.range) ** 2;
  const tiles = result.tiles as Map<string, Coverage>;
  for (const region of regions(source.grid, tileSize)) {
    options.context.signal?.throwIfAborted();
    const data = await energy(source, region, radius, options);
    for (let i = 0; i < data.length; i++) {
      const normalized = Math.max(0, Math.min(1, data[i] / p99) - floor) / (1 - floor);
      data[i] = Math.max(0, Math.min(1, (normalized - threshold) / 0.1 + 0.5));
    }
    if (data.some(value => value > 0)) tiles.set(`${region.x / tileSize}/${region.y / tileSize}`, { ...region, data });
    options.onProgress?.(++done, count * 3);
  }
  options.context.signal?.throwIfAborted(); return result;
}
