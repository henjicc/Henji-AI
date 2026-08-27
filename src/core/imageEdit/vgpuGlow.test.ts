import { describe, expect, it } from 'vitest';
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
  it('提供可感知差异的三种光感，并保持金字塔能量归一化', () => {
    const natural = compileVgpuGlowRecipe(applyVgpuGlowLook('natural'));
    const dreamy = compileVgpuGlowRecipe(applyVgpuGlowLook('dreamy'));
    const neon = compileVgpuGlowRecipe(applyVgpuGlowLook('neon'));

    expect(dreamy.levelWeights[2]).toBeGreaterThan(natural.levelWeights[2]);
    expect(neon.hdrBoost).toBeGreaterThan(dreamy.hdrBoost);
    for (const recipe of [natural, dreamy, neon]) {
      expect(recipe.levelWeights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
      expect(recipe.threshold).toBeGreaterThan(0);
      expect(recipe.sigma).toBeGreaterThanOrEqual(1.15);
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
});
