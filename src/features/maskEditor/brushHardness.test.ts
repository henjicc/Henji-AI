import { describe, expect, it } from 'vitest';
import {
  createMaskBrushRenderLayers,
  DEFAULT_MASK_BRUSH_HARDNESS,
  normalizeMaskBrushHardness,
} from './brushHardness';

function compositeOpacity(opacities: number[]): number {
  return 1 - opacities.reduce((remaining, opacity) => remaining * (1 - opacity), 1);
}

describe('mask brush hardness', () => {
  it('硬边只绘制一层，并兼容旧文档缺省硬度', () => {
    expect(normalizeMaskBrushHardness(undefined)).toBe(DEFAULT_MASK_BRUSH_HARDNESS);
    expect(createMaskBrushRenderLayers(40, 1)).toEqual([{ size: 40, opacity: 1 }]);
  });

  it('软边从外沿到硬芯逐层收窄，中心保持完全生效', () => {
    const layers = createMaskBrushRenderLayers(40, 0.25);

    expect(layers).toHaveLength(8);
    expect(layers[0].size).toBe(40);
    expect(layers.at(-1)?.size).toBe(10);
    expect(layers[0].opacity).toBeLessThan(layers.at(-1)?.opacity ?? 0);
    expect(compositeOpacity(layers.map((layer) => layer.opacity))).toBeCloseTo(1, 8);
  });

  it('预览层可以限制最大覆盖率而不改变羽化形状', () => {
    const layers = createMaskBrushRenderLayers(32, 0.5, 0.55);
    expect(compositeOpacity(layers.map((layer) => layer.opacity))).toBeCloseTo(0.55, 8);
  });

  it('大尺寸低硬度画笔自适应增加层数，并限制性能上限', () => {
    expect(createMaskBrushRenderLayers(256, 0.1)).toHaveLength(15);
    expect(createMaskBrushRenderLayers(512, 0.1)).toHaveLength(24);
  });
});
