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
  type VgpuGlowRecipe,
} from './index';

const UHD = { width: 3840, height: 2160 } as const;

type Rgba = readonly [number, number, number, number];
type Rgb = readonly [number, number, number];

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

function amplitude(recipe: VgpuGlowRecipe, radiusFraction: number, channel = 1): number {
  const radiusPixels = radiusFraction * recipe.image.referenceDimension;
  return recipe.scatterLevels.reduce((sum, level) => {
    const sigma = level.effectiveSigmaPx;
    return sum + level.weight[channel]
      * Math.exp(-(radiusPixels * radiusPixels) / (2 * sigma * sigma))
      / (2 * Math.PI * sigma * sigma);
  }, 0) * recipe.image.referenceDimension * recipe.image.referenceDimension;
}

describe('VGPU 辉光操作契约', () => {
  it('提供三种 core/skirt 光感，并把总能量归一到连续散射金字塔', () => {
    const natural = compileVgpuGlowRecipe(applyVgpuGlowLook('natural'), UHD);
    const dreamy = compileVgpuGlowRecipe(applyVgpuGlowLook('dreamy'), UHD);
    const neon = compileVgpuGlowRecipe(applyVgpuGlowLook('neon'), UHD);

    expect(weightedMeanFraction(dreamy)).toBeGreaterThan(weightedMeanFraction(natural));
    expect(neon.sourceGain).toBeGreaterThan(dreamy.sourceGain);
    for (const recipe of [natural, dreamy, neon]) {
      expect(recipe.schemaVersion).toBe(9);
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

  it('用真实 GPU 核尺度构造最大半径，核心到远场没有 octave 肩部', () => {
    const recipe = compileVgpuGlowRecipe({
      ...createDefaultVgpuGlowOperationParams(),
      radius: 1,
    }, UHD);
    expect(effectiveScatterSigmaPx(2)).toBeCloseTo(Math.sqrt(2.75), 10);
    expect(effectiveScatterSigmaPx(4)).toBeCloseTo(Math.sqrt(20.75), 10);
    expect(effectiveScatterSigmaPx(2048) / 2048).toBeCloseTo(Math.sqrt(1.5), 5);

    const fractions = [4, 8, 16, 32, 64, 128, 256, 512, 1024]
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
        .toBeGreaterThan(1.8);
      expect(exponent, `半径 ${(start * 3840).toFixed(0)}→${(end * 3840).toFixed(0)}px`)
        .toBeLessThan(2.9);
    }
    for (let index = 1; index < exponents.length; index += 1) {
      expect(
        Math.abs(exponents[index] - exponents[index - 1]),
        `octave 斜率跳变 ${index - 1}→${index}`
      ).toBeLessThan(0.55);
    }
  });

  it('预览重基准后保持归一化光晕尺寸、径向亮度和逐通道总能量', () => {
    const source = compileVgpuGlowRecipe(createDefaultVgpuGlowOperationParams(), UHD);
    const preview = rebaseVgpuGlowRecipeForScale(source, 1885, 1060);

    expect(weightedMeanFraction(preview)).toBeCloseTo(weightedMeanFraction(source), 2);
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

  it('色差为零时不偷偷改变色彩，开启后才错开波长尺度且保持总能量', () => {
    const neutral = compileVgpuGlowRecipe(createDefaultVgpuGlowOperationParams(), UHD);
    for (const level of neutral.scatterLevels) {
      expect(level.weight[0]).toBeCloseTo(level.weight[1], 12);
      expect(level.weight[1]).toBeCloseTo(level.weight[2], 12);
    }

    const recipe = compileVgpuGlowRecipe({
      ...createDefaultVgpuGlowOperationParams(),
      chromaticAberration: 1,
    }, UHD);
    const near = recipe.scatterLevels[0].weight;
    const tail = recipe.scatterLevels[recipe.scatterLevels.length - 1].weight;

    expect(near[2]).toBeGreaterThan(near[0]);
    expect(tail[0]).toBeGreaterThan(tail[2]);
    for (const channel of [0, 1, 2]) {
      expect(recipe.scatterLevels.reduce(
        (sum, level) => sum + level.weight[channel],
        0
      )).toBeCloseTo(1, 10);
    }
  });

  it('用有限斜率肩部重建 LDR 辐射，不再放大 8-bit 顶值量化', () => {
    const ceiling = 8.2;
    const samples = [0, 0.1, 0.5, 0.9, 1]
      .map((value) => reconstructVirtualRadiance(value, ceiling));
    expect(samples[0]).toBeCloseTo(0, 12);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThan(samples[index - 1]);
      expect(Number.isFinite(samples[index])).toBe(true);
    }
    expect(samples.at(-1)).toBeCloseTo(ceiling, 10);
    const almostWhite = reconstructVirtualRadiance(254 / 255, ceiling);
    expect(samples.at(-1)! / almostWhite).toBeLessThan(1.03);
  });

  it('在显示域提取亮源，让青色到暖色的可见渐变保持连续能量', () => {
    const recipe = compileVgpuGlowRecipe(applyVgpuGlowLook('dreamy'), UHD);
    const emission = (displayPeak: number) => extractVirtualEmitterRadiance(
      displayPeak,
      recipe.sourceThresholdDisplay,
      recipe.sourceKneeDisplay,
      recipe.sourceRadianceCeiling
    );
    // 来自“发光测试.jpg”中「界」字同一水平笔画的实测显示域峰值。
    const cyan = emission(255 / 255);
    const warmTransition = emission(196 / 255);
    const orange = emission(247 / 255);

    expect(emission(0)).toBe(0);
    expect(cyan / warmTransition).toBeLessThan(2.5);
    expect(orange / warmTransition).toBeLessThan(2.5);
    expect(emission(255 / 255) / emission(254 / 255)).toBeLessThan(1.03);
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
      schemaVersion: 3,
      tintEnabled: false,
      chromaticAberration: 0,
    });
    expect(() => parseVgpuGlowOperationParams({ ...defaults, schemaVersion: 2 }))
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

  it('着色器在显示域有限重建辐射，并让白热只走独立核心 PSF', () => {
    expect(bloomShaderSource).toContain('let linearPeak = max(color.r, max(color.g, color.b))');
    expect(bloomShaderSource).toContain('let displayPeak = clamp(linearToSrgb(linearPeak)');
    expect(bloomShaderSource).toContain('1.0 - RADIANCE_SHOULDER * clamp(displayValue');
    expect(bloomShaderSource).not.toContain('-log(max(1.0 - min(');
    expect(bloomShaderSource).toContain('return vec4f(coloredEmitter, whiteCore)');
    expect(bloomShaderSource).toContain('extractEmitter(color.rgb) * color.a');
    expect(bloomShaderSource).toContain('insideImage(sampleUv)');
    expect(upsampleShaderSource).toContain(
      'return high * accumulate.highWeight + low * accumulate.lowWeight'
    );
    expect(compositeShaderSource).not.toContain('softCore');
    expect(compositeShaderSource).not.toContain('toneBloom');
    expect(compositeShaderSource).not.toContain('applyWhiteHeat');
    expect(compositeShaderSource).toContain('vec3f(max(centeredBloom.a, 0.0))');
    expect(compositeShaderSource).toContain('var glowLayer = vec3f(1.0) - exp(-emitted)');
    expect(compositeShaderSource).toContain('let outAlpha = glowAlpha + baseAlpha * (1.0 - glowAlpha)');
    expect(compositeShaderSource).toContain('return compositeGlow(base, glowLayer)');
    expect(baselineShaderSource).toContain('linear_to_srgb(color.rgb) * alpha');
  });
});
