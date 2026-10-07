import { describe, expect, it } from 'vitest';
import compositeShaderSource from './shaders/vgpuGlowComposite.wgsl?raw';
import copyShaderSource from './shaders/vgpuGlowCopy.wgsl?raw';
import upsampleShaderSource from './shaders/vgpuGlowUpsample.wgsl?raw';
import {
  compileVgpuGlowRecipe,
  createDefaultVgpuGlowOperationParams,
  parseVgpuGlowOperationParams,
  rebaseVgpuGlowRecipeForScale,
  replaceVgpuGlowChromaticChannel,
  type VgpuGlowChromaticChannels,
  type VgpuGlowRecipe,
} from './index';

const UHD = { width: 3840, height: 2160 } as const;
const PAIRS: readonly VgpuGlowChromaticChannels[] = [
  ['red', 'green'],
  ['red', 'blue'],
  ['green', 'red'],
  ['green', 'blue'],
  ['blue', 'red'],
  ['blue', 'green'],
];

const ENDPOINT_SOFTNESS_PX = 0.75;

function meanSigma(recipe: VgpuGlowRecipe, channel: 0 | 1 | 2): number {
  return recipe.scatterLevels.reduce(
    (sum, level) => sum + level.weight[channel] * level.effectiveSigmaPx,
    0
  );
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t)
    + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
}

/** 白色半平面经单位能量 Gaussian 混合后的解析边缘响应。 */
function halfPlaneResponse(
  recipe: VgpuGlowRecipe,
  channel: 0 | 1 | 2,
  x: number
): number {
  return recipe.scatterLevels.reduce((sum, level) => sum
    + level.weight[channel] * 0.5 * (
      1 - erf(x / (Math.SQRT2 * level.effectiveSigmaPx))
    ), 0);
}

function boundaryVisibility(recipe: VgpuGlowRecipe): number {
  const [left, right] = recipe.chromaticChannelIndices;
  const amount = recipe.chromaticAberration;
  const offset = recipe.chromaticOffsetPx;
  const softness = ENDPOINT_SOFTNESS_PX * amount;
  let maximum = 0;
  for (let x = -offset * 2 - 8; x <= offset * 2 + 8; x += 0.25) {
    const leftCentered = halfPlaneResponse(recipe, left, x);
    const rightCentered = halfPlaneResponse(recipe, right, x);
    const leftShifted = (
      halfPlaneResponse(recipe, left, x + offset - softness)
      + halfPlaneResponse(recipe, left, x + offset + softness)
    ) * 0.5;
    const rightShifted = (
      halfPlaneResponse(recipe, right, x - offset - softness)
      + halfPlaneResponse(recipe, right, x - offset + softness)
    ) * 0.5;
    const leftOutput = amount > 0 ? leftShifted : leftCentered;
    const rightOutput = amount > 0 ? rightShifted : rightCentered;
    maximum = Math.max(maximum, Math.abs(leftOutput - rightOutput));
  }
  return maximum;
}

function impulseResponse(
  recipe: VgpuGlowRecipe,
  channel: 0 | 1 | 2,
  x: number
): number {
  return recipe.scatterLevels.reduce((sum, level) => {
    const sigma = level.effectiveSigmaPx;
    return sum + level.weight[channel]
      * Math.exp(-0.5 * Math.pow(x / sigma, 2))
      / (Math.sqrt(2 * Math.PI) * sigma);
  }, 0);
}

function softShiftedImpulseResponse(
  recipe: VgpuGlowRecipe,
  channel: 0 | 1 | 2,
  x: number,
  offset: number,
  amount: number
): number {
  const softness = ENDPOINT_SOFTNESS_PX * amount;
  return (
    impulseResponse(recipe, channel, x + offset - softness)
    + impulseResponse(recipe, channel, x + offset + softness)
  ) * 0.5;
}

function countStrictLocalMaxima(values: readonly number[]): number {
  let count = 0;
  for (let index = 1; index < values.length - 1; index += 1) {
    if (values[index] > values[index - 1] && values[index] > values[index + 1]) {
      count += 1;
    }
  }
  return count;
}

describe('VGPU 辉光边界色差', () => {
  it('接受全部六种有序 RGB 颜色对，并拒绝同色或开发期旧结构', () => {
    const defaults = createDefaultVgpuGlowOperationParams();
    for (const pair of PAIRS) {
      expect(parseVgpuGlowOperationParams({
        ...defaults,
        chromaticChannels: pair,
      }).chromaticChannels).toEqual(pair);
    }
    expect(() => parseVgpuGlowOperationParams({
      ...defaults,
      chromaticChannels: ['green', 'green'],
    })).toThrow();
    expect(() => parseVgpuGlowOperationParams({
      ...defaults,
      schemaVersion: 3,
    })).toThrow();
  });

  it('用户选到另一侧已有颜色时原子交换，不产生暂态同色参数', () => {
    expect(replaceVgpuGlowChromaticChannel(['red', 'blue'], 0, 'blue'))
      .toEqual(['blue', 'red']);
    expect(replaceVgpuGlowChromaticChannel(['red', 'blue'], 1, 'green'))
      .toEqual(['red', 'green']);
    const unchanged = ['green', 'blue'] as const;
    expect(replaceVgpuGlowChromaticChannel(unchanged, 0, 'green')).toBe(unchanged);
  });

  it('Pixel Offset 与总辉光半径解耦，预览重基准保持归一化间距', () => {
    const defaults = createDefaultVgpuGlowOperationParams();
    const compact = compileVgpuGlowRecipe({
      ...defaults,
      radius: 0.05,
      chromaticAberration: 1,
      chromaticChannels: ['green', 'red'],
    }, UHD);
    const wide = compileVgpuGlowRecipe({
      ...defaults,
      radius: 1,
      chromaticAberration: 1,
      chromaticChannels: ['green', 'red'],
    }, UHD);
    expect(compact.chromaticOffsetPx).toBeCloseTo(wide.chromaticOffsetPx, 10);
    expect(wide.chromaticOffsetPx).toBeGreaterThanOrEqual(12);
    expect(wide.chromaticChannelIndices).toEqual([1, 0]);

    const preview = rebaseVgpuGlowRecipeForScale(wide, 1920, 1080);
    expect(preview.chromaticOffsetPx / preview.image.referenceDimension)
      .toBeCloseTo(wide.chromaticOffsetPx / wide.image.referenceDimension, 10);
    expect(preview.chromaticChannelIndices).toEqual([1, 0]);
  });

  it('叠加轻量 Glow Aberration：左侧更紧、右侧更宽，逐通道能量仍归一', () => {
    const recipe = compileVgpuGlowRecipe({
      ...createDefaultVgpuGlowOperationParams(),
      radius: 0.8,
      chromaticAberration: 1,
      chromaticChannels: ['green', 'red'],
    }, UHD);
    expect(recipe.chromaticRadiusMultipliers[0]).toBeCloseTo(1.18, 10);
    expect(recipe.chromaticRadiusMultipliers[1]).toBeCloseTo(0.82, 10);
    expect(recipe.chromaticRadiusMultipliers[2]).toBe(1);
    expect(meanSigma(recipe, 1)).toBeLessThan(meanSigma(recipe, 2));
    expect(meanSigma(recipe, 2)).toBeLessThan(meanSigma(recipe, 0));
    for (const channel of [0, 1, 2] as const) {
      expect(recipe.scatterLevels.reduce(
        (sum, level) => sum + level.weight[channel],
        0
      )).toBeCloseTo(1, 10);
    }
  });

  it('真实 recipe 的边界可见度随滑杆单调增加，满量程明确可见', () => {
    const visibilities = [0, 0.1, 0.25, 0.5, 0.75, 1].map((amount) => (
      boundaryVisibility(compileVgpuGlowRecipe({
        ...createDefaultVgpuGlowOperationParams(),
        look: 'dreamy',
        radius: 1,
        chromaticAberration: amount,
        chromaticChannels: ['red', 'blue'],
      }, { width: 1920, height: 1080 }))
    ));
    expect(visibilities[0]).toBeCloseTo(0, 10);
    for (let index = 1; index < visibilities.length; index += 1) {
      expect(visibilities[index]).toBeGreaterThan(visibilities[index - 1]);
    }
    // 25% 已应明显超过“几乎看不见”的级别；阈值留有多种 look / 分辨率
    // 的光学余量，但不允许以后退化回旧实现的远场微弱 carrier。
    expect(visibilities[2]).toBeGreaterThan(0.18);
    expect(visibilities[3]).toBeGreaterThan(0.3);
    expect(visibilities.at(-1)).toBeGreaterThan(0.45);
  });

  it('细线脉冲在所有中间档都整体位移，每个色散通道只保留一个光峰', () => {
    for (const amount of [0.1, 0.25, 0.5, 0.75, 1]) {
      const recipe = compileVgpuGlowRecipe({
        ...createDefaultVgpuGlowOperationParams(),
        look: 'dreamy',
        radius: 1,
        chromaticAberration: amount,
        chromaticChannels: ['red', 'blue'],
      }, UHD);
      const [left, right] = recipe.chromaticChannelIndices;
      const coordinates = Array.from(
        { length: 3201 },
        (_, index) => -80 + index * 0.05
      );
      const leftProfile = coordinates.map((x) => softShiftedImpulseResponse(
        recipe,
        left,
        x,
        recipe.chromaticOffsetPx,
        amount
      ));
      const rightProfile = coordinates.map((x) => softShiftedImpulseResponse(
        recipe,
        right,
        x,
        -recipe.chromaticOffsetPx,
        amount
      ));
      expect(countStrictLocalMaxima(leftProfile), `left at ${amount}`).toBe(1);
      expect(countStrictLocalMaxima(rightProfile), `right at ${amount}`).toBe(1);
    }
  });

  it('着色器直接位移完整辉光通道，并移除只承载远场的 MRT carrier', () => {
    expect(upsampleShaderSource).not.toContain('@location(1)');
    expect(upsampleShaderSource).not.toContain('Carrier');
    expect(copyShaderSource).not.toContain('sourceCarriers');
    expect(copyShaderSource).not.toContain('@location(1)');
    expect(compositeShaderSource).not.toContain('chromaticCarriers');
    expect(compositeShaderSource).toContain('fn sampleSoftShiftedBloom');
    expect(compositeShaderSource).toContain('let shiftedUv = uv + offset');
    expect(compositeShaderSource).toContain('0.75 * clamp(composite.optics.w, 0.0, 1.0)');
    expect(compositeShaderSource).toContain('sampleSoftShiftedBloom(sceneUv, chromaOffset)');
    expect(compositeShaderSource).toContain('sampleSoftShiftedBloom(sceneUv, -chromaOffset)');
    expect(compositeShaderSource).not.toContain('offset * 0.25');
    expect(compositeShaderSource).not.toContain('offset * 0.50');
    expect(compositeShaderSource).not.toContain('offset * 0.75');
    expect(compositeShaderSource).toContain('let spectralDelta =');
    expect(compositeShaderSource).toContain('centered + spectralDelta');
    expect(compositeShaderSource).not.toContain('spectralDelta * amount');
    expect(compositeShaderSource).not.toContain('sampleSoftCarrier');
  });
});
