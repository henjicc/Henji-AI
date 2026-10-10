import { evaluationCacheIdentity, type EvaluationContext } from '../../evaluation';
import { assertRetouchPixels } from '../../retouch/brush';
import type { RetouchPixels } from '../../retouch/contracts';
import { sampleBilinearPixels } from '../resample';

export interface SeamPlan { width: number; height: number; sourceWidth: number; sourceHeight: number; coordinates: Float32Array; identity: string; protectedFraction: number }
export interface SeamOptions { context: EvaluationContext; protect?: Float32Array; onProgress?: (completed: number, total: number) => void }
interface Grid { width: number; height: number; pixels: Float32Array; coordinates: Float32Array; protect: Float32Array }
/** Analysis is a byte budget, never a document-size limit; originals are sampled at full resolution. */
export function seamAnalysisSize(source: { width: number; height: number }, output: { width: number; height: number }, bytes = 8 * 1024 * 1024): { source: { width: number; height: number }; output: { width: number; height: number } } {
  if (![source.width, source.height, output.width, output.height].every(v => Number.isSafeInteger(v) && v > 0)) throw new Error('图像尺寸必须为正整数');
  if (!Number.isSafeInteger(bytes) || bytes < 256) throw new Error('分析预算不足以容纳二维采样网格');
  // A square-root estimate exceeds the budget on very thin images once the other axis rounds to one.
  // Keep two samples on every non-degenerate axis so native edge interpolation does not collapse.
  const scaled = (s: typeof source, ratio: number) => ({ width: Math.max(Math.min(2, s.width), Math.round(s.width * ratio)), height: Math.max(Math.min(2, s.height), Math.round(s.height * ratio)) });
  const fits = (ratio: number) => { const a = scaled(source, ratio), b = scaled(output, ratio); return Math.max(a.width, b.width) * Math.max(a.height, b.height) * 64 <= bytes; };
  let lower = 0, upper = 1;
  if (fits(1)) lower = 1;
  else for (let i = 0; i < 64; i++) { const middle = (lower + upper) / 2; if (fits(middle)) lower = middle; else upper = middle; }
  const size = (s: typeof source) => scaled(s, lower);
  return { source: size(source), output: size(output) };
}
function transpose(grid: Grid): Grid {
  const result: Grid = { ...grid, width: grid.height, height: grid.width, pixels: new Float32Array(grid.pixels.length), coordinates: new Float32Array(grid.coordinates.length), protect: new Float32Array(grid.protect.length) };
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
    const a = y * grid.width + x, b = x * grid.height + y;
    result.pixels.set(grid.pixels.subarray(a * 4, a * 4 + 4), b * 4); result.coordinates.set(grid.coordinates.subarray(a * 2, a * 2 + 2), b * 2); result.protect[b] = grid.protect[a];
  }
  return result;
}
/** Avidan/Shamir gradient-energy dynamic programming, reviewed against PhotoCraft seam.rs.
 * Independent TS adaptation, using the existing floating retouch pixel and evaluation contracts. */
function findSeam(grid: Grid): Int32Array {
  const { width: w, height: h, pixels, protect } = grid, costs = new Float64Array(w * h), parents = new Int8Array(w * h);
  const energy = new Float64Array(w * h); let largest = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let e = 0; const i = y * w + x;
    for (let c = 0; c < 4; c++) {
      const v = pixels[i * 4 + c];
      e += Math.abs(v - pixels[(y * w + Math.max(0, x - 1)) * 4 + c]) + Math.abs(v - pixels[(y * w + Math.min(w - 1, x + 1)) * 4 + c])
        + Math.abs(v - pixels[(Math.max(0, y - 1) * w + x) * 4 + c]) + Math.abs(v - pixels[(Math.min(h - 1, y + 1) * w + x) * 4 + c]);
    }
    energy[i] = e; largest = Math.max(largest, e);
  }
  // Scale protection with HDR energy and seam length, rather than assuming RGB <= 1.
  const bias = (largest + 1) * h * 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let best = y ? costs[i - w] : 0, direction = 0;
    if (y && x && costs[i - w - 1] < best) { best = costs[i - w - 1]; direction = -1; }
    if (y && x + 1 < w && costs[i - w + 1] < best) { best = costs[i - w + 1]; direction = 1; }
    parents[i] = direction; costs[i] = best + energy[i] + protect[i] * bias;
  }
  let x = 0; for (let i = 1; i < w; i++) if (costs[(h - 1) * w + i] < costs[(h - 1) * w + x]) x = i;
  const seam = new Int32Array(h);
  for (let y = h - 1; y >= 0; y--) { seam[y] = x; x += parents[y * w + x]; }
  return seam;
}
function remove(grid: Grid, seam: Int32Array): Grid {
  const width = grid.width - 1, result: Grid = { width, height: grid.height, pixels: new Float32Array(width * grid.height * 4), coordinates: new Float32Array(width * grid.height * 2), protect: new Float32Array(width * grid.height) };
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < width; x++) {
    const a = y * grid.width + x + Number(x >= seam[y]), b = y * width + x;
    result.pixels.set(grid.pixels.subarray(a * 4, a * 4 + 4), b * 4); result.coordinates.set(grid.coordinates.subarray(a * 2, a * 2 + 2), b * 2); result.protect[b] = grid.protect[a];
  }
  return result;
}
export function createSeamPlan(source: RetouchPixels, output: { width: number; height: number }, options: SeamOptions): SeamPlan {
  assertRetouchPixels(source);
  if (![output.width, output.height].every(v => Number.isSafeInteger(v) && v > 0) || source.data.some(v => !Number.isFinite(v))) throw new Error('内容识别缩放尺寸或像素无效');
  if (options.protect && (options.protect.length !== source.width * source.height || options.protect.some(v => !Number.isFinite(v) || v < 0 || v > 1))) throw new Error('保护区域与来源不一致');
  let maskHash = 2166136261;
  if (options.protect) for (const byte of new Uint8Array(options.protect.buffer, options.protect.byteOffset, options.protect.byteLength)) maskHash = Math.imul(maskHash ^ byte, 16777619);
  const identity = JSON.stringify([evaluationCacheIdentity(options.context), output, options.protect ? maskHash >>> 0 : null]);
  let grid: Grid = { width: source.width, height: source.height, pixels: source.data.slice(), protect: options.protect?.slice() ?? new Float32Array(source.width * source.height), coordinates: new Float32Array(source.width * source.height * 2) };
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) grid.coordinates.set([(x + .5) / grid.width, (y + .5) / grid.height], (y * grid.width + x) * 2);
  let completed = 0; const total = Math.abs(source.width - output.width) + Math.abs(source.height - output.height);
  const tick = () => { options.context.signal?.throwIfAborted(); options.onProgress?.(++completed, total); };
  const resizeWidth = (target: number): void => {
    while (grid.width > target) { options.context.signal?.throwIfAborted(); grid = remove(grid, findSeam(grid)); tick(); }
    while (grid.width < target) {
      // Discover distinct seams on a shrinking copy; never repeatedly stretch the same seam.
      const count = Math.min(target - grid.width, Math.max(1, grid.width - 1)), positions = Array.from({ length: grid.height }, () => [] as number[]);
      let copy = grid; const indices = Array.from({ length: grid.height }, () => Array.from({ length: grid.width }, (_, i) => i));
      for (let i = 0; i < count; i++) { options.context.signal?.throwIfAborted(); const seam = findSeam(copy);
        seam.forEach((x, y) => { positions[y].push(indices[y][x]); indices[y].splice(x, 1); });
        if (copy.width > 1) copy = remove(copy, seam); tick();
      }
      const width = grid.width + count, next: Grid = { width, height: grid.height, pixels: new Float32Array(width * grid.height * 4), coordinates: new Float32Array(width * grid.height * 2), protect: new Float32Array(width * grid.height) };
      for (let y = 0; y < grid.height; y++) { const insert = new Set(positions[y]); let xx = 0;
        for (let x = 0; x < grid.width; x++) { const a = y * grid.width + x, b = y * width + xx++;
          next.pixels.set(grid.pixels.subarray(a * 4, a * 4 + 4), b * 4); next.coordinates.set(grid.coordinates.subarray(a * 2, a * 2 + 2), b * 2); next.protect[b] = grid.protect[a];
          if (insert.has(x)) { const d = y * width + xx++, n = y * grid.width + Math.min(grid.width - 1, x + 1);
            for (let c = 0; c < 4; c++) next.pixels[d * 4 + c] = (grid.pixels[a * 4 + c] + grid.pixels[n * 4 + c]) / 2;
            for (let c = 0; c < 2; c++) next.coordinates[d * 2 + c] = (grid.coordinates[a * 2 + c] + grid.coordinates[n * 2 + c]) / 2;
            next.protect[d] = Math.max(grid.protect[a], grid.protect[n]);
          }
        }
      } grid = next;
    }
  };
  options.context.signal?.throwIfAborted(); resizeWidth(output.width); grid = transpose(grid); resizeWidth(output.height); grid = transpose(grid);
  return { width: grid.width, height: grid.height, sourceWidth: source.width, sourceHeight: source.height, coordinates: grid.coordinates, identity,
    protectedFraction: grid.protect.reduce((sum, v) => sum + v, 0) / grid.protect.length };
}
/** Same displacement field for pixels and protection/region coverage, including alpha. */
export function sampleSeamCoordinate(plan: SeamPlan, xRatio: number, yRatio: number): readonly [number, number] {
  const x = xRatio * plan.width - .5, y = yRatio * plan.height - .5;
  const ix = Math.max(0, Math.min(Math.max(0, plan.width - 2), Math.floor(x))), iy = Math.max(0, Math.min(Math.max(0, plan.height - 2), Math.floor(y)));
  const fx = plan.width === 1 ? 0 : x - ix, fy = plan.height === 1 ? 0 : y - iy, result = [0, 0];
  for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const i = (Math.min(plan.height - 1, iy + dy) * plan.width + Math.min(plan.width - 1, ix + dx)) * 2, w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
    for (let c = 0; c < 2; c++) result[c] += plan.coordinates[i + c] * w;
  }
  return [result[0], result[1]];
}
export function applySeamPlan(source: { width: number; height: number; data: Float32Array }, plan: SeamPlan, output: { width: number; height: number }, channels: 1 | 4): Float32Array {
  const data = new Float32Array(output.width * output.height * channels);
  for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
    const p = sampleSeamCoordinate(plan, (x + .5) / output.width, (y + .5) / output.height);
    sampleBilinearPixels(source, p[0] * source.width - .5, p[1] * source.height - .5, channels, data, (y * output.width + x) * channels, 'clamp');
  }
  return data;
}
