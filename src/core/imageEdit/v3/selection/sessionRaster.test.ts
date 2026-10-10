import { describe, expect, it } from 'vitest';
import { appendImageEditSelectionV3, imageEditSelectionSessionSchemaV3 } from './session';
import { exportImageEditSelectionMaskV3, rasterizeImageEditSessionRegionV3 } from './sessionRaster';

const size = { width: 1024, height: 32 };
const left = { type: 'rectangle' as const, x: 0, y: 0, width: 0.5, height: 1 };
const right = { ...left, x: 0.5 };
describe('独立选区覆盖率和边缘', () => {
  it.each([['replace', [0, 1]], ['add', [1, 1]], ['subtract', [1, 0]], ['intersect', [0, 0]]] as const)('%s 四种组合不修改图层', (mode, expected) => {
    const selection = appendImageEditSelectionV3(appendImageEditSelectionV3(null, left, 'replace'), right, mode);
    const result = rasterizeImageEditSessionRegionV3(selection, size, { x: 511, y: 10, width: 2, height: 1 });
    expect([...result]).toEqual(expected);
  });
  it('反选之后继续减选顺序正确，画外没有反选覆盖', () => {
    const selection = appendImageEditSelectionV3({ ...appendImageEditSelectionV3(null, left, 'replace'), inverted: true }, right, 'subtract');
    expect([...rasterizeImageEditSessionRegionV3(selection, size, { x: 0, y: 10, width: 1024, height: 1 })].every(v => v === 0)).toBe(true);
    expect(rasterizeImageEditSessionRegionV3({ ...selection, inverted: true }, size, { x: -1, y: 10, width: 1, height: 1 })[0]).toBe(0);
  });
  it('羽化在 512 瓦片两侧与整体求值一致，调回零恢复原始几何', () => {
    const raw = appendImageEditSelectionV3(null, left, 'replace');
    const soft = { ...raw, feather: 0.06 };
    const whole = rasterizeImageEditSessionRegionV3(soft, size, { x: 500, y: 8, width: 24, height: 16 });
    const a = rasterizeImageEditSessionRegionV3(soft, size, { x: 500, y: 8, width: 12, height: 16 });
    const b = rasterizeImageEditSessionRegionV3(soft, size, { x: 512, y: 8, width: 12, height: 16 });
    for (let y = 0; y < 16; y++) for (let x = 0; x < 24; x++) expect(whole[y * 24 + x]).toBeCloseTo(x < 12 ? a[y * 12 + x] : b[y * 12 + x - 12], 6);
    expect(whole[11]).toBeGreaterThan(0); expect(whole[11]).toBeLessThan(1);
    expect([...rasterizeImageEditSessionRegionV3({ ...soft, feather: 0 }, size, { x: 511, y: 10, width: 2, height: 1 })]).toEqual([1, 0]);
  });
  it('连续圆头画笔覆盖段间空隙；超 8192 点套索仍可求值', () => {
    const brush = appendImageEditSelectionV3(null, { type: 'brush', points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], radius: 0.1 }, 'replace');
    expect(rasterizeImageEditSessionRegionV3(brush, size, { x: 512, y: 15, width: 1, height: 1 })[0]).toBe(1);
    const polygon = appendImageEditSelectionV3(null, { type: 'lasso', points: Array.from({ length: 9000 }, (_, i) => ({ x: 0.5 + 0.2 * Math.cos(i * 2 * Math.PI / 9000), y: 0.5 + 0.2 * Math.sin(i * 2 * Math.PI / 9000) })) }, 'replace');
    expect(rasterizeImageEditSessionRegionV3(polygon, size, { x: 512, y: 15, width: 1, height: 1 })[0]).toBe(1);
  });
  it('大羽化低频栅格在非整除尺寸下跨 512 边界无缝', () => {
    const largeSize = { width: 2051, height: 1027 };
    const selection = { ...appendImageEditSelectionV3(null, { ...left, width: 512.4 / largeSize.width }, 'replace'), feather: 0.04 };
    const whole = rasterizeImageEditSessionRegionV3(selection, largeSize, { x: 480, y: 400, width: 64, height: 16 });
    const a = rasterizeImageEditSessionRegionV3(selection, largeSize, { x: 480, y: 400, width: 32, height: 16 });
    const b = rasterizeImageEditSessionRegionV3(selection, largeSize, { x: 512, y: 400, width: 32, height: 16 });
    for (let y = 0; y < 16; y++) for (let x = 0; x < 64; x++) expect(whole[y * 64 + x]).toBeCloseTo(x < 32 ? a[y * 32 + x] : b[y * 32 + x - 32], 6);
    expect(whole[32]).toBeGreaterThan(0); expect(whole[32]).toBeLessThan(1);
  });
  it('统一导出逐块灰度位图与实际非空 ROI，并响应取消', async () => {
    const selection = appendImageEditSelectionV3(null, { type: 'rectangle', x: 0.5, y: 0.25, width: 0.25, height: 0.5 }, 'replace');
    const iterator = exportImageEditSelectionMaskV3(selection, size, async (s, region) => rasterizeImageEditSessionRegionV3(s, size, region));
    let count = 0; let step = await iterator.next();
    while (!step.done) { count++; expect(step.value.bitmap).toBeInstanceOf(Uint8Array); step = await iterator.next(); }
    expect(count).toBe(2); expect(step.value).toEqual({ left: 512, top: 8, width: 256, height: 16 });
    const abort = new AbortController(); abort.abort();
    await expect(exportImageEditSelectionMaskV3(selection, size, async (s, region) => rasterizeImageEditSessionRegionV3(s, size, region), abort.signal).next()).rejects.toThrow('CANCELLED');
  });
  it('拒绝开放字段、无效坐标与无效羽化', () => {
    expect(() => imageEditSelectionSessionSchemaV3.parse({ operations: [], feather: Number.NaN, inverted: false })).toThrow();
    expect(() => appendImageEditSelectionV3(null, { ...left, x: Infinity }, 'replace')).toThrow();
  });
});
