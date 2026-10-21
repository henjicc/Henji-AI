import { describe, expect, it } from 'vitest'

import { ACCENT_PRESET_HEX } from './colorTokens'
import { normalizeHex } from './themeColor'
import { DEFAULT_THEME_SEED, THEME_PRESETS } from './themeEngine'
import { createThemePayloadV2, findThemePresetId, parseThemePayload } from './themeMigration'

describe('themeMigration payload v2', () => {
  it('导出 → JSON → 导入往返一致（含 overrides）', () => {
    for (const payload of [
      createThemePayloadV2({ seed: THEME_PRESETS.film.seed, overrides: { window: normalizeHex('2a2f36')!, text1: 'rgba(240,240,240,0.9)' }, uiRadiusPreset: 'large' }),
      createThemePayloadV2({ seed: { ...THEME_PRESETS.paper.seed, contrast: 1.35 } }),
      createThemePayloadV2({ seed: THEME_PRESETS.ocean.seed, overrides: { mediaScrim: 'rgba(0, 0, 0, 0.4)' }, uiRadiusPreset: 'compact' }),
    ]) {
      const imported = parseThemePayload(JSON.parse(JSON.stringify(payload)))
      expect(imported).toEqual(payload)
      expect(parseThemePayload(JSON.parse(JSON.stringify(imported)))).toEqual(imported)
    }
  })

  it('导入时规范化种子与覆盖：未知令牌、非法颜色被丢弃，rgba 统一格式', () => {
    const imported = parseThemePayload({
      version: 2,
      seed: { mode: 'light', hue: 400, tint: 0.5, base: 0.97, contrast: 1, accent: '3a6fdf' },
      overrides: { window: 'abcdef', notAToken: 'abcdef', panel: 'nope', scrim: 'rgb(0 0 0 / 0.3)' },
      uiRadiusPreset: 'default',
    })
    expect(imported?.seed).toMatchObject({ mode: 'light', hue: 40, tint: 0.08, accent: THEME_PRESETS.paper.seed.accent })
    expect(imported?.overrides).toEqual({ window: normalizeHex('abcdef'), scrim: 'rgba(0,0,0,0.3)' })
  })

  it('格式不对返回 null', () => {
    expect(parseThemePayload(null)).toBeNull()
    expect(parseThemePayload('x')).toBeNull()
    expect(parseThemePayload({ version: 3 })).toBeNull()
    expect(parseThemePayload({ version: 2, seed: { mode: 'sepia' }, uiRadiusPreset: 'default' })).toBeNull()
    expect(parseThemePayload({ version: 2, seed: DEFAULT_THEME_SEED, uiRadiusPreset: 'huge' })).toBeNull()
    // 兼容起点之前的 v1 手填颜色主题不再转换。
    expect(parseThemePayload({ version: 1, themeTonePreset: 'warm', uiRadiusPreset: 'default', accentColor: ACCENT_PRESET_HEX[0], colors: {} })).toBeNull()
  })

  it('按底色识别预设（强调色、对比度可不同）', () => {
    expect(findThemePresetId({ ...THEME_PRESETS.film.seed, contrast: 1.35, accent: ACCENT_PRESET_HEX[0] })).toBe('film')
    expect(findThemePresetId({ ...THEME_PRESETS.film.seed, hue: 71 })).toBeNull()
  })
})
