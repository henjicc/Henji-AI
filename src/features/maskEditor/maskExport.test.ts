import { describe, expect, it, vi } from 'vitest';
import { createEmptyMaskDocument } from './maskDocument';
import { renderMaskDocument } from './maskExport';
import { rasterizeQuickMaskCoverage } from './regionAdapter';

describe('参数蒙版导出', () => {
  it('按共享 float32 覆盖编码透明区；擦除恢复不透明而画外仍为原始区域', () => {
    const document = { ...createEmptyMaskDocument('source', 8, 4), strokes: [
      { id: 'paint', kind: 'rectangle' as const, mode: 'paint' as const, points: [{ x: 0.25, y: 0 }, { x: 6, y: 4 }] },
      { id: 'erase', kind: 'rectangle' as const, mode: 'erase' as const, points: [{ x: 2, y: 0 }, { x: 4, y: 4 }] },
    ] };
    const image = { width: 8, height: 4, data: new Uint8ClampedArray(8 * 4 * 4), colorSpace: 'srgb' as const };
    const context = { createImageData: vi.fn(() => image), putImageData: vi.fn() };
    renderMaskDocument(context, document);
    expect(context.putImageData).toHaveBeenCalledWith(image, 0, 0);
    const coverage = rasterizeQuickMaskCoverage(document, { x: 0, y: 0, width: 8, height: 4 });
    expect(Array.from({ length: coverage.length }, (_, i) => image.data[i * 4 + 3])).toEqual([...coverage].map(v => Math.round((1 - v) * 255)));
    expect(image.data[3]).toBe(64); expect(image.data[2 * 4 + 3]).toBe(255); expect(image.data[5 * 4 + 3]).toBe(0);
  });
  it('软边和连续平滑路径导出有半透明边缘、实心中心；分块保持同一覆盖', () => {
    const document = { ...createEmptyMaskDocument('source', 530, 20), strokes: [{ id: 'soft', mode: 'paint' as const,
      size: 12, hardness: 0.25, points: [{ x: 490, y: 10 }, { x: 512, y: 10 }, { x: 525, y: 10 }] }] };
    const region = { x: 500, y: 4, width: 25, height: 12 };
    const whole = rasterizeQuickMaskCoverage(document, region);
    const a = rasterizeQuickMaskCoverage(document, { ...region, width: 12 });
    const b = rasterizeQuickMaskCoverage(document, { ...region, x: 512, width: 13 });
    for (let y = 0; y < 12; y++) for (let x = 0; x < 25; x++) expect(whole[y * 25 + x]).toBe(x < 12 ? a[y * 12 + x] : b[y * 13 + x - 12]);
    expect(whole.some(v => v > 0 && v < 1)).toBe(true); expect(whole.some(v => v === 1)).toBe(true);
  });
});
