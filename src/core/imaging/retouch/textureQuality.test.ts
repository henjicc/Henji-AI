import { expect, it } from 'vitest';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { completeRetouchTexture } from './texture';

it.each(['mask', 'rectangle', 'fractional'] as const)('固定大面积砖墙 %s 真实像素：纹理相位、残色、边缘和原图保护', async region => {
  const root = 'tests/fixtures/image-inpainting', w = 512, h = 512;
  const [source, truth, mask] = await Promise.all(['source', 'original', 'mask'].map(async kind => new Uint8Array(await sharp(path.join(root, `brick-large-${kind}.png`)).ensureAlpha().raw().toBuffer())));
  const pixels = new Float32Array(w * h * 4), coverage = new Float32Array(w * h);
  for (let i = 0; i < coverage.length; i++) {
    const x = i % w, y = Math.floor(i / w);
    coverage[i] = region === 'mask' ? mask[i * 4] / 255 : Number(x >= 164 && x < 343 && y >= 143 && y < 384); const alpha = source[i * 4 + 3] / 255;
    if (region === 'fractional') coverage[i] = Math.max(0, Math.min(x + 1, 343.04) - Math.max(x, 163.84)) * Math.max(0, Math.min(y + 1, 384) - Math.max(y, 143.36));
    for (let c = 0; c < 3; c++) { const value = source[i * 4 + c] / 255; pixels[i * 4 + c] = (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * alpha; }
    pixels[i * 4 + 3] = alpha;
  }
  const started = performance.now(), result = completeRetouchTexture({ pixels: { width: w, height: h, originX: 0, originY: 0, data: pixels }, coverage, seed: 1 });
  const durationMs = performance.now() - started, output = new Uint8Array(source); let n = 0, error = 0, squared = 0, red = 0, boundary = 0, bn = 0;
  for (let i = 0; i < coverage.length; i++) {
    if (!coverage[i]) { expect(result.data.subarray(i * 4, i * 4 + 4)).toEqual(pixels.subarray(i * 4, i * 4 + 4)); continue; }
    expect(result.data[i * 4 + 3]).toBe(pixels[i * 4 + 3]); n++;
    const edge = [i - 1, i + 1, i - w, i + w].some(j => j < 0 || j >= coverage.length || !coverage[j]);
    for (let c = 0; c < 3; c++) {
      const linear = result.data[i * 4 + c] / result.data[i * 4 + 3];
      output[i * 4 + c] = Math.round(Math.max(0, Math.min(255, (linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055) * 255)));
      const d = Math.abs(output[i * 4 + c] - truth[i * 4 + c]); error += d; squared += d * d; if (edge) { boundary += d; bn++; }
    }
    red += Math.max(0, output[i * 4] - truth[i * 4] - Math.max(0, output[i * 4 + 1] - truth[i * 4 + 1]));
  }
  const metrics = { durationMs, selectedMAE: error / n / 3, selectedPSNR: 10 * Math.log10(255 ** 2 / (squared / n / 3)), boundaryMAE: boundary / bn, excessRed: red / n, ringError: result.ringError, offsets: result.offsets.slice(0, 8), outsideChanged: 0, alphaChanged: 0 };
  await fs.mkdir('.reality/t119-11-quality', { recursive: true });
  const suffix = region === 'mask' ? '' : `-${region}`;
  await fs.writeFile(`.reality/t119-11-quality/texture${suffix}-metrics.json`, JSON.stringify(metrics, null, 2));
  await sharp(output, { raw: { width: w, height: h, channels: 4 } }).png().toFile(`.reality/t119-11-quality/brick-texture${suffix}.png`);
  expect(metrics.selectedMAE).toBeLessThan(5); expect(metrics.selectedPSNR).toBeGreaterThan(30);
  expect(metrics.boundaryMAE).toBeLessThan(5); expect(metrics.excessRed).toBeLessThan(3.2);
}, 60_000);
