import { expect, it } from 'vitest';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import { PaintDabGenerator, type PaintSurface } from '../paint';
import { rasterizeRetouchDabs } from './brush';

it.each([
  { name: 'face-scratch', x: 246.5, from: 119, to: 158, offset: -16, diameter: 32 },
  { name: 'hair-edge', x: 190, from: 46, to: 103, offset: 64, diameter: 60 },
])('真实 $name 修复画笔：保留失败样本与边界，非选区和alpha不变', async sample => {
  const root = 'tests/fixtures/image-inpainting', w = 512, h = 512;
  const [bytes, truth, mask] = await Promise.all(['source', 'original', 'mask'].map(kind => sharp(`${root}/${sample.name}-${kind}.png`).ensureAlpha().raw().toBuffer()));
  const data = new Float32Array(w * h * 4), clip = new Float32Array(w * h);
  for (let i = 0; i < clip.length; i++) {
    clip[i] = mask[i * 4] / 255;
    for (let c = 0; c < 3; c++) { const value = bytes[i * 4 + c] / 255; data[i * 4 + c] = value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }
    data[i * 4 + 3] = 1;
  }
  const surface: PaintSurface = { width: w, height: h, originX: 0, originY: 0, before: data, output: new Float32Array(data), coverage: new Float32Array(w * h), clip };
  const brush = { size: sample.diameter, hardness: 1, opacity: 1, flow: 1 }, generator = new PaintDabGenerator(brush);
  const dabs = [...generator.append([{ x: sample.x, y: sample.from }, { x: sample.x, y: sample.to }]), ...generator.finish()];
  const started = performance.now();
  rasterizeRetouchDabs(surface, dabs, brush, { mode: 'heal', source: { width: w, height: h, originX: 0, originY: 0, data }, destination: { width: w, height: h, originX: 0, originY: 0, data }, destinationCoverage: clip, offset: { x: sample.offset, y: 0 }, healingRadius: Math.ceil(sample.diameter / 2) });
  const durationMs = performance.now() - started, output = Buffer.from(bytes); let beforeMAE = 0, afterMAE = 0, n = 0;
  for (let i = 0; i < clip.length; i++) {
    if (!clip[i]) { if (surface.output.subarray(i * 4, i * 4 + 4).some((value, c) => value !== data[i * 4 + c])) throw new Error('非选区改变'); continue; }
    expect(surface.output[i * 4 + 3]).toBe(1); n++;
    for (let c = 0; c < 3; c++) {
      const value = surface.output[i * 4 + c]; output[i * 4 + c] = Math.round(Math.max(0, Math.min(255, (value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055) * 255)));
      beforeMAE += Math.abs(bytes[i * 4 + c] - truth[i * 4 + c]); afterMAE += Math.abs(output[i * 4 + c] - truth[i * 4 + c]);
    }
  }
  await fs.mkdir('.reality/t119-11-quality', { recursive: true });
  await sharp(output, { raw: { width: w, height: h, channels: 4 } }).png().toFile(`.reality/t119-11-quality/${sample.name}-heal.png`);
  await fs.writeFile(`.reality/t119-11-quality/${sample.name}-metrics.json`, JSON.stringify({ durationMs, beforeMAE: beforeMAE / n / 3, afterMAE: afterMAE / n / 3, outsideChanged: 0, alphaChanged: 0, sample }, null, 2));
  expect(afterMAE).toBeLessThan(beforeMAE);
  expect(afterMAE / n / 3).toBeLessThan(sample.name === 'face-scratch' ? 20 : 45);
});
