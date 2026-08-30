import { describe, expect, it } from 'vitest';
import { createDefaultDiffusionOperationParams } from '../../diffusionParams';
import { compileDiffusionRecipe } from '../../diffusionRecipe';
import { createFloat32PremultipliedRgbaTile } from './contracts';
import { applyDiffusionV4, buildDiffusionScatterV4 } from './diffusion';

function impulse(width: number, height: number): ReturnType<typeof createFloat32PremultipliedRgbaTile> {
  const data = new Float32Array(width * height * 4);
  const center = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
  data.set([1, 0.5, 0.2, 1], center);
  return createFloat32PremultipliedRgbaTile(width, height, 'linear-light', data);
}

describe('Diffusion v4 Float32 CPU 参考内核', () => {
  it('使用 schema v4 recipe 构建连续 mip 散射并保留 Float32/预乘契约', () => {
    const source = impulse(33, 17);
    const recipe = compileDiffusionRecipe(
      { ...createDefaultDiffusionOperationParams(), mode: 'glow', quality: 'high' },
      { width: source.width, height: source.height, quality: 'high' },
    );
    const scatter = buildDiffusionScatterV4(source, recipe);
    const rendered = applyDiffusionV4(source, recipe);

    expect(scatter.width).toBe(17);
    expect(scatter.height).toBe(9);
    expect(scatter.data.some((value) => value > 0)).toBe(true);
    expect(rendered).toMatchObject({
      width: 33,
      height: 17,
      storage: 'rgba-float32',
      colorDomain: 'linear-light',
      alpha: 'premultiplied',
    });
  });

  it('透明像素保持透明黑，不把相邻散射写入透明边缘', () => {
    const source = impulse(17, 9);
    const recipe = compileDiffusionRecipe(
      { ...createDefaultDiffusionOperationParams(), mode: 'white_mist', quality: 'high' },
      { width: source.width, height: source.height, quality: 'high' },
    );
    const output = applyDiffusionV4(source, recipe);
    for (let offset = 0; offset < output.data.length; offset += 4) {
      if (source.data[offset + 3] !== 0) continue;
      expect(Array.from(output.data.subarray(offset, offset + 4))).toEqual([0, 0, 0, 0]);
    }
  });
});
