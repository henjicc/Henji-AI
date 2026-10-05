/**
 * 主题组合属性测试（任务 5.11）：外观设置允许换强调色（含任意取色）、调层级对比度，
 * themeEngine.test 只断言了四个预设；这里用固定随机种子生成大量组合，对每组派生令牌跑
 * themeCombinationTestFixture 的全部判定。失败时 fast-check 自动收缩并输出最小反例（种子、路径与违规明细）。
 * 发现不达标的组合应修 themeEngine 的求解，不放宽门槛。
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'

import { checkThemeCombination } from './themeCombinationTestFixture'
import {
  THEME_ACCENT_CHOICES,
  THEME_CONTRAST_LEVELS,
  THEME_PRESETS,
  THEME_PRESET_IDS,
  THEME_SEED_LIMITS,
  deriveThemeTokens,
  type ThemeSeed,
} from './themeEngine'

/** 固定随机种子：失败可复现；改判定或引擎后仍用同一种子回归。 */
const PROPERTY_SEED = 20261005

const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()

/** 任意 sRGB 强调色（设置里的取色器可选任意颜色，含黑、白、灰与高彩度色）。 */
const accentArb = fc
  .tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }))
  .map(([r, g, b]) => `#${hex(r)}${hex(g)}${hex(b)}`)

const levelValues = Object.values(THEME_CONTRAST_LEVELS)

/** 层级对比度：设置的三档 + 引擎接受的连续全范围（自定义底色 × 档位会落在其中）。 */
const contrastArb = fc.oneof(
  fc.constantFrom(...levelValues),
  fc.double({ min: THEME_SEED_LIMITS.contrast.min, max: THEME_SEED_LIMITS.contrast.max, noNaN: true })
)

function assertCombination(seed: ThemeSeed) {
  const violations = checkThemeCombination(deriveThemeTokens(seed))
  if (violations.length > 0) {
    throw new Error(
      `种子 ${JSON.stringify(seed)} 不达标：\n${violations.map((v) => `  - ${v.check}：${v.detail}`).join('\n')}`
    )
  }
}

describe('主题组合属性测试（任务 5.11）', () => {
  it('四预设 × 设置里的强调色选项 × 三档对比度：穷举全部通过', () => {
    for (const id of THEME_PRESET_IDS) {
      for (const choice of THEME_ACCENT_CHOICES) {
        for (const contrast of levelValues) {
          const base = THEME_PRESETS[id].seed
          expect(() => assertCombination({ ...base, contrast, accent: choice.hex ?? base.accent })).not.toThrow()
        }
      }
    }
  })

  it('四预设（深浅两种模式）× 任意强调色 × 对比度全范围', () => {
    fc.assert(
      fc.property(fc.constantFrom(...THEME_PRESET_IDS), accentArb, contrastArb, (id, accent, contrast) => {
        assertCombination({ ...THEME_PRESETS[id].seed, accent, contrast })
      }),
      { seed: PROPERTY_SEED, numRuns: 3000 }
    )
  })

  it('自定义底色（深/浅、任意色相与倾向、预设附近的窗口亮度）× 任意强调色 × 对比度 0.5–2', () => {
    // 窗口亮度取四预设附近（深 0.12–0.22、浅 0.94–1）：深色底更亮且对比度 > 2 时，选中表面亮到白字都不足 4.5:1，
    // 属于种子本身不可行（任何文字色都无解），不在本测试范围，见任务 5.11 执行记录。
    const seedArb = fc.record({
      mode: fc.constantFrom('dark' as const, 'light' as const),
      hue: fc.double({ min: 0, max: 360, noNaN: true }),
      tint: fc.double({ min: THEME_SEED_LIMITS.tint.min, max: THEME_SEED_LIMITS.tint.max, noNaN: true }),
      position: fc.double({ min: 0, max: 1, noNaN: true }),
      contrast: fc.double({ min: 0.5, max: 2, noNaN: true }),
      accent: accentArb,
    })
    fc.assert(
      fc.property(seedArb, ({ position, ...rest }) => {
        const base = rest.mode === 'dark' ? 0.12 + position * 0.1 : 0.94 + position * 0.06
        assertCombination({ ...rest, base })
      }),
      { seed: PROPERTY_SEED, numRuns: 1500 }
    )
  })
})
