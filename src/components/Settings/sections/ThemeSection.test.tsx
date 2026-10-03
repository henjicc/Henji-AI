/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n/config'
import { SETTINGS_ACCENT_HEX } from '@/core/theme/colorTokens'
import { THEME_ACCENT_CHOICES, THEME_PRESETS, deriveThemeTokens } from '@/core/theme/themeEngine'
import { createThemePayloadV2 } from '@/core/theme/themeMigration'
import { useSettingsStore } from '@/stores/settingsStore'

import ThemeSection from './ThemeSection'

function resetTheme(): void {
  const initial = useSettingsStore.getInitialState()
  useSettingsStore.setState({
    themeSelection: initial.themeSelection,
    themeSeed: initial.themeSeed,
    themeOverrides: initial.themeOverrides,
  })
}

/** jsdom 把颜色规范化成 rgb()，比较前把推导出的 hex 也转成同一格式。 */
function hexToRgb(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16)
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`
}

function renderSection() {
  return render(<ThemeSection onExportTheme={vi.fn()} onImportTheme={vi.fn(async () => true)} />)
}

describe('外观设置（种子式）', () => {
  beforeAll(async () => { await i18n.changeLanguage('zh-CN') })
  beforeEach(resetTheme)
  afterEach(() => { cleanup(); resetTheme() })

  it('四个预设、六个强调色、三档对比度都以单选呈现，默认石墨 / 跟随预设 / 标准', () => {
    renderSection()
    const presets = within(screen.getByRole('radiogroup', { name: '主题预设' })).getAllByRole('radio')
    expect(presets.map((item) => item.textContent)).toEqual(['石墨', '深海', '胶片', '纸白'])
    expect(screen.getByRole('radio', { name: '石墨' })).toHaveProperty('ariaChecked', 'true')
    const accents = within(screen.getByRole('radiogroup', { name: '强调色' })).getAllByRole('radio')
    expect(accents.map((item) => item.getAttribute('aria-label'))).toEqual(['跟随预设', '蓝', '紫', '青', '橙', '玫红'])
    expect(screen.getByRole('radio', { name: '跟随预设' })).toHaveProperty('ariaChecked', 'true')
    expect(screen.getByRole('radio', { name: '标准' })).toHaveProperty('ariaChecked', 'true')
    // 逐色编辑、色调与 hex 输入已移除，界面不展示种子数值
    expect(screen.queryByText(/色调|高级颜色映射/)).toBeNull()
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })

  it('色样显示当前底色下推导后的强调实底，而不是种子原值', () => {
    renderSection()
    const blue = THEME_ACCENT_CHOICES.find((choice) => choice.id === 'blue')!.hex!
    const derived = deriveThemeTokens({ ...THEME_PRESETS.graphite.seed, accent: blue }).colors.accent
    expect(derived).not.toBe(blue)
    expect(screen.getByRole('radio', { name: '蓝' }).style.backgroundColor).toBe(hexToRgb(derived))
  })

  it('点击预设、强调色、对比度即时写入设置', () => {
    renderSection()
    fireEvent.click(screen.getByRole('radio', { name: '纸白' }))
    fireEvent.click(screen.getByRole('radio', { name: '玫红' }))
    fireEvent.click(screen.getByRole('radio', { name: '更强' }))
    const rose = THEME_ACCENT_CHOICES.find((choice) => choice.id === 'rose')!.hex
    expect(useSettingsStore.getState().themeSelection).toMatchObject({ preset: 'paper', accent: rose, contrast: 'strong' })
    expect(useSettingsStore.getState().themeSeed.mode).toBe('light')
    expect(screen.getByRole('radio', { name: '纸白' })).toHaveProperty('ariaChecked', 'true')
  })

  it('自定义取色后出现选中的“自定义颜色”色样；存在自定义底色时多出“自定义”预设', () => {
    useSettingsStore.getState().importThemePayload(
      createThemePayloadV2({ seed: { ...THEME_PRESETS.ocean.seed, hue: 200 }, uiRadiusPreset: 'default' }),
      'colorsOnly',
    )
    useSettingsStore.getState().setThemeAccent(SETTINGS_ACCENT_HEX)
    renderSection()
    expect(screen.getByRole('radio', { name: '自定义' })).toHaveProperty('ariaChecked', 'true')
    expect(screen.getByRole('radio', { name: '自定义颜色' })).toHaveProperty('ariaChecked', 'true')
    expect(screen.getByRole('radio', { name: '跟随预设' })).toHaveProperty('ariaChecked', 'false')
  })
})
