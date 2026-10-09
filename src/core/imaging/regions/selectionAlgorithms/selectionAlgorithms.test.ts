import { describe, expect, it } from 'vitest';
import { createSnapshotRegionSource, staticRegionContext } from '../snapshot';
import type { RegionRect, RegionSnapshot } from '../contracts';
import { solveSelection, modifySelection, type SelectionPixelSource } from './index';

function source(width: number, height: number, pixel: (x: number, y: number) => readonly number[]): SelectionPixelSource {
  return { grid: { width, height }, read: region => {
    const data = new Float32Array(region.width * region.height * 4);
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) data.set(pixel(x + region.x, y + region.y), (y * region.width + x) * 4);
    return { ...region, data };
  } };
}
async function full(snapshot: RegionSnapshot): Promise<Float32Array> {
  return (await createSnapshotRegionSource(snapshot).read({ x: 0, y: 0, ...snapshot.grid }, staticRegionContext(snapshot.grid, 'readback'))).data;
}
const context = (input: SelectionPixelSource, signal?: AbortSignal) => staticRegionContext(input.grid, 'source-v1', signal);

describe('共享高级选区', () => {
  it('跨多块四连通，孤立同色只有全局模式选中；透明 RGB 不参与匹配', async () => {
    const input = source(9, 4, (x, y) => [y === 1 || (x === 8 && y === 3) ? .25 : .75, 0, 0, 1]);
    const algorithm = { kind: 'wand', seed: { x: 0, y: 1 }, tolerance: 0, contiguous: true } as const;
    const contiguous = await full(await solveSelection(input, algorithm, { context: context(input), tileSize: 2 }));
    expect([...contiguous].filter(value => value === 1)).toHaveLength(9);
    expect(contiguous[35]).toBe(0);
    expect(await full(await solveSelection(input, algorithm, { context: context(input), tileSize: 9 }))).toEqual(contiguous);
    const global = await full(await solveSelection(input, { ...algorithm, contiguous: false }, { context: context(input), tileSize: 2 }));
    expect(global[35]).toBe(1);
    const transparent = source(3, 1, x => [x * 40, x * 10, 0, x === 2 ? .1 : 0]);
    expect([...await full(await solveSelection(transparent, { ...algorithm, seed: { x: 0, y: 0 } }, { context: context(transparent), tileSize: 1 }))]).toEqual([1, 1, 0]);
  });
  it('颜色容差和 alpha、HDR 保真；多点范围保留非字节软覆盖', async () => {
    const input = source(4, 1, x => [2 + x * .07, .2, .1, x === 3 ? 0 : .4]);
    const algorithm = { kind: 'color-range', samples: [{ x: 0, y: 0 }], tolerance: .3 } as const;
    const pixels = await full(await solveSelection(input, algorithm, { context: context(input), tileSize: 2 }));
    expect(pixels[0]).toBe(1); expect(pixels[1]).toBeCloseTo(1 - .07 / .3, 5); expect(pixels[3]).toBe(0);
    expect(Math.abs(pixels[1] * 255 - Math.round(pixels[1] * 255))).toBeGreaterThan(.01);
    const multi = await full(await solveSelection(input, { ...algorithm, samples: [{ x: 0, y: 0 }, { x: 2, y: 0 }] }, { context: context(input) }));
    expect(multi[2]).toBe(1);
  });
  it('修改的跨块 golden、半透明、画外与 halo/full 一致', async () => {
    const grid = { width: 7, height: 5 }, data = new Float32Array(35); data[2 * 7 + 3] = .371234;
    const snapshot: RegionSnapshot = { grid, tileSize: 7, defaultValue: 0, inverted: false, tiles: new Map([['0/0', { x: 0, y: 0, ...grid, data }]]) };
    const input = { grid, ...createSnapshotRegionSource(snapshot) };
    for (const mode of ['expand', 'contract', 'smooth', 'border'] as const) {
      const tiled = await full(await modifySelection(input, mode, 1, { context: staticRegionContext(grid, 'v1'), tileSize: 2 }));
      const whole = await full(await modifySelection(input, mode, 1, { context: staticRegionContext(grid, 'v1'), tileSize: 7 }));
      expect(tiled).toEqual(whole);
      expect(tiled[17]).toBeCloseTo(mode === 'smooth' ? .371234 / 9 : mode === 'contract' ? 0 : .371234, 7);
      expect(tiled[0]).toBe(0);
    }
    const all: RegionSnapshot = { ...snapshot, defaultValue: 1, tiles: new Map() };
    const eroded = await full(await modifySelection({ grid, ...createSnapshotRegionSource(all) }, 'contract', 1, { context: staticRegionContext(grid, 'v1'), tileSize: 2 }));
    expect(eroded[0]).toBe(0); expect(eroded[17]).toBe(1);
  });
  it('焦点仅选择清晰纹理、均匀画面为空，分块和全幅无接缝', async () => {
    const input = source(40, 24, (x, y) => [x < 20 ? (x + y) % 2 : .5, 0, 0, 1]);
    const algorithm = { kind: 'focus', range: .7, noise: 0 } as const;
    const tiled = await full(await solveSelection(input, algorithm, { context: context(input), tileSize: 7 }));
    const whole = await full(await solveSelection(input, algorithm, { context: context(input), tileSize: 40 }));
    expect(tiled).toEqual(whole); expect(tiled[12 * 40 + 8]).toBe(1); expect(tiled[12 * 40 + 35]).toBe(0);
    const flat = source(8, 8, () => [.5, .5, .5, 1]);
    expect((await solveSelection(flat, algorithm, { context: context(flat) })).tiles.size).toBe(0);
  });
  it('传递源帧和 ROI，取消迟到 read；非法样本/覆盖不吞错', async () => {
    const grid = { width: 4, height: 3 }, abort = new AbortController();
    const input: SelectionPixelSource = { grid, read: async (roi, ctx) => {
      expect(ctx.time).toEqual({ kind: 'frame', ticks: 17, timeBase: [1, 24], frameId: 'frame17' });
      expect(roi).toEqual({ x: 2, y: 0, width: 2, height: 2 }); abort.abort();
      return { ...roi, data: new Float32Array(roi.width * roi.height * 4) };
    } };
    await expect(solveSelection(input, { kind: 'wand', seed: { x: 3, y: 1 }, tolerance: .1, contiguous: true }, { tileSize: 2, context: { ...staticRegionContext(grid, 'v1', abort.signal), time: { kind: 'frame', ticks: 17, timeBase: [1, 24], frameId: 'frame17' } } })).rejects.toThrow();
    const valid = source(2, 2, () => [0, 0, 0, 1]);
    await expect(solveSelection(valid, { kind: 'color-range', samples: [], tolerance: .1 }, { context: context(valid) })).rejects.toThrow('取样点');
    await expect(solveSelection(valid, { kind: 'wand', seed: { x: 2, y: 0 }, tolerance: .1, contiguous: true }, { context: context(valid) })).rejects.toThrow('超出');
    const malformed: SelectionPixelSource = { grid: valid.grid, read: (roi: RegionRect) => ({ ...roi, data: new Float32Array(1) }) };
    await expect(solveSelection(malformed, { kind: 'wand', seed: { x: 0, y: 0 }, tolerance: .1, contiguous: true }, { context: context(malformed) })).rejects.toThrow('尺寸');
  });
  it('4K 范围扫描逐块消费，不申请全幅 RGBA，精确覆盖保持原尺寸', async () => {
    const input = source(3840, 2160, (x, y) => [x < 1920 ? .25 : .75, y / 2160, 0, 1]);
    let maxRead = 0, reads = 0;
    const original = input.read; input.read = (roi, ctx) => { maxRead = Math.max(maxRead, roi.width * roi.height); reads++; return original(roi, ctx); };
    const result = await solveSelection(input, { kind: 'color-range', samples: [{ x: 0, y: 0 }], tolerance: .001 }, { context: context(input) });
    expect(result.grid).toEqual(input.grid); expect(maxRead).toBeLessThanOrEqual(512 * 512); expect(reads).toBe(41);
    expect(result.tiles.get('0/0')!.data[0]).toBe(1);
  }, 20000);
});
