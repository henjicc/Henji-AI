import { describe, expect, it } from 'vitest';
import {
  applyDiffusionPreset,
  compileDiffusionRecipe,
  getDiffusionPreset,
  listDiffusionPresets,
} from '../index';
import {
  DIFFUSION_GOLDEN_INDEX,
  DIFFUSION_QUALITY_THRESHOLDS,
  validateDiffusionBaselineDefinitions,
} from './diffusionBaseline';

describe('摄影柔光通用预设与 Golden 基线', () => {
  it('为每种模式定义低、中、高三档可追溯预设', () => {
    const presets = listDiffusionPresets();
    expect(presets).toHaveLength(9);
    for (const mode of ['black_mist', 'white_mist', 'glow'] as const) {
      expect(presets.filter((preset) => preset.mode === mode).map((preset) => preset.intensity).sort())
        .toEqual(['high', 'low', 'medium']);
    }
    for (const preset of presets) {
      expect(preset.version).toBe(1);
      expect(preset.name.zh).toContain('通用');
      expect(preset.source.url).toMatch(/^https:\/\//);
      expect(preset.source.license).toContain('不声明品牌');
      // 预设已收敛成「模式 × 档位」，不再单独存 presetId：这两个字段就是它的身份。
      const applied = applyDiffusionPreset(preset.id);
      expect(applied.mode).toBe(preset.mode);
      expect(applied.density).toBe(preset.intensity);
    }
  });

  it('保留第三阶段预设 ID 的中等强度兼容映射', () => {
    expect(getDiffusionPreset('black-mist-soft')?.id).toBe('black-mist-medium');
    expect(getDiffusionPreset('white-mist-soft')?.id).toBe('white-mist-medium');
    expect(getDiffusionPreset('glow-soft')?.id).toBe('glow-medium');
  });

  it('使三种模式在公开参数和配方响应上保持可辨识差异', () => {
    const black = compileDiffusionRecipe(applyDiffusionPreset('black-mist-medium'), { width: 1920, height: 1080 });
    const white = compileDiffusionRecipe(applyDiffusionPreset('white-mist-medium'), { width: 1920, height: 1080 });
    const glow = compileDiffusionRecipe(applyDiffusionPreset('glow-medium'), { width: 1920, height: 1080 });

    expect(black.energy.veil).toBeLessThan(white.energy.veil);
    expect(black.source.microGain).toBeLessThan(white.source.microGain);
    expect(glow.energy.veil).toBe(0);
    expect(glow.scales[5].weight).toBeGreaterThan(black.scales[5].weight);
  });

  it('登记全部预设 Golden 和冻结/待运行时阈值', () => {
    expect(DIFFUSION_GOLDEN_INDEX).toHaveLength(9);
    expect(DIFFUSION_QUALITY_THRESHOLDS.some((threshold) => threshold.status === 'frozen')).toBe(true);
    expect(DIFFUSION_QUALITY_THRESHOLDS.some((threshold) => threshold.status === 'pending-electron-runtime')).toBe(true);
    expect(validateDiffusionBaselineDefinitions()).toEqual([]);
  });
});
