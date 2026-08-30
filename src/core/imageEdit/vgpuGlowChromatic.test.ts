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

type Rgb = readonly [number, number, number];

function blurPositive(values: readonly number[]): number[] {
  return values.map((_, index) => (
    (values[index - 1] ?? 0) * 0.25
    + values[index] * 0.5
    + (values[index + 1] ?? 0) * 0.25
  ));
}

function shift(values: readonly number[], offset: number): number[] {
  return values.map((_, index) => values[index - offset] ?? 0);
}

function transportCarrier(
  centered: readonly Rgb[],
  carriers: readonly [readonly number[], readonly number[]],
  channels: readonly [0 | 1 | 2, 0 | 1 | 2],
  amount: number,
  offset: number
): Rgb[] {
  const left = shift(blurPositive(carriers[0]), -offset);
  const right = shift(blurPositive(carriers[1]), offset);
  return centered.map((rgb, index) => {
    const result = [...rgb] as [number, number, number];
    result[channels[0]] -= Math.min(carriers[0][index], rgb[channels[0]]) * amount;
    result[channels[1]] -= Math.min(carriers[1][index], rgb[channels[1]]) * amount;
    result[channels[0]] += left[index] * amount;
    result[channels[1]] += right[index] * amount;
    return result;
  });
}

function energy(values: readonly Rgb[]): number {
  return values.reduce((sum, rgb) => sum + rgb[0] + rgb[1] + rgb[2], 0);
}

function channelEnergy(values: readonly Rgb[], channel: 0 | 1 | 2): number {
  return values.reduce((sum, rgb) => sum + rgb[channel], 0);
}

describe('VGPU 辉光柔性色差', () => {
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

  it('只从中远场构造正值 carrier，且预览重基准保留颜色顺序与光学比例', () => {
    const recipe = compileVgpuGlowRecipe({
      ...createDefaultVgpuGlowOperationParams(),
      radius: 0.85,
      chromaticAberration: 1,
      chromaticChannels: ['green', 'red'],
    }, UHD);
    expect(recipe.chromaticChannelIndices).toEqual([1, 0]);
    expect(recipe.scatterLevels.some((level) => level.chromaticCarrierWeight === 0)).toBe(true);
    expect(recipe.scatterLevels.some((level) => level.chromaticCarrierWeight > 0)).toBe(true);
    for (const level of recipe.scatterLevels) {
      expect(level.chromaticCarrierWeight).toBeGreaterThanOrEqual(0);
      expect(level.chromaticCarrierWeight).toBeLessThanOrEqual(level.weight[0]);
    }
    const preview = rebaseVgpuGlowRecipeForScale(recipe, 1920, 1080);
    expect(preview.chromaticChannelIndices).toEqual([1, 0]);
    expect(preview.chromaticOffsetPx / recipe.chromaticOffsetPx).toBeCloseTo(0.5, 8);
    expect(preview.chromaticCarrierMinimumSigmaPx).toBeCloseTo(
      recipe.chromaticCarrierMinimumSigmaPx * 0.5,
      8
    );
  });

  it('用正权重柔化搬运两侧色光，总能量守恒且不生成负边或硬副本', () => {
    const size = 81;
    const center = 40;
    const field = Array.from({ length: size }, (_, index) => (
      Math.exp(-Math.pow((index - center) / 7, 2) / 2)
    ));
    const centered: Rgb[] = field.map((value) => [value * 0.25, value * 0.5, value * 0.25]);
    const carriers = [
      field.map((value) => value * 0.25 * 0.55),
      field.map((value) => value * 0.25 * 0.55),
    ] as const;
    const amount = 0.82;
    const redBlue = transportCarrier(centered, carriers, [0, 2], amount, 3);
    const blueRed = transportCarrier(centered, carriers, [2, 0], amount, 3);
    expect(energy(redBlue)).toBeCloseTo(energy(centered), 6);
    expect(energy(blueRed)).toBeCloseTo(energy(centered), 6);
    for (const channel of [0, 1, 2] as const) {
      expect(channelEnergy(redBlue, channel)).toBeCloseTo(channelEnergy(centered, channel), 6);
      expect(channelEnergy(blueRed, channel)).toBeCloseTo(channelEnergy(centered, channel), 6);
    }
    expect(redBlue.flat().every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(blueRed.flat().every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    for (let index = 0; index < size; index += 1) {
      expect(redBlue[index][0]).toBeCloseTo(blueRed[index][2], 10);
      expect(redBlue[index][2]).toBeCloseTo(blueRed[index][0], 10);
    }
    expect(transportCarrier(centered, carriers, [0, 2], 0, 3)).toEqual(centered);
  });

  it('着色器用 MRT 分别传递两条宽场 carrier，并避免有符号差分或白热漂白色光', () => {
    expect(upsampleShaderSource).toContain('@location(1) chromaticCarriers: vec2f');
    expect(upsampleShaderSource).not.toContain('@location(2)');
    expect(copyShaderSource).toContain('@binding(1) var sourceCarriers');
    expect(copyShaderSource).toContain('@location(1) chromaticCarriers: vec2f');
    expect(compositeShaderSource).toContain('@binding(3) var chromaticCarriers');
    expect(compositeShaderSource).toContain('channelColor(composite.params.z)');
    expect(compositeShaderSource).toContain('channelColor(composite.params.w)');
    expect(compositeShaderSource).toContain('let remaining = max(');
    expect(compositeShaderSource).toContain('let spectral = (');
    expect(compositeShaderSource).toContain('whiteCorrection');
    expect(compositeShaderSource).not.toContain('separated - softCentered');
    expect(compositeShaderSource).not.toContain('diffusePeak');
  });
});
