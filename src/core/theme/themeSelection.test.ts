import { describe, expect, it } from 'vitest'

import { THEME_SEED_ACCENT_HEX } from './colorTokens'
import { DEFAULT_THEME_SEED, THEME_CONTRAST_LEVELS, THEME_PRESETS, THEME_PRESET_IDS } from './themeEngine'
import {
  DEFAULT_THEME_SELECTION,
  normalizeThemeSelection,
  resolveThemeSelection,
  selectionFromThemeSeed,
} from './themeSelection'

describe('外观选择 → 种子', () => {
  it('默认选择即石墨种子；预设 × 档位的对比度就是档位值', () => {
    expect(resolveThemeSelection(DEFAULT_THEME_SELECTION)).toEqual({ seed: DEFAULT_THEME_SEED, overrides: {} })
    for (const preset of THEME_PRESET_IDS) {
      const { seed } = resolveThemeSelection({ ...DEFAULT_THEME_SELECTION, preset, contrast: 'soft' })
      expect(seed).toEqual({ ...THEME_PRESETS[preset].seed, contrast: THEME_CONTRAST_LEVELS.soft })
    }
  })

  it('自定义底色：标准档保留拟合对比度，其他档按倍数缩放；覆盖只随自定义底色生效', () => {
    const custom = { seed: { ...DEFAULT_THEME_SEED, hue: 120, contrast: 1.8 }, overrides: { line: THEME_SEED_ACCENT_HEX.orange } }
    const selection = { ...DEFAULT_THEME_SELECTION, preset: 'custom' as const, custom }
    expect(resolveThemeSelection(selection)).toEqual({ seed: custom.seed, overrides: custom.overrides })
    expect(resolveThemeSelection({ ...selection, contrast: 'strong' }).seed.contrast).toBeCloseTo(1.8 * 1.35)
    expect(resolveThemeSelection({ ...selection, preset: 'paper' }).overrides).toEqual({})
  })

  it('种子 → 选择 → 种子往返不变（预设与自定义两条路）', () => {
    const seeds = [
      { ...THEME_PRESETS.film.seed, contrast: 1.35, accent: THEME_SEED_ACCENT_HEX.teal },
      THEME_PRESETS.ocean.seed,
      { ...THEME_PRESETS.paper.seed, base: 0.9 },
      { ...THEME_PRESETS.graphite.seed, contrast: 2 },
    ]
    for (const seed of seeds) {
      expect(resolveThemeSelection(selectionFromThemeSeed(seed)).seed).toEqual(seed)
    }
    expect(selectionFromThemeSeed(THEME_PRESETS.ocean.seed).accent).toBeNull()
    expect(selectionFromThemeSeed({ ...THEME_PRESETS.paper.seed, base: 0.9 }).preset).toBe('custom')
    expect(selectionFromThemeSeed(THEME_PRESETS.graphite.seed, { line: THEME_SEED_ACCENT_HEX.violet }).preset).toBe('custom')
  })

  it('持久化规范化：非法值回落，“自定义”缺底色时回到默认预设', () => {
    expect(normalizeThemeSelection(null)).toBeNull()
    expect(normalizeThemeSelection({ preset: 'sepia' })).toBeNull()
    expect(normalizeThemeSelection({ preset: 'custom', accent: THEME_SEED_ACCENT_HEX.rose.toLowerCase(), contrast: 'strong' }))
      .toEqual({ preset: 'graphite', accent: THEME_SEED_ACCENT_HEX.rose, contrast: 'strong', custom: null })
  })
})
