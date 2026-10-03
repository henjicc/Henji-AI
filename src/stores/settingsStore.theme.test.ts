// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { ACCENT_PRESET_HEX, SETTINGS_ACCENT_HEX, THEME_PALETTE_PRESET_HEX } from '@/core/theme/colorTokens'
import { normalizeHex } from '@/core/theme/themeColor'
import { DEFAULT_THEME_SEED, THEME_PRESETS } from '@/core/theme/themeEngine'
import { DEFAULT_THEME_COLOR_SCHEME } from '@/core/theme/runtimeTheme'
import { useSettingsStore } from './settingsStore'

const migrate = (state: Record<string, unknown>, version: number) =>
  useSettingsStore.persist.getOptions().migrate?.(state, version) as Record<string, unknown>

describe('settingsStore 主题种子（v12）', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      accentColor: SETTINGS_ACCENT_HEX,
      themeColors: DEFAULT_THEME_COLOR_SCHEME,
      themeSeed: DEFAULT_THEME_SEED,
      themeOverrides: {},
    })
  })

  it('默认状态是石墨种子、无覆盖', () => {
    expect(useSettingsStore.persist.getOptions().version).toBe(12)
    const state = useSettingsStore.getInitialState()
    expect(state.themeSeed).toEqual(DEFAULT_THEME_SEED)
    expect(state.themeOverrides).toEqual({})
  })

  it('v11 旧设置迁移：内置方案 → 石墨；改过的强调色保留；自定义九色 → 拟合', () => {
    const builtIn = migrate({ themeColors: THEME_PALETTE_PRESET_HEX[2].colors, accentColor: SETTINGS_ACCENT_HEX }, 11)
    expect(builtIn.themeSeed).toEqual(DEFAULT_THEME_SEED)
    expect(builtIn.themeOverrides).toEqual({})

    const accent = ACCENT_PRESET_HEX[7]
    expect(migrate({ themeColors: THEME_PALETTE_PRESET_HEX[0].colors, accentColor: accent }, 11).themeSeed).toEqual({
      ...DEFAULT_THEME_SEED,
      accent: normalizeHex(accent),
    })

    const custom = migrate({ themeColors: { ...THEME_PALETTE_PRESET_HEX[3].colors, bg: THEME_PALETTE_PRESET_HEX[3].colors.panel } }, 11)
    expect(custom.themeSeed).not.toEqual(DEFAULT_THEME_SEED)
    expect(Object.keys(custom.themeOverrides as object).length).toBeGreaterThan(0)
  })

  it('已有种子的持久化状态只做规范化，不被旧九色覆盖', () => {
    const migrated = migrate({ themeColors: THEME_PALETTE_PRESET_HEX[3].colors, themeSeed: { ...THEME_PRESETS.paper.seed, hue: 400 }, themeOverrides: { nope: 1 } }, 12)
    expect(migrated.themeSeed).toEqual({ ...THEME_PRESETS.paper.seed, hue: 40 })
    expect(migrated.themeOverrides).toEqual({})
  })

  it('旧设置写入同步换算种子：强调色（旧默认 = 跟随预设）与九色', () => {
    const { setAccentColor, setThemeColors, resetThemeColors } = useSettingsStore.getState()
    setAccentColor(ACCENT_PRESET_HEX[7])
    expect(useSettingsStore.getState().themeSeed.accent).toBe(normalizeHex(ACCENT_PRESET_HEX[7]))
    setAccentColor(SETTINGS_ACCENT_HEX)
    expect(useSettingsStore.getState().themeSeed.accent).toBe(DEFAULT_THEME_SEED.accent)

    setAccentColor(ACCENT_PRESET_HEX[5])
    setThemeColors({ ...THEME_PALETTE_PRESET_HEX[3].colors, bg: THEME_PALETTE_PRESET_HEX[3].colors.panel })
    const fitted = useSettingsStore.getState()
    expect(fitted.themeSeed).not.toMatchObject({ base: DEFAULT_THEME_SEED.base, contrast: DEFAULT_THEME_SEED.contrast })
    expect(fitted.themeSeed.accent).toBe(normalizeHex(ACCENT_PRESET_HEX[5]))

    resetThemeColors()
    expect(useSettingsStore.getState().themeSeed).toEqual({ ...DEFAULT_THEME_SEED, accent: normalizeHex(ACCENT_PRESET_HEX[5]) })
    expect(useSettingsStore.getState().themeOverrides).toEqual({})
  })
})
