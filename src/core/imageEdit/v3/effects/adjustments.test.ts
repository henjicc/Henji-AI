import { describe, expect, it } from 'vitest';
import { createDefaultDiffusionOperationParams } from '../../diffusionParams';
import { createDefaultVgpuGlowOperationParams } from '../../vgpuGlowParams';
import {
  applyCurvesAdjustment,
  applyHslAdjustment,
  applyTemperatureTintAdjustment,
  compileCurveLut,
  compileCurvesAdjustment,
  createFloat32PremultipliedRgbaTile,
  CURVES_ADJUSTMENT_CONTRACT,
  DIFFUSION_V4_RECIPE_ADAPTER,
  HSL_ADJUSTMENT_CONTRACT,
  IDENTITY_CURVE_POINTS,
  IMAGE_EDIT_CURVE_LUT_SIZE,
  sampleCurveLut,
  TEMPERATURE_TINT_ADJUSTMENT_CONTRACT,
  VGPU_GLOW_V4_RECIPE_ADAPTER,
} from './index';

describe('曲线调整 CPU 参考实现', () => {
  it('编译 4096 项、端点精确且单调的保形 LUT', () => {
    const lut = compileCurveLut([
      { x: 0, y: 0 },
      { x: 0.2, y: 0.08 },
      { x: 0.65, y: 0.8 },
      { x: 1, y: 1 },
    ]);

    expect(lut.values).toHaveLength(IMAGE_EDIT_CURVE_LUT_SIZE);
    expect(lut.values[0]).toBe(0);
    expect(lut.values[lut.values.length - 1]).toBe(1);
    for (let index = 1; index < lut.values.length; index += 1) {
      expect(lut.values[index]).toBeGreaterThanOrEqual(lut.values[index - 1]);
    }
    expect(sampleCurveLut(lut, 0.65)).toBeCloseTo(0.8, 4);
  });

  it('分别应用 RGB 与主通道，并保持预乘 alpha', () => {
    const identity = IDENTITY_CURVE_POINTS;
    const compiled = compileCurvesAdjustment({
      master: [{ x: 0, y: 0 }, { x: 1, y: 0.8 }],
      red: [{ x: 0, y: 0.1 }, { x: 1, y: 1 }],
      green: identity,
      blue: identity,
    });
    const source = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'perceptual-working',
      new Float32Array([0.1, 0.1, 0.1, 0.5]),
    );
    const result = applyCurvesAdjustment(source, compiled);

    expect(result.data[0]).toBeGreaterThan(result.data[1]);
    expect(result.data[1]).toBeCloseTo(0.08, 5);
    expect(result.data[3]).toBe(0.5);
    expect(CURVES_ADJUSTMENT_CONTRACT).toMatchObject({
      version: 2,
      inputColorDomain: 'perceptual-working',
      precision: 'float32',
    });
  });

  it('端点斜率延伸 Float32 头部空间，不把 HDR 输入夹到 1', () => {
    const identity = compileCurveLut(IDENTITY_CURVE_POINTS);
    expect(sampleCurveLut(identity, 1.75)).toBeCloseTo(1.75, 6);
    expect(sampleCurveLut(identity, -0.2)).toBeCloseTo(-0.2, 6);
  });
});

describe('色温、色调与 HSL CPU 参考实现', () => {
  it('Bradford 色适应让正色温变暖，并保持线性 Float32 HDR', () => {
    const source = createFloat32PremultipliedRgbaTile(
      1,
      1,
      'linear-light',
      new Float32Array([1.5, 1.5, 1.5, 1]),
    );
    const result = applyTemperatureTintAdjustment(source, {
      temperature: 0.6,
      tint: 0,
      workingSpace: 'srgb',
    });

    expect(result.data[0]).toBeGreaterThan(result.data[2]);
    expect(Math.max(result.data[0], result.data[1], result.data[2])).toBeGreaterThan(1);
    expect(result.data[3]).toBe(1);
    expect(TEMPERATURE_TINT_ADJUSTMENT_CONTRACT.inputColorDomain).toBe('linear-light');
  });

  it('HSL 在感知工作空间旋转色相，并把 HDR 残差带回结果', () => {
    const source = createFloat32PremultipliedRgbaTile(
      2,
      1,
      'perceptual-working',
      new Float32Array([
        1, 0, 0, 1,
        1.25, 0.25, 0.25, 1,
      ]),
    );
    const result = applyHslAdjustment(source, {
      hueDegrees: 120,
      saturation: 0,
      lightness: 0,
    });

    expect(result.data[0]).toBeCloseTo(0, 6);
    expect(result.data[1]).toBeCloseTo(1, 6);
    expect(result.data[2]).toBeCloseTo(0, 6);
    expect(result.data[3]).toBe(1);
    expect(result.data[5]).toBeCloseTo(1, 6);
    expect(result.data[4]).toBeCloseTo(0.5, 6);
    expect(result.data[7]).toBe(1);
    expect(HSL_ADJUSTMENT_CONTRACT.inputColorDomain).toBe('perceptual-working');
  });
});

describe('稳定效果的 V3 recipe 适配', () => {
  it('diffusion v4 复用现有参数解析和 recipe 编译', () => {
    const parameters = DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(
      createDefaultDiffusionOperationParams(),
    );
    const recipe = DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(parameters, {
      width: 2048,
      height: 1024,
    });

    expect(DIFFUSION_V4_RECIPE_ADAPTER).toMatchObject({
      nodeVersion: 4,
      parameterSchemaVersion: 4,
      implementation: 'existing-recipe',
    });
    expect(recipe.version).toBe(DIFFUSION_V4_RECIPE_ADAPTER.recipeVersion);
  });

  it('VGPU Glow v4 复用现有光学 recipe，不声明视觉不等价的替代数学', () => {
    const parameters = VGPU_GLOW_V4_RECIPE_ADAPTER.parseParameters(
      createDefaultVgpuGlowOperationParams(),
    );
    const recipe = VGPU_GLOW_V4_RECIPE_ADAPTER.compileRecipe(parameters, {
      width: 2048,
      height: 1024,
    });

    expect(VGPU_GLOW_V4_RECIPE_ADAPTER).toMatchObject({
      nodeVersion: 4,
      parameterSchemaVersion: 4,
      implementation: 'existing-recipe',
    });
    expect(recipe.schemaVersion).toBe(VGPU_GLOW_V4_RECIPE_ADAPTER.recipeVersion);
  });
});
