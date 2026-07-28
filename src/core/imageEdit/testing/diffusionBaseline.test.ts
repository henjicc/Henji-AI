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
import diffusionShaderSource from '../shaders/diffusion.wgsl?raw';

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
    expect(black.source.scatterFloor).toBeLessThan(white.source.scatterFloor);
    expect(glow.energy.veil).toBe(0);
    expect(glow.scales[5].weight).toBeGreaterThan(black.scales[5].weight);
  });

  it('强度为零时不残留高光压缩、雾幕或细节补偿', () => {
    const params = applyDiffusionPreset('white-mist-high');
    const recipe = compileDiffusionRecipe(
      { ...params, strength: 0 },
      { width: 1920, height: 1080 }
    );

    expect(recipe.energy.scatterFraction).toBe(0);
    expect(recipe.energy.veil).toBe(0);
    expect(recipe.tone.highlightCompression).toBe(0);
    expect(recipe.detail.highFrequencyRetention).toBe(0);
    expect(recipe.detail.midFrequencyRetention).toBe(0);
  });

  it('限制白柔强档雾幕，并让辉光强档保持纯加法配方', () => {
    const white = compileDiffusionRecipe(
      applyDiffusionPreset('white-mist-high'),
      { width: 1920, height: 1080 }
    );
    const glow = compileDiffusionRecipe(
      applyDiffusionPreset('glow-high'),
      { width: 1920, height: 1080 }
    );

    // 雾幕是白柔的特征而不是它的全部：黑位抬升主要来自长尾 PSF，额外的全局雾幕保持
    // 在个位数百分比，否则强档会退化成「整张图加一层灰」。
    expect(white.energy.veil).toBeLessThanOrEqual(0.08);
    // 散射系数就是「画面被换成散射版本的比例」，必须留在 [0,1] 才谈得上能量守恒。
    expect(white.energy.scatterFraction).toBeLessThan(0.8);
    expect(glow.energy.scatterFraction).toBeLessThanOrEqual(1);
    expect(glow.source.highlightRecovery).toBe(0);
    expect(glow.tone.highlightCompression).toBe(0);
    expect(glow.detail.highFrequencyRetention).toBe(0);
    expect(glow.detail.midFrequencyRetention).toBe(0);
    expect(glow.scales.reduce((sum, scale) => sum + scale.weight, 0)).toBeCloseTo(1);
    expect(glow.scales.every((scale) => scale.weight > 0)).toBe(true);
  });

  it('着色器以底图频段补偿细节，黑颗粒只吸收加回的散射项', () => {
    expect(diffusionShaderSource).toContain('let high_detail = base.rgb - near_base;');
    expect(diffusionShaderSource).toContain('let mid_detail = near_base - far_base;');
    expect(diffusionShaderSource).not.toMatch(
      /let high_detail = base\.rgb\s*-\s*textureSampleLevel\(scatter_0/
    );
    expect(diffusionShaderSource).toMatch(
      /let absorption = mix\(1\.0, shadow_response, composite_params\.shadow_absorption\)/
    );
    expect(diffusionShaderSource).toContain(
      'var color = direct + scatter * composite_params.scatter_fraction * absorption;'
    );
    // 旧写法把整个效果在暗部 mix 回原图，连柔焦和细节补偿一起撤销，
    // 黑柔因此在暗部完全没有滤镜的痕迹。钉住不许写回来。
    expect(diffusionShaderSource).not.toMatch(/color = mix\(base\.rgb, color, /);
    expect(diffusionShaderSource).toContain(
      'color = compress_highlights(color, composite_params.highlight_compression);'
    );
  });

  it('三种模式共用固定小核散射金字塔，辉光保留 max RGB 软阈值与加法合成', () => {
    expect(diffusionShaderSource).toContain(
      'let brightness = max(color.r, max(color.g, color.b));'
    );
    expect(diffusionShaderSource).toContain('fn fragment_scatter_downsample');
    expect(diffusionShaderSource).toContain('fn fragment_scatter_upsample');
    expect(diffusionShaderSource).not.toContain('fn gaussian_sample');
    expect(diffusionShaderSource).not.toContain('fn fragment_blur_horizontal');
    expect(diffusionShaderSource).not.toContain('fn fragment_blur_vertical');
    expect(diffusionShaderSource).toContain('base.rgb + bloom,');
  });

  /**
   * 雾镜的颗粒对所有入射光都散射，「只散阈值以上的高光」出来的是 bloom 插件：
   * 中暗部既不糊也不会被相邻亮部渗进来，也就没有 halation 和 loss of definition。
   * 这是黑柔/白柔此前观感不像的根因，钉住散射地板不许再退回阈值门。
   */
  it('黑柔/白柔的散射源覆盖整幅画面，高光只是加权更高', () => {
    expect(diffusionShaderSource).toContain(
      'let scatter_ratio = mix(source_params.scatter_floor, 1.0, highlight);'
    );
    expect(diffusionShaderSource).toContain(
      'color.rgb * scatter_ratio * source_params.highlight_gain,'
    );
    expect(diffusionShaderSource).toContain('scatter *= composite_params.scatter_tint;');
  });

  it('黑柔和白柔只用连续 2× mip 层，并保持逐通道散射能量归一', () => {
    for (const presetId of ['black-mist-medium', 'white-mist-medium'] as const) {
      const recipe = compileDiffusionRecipe(
        applyDiffusionPreset(presetId),
        { width: 3840, height: 2160 }
      );
      expect(recipe.scatterLevels[0].divisor).toBe(2);
      for (let index = 1; index < recipe.scatterLevels.length; index += 1) {
        expect(recipe.scatterLevels[index].divisor)
          .toBe(recipe.scatterLevels[index - 1].divisor * 2);
      }
      for (const channel of [0, 1, 2] as const) {
        expect(recipe.scatterLevels.reduce(
          (sum, level) => sum + level.weight[channel],
          0
        )).toBeCloseTo(1, 10);
      }
    }
  });

  it('黑柔散射更收敛并守黑位，白柔散射更宽且雾幕更强', () => {
    const black = compileDiffusionRecipe(
      applyDiffusionPreset('black-mist-medium'),
      { width: 3840, height: 2160 }
    );
    const white = compileDiffusionRecipe(
      applyDiffusionPreset('white-mist-medium'),
      { width: 3840, height: 2160 }
    );
    const effectiveRadius = (recipe: typeof black): number =>
      recipe.scatterLevels.reduce(
        (sum, level) => sum + level.divisor * level.weight[1],
        0
      );

    expect(effectiveRadius(black)).toBeLessThan(effectiveRadius(white));
    expect(black.energy.veil).toBeLessThan(white.energy.veil);
    expect(black.source.scatterFloor).toBeLessThan(white.source.scatterFloor);
    // 黑柔的黑颗粒吸收更多散进暗部的光，白柔留着那层被抬起的奶雾。
    expect(black.tone.shadowAbsorption).toBeGreaterThan(white.tone.shadowAbsorption);
  });

  /**
   * 这两种写法都曾经在辉光合成里出现过，观感代价很大且不容易一眼看出来，所以钉住：
   * headroom 门控让底图越亮能加的辉光越少，纯白光源处直接归零、光晕中心被挖空；
   * 逐像素峰值归一是非线性缩放，亮处压得多暗处不压，直接把 PSF 径向衰减压平。
   * 溢出该由末端的保色相肩部收，不该由这两个空间 hack 代劳。
   */
  it('辉光不按底图亮度做空间门控，也不逐像素归一化光晕', () => {
    // 只看语句行；两处都在注释里被点名说明为什么不能再写回来。
    expect(diffusionShaderSource).not.toMatch(/^\s*let headroom\b/m);
    expect(diffusionShaderSource).not.toMatch(/^\s*bloom\s*\/=/m);
    expect(diffusionShaderSource).toContain('fn tonemap_glow');
    expect(diffusionShaderSource).toContain(
      'let rolled = knee + range * (1.0 - exp(-(peak - knee) / range));'
    );
  });

  it('辉光范围增大时把更多能量平滑分配到宽半径层', () => {
    const lowRange = applyDiffusionPreset('glow-medium');
    const narrow = compileDiffusionRecipe(
      { ...lowRange, glowRange: 0.1, softness: 0.2 },
      { width: 1920, height: 1080 }
    );
    const wide = compileDiffusionRecipe(
      { ...lowRange, glowRange: 0.9, softness: 0.8 },
      { width: 1920, height: 1080 }
    );
    const tailWeight = (recipe: typeof narrow): number =>
      recipe.scales.slice(3).reduce((sum, scale) => sum + scale.weight, 0);

    expect(tailWeight(wide)).toBeGreaterThan(tailWeight(narrow));
  });

  it('登记全部预设 Golden 和冻结/待运行时阈值', () => {
    expect(DIFFUSION_GOLDEN_INDEX).toHaveLength(9);
    expect(DIFFUSION_QUALITY_THRESHOLDS.some((threshold) => threshold.status === 'frozen')).toBe(true);
    expect(DIFFUSION_QUALITY_THRESHOLDS.some((threshold) => threshold.status === 'pending-electron-runtime')).toBe(true);
    expect(validateDiffusionBaselineDefinitions()).toEqual([]);
  });
});
