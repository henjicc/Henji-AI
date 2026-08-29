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
} from './index';

describe('VGPU 辉光操作契约', () => {
  it('提供可感知差异的三种光感，并保持五级散射能量归一化', () => {
    const natural = compileVgpuGlowRecipe(applyVgpuGlowLook('natural'));
    const dreamy = compileVgpuGlowRecipe(applyVgpuGlowLook('dreamy'));
    const neon = compileVgpuGlowRecipe(applyVgpuGlowLook('neon'));

    expect(dreamy.levelWeights[2]).toBeGreaterThan(natural.levelWeights[2]);
    expect(neon.hdrBoost).toBeGreaterThan(dreamy.hdrBoost);
    for (const recipe of [natural, dreamy, neon]) {
      expect(recipe.levelWeights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
      expect(recipe.threshold).toBeGreaterThan(0);
      expect(recipe.sigma).toBeGreaterThanOrEqual(0.85);
      expect(recipe.blurStep).toBeGreaterThan(0);
      expect(recipe.levelWeights).toHaveLength(5);
      expect(recipe.tintLinear).toHaveLength(3);
      expect(recipe.tintEnabled).toBe(false);
      expect(recipe.chromaticAberration).toBe(0);
    }
  });

  it('把发光半径、强度、着色与色差编译成彼此独立的光学量', () => {
    const defaults = createDefaultVgpuGlowOperationParams();
    const compact = compileVgpuGlowRecipe({
      ...defaults,
      radius: 0.1,
      intensity: 0.25,
      tintEnabled: false,
      tintColor: IMAGE_EDITOR_PRESET_COLORS[1],
      chromaticAberration: 0,
    });
    const wide = compileVgpuGlowRecipe({
      ...defaults,
      radius: 0.9,
      intensity: 0.25,
      tintEnabled: true,
      tintColor: IMAGE_EDITOR_PRESET_COLORS[1],
      chromaticAberration: 1,
    });

    expect(wide.sigma).toBeGreaterThan(compact.sigma);
    expect(wide.blurStep).toBeGreaterThan(compact.blurStep);
    expect(wide.levelWeights[4]).toBeGreaterThan(compact.levelWeights[4]);
    expect(wide.levelWeights[0]).toBeLessThan(compact.levelWeights[0]);
    expect(wide.intensity).toBe(compact.intensity);
    expect(wide.chromaticOffsetPx).toBeGreaterThan(4);
    expect(compact.chromaticOffsetPx).toBe(0);
    expect(compact.tintEnabled).toBe(false);
    expect(wide.tintEnabled).toBe(true);
    expect(compact.tintLinear[0]).toBeCloseTo(1, 6);
    expect(compact.tintLinear[1]).toBeGreaterThan(0.1);
    expect(compact.tintLinear[2]).toBe(0);
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
