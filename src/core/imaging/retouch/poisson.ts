/*! @license Adapted to TypeScript/Float32 from PhotoCraft crates/algo/src/poisson.rs,
 * ec350d64aedd019afc5eda290cc32909bc9bab7d. Cascadic multigrid + SOR membrane solver.
 * MIT License — Copyright (c) 2026 ArtCraft Team and the PhotoCraft contributors.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

function sor(w: number, h: number, unknown: Uint8Array, values: Float32Array, iterations: number, omega: number): void {
  const cells: number[] = [];
  for (let i = 0; i < unknown.length; i++) if (unknown[i]) cells.push(i);
  for (let pass = 0; pass < iterations; pass++) {
    let maximum = 0;
    for (const i of cells) {
      const x = i % w, y = Math.floor(i / w); let sum = 0, n = 0;
      if (x > 0) { sum += values[i - 1]; n++; }
      if (x + 1 < w) { sum += values[i + 1]; n++; }
      if (y > 0) { sum += values[i - w]; n++; }
      if (y + 1 < h) { sum += values[i + w]; n++; }
      if (!n) continue;
      const change = omega * (sum / n - values[i]); values[i] += change; maximum = Math.max(maximum, Math.abs(change));
    }
    if (maximum < 2e-5) break;
  }
}

export function solveRetouchMembrane(w: number, h: number, unknown: Uint8Array, values: Float32Array, depth = 0): void {
  let count = 0, knownSum = 0;
  for (let i = 0; i < unknown.length; i++) { if (unknown[i]) count++; else knownSum += values[i]; }
  if (!count || count === unknown.length) return;
  if (w >= 8 && h >= 8 && count > 64 && depth < 16) {
    const cw = Math.ceil(w / 2), ch = Math.ceil(h / 2), coarse = new Float32Array(cw * ch), mask = new Uint8Array(cw * ch).fill(1);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      let sum = 0, n = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = x * 2 + dx, sy = y * 2 + dy;
        if (sx < w && sy < h && !unknown[sy * w + sx]) { sum += values[sy * w + sx]; n++; }
      }
      if (n) { mask[y * cw + x] = 0; coarse[y * cw + x] = sum / n; }
    }
    solveRetouchMembrane(cw, ch, mask, coarse, depth + 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!unknown[y * w + x]) continue;
      const fx = Math.max(0, Math.min(cw - 1, (x + .5) / 2 - .5)), fy = Math.max(0, Math.min(ch - 1, (y + .5) / 2 - .5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(cw - 1, x0 + 1), y1 = Math.min(ch - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
      const a = coarse[y0 * cw + x0] + (coarse[y0 * cw + x1] - coarse[y0 * cw + x0]) * tx;
      const b = coarse[y1 * cw + x0] + (coarse[y1 * cw + x1] - coarse[y1 * cw + x0]) * tx;
      values[y * w + x] = a + (b - a) * ty;
    }
    sor(w, h, unknown, values, 30, 1.7);
  } else {
    const mean = knownSum / (unknown.length - count);
    for (let i = 0; i < unknown.length; i++) if (unknown[i]) values[i] = mean;
    sor(w, h, unknown, values, 2000, 1.85);
  }
}
