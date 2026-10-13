import { describe, expect, it } from 'vitest'
import { deriveThemeTokens, THEME_PRESETS, THEME_PRESET_IDS, THEME_CONTRAST_LEVELS } from './themeEngine'
import { contrastRatio, deltaEOK, hexToOklch } from './themeColor'

describe('中性分段选中底在四预设下可辨', () => {
  for (const preset of THEME_PRESET_IDS) {
    it.each(Object.values(THEME_CONTRAST_LEVELS))(`${preset} 对比度 %s`, contrast => {
      const { colors } = deriveThemeTokens({ ...THEME_PRESETS[preset].seed, contrast })
      expect(colors.segmentSelected).toBeDefined()
      expect(deltaEOK(colors.segmentSelected, colors.gap)).toBeGreaterThanOrEqual(0.04)
      expect(deltaEOK(colors.segmentSelected, colors.hover)).toBeGreaterThanOrEqual(0.03)
      expect(contrastRatio(colors.text1, colors.segmentSelected)).toBeGreaterThanOrEqual(4.5)
      expect(hexToOklch(colors.segmentSelected).C).toBeLessThanOrEqual(hexToOklch(colors.raised).C + 0.01)
    })
  }
})
