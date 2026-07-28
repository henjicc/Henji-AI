import { describe, expect, it } from 'vitest';
import { compileDiffusionRecipe } from '../diffusionRecipe';
import { createDefaultDiffusionOperationParams } from '../diffusionParams';
import type { DiffusionOperationParams } from '../types';

/**
 * 辉光的观感几乎全在 PSF 的径向衰减上，而这条曲线不看真实 GPU 输出也能算准：
 * 每级 mip 的降采样核与 tent 上采样核都归一到 1，所以每级都是面积归一的模糊，
 * 点光源经过第 i 级后总能量不变、峰值 ∝ 1/σ_i²，于是
 *   A(r) = Σ w_i · exp(-r²/2σ_i²) / (2πσ_i²)
 * 这里就用配方里的 levels 直接求值，把两条容易悄悄退化的性质钉住。
 */
function amplitude(
  params: DiffusionOperationParams,
  dimensions: { width: number; height: number },
  radiusPixels: number
): number {
  const recipe = compileDiffusionRecipe(params, dimensions);
  return recipe.glow.levels.reduce((sum, level) => {
    if (level.weight[1] <= 0) return sum;
    const sigma = level.divisor;
    return sum + level.weight[1]
      * Math.exp(-(radiusPixels * radiusPixels) / (2 * sigma * sigma))
      / (2 * Math.PI * sigma * sigma);
  }, 0);
}

const GLOW_PARAMS: DiffusionOperationParams = {
  ...createDefaultDiffusionOperationParams(),
  mode: 'glow',
  glowRange: 0.5,
  softness: 0.45,
};

describe('辉光 PSF', () => {
  /**
   * 固定六级的旧实现在 128px 之后没有更宽的尺度可叠，PSF 会从幂律突然退化成高斯：
   * 实测衰减指数在 128→256px 处从 3.3 跳到 8.7，512px 之后是 138。
   * 观感上就是光晕有一圈看得见的外边界，也就是「很普通的辉光」最主要的特征。
   */
  it('在最紧尺度以外全程保持 2~3 的幂律衰减，尾部不塌成高斯', () => {
    // 起点取最紧一级（3840 长边下 σ=4px）的两倍。比 σ_min 更近的地方 PSF 本来就是
    // 平顶的——真实光学的 PSF 也有有限大小的核心，那段不适用幂律。
    const radii = [8, 16, 32, 64, 128, 256, 512, 1024];
    const dimensions = { width: 3840, height: 2160 };
    for (let i = 0; i < radii.length - 1; i += 1) {
      const exponent = -(
        Math.log(amplitude(GLOW_PARAMS, dimensions, radii[i + 1]))
        - Math.log(amplitude(GLOW_PARAMS, dimensions, radii[i]))
      ) / (Math.log(radii[i + 1]) - Math.log(radii[i]));
      expect(exponent, `半径 ${radii[i]}→${radii[i + 1]}px`).toBeGreaterThan(2);
      expect(exponent, `半径 ${radii[i]}→${radii[i + 1]}px`).toBeLessThan(3.2);
    }
  });

  /**
   * 实时预览会先降到 200 万像素预算，而 mip 的 divisor 是工作分辨率像素。
   * 尺度区间若按像素而不是按占长边的比例来选，预览和导出会挑到不同的归一化尺度，
   * 实测预览比导出亮 1.4~2.6 倍——等于对着一个会骗人的预览调参。
   */
  it('预览与导出分辨率下的归一化 PSF 一致', () => {
    const exportSize = { width: 3840, height: 2160 };
    // 3840×2160 落进 200 万像素预算后约为 1885×1060
    const previewSize = { width: 1885, height: 1060 };

    for (const fraction of [0.002, 0.005, 0.01, 0.03, 0.08, 0.2]) {
      // 换算成「每归一化面积」的量，两个分辨率才可比
      const scaled = (size: { width: number; height: number }): number => {
        const reference = Math.max(size.width, size.height);
        return amplitude(GLOW_PARAMS, size, fraction * reference) * reference * reference;
      };
      const ratio = scaled(previewSize) / scaled(exportSize);
      expect(ratio, `半径 = 长边的 ${(fraction * 100).toFixed(1)}%`).toBeGreaterThan(0.8);
      expect(ratio, `半径 = 长边的 ${(fraction * 100).toFixed(1)}%`).toBeLessThan(1.25);
    }
  });

  it('逐通道权重各自归一，只错开分布而不产生整体色偏', () => {
    const recipe = compileDiffusionRecipe(GLOW_PARAMS, { width: 3840, height: 2160 });
    const contributing = recipe.glow.levels.filter((level) => level.weight[1] > 0);

    // 三通道各自和为 1：色散只改变能量在尺度间的分布，不改变每个通道的总量。
    for (const channel of [0, 1, 2]) {
      const total = recipe.glow.levels.reduce((sum, level) => sum + level.weight[channel], 0);
      expect(total).toBeCloseTo(1, 10);
    }
    // 红端衰减慢、蓝端快，于是尾部偏暖、近场偏冷。
    const tail = contributing[contributing.length - 1].weight;
    expect(tail[0]).toBeGreaterThan(tail[2]);
    const near = contributing[0].weight;
    expect(near[2]).toBeGreaterThan(near[0]);
  });

  it('尺度区间按占长边的比例选取，低于下限的层只作为链路中间产物不参与加权', () => {
    const recipe = compileDiffusionRecipe(GLOW_PARAMS, { width: 3840, height: 2160 });
    const reference = 3840;
    const contributing = recipe.glow.levels.filter((level) => level.weight[1] > 0);

    // 金字塔必须每步只降一半，所以链路一定从 divisor=2 起，但它可能不参与加权。
    expect(recipe.glow.levels[0].divisor).toBe(2);
    expect(contributing[0].divisor / reference).toBeGreaterThanOrEqual(1 / 1024);
    expect(contributing[contributing.length - 1].divisor / reference).toBeLessThanOrEqual(1 / 2);
  });
});
