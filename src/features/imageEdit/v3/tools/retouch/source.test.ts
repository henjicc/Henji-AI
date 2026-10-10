import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts';
import type { PaintBrush, PaintDab, PaintSurface } from '@/core/imaging/paint';
import { rasterizeRetouchDabs, type RetouchSource } from '@/core/imaging/retouch';
import { RetouchStrokeCompute } from './source';

vi.mock('../paint/workerClient', () => ({ PaintWorkerClient: class {
  async retouch(surface: PaintSurface, dabs: readonly PaintDab[], brush: PaintBrush, source: RetouchSource) { return rasterizeRetouchDabs(surface, dabs, brush, source); }
  dispose() {}
} }));

it('4K/8K 同一跨瓦片修复结果一致，稀疏读取、选区边界及旧源缓存不依赖整图尺寸', async () => {
  const outputs: Float32Array[] = [], timings: { size: number; durationMs: number; loadedTiles: number }[] = [];
  for (const size of [4096, 8192]) {
    const tiles = new Map<string, ReturnType<typeof createFloat32PremultipliedRgbaTile>>(); let reads = 0;
    const load = async ({ x, y }: { x: number; y: number }) => {
      reads++; const key = `${x}/${y}`; let tile = tiles.get(key);
      if (!tile) {
        const data = new Float32Array(512 * 512 * 4);
        for (let py = 0; py < 512; py++) for (let px = 0; px < 512; px++) {
          const gx = x * 512 + px, gy = y * 512 + py;
          data.set([gx >= 504 && gx < 520 && gy >= 500 && gy < 528 ? 3 : .25 + gx / 8192, .3 + (gx % 8) * .03, .2, .5], (py * 512 + px) * 4);
        }
        tile = createFloat32PremultipliedRgbaTile(512, 512, 'linear-light', data); tiles.set(key, tile);
      }
      return { tile, resource: null };
    };
    const clip = async ({ x, y }: { x: number; y: number }) => {
      const data = new Float32Array(512 * 512);
      for (let py = 0; py < 512; py++) for (let px = 0; px < 512; px++) if (x * 512 + px >= 504 && x * 512 + px < 520 && y * 512 + py >= 500 && y * 512 + py < 528) data[py * 512 + px] = 1;
      return data;
    };
    const compute = new RetouchStrokeCompute(load, async () => ({ width: size, height: size }), 'heal', { x: -48, y: 0 }, clip);
    const started = performance.now(), results: Float32Array[] = [];
    for (const x of [0, 1]) {
      const { tile } = await load({ x, y: 0 });
      const surface: PaintSurface = { originX: x * 512, originY: 0, width: 512, height: 512, before: tile.data, output: new Float32Array(tile.data), coverage: new Float32Array(512 * 512), clip: await clip({ x, y: 0 }) };
      const dab: PaintDab = { x: 512, y: 512, radius: 32, roundness: 1, angle: 0, flow: 1, index: 0 };
      await compute.rasterize(surface, [dab], { size: 64, hardness: 1, opacity: 1 }, { kind: 'rgba', color: [0, 0, 0, 1] }, 'brush', new AbortController().signal);
      expect(surface.output[(510 * 512 + (x ? 1 : 510)) * 4]).toBeLessThan(1);
      results.push(surface.output);
    }
    timings.push({ size, durationMs: performance.now() - started, loadedTiles: reads });
    expect(reads).toBeLessThan(20); outputs.push(...results); compute.dispose();
  }
  expect(outputs[0]).toEqual(outputs[2]); expect(outputs[1]).toEqual(outputs[3]);
  await fs.mkdir('.reality/t119-11-quality', { recursive: true });
  await fs.writeFile('.reality/t119-11-quality/sparse-stroke-metrics.json', JSON.stringify(timings, null, 2));
});
