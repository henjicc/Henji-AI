import { describe, expect, it } from 'vitest';
import { IMAGE_EDITOR_PRESET_COLORS } from '@/core/theme/colorTokens';
import {
  IMAGE_EDIT_OPERATION_IDS,
  InvalidImageEditOperationParamsError,
  applyVgpuGlowLook,
  compileVgpuGlowRecipe,
  createBuiltInImageEditOperationRegistry,
  createDefaultVgpuGlowOperationParams,
  decodeImageEditDocument,
  parseVgpuGlowOperationParams,
  rebaseVgpuGlowRecipeForScale,
  type VgpuGlowRecipe,
} from './index';

const UHD = { width: 3840, height: 2160 } as const;

function weightedMeanFraction(recipe: VgpuGlowRecipe, channel = 1): number {
  return recipe.scatterLevels.reduce(
    (sum, level) => sum + level.weight[channel] * level.divisor,
    0
  ) / recipe.image.referenceDimension;
}

function amplitude(recipe: VgpuGlowRecipe, radiusFraction: number, channel = 1): number {
  const radiusPixels = radiusFraction * recipe.image.referenceDimension;
  return recipe.scatterLevels.reduce((sum, level) => {
    const sigma = level.divisor;
    return sum + level.weight[channel]
      * Math.exp(-(radiusPixels * radiusPixels) / (2 * sigma * sigma))
      / (2 * Math.PI * sigma * sigma);
  }, 0) * recipe.image.referenceDimension * recipe.image.referenceDimension;
}

describe('VGPU 辉光操作契约', () => {
  it('提供三种光感，并把 Spencer 眩光能量归一到连续散射金字塔', () => {
    const natural = compileVgpuGlowRecipe(applyVgpuGlowLook('natural'), UHD);
    const dreamy = compileVgpuGlowRecipe(applyVgpuGlowLook('dreamy'), UHD);
    const neon = compileVgpuGlowRecipe(applyVgpuGlowLook('neon'), UHD);

    expect(dreamy.fieldOfViewDegrees).toBeLessThan(natural.fieldOfViewDegrees);
    expect(neon.hdrBoost).toBeGreaterThan(dreamy.hdrBoost);
    for (const recipe of [natural, dreamy, neon]) {
      expect(recipe.schemaVersion).toBe(6);
      expect(recipe.scatterLevels.length).toBeGreaterThanOrEqual(4);
      expect(recipe.scatterLevels.length).toBeLessThanOrEqual(12);
      expect(recipe.scatterLevels[0].divisor).toBe(2);
      for (let index = 1; index < recipe.scatterLevels.length; index += 1) {
        expect(recipe.scatterLevels[index].divisor)
          .toBe(recipe.scatterLevels[index - 1].divisor * 2);
      }
      for (const channel of [0, 1, 2]) {
        expect(recipe.scatterLevels.reduce(
          (sum, level) => sum + level.weight[channel],
          0
        )).toBeCloseTo(1, 10);
      }
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

    expect(wide.fieldOfViewDegrees).toBeLessThan(compact.fieldOfViewDegrees);
    expect(weightedMeanFraction(wide)).toBeGreaterThan(weightedMeanFraction(compact));
    expect(wide.intensity).toBe(compact.intensity);
    expect(wide.chromaticOffsetPx).toBeGreaterThan(7);
    expect(compact.chromaticOffsetPx).toBe(0);
    expect(compact.tintEnabled).toBe(false);
    expect(wide.tintEnabled).toBe(true);
    expect(compact.tintLinear[0]).toBeCloseTo(1, 6);
    expect(compact.tintLinear[1]).toBeGreaterThan(0.1);
    expect(compact.tintLinear[2]).toBe(0);
  });

  it('最大半径的中远场保持连续幂律衰减，不在固定层数后塌成高斯边界', () => {
    const recipe = compileVgpuGlowRecipe({
      ...createDefaultVgpuGlowOperationParams(),
      radius: 1,
    }, UHD);
    const fractions = [16, 32, 64, 128, 256, 512, 1024].map((value) => value / 3840);
    for (let index = 0; index < fractions.length - 1; index += 1) {
      const start = fractions[index];
      const end = fractions[index + 1];
      const exponent = -(
        Math.log(amplitude(recipe, end)) - Math.log(amplitude(recipe, start))
      ) / (Math.log(end) - Math.log(start));
      expect(exponent, `半径 ${(start * 3840).toFixed(0)}→${(end * 3840).toFixed(0)}px`)
        .toBeGreaterThan(2);
      expect(exponent, `半径 ${(start * 3840).toFixed(0)}→${(end * 3840).toFixed(0)}px`)
        .toBeLessThan(3.2);
    }
  });

  it('预览重基准后保持归一化光晕尺寸、径向亮度和逐通道总能量', () => {
    const source = compileVgpuGlowRecipe(createDefaultVgpuGlowOperationParams(), UHD);
    const preview = rebaseVgpuGlowRecipeForScale(source, 1885, 1060);

    expect(weightedMeanFraction(preview)).toBeCloseTo(weightedMeanFraction(source), 2);
    for (const fraction of [0.005, 0.02, 0.08, 0.2]) {
      const ratio = amplitude(preview, fraction) / amplitude(source, fraction);
      expect(ratio, `半径占长边 ${(fraction * 100).toFixed(1)}%`).toBeGreaterThan(0.8);
      expect(ratio, `半径占长边 ${(fraction * 100).toFixed(1)}%`).toBeLessThan(1.25);
    }
    for (const channel of [0, 1, 2]) {
      expect(preview.scatterLevels.reduce(
        (sum, level) => sum + level.weight[channel],
        0
      )).toBeCloseTo(1, 10);
    }
  });

  it('内建波长色散只错开尺度分布，不改变 RGB 总能量', () => {
    const recipe = compileVgpuGlowRecipe(createDefaultVgpuGlowOperationParams(), UHD);
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
});
