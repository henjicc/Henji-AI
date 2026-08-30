import { describe, expect, it } from 'vitest';
import { IMAGE_EDITOR_PRESET_COLORS } from '@/core/theme/colorTokens';
import bloomShaderSource from './shaders/vgpuGlowBloom.wgsl?raw';
import compositeShaderSource from './shaders/vgpuGlowComposite.wgsl?raw';
import upsampleShaderSource from './shaders/vgpuGlowUpsample.wgsl?raw';
import baselineShaderSource from './worker/baseline.wgsl?raw';
import {
  IMAGE_EDIT_OPERATION_IDS,
  InvalidImageEditOperationParamsError,
  applyVgpuGlowLook,
  compileVgpuGlowRecipe,
  createBuiltInImageEditOperationRegistry,
  createDefaultVgpuGlowOperationParams,
  decodeImageEditDocument,
  effectiveScatterSigmaPx,
  extractVirtualEmitterRadiance,
  parseVgpuGlowOperationParams,
  rebaseVgpuGlowRecipeForScale,
  reconstructVirtualRadiance,
  resolveEmissionPeak,
  resolveSoftChannelPeak,
  type VgpuGlowRecipe,
} from './index';
const UHD = { width: 3840, height: 2160 } as const;
type Rgba = readonly [number, number, number, number];
type Rgb = readonly [number, number, number];
const DOWNSAMPLE_13 = [[-2, -2, 1 / 32], [0, -2, 1 / 16], [2, -2, 1 / 32], [-2, 0, 1 / 16], [0, 0, 1 / 8], [2, 0, 1 / 16], [-2, 2, 1 / 32], [0, 2, 1 / 16], [2, 2, 1 / 32], [-1, -1, 1 / 8], [1, -1, 1 / 8], [-1, 1, 1 / 8], [1, 1, 1 / 8]] as const;
// 13-tap 二维核的精确单轴边缘分布；足以完整追踪质量和一阶矩。
const DOWNSAMPLE_TAPS = [[-2, 1 / 8], [-1, 1 / 4], [0, 1 / 4], [1, 1 / 4], [2, 1 / 8]] as const;
const TENT_TAPS = [[-1, 0.25], [0, 0.5], [1, 0.25]] as const;
function screen(base: number, glow: number): number {
  return base + glow - base * glow;
}
/** 与 WGSL 相同的 W3C source-over + screen 参考实现，用来钉住透明合成不变量。 */
function compositeGlowReference(base: Rgba, glowPremultiplied: Rgb): Rgba {
  const baseAlpha = base[3];
  const glowAlpha = Math.max(...glowPremultiplied);
  if (glowAlpha <= 1e-6) return base;
  const glowStraight: Rgb = [
    glowPremultiplied[0] / glowAlpha,
    glowPremultiplied[1] / glowAlpha,
    glowPremultiplied[2] / glowAlpha,
  ];
  const outAlpha = glowAlpha + baseAlpha * (1 - glowAlpha);
  const outPremultiplied = glowStraight.map((source, channel) => (
    source * glowAlpha * (1 - baseAlpha)
    + screen(base[channel], source) * glowAlpha * baseAlpha
    + base[channel] * baseAlpha * (1 - glowAlpha)
  ));
  return [
    outPremultiplied[0] / outAlpha,
    outPremultiplied[1] / outAlpha,
    outPremultiplied[2] / outAlpha,
    outAlpha,
  ];
}
function weightedMeanFraction(recipe: VgpuGlowRecipe, channel = 1): number {
  return recipe.scatterLevels.reduce(
    (sum, level) => sum + level.weight[channel] * level.effectiveSigmaPx,
    0
  ) / recipe.image.referenceDimension;
}
/** 单位能量二维 Gaussian 混合的径向质心：E[r] = σ√(π/2)。 */
function radialCentroidFraction(recipe: VgpuGlowRecipe, channel = 1): number {
  return recipe.scatterLevels.reduce(
    (sum, level) => sum
      + level.weight[channel] * level.effectiveSigmaPx * Math.sqrt(Math.PI / 2),
    0
  ) / recipe.image.referenceDimension;
}
function amplitude(recipe: VgpuGlowRecipe, radiusFraction: number, channel = 1): number {
  const radiusPixels = radiusFraction * recipe.image.referenceDimension;
  return recipe.scatterLevels.reduce((sum, level) => {
    const sigma = level.effectiveSigmaPx;
    return sum + level.weight[channel]
      * Math.exp(-(radiusPixels * radiusPixels) / (2 * sigma * sigma))
      / (2 * Math.PI * sigma * sigma);
  }, 0) * recipe.image.referenceDimension * recipe.image.referenceDimension;
}
function sampleLine(source: readonly number[], coordinate: number): number {
  if (coordinate < -0.5 || coordinate > source.length - 0.5) return 0;
  const left = Math.floor(coordinate), amount = coordinate - left;
  const start = source[Math.min(source.length - 1, Math.max(0, left))], end = source[Math.min(source.length - 1, Math.max(0, left + 1))];
  return start * (1 - amount) + end * amount;
}
function resampleLine(source: readonly number[], size: number, scale: number, taps: ReadonlyArray<readonly [number, number]>) {
  return Array.from({ length: size }, (_, index) => taps.reduce((sum, [offset, weight]) =>
    sum + sampleLine(source, (index + 0.5) / scale - 0.5 + offset) * weight, 0));
}
function impulsePyramid(size: number, position: number): number[][] {
  let current = Array.from({ length: size }, (_, index) => Number(index === position));
  const levels = Array.from({ length: 5 }, () => (current = resampleLine(current, Math.ceil(current.length / 2), 0.5, DOWNSAMPLE_TAPS)));
  return levels.map((level, index) => {
    let reconstructed = level;
    for (let target = index - 1; target >= 0; target -= 1) reconstructed = resampleLine(reconstructed, levels[target].length, 2, TENT_TAPS);
    return resampleLine(reconstructed, size, 2, [[0, 1]]);
  });
}
function impulseMetrics(values: readonly number[], position: number, scale = 1) {
  const mass = values.reduce((sum, value) => sum + value, 0);
  const centroid = values.reduce((sum, value, index) => sum + ((index + 0.5) * scale - 0.5) * value, 0) / mass;
  return { energy: mass * scale, offset: centroid - position };
}
function downsample13Metrics(size: number, x: number, y: number) {
  const targetSize = Math.ceil(size / 2), centerX = Math.floor(x / 2), centerY = Math.floor(y / 2);
  let mass = 0, momentX = 0, momentY = 0;
  for (let row = Math.max(0, centerY - 3); row <= Math.min(targetSize - 1, centerY + 3); row += 1) for (let column = Math.max(0, centerX - 3); column <= Math.min(targetSize - 1, centerX + 3); column += 1) {
    const value = DOWNSAMPLE_13.reduce((sum, [offsetX, offsetY, weight]) => sum + Math.max(0, 1 - Math.abs(2 * column + 0.5 + offsetX - x)) * Math.max(0, 1 - Math.abs(2 * row + 0.5 + offsetY - y)) * weight, 0);
    mass += value; momentX += value * (2 * column + 0.5); momentY += value * (2 * row + 0.5);
  }
  return { energy: mass * 4, offsetX: momentX / mass - x, offsetY: momentY / mass - y };
}
describe('VGPU 辉光操作契约', () => {
  it('提供三种 core/skirt 光感，并把总能量归一到连续散射金字塔', () => {
    const natural = compileVgpuGlowRecipe(applyVgpuGlowLook('natural'), UHD);
    const dreamy = compileVgpuGlowRecipe(applyVgpuGlowLook('dreamy'), UHD);
    const neon = compileVgpuGlowRecipe(applyVgpuGlowLook('neon'), UHD);
    expect(weightedMeanFraction(dreamy)).toBeGreaterThan(weightedMeanFraction(natural));
    expect(neon.sourceGain).toBeGreaterThan(dreamy.sourceGain);
    for (const recipe of [natural, dreamy, neon]) {
      expect(recipe.schemaVersion).toBe(14);
      expect(recipe.scatterLevels.length).toBeGreaterThanOrEqual(4);
      expect(recipe.scatterLevels.length).toBeLessThanOrEqual(12);
      expect(recipe.scatterLevels[0].divisor).toBe(2);
      for (let index = 1; index < recipe.scatterLevels.length; index += 1) {
        expect(recipe.scatterLevels[index].divisor)
          .toBe(recipe.scatterLevels[index - 1].divisor * 2);
        expect(recipe.scatterLevels[index].effectiveSigmaPx)
          .toBeGreaterThan(recipe.scatterLevels[index - 1].effectiveSigmaPx);
      }
      for (const channel of [0, 1, 2]) {
        expect(recipe.scatterLevels.reduce(
          (sum, level) => sum + level.weight[channel],
          0
        )).toBeCloseTo(1, 10);
      }
      expect(recipe.scatterLevels.reduce(
        (sum, level) => sum + level.whiteCoreWeight,
        0
      )).toBeCloseTo(1, 10);
      expect(recipe.tintLinear).toHaveLength(3);
      expect(recipe.tintEnabled).toBe(false);
      expect(recipe.chromaticAberration).toBe(0);
    }
  });
  it('把发光半径、强度、着色与 RGB 分离编译成彼此独立的光学量', () => {
    const defaults = createDefaultVgpuGlowOperationParams();
    const compact = compileVgpuGlowRecipe({
      ...defaults,
      radius: 0.1,
      intensity: 0.25,
      tintEnabled: false,
      tintColor: IMAGE_EDITOR_PRESET_COLORS[1],
      chromaticAberration: 0,
    }, UHD);
    const wide = compileVgpuGlowRecipe({
      ...defaults,
      radius: 0.9,
      intensity: 0.25,
      tintEnabled: true,
      tintColor: IMAGE_EDITOR_PRESET_COLORS[1],
      chromaticAberration: 1,
    }, UHD);
    expect(weightedMeanFraction(wide)).toBeGreaterThan(weightedMeanFraction(compact));
    expect(wide.intensity).toBe(compact.intensity);
    expect(wide.chromaticOffsetPx).toBeGreaterThan(5);
    expect(compact.chromaticOffsetPx).toBe(0);
    expect(compact.tintEnabled).toBe(false);
    expect(wide.tintEnabled).toBe(true);
    expect(compact.tintLinear[0]).toBeCloseTo(1, 6);
    expect(compact.tintLinear[1]).toBeGreaterThan(0.1);
    expect(compact.tintLinear[2]).toBe(0);
  });
  it('强度高段显著扩展动态范围，同时保留低段细调能力', () => {
    const defaults = createDefaultVgpuGlowOperationParams();
    const low = compileVgpuGlowRecipe({ ...defaults, intensity: 0.1 }, UHD);
    const middle = compileVgpuGlowRecipe({ ...defaults, intensity: 0.5 }, UHD);
    const maximum = compileVgpuGlowRecipe({ ...defaults, intensity: 1 }, UHD);
    expect(low.intensity).toBeGreaterThan(0);
    expect(low.intensity).toBeLessThan(middle.intensity);
    expect(middle.intensity).toBeLessThan(maximum.intensity);
    expect(maximum.intensity / middle.intensity).toBeGreaterThan(3);
    expect(maximum.intensity).toBeGreaterThan(2.5);
  });
  it('用真实 GPU 核尺度构造连续正值 PSF，中远场没有 octave 肩部', () => {
    const recipe = compileVgpuGlowRecipe({
      ...createDefaultVgpuGlowOperationParams(),
      radius: 1,
    }, UHD);
    expect(effectiveScatterSigmaPx(2)).toBeCloseTo(Math.sqrt(2.5), 10);
    expect(effectiveScatterSigmaPx(4)).toBeCloseTo(Math.sqrt(20.5), 10);
    expect(effectiveScatterSigmaPx(2048) / 2048).toBeCloseTo(Math.sqrt(1.5), 5);
    for (const level of recipe.scatterLevels) {
      expect(level.weight.every((weight) => Number.isFinite(weight) && weight >= 0)).toBe(true);
      expect(Number.isFinite(level.whiteCoreWeight)).toBe(true);
      expect(level.whiteCoreWeight).toBeGreaterThanOrEqual(0);
    }
    // 正值 Gaussian basis 的混合必须从中心连续单调衰减，不能出现一圈独立亮边。
    const monotonicFractions = Array.from({ length: 257 }, (_, index) => index / 512);
    const radialSamples = monotonicFractions.map((fraction) => amplitude(recipe, fraction));
    for (let index = 1; index < radialSamples.length; index += 1) {
      expect(radialSamples[index]).toBeLessThanOrEqual(radialSamples[index - 1]);
      expect(Number.isFinite(radialSamples[index])).toBe(true);
      expect(radialSamples[index]).toBeGreaterThan(0);
    }
    // 紧致 core 允许有限平顶；离开 core 后，应平滑进入 Moffat 中场与反平方远场。
    const fractions = [8, 16, 32, 64, 128, 256, 512, 1024]
      .map((value) => value / 3840);
    const exponents: number[] = [];
    for (let index = 0; index < fractions.length - 1; index += 1) {
      const start = fractions[index];
      const end = fractions[index + 1];
      const exponent = -(
        Math.log(amplitude(recipe, end)) - Math.log(amplitude(recipe, start))
      ) / (Math.log(end) - Math.log(start));
      exponents.push(exponent);
      expect(exponent, `半径 ${(start * 3840).toFixed(0)}→${(end * 3840).toFixed(0)}px`)
        .toBeGreaterThan(2);
      expect(exponent, `半径 ${(start * 3840).toFixed(0)}→${(end * 3840).toFixed(0)}px`)
        .toBeLessThan(2.75);
    }
    for (let index = 1; index < exponents.length; index += 1) {
      expect(
        Math.abs(exponents[index] - exponents[index - 1]),
        `octave 斜率跳变 ${index - 1}→${index}`
      ).toBeLessThan(0.35);
    }
  });
  it('用固定半相位坐标让奇偶尺寸、位置与四种像素相位保持稳定', () => {
    for (const size of [511, 512, 513]) for (const fraction of [0.25, 0.5, 0.75]) {
      const anchor = Math.floor(size * fraction);
      for (const [x, y] of [[anchor, anchor], [anchor + 1, anchor], [anchor, anchor + 1], [anchor + 1, anchor + 1]]) {
        const single = downsample13Metrics(size, x, y);
        expect(single.energy, `${size}px ${fraction} single energy`).toBeCloseTo(1, 12);
        expect(single.offsetX, `${size}px ${fraction} single X`).toBeCloseTo(0, 12);
        expect(single.offsetY, `${size}px ${fraction} single Y`).toBeCloseTo(0, 12);
        for (const [axis, position] of [['X', x], ['Y', y]] as const) {
          const levels = impulsePyramid(size, position).map((values) => impulseMetrics(values, position));
          for (let level = 0; level < 5; level += 1) {
            expect(Math.abs(1 - levels[level].energy), `${size}px ${fraction} L${level} ${axis} energy`).toBeLessThan(0.00025);
            expect(Math.abs(levels[level].offset), `${size}px ${fraction} L${level} ${axis} centroid`).toBeLessThan(0.031);
          }
        }
      }
    }
  });
  it('用有限核心目标保留反立方 1/σ 与反平方 octave 等权关系', () => {
    const source = compileVgpuGlowRecipe({
      ...createDefaultVgpuGlowOperationParams(),
      radius: 1,
    }, UHD);
    const isolate = (
      inverseCubeEnergy: number,
      inverseSquareEnergy: number
    ): VgpuGlowRecipe => rebaseVgpuGlowRecipeForScale({
      ...source,
      scatterModel: {
        ...source.scatterModel,
        optical: {
          ...source.scatterModel.optical,
          coreEnergy: 0,
          inverseCubeEnergy,
          inverseSquareEnergy,
        },
      },
    }, UHD.width, UHD.height);
    const inverseCube = isolate(1, 0);
    const inverseSquare = isolate(0, 1);
    // 跳过有限核心，且留在远场截止包络明显生效之前。相邻 σ 约翻倍，
    // 所以反立方的每 octave 能量约减半，反平方则约保持不变。
    for (const index of [4, 5, 6]) {
      const cubeRatio = inverseCube.scatterLevels[index + 1].weight[1]
        / inverseCube.scatterLevels[index].weight[1];
      const squareRatio = inverseSquare.scatterLevels[index + 1].weight[1]
        / inverseSquare.scatterLevels[index].weight[1];
      expect(cubeRatio).toBeGreaterThan(0.43);
      expect(cubeRatio).toBeLessThan(0.56);
      expect(squareRatio).toBeGreaterThan(0.9);
      // 有限核心的启动项会让最前一组比值略高于 1，进入远场后即趋于等权。
      expect(squareRatio).toBeLessThan(1.02);
    }
  });
  it('预览重基准后保持归一化光晕尺寸、径向亮度和逐通道总能量', () => {
    const source = compileVgpuGlowRecipe(createDefaultVgpuGlowOperationParams(), UHD);
    const preview = rebaseVgpuGlowRecipeForScale(source, 1885, 1060);
    expect(weightedMeanFraction(preview)).toBeCloseTo(weightedMeanFraction(source), 2);
    expect(radialCentroidFraction(preview)).toBeCloseTo(radialCentroidFraction(source), 2);
    for (const fraction of [0.005, 0.02, 0.08, 0.2]) {
      const ratio = amplitude(preview, fraction) / amplitude(source, fraction);
      // 0.5% 已接近预览图的最小可表达核心尺度；允许一个 mip 的量化误差。
      const upperBound = fraction === 0.005 ? 1.4 : 1.25;
      expect(ratio, `半径占长边 ${(fraction * 100).toFixed(1)}%`).toBeGreaterThan(0.8);
      expect(ratio, `半径占长边 ${(fraction * 100).toFixed(1)}%`).toBeLessThan(upperBound);
    }
    for (const channel of [0, 1, 2]) {
      expect(preview.scatterLevels.reduce(
        (sum, level) => sum + level.weight[channel],
        0
      )).toBeCloseTo(1, 10);
    }
  });
  it('RGB 分离同时编译独立 Pixel Offset 与轻量通道半径差，且逐通道守恒', () => {
    const recipe = compileVgpuGlowRecipe({
      ...createDefaultVgpuGlowOperationParams(),
      chromaticAberration: 1,
    }, UHD);
    expect(recipe.chromaticOffsetPx).toBeGreaterThan(0);
    expect(recipe.chromaticRadiusMultipliers[0]).toBeLessThan(1);
    expect(recipe.chromaticRadiusMultipliers[1]).toBe(1);
    expect(recipe.chromaticRadiusMultipliers[2]).toBeGreaterThan(1);
    expect(weightedMeanFraction(recipe, 0)).toBeLessThan(weightedMeanFraction(recipe, 1));
    expect(weightedMeanFraction(recipe, 1)).toBeLessThan(weightedMeanFraction(recipe, 2));
    for (const channel of [0, 1, 2]) {
      expect(recipe.scatterLevels.reduce(
        (sum, level) => sum + level.weight[channel],
        0
      )).toBeCloseTo(1, 10);
    }
  });
  it('用有限斜率 SDR emissive prior 重建辐射，不再放大 8-bit 顶值量化', () => {
    const threshold = 0.12;
    const knee = 0.07;
    const maximumRadiance = 8.2;
    const samples = [0, 0.1, 0.5, 0.9, 1]
      .map((value) => reconstructVirtualRadiance(
        value,
        threshold,
        knee,
        maximumRadiance
      ));
    expect(samples[0]).toBeCloseTo(0, 12);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThan(samples[index - 1]);
      expect(Number.isFinite(samples[index])).toBe(true);
    }
    expect(samples.at(-1)).toBeCloseTo(maximumRadiance, 10);
    const almostWhite = reconstructVirtualRadiance(
      254 / 255,
      threshold,
      knee,
      maximumRadiance
    );
    expect(samples.at(-1)! / almostWhite).toBeLessThan(1.015);
    const strict = compileVgpuGlowRecipe({
      ...applyVgpuGlowLook('dreamy'), sourceThreshold: 1,
    }, UHD);
    const top = (value: number) => reconstructVirtualRadiance(value,
      strict.sourceThresholdDisplay, strict.sourceKneeDisplay, strict.sourceMaximumRadiance);
    expect(top(1) / top(254 / 255)).toBeLessThan(1.015);
  });

  it('以高亮光谱覆盖率提取亮源，让青色到暖色的真实渐变保持连续能量', () => {
    const recipe = compileVgpuGlowRecipe(applyVgpuGlowLook('dreamy'), UHD);
    const emission = (displayRgb: readonly [number, number, number]) =>
      extractVirtualEmitterRadiance(
        resolveEmissionPeak(displayRgb),
        recipe.sourceThresholdDisplay,
        recipe.sourceKneeDisplay,
        recipe.sourceMaximumRadiance
      );
    // 来自“发光测试.jpg”中「界」字同一水平笔画的真实显示域 RGB 样本。
    const transitionSamples = [
      [1, 255, 216],
      [132, 234, 184],
      [188, 196, 149],
      [220, 157, 113],
      [247, 84, 53],
    ].map((rgb) => rgb.map((channel) => channel / 255) as [number, number, number]);
    const transitionEmission = transitionSamples.map(emission);
    const endpointMean = (
      transitionEmission[0] + transitionEmission[transitionEmission.length - 1]
    ) / 2;

    expect(emission([0, 0, 0])).toBe(0);
    expect(Math.min(...transitionEmission) / endpointMean).toBeGreaterThan(0.93);
    expect(Math.max(...transitionEmission) / Math.min(...transitionEmission)).toBeLessThan(1.15);

    // 中性灰必须严格保持原值；彩色暗边也只能获得有限的光谱覆盖补偿。
    expect(resolveEmissionPeak([0.5, 0.5, 0.5])).toBeCloseTo(0.5, 12);
    expect(resolveEmissionPeak([0.1, 0.2, 0.28])).toBeLessThan(0.33);
    expect(resolveEmissionPeak([0.1, 0.2, 0.28])).toBeGreaterThanOrEqual(
      resolveSoftChannelPeak([0.1, 0.2, 0.28])
    );

    // 高亮主导通道交换处应接近光滑，不能保留 max 的 V 形折角。
    const delta = 1 / 255;
    const center = resolveEmissionPeak([0.75, 0.75, 0.1]);
    const left = resolveEmissionPeak([0.75 - delta, 0.75, 0.1]);
    const right = resolveEmissionPeak([0.75 + delta, 0.75, 0.1]);
    expect((left + right - 2 * center) / delta).toBeLessThan(0.01);

    const white = emission([1, 1, 1]);
    const almostWhite = emission([254 / 255, 254 / 255, 254 / 255]);
    expect(white / almostWhite).toBeLessThan(1.03);
  });

  it('拒绝越界参数，并由内置注册表按 effect 阶段校验', () => {
    const defaults = createDefaultVgpuGlowOperationParams();
    expect(() => parseVgpuGlowOperationParams({ ...defaults, intensity: 1.01 }))
      .toThrow(InvalidImageEditOperationParamsError);
    const definition = createBuiltInImageEditOperationRegistry().get(IMAGE_EDIT_OPERATION_IDS.vgpuGlow);
    expect(definition).toMatchObject({ stage: 'effect', order: 160, supportsMultiple: false });
    expect(definition?.parseParams(defaults)).toEqual(defaults);
  });

  it('V2 文档往返时保留辉光 Pro 参数', () => {
    const params = applyVgpuGlowLook('neon');
    const decoded = decodeImageEditDocument({
      version: 2,
      operations: [{
        id: 'vgpu-glow-test',
        operationId: IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
        enabled: true,
        params,
      }],
    });
    expect(decoded).toMatchObject({ sourceFormat: 'v2', issues: [] });
    expect(decoded.document.operations[0]?.params).toEqual(params);
  });

  it('默认关闭着色和 RGB 分离，并拒绝开发期旧参数', () => {
    const defaults = createDefaultVgpuGlowOperationParams();
    expect(defaults).toMatchObject({
      schemaVersion: 4,
      tintEnabled: false,
      chromaticAberration: 0,
      chromaticChannels: ['red', 'blue'],
    });
    expect(() => parseVgpuGlowOperationParams({ ...defaults, schemaVersion: 3 }))
      .toThrow(InvalidImageEditOperationParamsError);
  });

  it('透明合成扩展光晕 Alpha，同时严格保持不透明图片原有的 screen 观感', () => {
    const opaqueBase: Rgba = [0.2, 0.4, 0.7, 1];
    const glow: Rgb = [0.3, 0.1, 0.2];
    const opaqueResult = compositeGlowReference(opaqueBase, glow);
    const legacyScreen: Rgba = [
      screen(opaqueBase[0], glow[0]),
      screen(opaqueBase[1], glow[1]),
      screen(opaqueBase[2], glow[2]),
      1,
    ];
    for (let channel = 0; channel < 4; channel += 1) {
      expect(opaqueResult[channel]).toBeCloseTo(legacyScreen[channel], 12);
    }

    const transparentResult = compositeGlowReference([0, 0, 0, 0], glow);
    expect(transparentResult[3]).toBeCloseTo(0.3, 12);
    // 最终 encode pass 再预乘后必须精确还原原始光层能量，不能有黑边或被透明度切掉。
    for (let channel = 0; channel < 3; channel += 1) {
      expect(transparentResult[channel] * transparentResult[3])
        .toBeCloseTo(glow[channel], 12);
    }

    const translucentResult = compositeGlowReference([0.5, 0.25, 0.1, 0.4], glow);
    expect(translucentResult[3]).toBeCloseTo(0.58, 12);
    expect(translucentResult.every(Number.isFinite)).toBe(true);
  });

  it('着色器分离 SDR 发射幅度与线性色度，并让白热只替换独立核心', () => {
    expect(bloomShaderSource).toContain('let displayColor = clamp(linearToSrgb(color)');
    expect(bloomShaderSource).toContain('let channelPeak = softChannelPeak(displayColor)');
    expect(bloomShaderSource).toContain('let displayPeak = emissionPeak(displayColor)');
    expect(bloomShaderSource).toContain('dot(displayColor * displayColor, displayColor)');
    expect(bloomShaderSource).toContain('let sourceDirection = color / max(srgbToLinear(channelPeak)');
    expect(bloomShaderSource).toContain('pow(displayPeak, LDR_EMISSION_GAMMA)');
    expect(bloomShaderSource).not.toContain('RADIANCE_SHOULDER');
    expect(bloomShaderSource).not.toContain('-log(');
    expect(bloomShaderSource).toContain('return vec4f(coloredEmitter, whiteCore)');
    expect(bloomShaderSource).toContain('extractEmitter(color.rgb) * color.a');
    expect(bloomShaderSource).toContain('insideImage(sampleUv)');
    expect(bloomShaderSource).toContain('@fragment fn fs_main(@builtin(position) position: vec4f)');
    expect(bloomShaderSource).toContain('let sourceUv = position.xy * 2.0 / sourceDimensions');
    expect(bloomShaderSource).toContain('return downsample13(sourceUv, bloom.params.w >= 0.0)');
    expect(upsampleShaderSource).toContain('let highUv = position.xy / highDimensions');
    expect(upsampleShaderSource).toContain('let lowUv = position.xy / (2.0 * lowDimensions)');
    expect(upsampleShaderSource).toContain('let low = tentUpsample(lowUv)');
    expect(upsampleShaderSource).toContain(
      'return high * accumulate.highWeight + low * accumulate.lowWeight'
    );
    expect(compositeShaderSource).not.toContain('softCore');
    expect(compositeShaderSource).not.toContain('toneBloom');
    expect(compositeShaderSource).not.toContain('applyWhiteHeat');
    expect(compositeShaderSource).toContain('let sceneUv = position.xy / dimensions');
    expect(compositeShaderSource).toContain('mappedSourceUv * sourceSize / (2.0 * bloomSize)');
    expect(compositeShaderSource).toContain('all(mappedSourceUv >= vec2f(0.0))');
    expect(compositeShaderSource).not.toContain('sampleCarrier');
    expect(compositeShaderSource).toContain('let spectralDelta =');
    expect(compositeShaderSource).not.toContain('separated');
    expect(compositeShaderSource).toContain(
      'let whiteCorrection = (vec3f(centeredPeak) - centered) * whiteBlend'
    );
    expect(compositeShaderSource).not.toContain('+ vec3f(max(centeredBloom.a');
    expect(compositeShaderSource).toContain('let emittedDirection = emitted / max(emittedPeak');
    expect(compositeShaderSource).toContain('let glowLayer = emittedDirection * response');
    expect(compositeShaderSource).toContain('let outAlpha = glowAlpha + baseAlpha * (1.0 - glowAlpha)');
    expect(compositeShaderSource).toContain('return compositeGlow(base, glowLayer)');
    expect(baselineShaderSource).toContain('linear_to_srgb(color.rgb) * alpha');
  });
});
