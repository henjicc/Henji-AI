import { describe, expect, it } from 'vitest'
import { SOCKET_TYPE_COLOR_HEX, SOCKET_TYPE_COLOR_LIGHT_HEX } from '@/core/theme/colorTokens'
import { contrastRatio } from '@/core/theme/themeColor'
import { deriveThemeTokens, THEME_PRESETS } from '@/core/theme/themeEngine'
import { getSocketColor } from './SocketType'

/** 端口画在节点边上：一半压节点面、一半压画布；浅色模式再加最暗的间隙色留余量。 */
const surfacesOf = (preset: keyof typeof THEME_PRESETS): string[] => {
  const { colors } = deriveThemeTokens(THEME_PRESETS[preset].seed)
  return [colors.canvas, colors.panel, ...(THEME_PRESETS[preset].seed.mode === 'light' ? [colors.gap] : [])]
}

describe('端口类型色按明暗模式派生（4.1）', () => {
  it('每种类型都有浅色值，getSocketColor 用 light-dark() 组合两套', () => {
    expect(Object.keys(SOCKET_TYPE_COLOR_LIGHT_HEX).sort()).toEqual(Object.keys(SOCKET_TYPE_COLOR_HEX).sort())
    expect(getSocketColor('image')).toBe(`light-dark(${SOCKET_TYPE_COLOR_LIGHT_HEX.IMAGE}, ${SOCKET_TYPE_COLOR_HEX.IMAGE})`)
    expect(getSocketColor('*')).toMatch(/^light-dark\(#[0-9A-F]{6}, #[0-9A-F]{6}\)$/)
    expect(getSocketColor(null)).toBe(getSocketColor('unknown'))
  })

  it('深色预设用原色、纸白用浅色值，端口与画布/节点面都 ≥ 3:1', () => {
    for (const preset of ['graphite', 'ocean', 'film'] as const) {
      for (const [type, color] of Object.entries(SOCKET_TYPE_COLOR_HEX)) {
        for (const surface of surfacesOf(preset)) {
          expect(contrastRatio(color, surface), `${preset} ${type}`).toBeGreaterThanOrEqual(3)
        }
      }
    }
    for (const [type, color] of Object.entries(SOCKET_TYPE_COLOR_LIGHT_HEX)) {
      for (const surface of surfacesOf('paper')) {
        expect(contrastRatio(color, surface), `paper ${type} on ${surface}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
