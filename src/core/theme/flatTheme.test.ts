import { expect, it } from 'vitest'
import { deriveThemeTokens, THEME_PRESET_IDS, THEME_PRESETS, THEME_COLOR_TOKEN_NAMES, solveSolidRamp } from './themeEngine'
import { minContrast, oklchToHex, WHITE } from './themeColor'
it('达标纯色不为渐变高光压暗', () => {
  const L = 0.59
  expect(minContrast(WHITE, [oklchToHex(L, 0.19, 25)])).toBeGreaterThanOrEqual(4.5)
  expect(solveSolidRamp({ startL: L, floorL: 0, chroma: 0.19, hue: 25, ink: oklchToHex(0.17, 0, 0), allowInk: false }).L).toBe(L)
})
it('仅输出纯色三态且全部预设文字达到 4.5', () => {
  expect(THEME_COLOR_TOKEN_NAMES.some(name => /Hi$/.test(name))).toBe(false)
  for (const id of THEME_PRESET_IDS) {
    const { colors } = deriveThemeTokens(THEME_PRESETS[id].seed)
    expect(minContrast(colors.onAccent, [colors.accent, colors.accentHover, colors.accentPressed])).toBeGreaterThanOrEqual(4.5)
    expect(minContrast(colors.onDanger, [colors.danger, colors.dangerHover, colors.dangerPressed])).toBeGreaterThanOrEqual(4.5)
  }
})
