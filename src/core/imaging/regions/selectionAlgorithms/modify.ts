import type { Coverage, RegionRect, RegionSnapshot } from '../contracts';
import type { SelectionAlgorithmOptions, SelectionCoverageSource, SelectionModification } from './contracts';
import { checkOptions, emptySnapshot, regions } from './tiles';

/** Separable square max/min/box operators, O(pixels) independent of radius. */
export function filterCoverage(data: Float32Array, width: number, height: number, radius: number, mode: 'max' | 'min' | 'mean'): Float32Array {
  const pass = (input: Float32Array, vertical: boolean): Float32Array => {
    const output = new Float32Array(input.length), length = vertical ? height : width, lines = vertical ? width : height;
    const deque = new Int32Array(length);
    for (let line = 0; line < lines; line++) {
      const at = (i: number): number => vertical ? i * width + line : line * width + i;
      let head = 0, tail = 0, next = 0, sum = 0;
      for (let i = 0; i < length; i++) {
        const left = Math.max(0, i - radius), right = Math.min(length - 1, i + radius);
        while (next <= right) {
          const value = input[at(next)]; sum += value;
          if (mode !== 'mean') {
            while (tail > head && (mode === 'max' ? input[at(deque[tail - 1])] <= value : input[at(deque[tail - 1])] >= value)) tail--;
            deque[tail++] = next;
          }
          next++;
        }
        if (i - radius - 1 >= 0) sum -= input[at(i - radius - 1)];
        while (head < tail && deque[head] < left) head++;
        output[at(i)] = mode === 'mean' ? sum / (right - left + 1) : input[at(deque[head])];
      }
    }
    return output;
  };
  return pass(pass(data, false), true);
}

export async function readCoverageHalo(source: SelectionCoverageSource, region: RegionRect, radius: number, options: SelectionAlgorithmOptions): Promise<Coverage> {
  const x = region.x - radius, y = region.y - radius, width = region.width + radius * 2, height = region.height + radius * 2;
  const clip = { x: Math.max(0, x), y: Math.max(0, y), width: Math.min(source.grid.width, x + width) - Math.max(0, x), height: Math.min(source.grid.height, y + height) - Math.max(0, y) };
  const input = await source.read(clip, options.context);
  options.context.signal?.throwIfAborted();
  if (input.x !== clip.x || input.y !== clip.y || input.width !== clip.width || input.height !== clip.height || input.data.length !== clip.width * clip.height) throw new Error('选区覆盖尺寸不匹配');
  const data = new Float32Array(width * height);
  for (let yy = 0; yy < clip.height; yy++) {
    const row = input.data.subarray(yy * clip.width, (yy + 1) * clip.width);
    for (const value of row) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('选区覆盖无效');
    data.set(row, (yy + clip.y - y) * width + clip.x - x);
  }
  return { x, y, width, height, data };
}

export async function modifySelection(source: SelectionCoverageSource, mode: SelectionModification, radius: number, options: SelectionAlgorithmOptions): Promise<RegionSnapshot> {
  const tileSize = checkOptions(source.grid, options);
  if (!Number.isSafeInteger(radius) || radius < 1) throw new Error('选区修改半径必须为正整数');
  if (!['expand', 'contract', 'smooth', 'border'].includes(mode)) throw new Error('选区修改方式无效');
  const result = emptySnapshot(source.grid, tileSize), tiles = result.tiles as Map<string, Coverage>;
  const total = Math.ceil(source.grid.width / tileSize) * Math.ceil(source.grid.height / tileSize); let done = 0;
  options.onProgress?.(0, total);
  for (const region of regions(source.grid, tileSize)) {
    options.context.signal?.throwIfAborted();
    const input = await readCoverageHalo(source, region, radius, options);
    const filtered = filterCoverage(input.data, input.width, input.height, radius, mode === 'contract' ? 'min' : mode === 'smooth' ? 'mean' : 'max');
    const inner = mode === 'border' ? filterCoverage(input.data, input.width, input.height, radius, 'min') : null;
    const data = new Float32Array(region.width * region.height);
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
      const i = (y + radius) * input.width + x + radius;
      data[y * region.width + x] = Math.max(0, filtered[i] - (inner?.[i] ?? 0));
    }
    if (data.some(value => value > 0)) tiles.set(`${region.x / tileSize}/${region.y / tileSize}`, { ...region, data });
    options.onProgress?.(++done, total);
  }
  options.context.signal?.throwIfAborted();
  return result;
}
