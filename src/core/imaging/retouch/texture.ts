import { evaluationCacheIdentity } from '../evaluation';
import { assertRetouchPixels } from './brush';
import type { TextureCompletionInput, TextureCompletionResult } from './contracts';

/** Ring displacement search, following PhotoCraft's best_offset / patch correspondence approach.
 * The ring never contains the removed object; every donor is checked against the original mask.
 * Fixed sample/search budgets control compute cost, not document/image size. */
export function completeRetouchTexture(input: TextureCompletionInput): TextureCompletionResult {
  const { pixels, coverage } = input;
  assertRetouchPixels(pixels);
  if (input.context) { input.context.signal?.throwIfAborted(); evaluationCacheIdentity(input.context); }
  const { width: w, height: h, data } = pixels, count = w * h;
  if (coverage.length !== count || coverage.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('内容识别填充覆盖无效');
  const output = new Float32Array(data), holes: number[] = [], ring: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (coverage[i] > 0) { holes.push(i); continue; }
    if (data[i * 4 + 3] <= 0) continue;
    if ((x > 0 && coverage[i - 1] > 0) || (x + 1 < w && coverage[i + 1] > 0)
      || (y > 0 && coverage[i - w] > 0) || (y + 1 < h && coverage[i + w] > 0)) ring.push(i);
  }
  if (!holes.length) return { data: output, ringError: 0, offsets: [] };
  if (!ring.length) throw new Error('选区周围没有可取样的背景，请缩小选区或指定干净来源');
  // Include both sides of strong structure around the ring, without mask/alpha contamination.
  const samples: number[] = [];
  const spacing = Math.max(1, Math.ceil(ring.length / 192));
  for (let j = 0; j < ring.length; j += spacing) {
    const i = ring[j], x = i % w, y = Math.floor(i / w);
    for (const [dx, dy] of [[0, 0], [-2, 0], [2, 0], [0, -2], [0, 2]]) {
      const sx = x + dx, sy = y + dy, p = sy * w + sx;
      if (sx >= 0 && sy >= 0 && sx < w && sy < h && coverage[p] === 0 && data[p * 4 + 3] > 0) samples.push(p);
    }
  }
  const known = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && coverage[y * w + x] === 0 && data[(y * w + x) * 4 + 3] > 0;
  // Validate phase on the surrounding original background as well as the ring.
  // A ring lying between mortar lines cannot by itself distinguish staggered rows.
  const backgroundStep = Math.max(1, Math.ceil(Math.max(w, h) / 32));
  for (let y = 0; y < h; y += backgroundStep) for (let x = 0; x < w; x += backgroundStep) if (known(x, y)) samples.push(y * w + x);
  const distance = (a: number, b: number): number => {
    let sum = 0;
    for (let c = 0; c < 3; c++) { const d = data[a * 4 + c] / data[a * 4 + 3] - data[b * 4 + c] / data[b * 4 + 3]; sum += d * d; }
    return sum / 3;
  };
  const tested = new Set<string>(), candidates: { x: number; y: number; error: number; fit: number }[] = [];
  const test = (dx: number, dy: number): void => {
    const key = `${dx}/${dy}`;
    if ((!dx && !dy) || tested.has(key)) return;
    tested.add(key);
    let error = 0, n = 0;
    for (const i of samples) {
      const x = i % w + dx, y = Math.floor(i / w) + dy;
      if (!known(x, y)) continue;
      error += distance(i, y * w + x); n++;
    }
    if (n < samples.length * .3) return;
    // Penalise little support so matching a single flat pixel cannot win.
    const score = error / n + .002 * (1 - n / samples.length);
    candidates.push({ x: dx, y: dy, error: score, fit: error / n });
  };
  // Axis sweeps preserve exact phase on repeated rows/columns; a coarse 2D search handles oblique patterns.
  for (let x = -w + 1; x < w; x++) test(x, 0);
  for (let y = -h + 1; y < h; y++) test(0, y);
  const step = Math.max(1, Math.ceil(Math.max(w, h) / 40));
  for (let y = -h + step; y < h; y += step) for (let x = -w + step; x < w; x += step) test(x, y);
  candidates.sort((a, b) => a.error - b.error || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  const coarse = candidates.slice(0, 12);
  for (const candidate of coarse) for (let y = -step; y <= step; y++) for (let x = -step; x <= step; x++) test(candidate.x + x, candidate.y + y);
  candidates.sort((a, b) => a.error - b.error || Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  // A sub-pixel phase advantage in the sparse ring must not bend an otherwise exact row/column.
  // Prefer a coherent axis match only when both fits are strong and differ within sampling noise.
  const best = candidates[0]?.error ?? Infinity;
  const minimumFit = candidates.reduce((value, candidate) => Math.min(value, candidate.fit), Infinity);
  const coherentAxis = (value: typeof candidates[number]): boolean => (!value.x || !value.y) && value.fit < .001 && value.fit <= minimumFit + .0005;
  if (best < .001) candidates.sort((a, b) => {
    const axis = (value: typeof a): boolean => (!value.x || !value.y) && value.error <= best * 2 && value.error - best <= .0005;
    return Number(axis(b)) - Number(axis(a)) || a.error - b.error;
  });
  // Ring fit alone favours many near-identical displacements on flat backgrounds.
  // Keep complementary donors so streamed large regions can cover their interiors as well.
  const offsets = candidates.slice(0, 1), probes = holes.filter((_value, index) => index % Math.max(1, Math.ceil(holes.length / 192)) === 0);
  const reachable = (i: number, offset: { x: number; y: number }): boolean => known(i % w + offset.x, Math.floor(i / w) + offset.y);
  let missing = probes.filter(i => !offsets.some(offset => reachable(i, offset)));
  while (missing.length && offsets.length < 8) {
    let choice: typeof candidates[number] | undefined, gain = 0;
    for (const axisOnly of [true, false]) {
      for (const candidate of candidates) {
        if ((axisOnly && !coherentAxis(candidate)) || candidate.fit > minimumFit + .0005 || offsets.includes(candidate)) continue;
        const covered = missing.reduce((sum, i) => sum + Number(reachable(i, candidate)), 0);
        if (covered > gain) { gain = covered; choice = candidate; }
      }
      if (choice) break;
    }
    if (!choice) break;
    offsets.push(choice); missing = missing.filter(i => !reachable(i, choice!));
  }
  for (const candidate of candidates) { if (offsets.length >= 64) break; if (!offsets.includes(candidate)) offsets.push(candidate); }
  if (!offsets.length) throw new Error('没有找到干净纹理，请指定来源或改用移除工具');
  let seed = (input.seed ?? 1) >>> 0;
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const field = new Int32Array(count); field.fill(-1);
  const patchError = (i: number, sx: number, sy: number): number => {
    if (!known(sx, sy)) return Infinity;
    const tx = i % w, ty = Math.floor(i / w);
    let error = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!known(sx + dx, sy + dy)) return Infinity;
      const x = tx + dx, y = ty + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const a = y * w + x, b = (sy + dy) * w + sx + dx;
      for (let c = 0; c < 3; c++) {
        const aa = output[a * 4 + 3];
        const d = (aa > 0 ? output[a * 4 + c] / aa : 0) - data[b * 4 + c] / data[b * 4 + 3];
        error += d * d;
      }
      n += 3;
    }
    return n ? error / n : Infinity;
  };
  // Best coherent displacements first. Only difficult pixels need local PatchMatch refinement.
  const unresolved: number[] = [];
  for (const i of holes) {
    const x = i % w, y = Math.floor(i / w), fit = offsets.find(offset => known(x + offset.x, y + offset.y));
    if (fit) field[i] = (y + fit.y) * w + x + fit.x;
    else unresolved.push(i);
  }
  const knownPixels: number[] = [];
  if (unresolved.length || offsets[0].error > .01) {
    for (let i = 0; i < count; i++) if (coverage[i] === 0 && data[i * 4 + 3] > 0) knownPixels.push(i);
    for (const i of unresolved) field[i] = knownPixels[Math.floor(random() * knownPixels.length)];
  }
  const copy = (i: number): void => {
    const from = field[i], alpha = data[i * 4 + 3], sa = data[from * 4 + 3];
    for (let c = 0; c < 3; c++) output[i * 4 + c] = Math.fround(data[from * 4 + c] / sa * alpha);
  };
  for (const i of holes) copy(i);
  // Random search + alternating propagation, all donors remain original fully-known patches.
  if (offsets[0].error > .01) for (let pass = 0; pass < 4; pass++) {
    input.context?.signal?.throwIfAborted();
    const ordered = pass % 2 ? [...holes].reverse() : holes, direction = pass % 2 ? -1 : 1;
    for (const i of ordered) {
      const x = i % w, y = Math.floor(i / w);
      let best = field[i], error = patchError(i, best % w, Math.floor(best / w));
      const consider = (sx: number, sy: number): void => { const score = patchError(i, sx, sy); if (score < error) { error = score; best = sy * w + sx; } };
      for (const j of [x - direction >= 0 && x - direction < w ? i - direction : -1, y - direction >= 0 && y - direction < h ? i - direction * w : -1]) {
        if (j < 0 || field[j] < 0) continue;
        consider(field[j] % w + (j === i - direction ? direction : 0), Math.floor(field[j] / w) + (j === i - direction * w ? direction : 0));
      }
      for (let radius = Math.max(w, h); radius >= 1; radius = Math.floor(radius / 2)) consider(best % w + Math.floor((random() * 2 - 1) * radius), Math.floor(best / w) + Math.floor((random() * 2 - 1) * radius));
      field[i] = best; copy(i);
    }
  }
  // Coverage applied exactly once; outside and alpha remain bit-identical, HDR is not clipped.
  for (const i of holes) for (let c = 0; c < 3; c++) output[i * 4 + c] = Math.fround(data[i * 4 + c] + (output[i * 4 + c] - data[i * 4 + c]) * coverage[i]);
  return { data: output, ringError: offsets[0].error, offsets: offsets.map(({ x, y, error }) => ({ x, y, error })) };
}
