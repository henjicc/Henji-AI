// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { ACCENT_PRESET_HEX, SETTINGS_ACCENT_HEX, THEME_PALETTE_PRESET_HEX, THEME_SEED_ACCENT_HEX } from '@/core/theme/colorTokens'
import { normalizeHex } from '@/core/theme/themeColor'
import { DEFAULT_THEME_SEED, THEME_ACCENT_CHOICES, THEME_CONTRAST_LEVELS, THEME_PRESETS } from '@/core/theme/themeEngine'
import { createThemePayloadV2, parseThemePayload } from '@/core/theme/themeMigration'
import { DEFAULT_THEME_SELECTION } from '@/core/theme/themeSelection'
import { useSettingsStore } from './settingsStore'

const migrate = (state: Record<string, unknown>, version: number) =>
  useSettingsStore.persist.getOptions().migrate?.(state, version) as Record<string, unknown>

const violet = THEME_ACCENT_CHOICES.find((choice) => choice.id === 'violet')!.hex!

function resetTheme(): void {
  const initial = useSettingsStore.getInitialState()
  useSettingsStore.setState({
    themeSelection: initial.themeSelection,
    themeSeed: initial.themeSeed,
    themeOverrides: initial.themeOverrides,
    uiRadiusPreset: 'default',
  })
}

describe('settingsStore 外观选择（v13）', () => {
  beforeEach(resetTheme)

  it('默认是石墨预设、跟随预设强调色、标准对比度；派生种子即石墨种子', () => {
    expect(useSettingsStore.persist.getOptions().version).toBe(13)
    const state = useSettingsStore.getInitialState()
    expect(state.themeSelection).toEqual(DEFAULT_THEME_SELECTION)
    expect(state.themeSeed).toEqual(DEFAULT_THEME_SEED)
    expect(state.themeOverrides).toEqual({})
  })

  it('预设、强调色、对比度三个动作即时改写派生种子，并互相保留', () => {
    const { setThemePreset, setThemeAccent, setThemeContrast } = useSettingsStore.getState()
    setThemeAccent(violet)
    setThemeContrast('strong')
    setThemePreset('paper')
    let state = useSettingsStore.getState()
    expect(state.themeSelection).toMatchObject({ preset: 'paper', accent: violet, contrast: 'strong' })
    expect(state.themeSeed).toEqual({ ...THEME_PRESETS.paper.seed, accent: violet, contrast: THEME_CONTRAST_LEVELS.strong })

    setThemeAccent(null)
    setThemePreset('ocean')
    state = useSettingsStore.getState()
    expect(state.themeSeed).toEqual({ ...THEME_PRESETS.ocean.seed, contrast: THEME_CONTRAST_LEVELS.strong })

    setThemeAccent('not-a-color')
    expect(useSettingsStore.getState().themeSelection.accent).toBeNull()
  })

  it('没有自定义底色时不能切到“自定义”', () => {
    useSettingsStore.getState().setThemePreset('custom')
    expect(useSettingsStore.getState().themeSelection.preset).toBe('graphite')
  })

  it('导入：预设主题落到预设；非预设种子成为可切回的自定义底色；三种范围各管各的', () => {
    const { importThemePayload, setThemePreset } = useSettingsStore.getState()
    importThemePayload(createThemePayloadV2({ seed: { ...THEME_PRESETS.film.seed, contrast: THEME_CONTRAST_LEVELS.soft }, uiRadiusPreset: 'large' }), 'colorsOnly')
    let state = useSettingsStore.getState()
    expect(state.themeSelection).toMatchObject({ preset: 'film', accent: null, contrast: 'soft', custom: null })
    expect(state.uiRadiusPreset).toBe('default')

    const custom = { ...THEME_PRESETS.ocean.seed, hue: 200, contrast: 1.6 }
    importThemePayload(createThemePayloadV2({ seed: custom, overrides: { line: THEME_SEED_ACCENT_HEX.orange }, uiRadiusPreset: 'compact' }), 'all')
    state = useSettingsStore.getState()
    expect(state.themeSelection.preset).toBe('custom')
    expect(state.themeSeed).toEqual(custom)
    expect(state.themeOverrides).toEqual({ line: THEME_SEED_ACCENT_HEX.orange })
    expect(state.uiRadiusPreset).toBe('compact')

    setThemePreset('graphite')
    expect(useSettingsStore.getState().themeOverrides).toEqual({})
    setThemePreset('custom')
    expect(useSettingsStore.getState().themeSeed).toEqual(custom)

    importThemePayload(createThemePayloadV2({ seed: THEME_PRESETS.paper.seed, uiRadiusPreset: 'large' }), 'radiusOnly')
    state = useSettingsStore.getState()
    expect(state.themeSelection.preset).toBe('custom')
    expect(state.uiRadiusPreset).toBe('large')
  })

  it('导入 v1 主题文件：内置方案 → 石墨并保留改过的强调色', () => {
    const v1 = { version: 1, themeTonePreset: 'warm', uiRadiusPreset: 'default', accentColor: ACCENT_PRESET_HEX[7], colors: THEME_PALETTE_PRESET_HEX[1].colors }
    useSettingsStore.getState().importThemePayload(parseThemePayload(v1)!, 'all')
    expect(useSettingsStore.getState().themeSelection).toMatchObject({ preset: 'graphite', accent: normalizeHex(ACCENT_PRESET_HEX[7]) })
  })
})

describe('settingsStore 外观迁移', () => {
  it('v11：内置方案 → 石墨；改过的强调色保留；自定义九色 → 自定义底色；删除 v1 字段', () => {
    const builtIn = migrate({ themeColors: THEME_PALETTE_PRESET_HEX[2].colors, accentColor: SETTINGS_ACCENT_HEX, themeTonePreset: 'warm' }, 11)
    expect(builtIn.themeSelection).toEqual(DEFAULT_THEME_SELECTION)
    expect(builtIn.themeSeed).toEqual(DEFAULT_THEME_SEED)
    expect(builtIn).not.toHaveProperty('themeColors')
    expect(builtIn).not.toHaveProperty('accentColor')
    expect(builtIn).not.toHaveProperty('themeTonePreset')

    const accent = ACCENT_PRESET_HEX[7]
    expect(migrate({ themeColors: THEME_PALETTE_PRESET_HEX[0].colors, accentColor: accent }, 11).themeSelection)
      .toMatchObject({ preset: 'graphite', accent: normalizeHex(accent), contrast: 'standard' })

    const custom = migrate({ themeColors: { ...THEME_PALETTE_PRESET_HEX[3].colors, bg: THEME_PALETTE_PRESET_HEX[3].colors.panel } }, 11)
    expect((custom.themeSelection as { preset: string }).preset).toBe('custom')
    expect(custom.themeSeed).not.toEqual(DEFAULT_THEME_SEED)
    expect(Object.keys(custom.themeOverrides as object).length).toBeGreaterThan(0)
  })

  it('v12：由已有种子反推选择（预设 + 强调色 + 档位），非预设种子成为自定义底色且观感不变', () => {
    const preset = migrate({ themeSeed: { ...THEME_PRESETS.paper.seed, accent: violet, contrast: 1.35 }, themeOverrides: {} }, 12)
    expect(preset.themeSelection).toMatchObject({ preset: 'paper', accent: violet, contrast: 'strong' })

    const seed = { ...THEME_PRESETS.paper.seed, hue: 400, contrast: 1.8 }
    const custom = migrate({ themeSeed: seed, themeOverrides: { nope: 1, line: THEME_SEED_ACCENT_HEX.teal } }, 12)
    expect((custom.themeSelection as { preset: string }).preset).toBe('custom')
    expect(custom.themeSeed).toEqual({ ...seed, hue: 40 })
    expect(custom.themeOverrides).toEqual({ line: THEME_SEED_ACCENT_HEX.teal })
  })

  it('v13：已有选择只做规范化', () => {
    const migrated = migrate({ themeSelection: { preset: 'film', accent: 'bad', contrast: 'loud' } }, 13)
    expect(migrated.themeSelection).toEqual({ preset: 'film', accent: null, contrast: 'standard', custom: null })
    expect(migrated.themeSeed).toEqual(THEME_PRESETS.film.seed)
  })
})
