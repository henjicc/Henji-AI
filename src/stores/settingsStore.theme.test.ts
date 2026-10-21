// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { SETTINGS_ACCENT_HEX, THEME_PALETTE_PRESET_HEX, THEME_SEED_ACCENT_HEX } from '@/core/theme/colorTokens'
import { DEFAULT_THEME_SEED, THEME_ACCENT_CHOICES, THEME_CONTRAST_LEVELS, THEME_PRESETS } from '@/core/theme/themeEngine'
import { createThemePayloadV2, parseThemePayload } from '@/core/theme/themeMigration'
import { DEFAULT_THEME_SELECTION } from '@/core/theme/themeSelection'
import { useSettingsStore } from './settingsStore'


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

describe('settingsStore 外观选择（v14）', () => {
  beforeEach(resetTheme)

  it('默认是石墨预设、跟随预设强调色、标准对比度；派生种子即石墨种子', () => {
    expect(useSettingsStore.persist.getOptions().version).toBe(14)
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
})

describe('settingsStore 外观持久化边界', () => {
  it('设置不走 zustand 迁移；兼容起点之前的 v1 主题文件不再转换', () => {
    expect(useSettingsStore.persist.getOptions().migrate).toBeUndefined()
    expect(parseThemePayload({ version: 1, themeTonePreset: 'warm', uiRadiusPreset: 'default', accentColor: SETTINGS_ACCENT_HEX, colors: THEME_PALETTE_PRESET_HEX[2].colors })).toBeNull()
    expect(parseThemePayload(createThemePayloadV2({ seed: DEFAULT_THEME_SEED }))?.seed).toEqual(DEFAULT_THEME_SEED)
  })
})
