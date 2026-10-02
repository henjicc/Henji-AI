import { describe, expect, it } from 'vitest'

import { WHITE, compositeOver, contrastRatio, hexToOklch, minContrast, mixOklab, oklchToHex, parseColor } from './themeColor'
import {
  DEFAULT_THEME_SEED,
  MEDIA_OVERLAY_TOKENS,
  THEME_COLOR_TOKEN_NAMES,
  THEME_CONTRAST_LEVELS,
  THEME_PRESETS,
  THEME_PRESET_IDS,
  THEME_TEXT_MIN_CONTRAST,
  deriveThemeTokens,
  normalizeThemeSeed,
  type ThemeColorTokens,
  type ThemeSeed,
} from './themeEngine'
import {
  REFERENCE_CONTRAST_LEVELS,
  REFERENCE_PRESETS,
  referenceContrast,
  referenceDerive,
} from './themeReferenceTestFixture'

const LEVELS = Object.entries(THEME_CONTRAST_LEVELS) as Array<[keyof typeof THEME_CONTRAST_LEVELS, number]>

const COMBOS = THEME_PRESET_IDS.flatMap((id) =>
  LEVELS.map(([level, contrast]) => ({
    id,
    level,
    seed: { ...THEME_PRESETS[id].seed, contrast } satisfies ThemeSeed,
  }))
)

/**
 * 允许与参考实现不同的令牌（重要记录 010 的文字求解 + 主控 2026-10-03 的实底按钮规则），
 * 差异由快照锁定并写入执行记录。
 */
const CORRECTED_TOKENS = new Set([
  'text2', 'text3', 'accentText',
  'accent', 'accentHi', 'accentHover', 'accentHoverHi', 'accentPressed', 'accentTint', 'onAccent',
  'danger', 'dangerHi', 'dangerTint',
])

/** 实底按钮上文字实际所在处：静息、悬停渐变的 OKLab 中点（按下态瞬态、顶端高光不计）。 */
const visibleSolid = (t: ThemeColorTokens, kind: 'accent' | 'danger') =>
  kind === 'accent'
    ? [mixOklab(t.accentHi, t.accent), mixOklab(t.accentHoverHi, t.accentHover)]
    : [mixOklab(t.dangerHi, t.danger), mixOklab(t.dangerHoverHi, t.dangerHover)]

const hoverLift = (t: ThemeColorTokens, kind: 'accent' | 'danger') => {
  const [rest, hover] = visibleSolid(t, kind)
  return hexToOklch(hover).L - hexToOklch(rest).L
}

/** 文字会压上的表面（含按钮静息/悬停；按下态是瞬态，不计入）。 */
const TEXT_BEDS = ['window', 'panel', 'raised', 'hover', 'selected', 'control', 'controlHover'] as const

const bedsOf = (t: ThemeColorTokens) => TEXT_BEDS.map((name) => t[name])

describe('themeEngine 与设计稿参考实现对照', () => {
  it('预设与对比度档位和设计稿一致', () => {
    expect(REFERENCE_CONTRAST_LEVELS).toEqual(LEVELS.map(([, value]) => value))
    for (const id of THEME_PRESET_IDS) {
      const { name, ...seed } = REFERENCE_PRESETS[id]
      expect(THEME_PRESETS[id].name.zh).toBe(name)
      expect(THEME_PRESETS[id].seed).toEqual({ ...seed, contrast: 1 })
    }
    expect(DEFAULT_THEME_SEED).toBe(THEME_PRESETS.graphite.seed)
  })

  it.each(COMBOS)('$id/$level：未被 010 修正的令牌与参考实现逐个完全相同（容差 0）', ({ seed }) => {
    const ours = deriveThemeTokens(seed).colors
    const reference = referenceDerive(seed)
    for (const [name, value] of Object.entries(reference)) {
      if (!CORRECTED_TOKENS.has(name)) {
        expect({ name, value: ours[name as keyof ThemeColorTokens] }).toEqual({ name, value })
      }
    }
  })

  it('被修正令牌的取值（快照）；实底只调亮度，色相与设计稿一致', () => {
    const corrected: Record<string, Record<string, string>> = {}
    for (const { id, level, seed } of COMBOS) {
      const ours = deriveThemeTokens(seed).colors
      const reference = referenceDerive(seed)
      corrected[`${id}/${level}`] = Object.fromEntries(
        [...CORRECTED_TOKENS].map((name) => [name, ours[name as keyof ThemeColorTokens]])
      )
      for (const name of ['accent', 'danger'] as const) {
        const hueDiff = Math.abs(hexToOklch(ours[name]).H - hexToOklch(reference[name]).H)
        expect(Math.min(hueDiff, 360 - hueDiff)).toBeLessThan(3)
      }
    }
    expect(corrected).toMatchSnapshot()
  })
})

describe('themeEngine 对比度（重要记录 010）', () => {
  it('1.1 实算的参考实现失败数据仍然成立（回归基线）', () => {
    const at = (id: string, contrast: number) => referenceDerive({ ...REFERENCE_PRESETS[id], contrast })
    expect(referenceContrast(at('graphite', 1).text3, at('graphite', 1).selected)).toBeCloseTo(4.33, 2)
    expect(referenceContrast(at('ocean', 1).text3, at('ocean', 1).selected)).toBeCloseTo(4.42, 2)
    expect(referenceContrast(at('paper', 1).text3, at('paper', 1).selected)).toBeCloseTo(4.03, 2)
    for (const id of THEME_PRESET_IDS) {
      const strong = at(id, 1.35)
      expect(referenceContrast(strong.text3, strong.window)).toBeLessThan(3.5)
      expect(referenceContrast(strong.text3, strong.selected)).toBeLessThan(2.6)
    }
    expect(at('ocean', 1).onAccent).not.toBe(WHITE)
    expect(at('film', 1).onAccent).not.toBe(WHITE)
  })

  it.each(COMBOS)('$id/$level：text1/2/3 对全部承载表面 ≥ 4.5', ({ seed }) => {
    const t = deriveThemeTokens(seed).colors
    for (const text of ['text1', 'text2', 'text3'] as const) {
      for (const bed of TEXT_BEDS) {
        expect({ text, bed, ok: contrastRatio(t[text], t[bed]) >= THEME_TEXT_MIN_CONTRAST }).toEqual({ text, bed, ok: true })
      }
    }
  })

  it.each(COMBOS)('$id/$level：强调/危险实底按钮在静息与悬停渐变中点上、成功/警示实底上的文字 ≥ 4.5', ({ seed }) => {
    const t = deriveThemeTokens(seed).colors
    expect(minContrast(t.onAccent, visibleSolid(t, 'accent'))).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
    expect(minContrast(t.onDanger, visibleSolid(t, 'danger'))).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
    expect(contrastRatio(t.onSuccess, t.success)).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
    expect(contrastRatio(t.onWarning, t.warning)).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
  })

  it.each(COMBOS)('$id/$level：强调文字与状态文字对表面及自身浅底 ≥ 4.5', ({ seed }) => {
    const t = deriveThemeTokens(seed).colors
    expect(minContrast(t.accentText, bedsOf(t))).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
    for (const [text, tint] of [
      ['dangerText', 'dangerTint'],
      ['successText', 'successTint'],
      ['warningText', 'warningTint'],
    ] as const) {
      const beds = [...bedsOf(t), compositeOver(t[tint], t.window), compositeOver(t[tint], t.panel), compositeOver(t[tint], t.raised)]
      expect({ text, value: minContrast(t[text], beds) >= THEME_TEXT_MIN_CONTRAST }).toEqual({ text, value: true })
    }
  })

  it('实底按钮规则：主按钮白字最多压暗 0.04，否则墨水；危险必须白字；各预设结论', () => {
    const tokens = (id: keyof typeof THEME_PRESETS) => deriveThemeTokens(THEME_PRESETS[id].seed).colors
    expect(tokens('graphite').onAccent).toBe(WHITE)
    expect(tokens('paper').onAccent).toBe(WHITE)
    // 深海、胶片：白字需要压暗超过 0.04 → 墨水，实底与文字都回到设计稿推导
    for (const id of ['ocean', 'film'] as const) {
      const reference = referenceDerive(REFERENCE_PRESETS[id])
      expect(tokens(id).onAccent).toBe(reference.onAccent)
      expect(tokens(id).accent).toBe(reference.accent)
      expect(tokens(id).accentHi).toBe(reference.accentHi)
      expect(tokens(id).accentPressed).toBe(reference.accentPressed)
    }
    for (const id of THEME_PRESET_IDS) {
      const t = tokens(id)
      const referenceL = hexToOklch(referenceDerive(REFERENCE_PRESETS[id]).accent).L
      expect(hexToOklch(t.accent).L).toBeGreaterThanOrEqual(referenceL - 0.04 - 0.003)
      expect(t.onDanger).toBe(WHITE)
    }
    // 危险只压到刚好达标：纸白原值已达标则不动
    expect(tokens('paper').danger).toBe(referenceDerive(REFERENCE_PRESETS.paper).danger)
  })

  it('悬停中点相对静息中点的亮度提升 ≤ 0.02（预设与任意强调色）', () => {
    for (const { seed } of COMBOS) {
      const t = deriveThemeTokens(seed).colors
      expect(hoverLift(t, 'accent')).toBeLessThanOrEqual(0.02)
      expect(hoverLift(t, 'danger')).toBeLessThanOrEqual(0.02)
      expect(hoverLift(t, 'accent')).toBeGreaterThan(0)
    }
    for (const mode of ['dark', 'light'] as const) {
      for (let hue = 0; hue < 360; hue += 30) {
        for (const L of [0.45, 0.55, 0.62, 0.7]) {
          const t = deriveThemeTokens({ ...DEFAULT_THEME_SEED, mode, base: mode === 'dark' ? 0.17 : 0.975, accent: oklchToHex(L, 0.15, hue) }).colors
          expect(hoverLift(t, 'accent')).toBeLessThanOrEqual(0.02)
        }
      }
    }
  })

  it('档位升高时文字只会远离表面，不会变暗', () => {
    for (const id of THEME_PRESET_IDS) {
      const dark = THEME_PRESETS[id].seed.mode === 'dark'
      for (const text of ['text2', 'text3'] as const) {
        const ls = [0.8, 1, 1.35, 2].map((contrast) => hexToOklch(deriveThemeTokens({ ...THEME_PRESETS[id].seed, contrast }).colors[text]).L)
        for (let i = 1; i < ls.length; i += 1) {
          if (dark) {
            expect(ls[i]).toBeGreaterThanOrEqual(ls[i - 1] - 1e-9)
          } else {
            expect(ls[i]).toBeLessThanOrEqual(ls[i - 1] + 1e-9)
          }
        }
      }
    }
  })

  it('文字层级保持 text1 > text2 > text3（相对表面的对比度）', () => {
    for (const { seed } of COMBOS) {
      const t = deriveThemeTokens(seed).colors
      expect(contrastRatio(t.text1, t.window)).toBeGreaterThan(contrastRatio(t.text2, t.window))
      expect(contrastRatio(t.text2, t.window)).toBeGreaterThan(contrastRatio(t.text3, t.window))
    }
  })

  it('任意强调色（含落在中灰区的颜色）都能得到达标的实底文字', () => {
    for (const mode of ['dark', 'light'] as const) {
      for (let hue = 0; hue < 360; hue += 30) {
        for (const L of [0.45, 0.55, 0.62, 0.7]) {
          const accent = oklchToHex(L, 0.15, hue)
          const t = deriveThemeTokens({ ...DEFAULT_THEME_SEED, mode, base: mode === 'dark' ? 0.17 : 0.975, accent }).colors
          expect({ accent, mode, ok: minContrast(t.onAccent, visibleSolid(t, 'accent')) >= THEME_TEXT_MIN_CONTRAST }).toEqual({ accent, mode, ok: true })
        }
      }
    }
  })
})

describe('themeEngine 令牌集合', () => {
  it('输出全部令牌，且均为合法颜色；colorScheme 跟随模式', () => {
    for (const { seed } of COMBOS) {
      const tokens = deriveThemeTokens(seed)
      expect(Object.keys(tokens.colors).sort()).toEqual([...THEME_COLOR_TOKEN_NAMES].sort())
      for (const name of THEME_COLOR_TOKEN_NAMES) {
        expect({ name, parsed: parseColor(tokens.colors[name]) !== null }).toEqual({ name, parsed: true })
      }
      expect(tokens.colorScheme).toBe(seed.mode)
      expect(tokens.mode).toBe(seed.mode)
    }
  })

  it('媒体叠层不随主题变化；canvas 默认等于 window；wavePlayed 等于 text1', () => {
    for (const { seed } of COMBOS) {
      const t = deriveThemeTokens(seed).colors
      for (const [name, value] of Object.entries(MEDIA_OVERLAY_TOKENS)) {
        expect(t[name as keyof ThemeColorTokens]).toBe(value)
      }
      expect(t.canvas).toBe(t.window)
      expect(t.wavePlayed).toBe(t.text1)
    }
  })

  it('玻璃按模式派生：浅色主题下是浅底，主要文字压在任何背景上都 ≥ 4.5', () => {
    for (const { seed } of COMBOS) {
      const t = deriveThemeTokens(seed).colors
      const overWhite = compositeOver(t.glassTint, WHITE)
      const overBlack = compositeOver(t.glassTint, 'rgb(0,0,0)')
      expect(contrastRatio(t.text1, overWhite)).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
      expect(contrastRatio(t.text1, overBlack)).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
      if (seed.mode === 'light') {
        expect(hexToOklch(overBlack).L).toBeGreaterThan(0.8)
        expect(parseColor(t.scrim)?.r).toBeGreaterThan(0)
      }
    }
  })

  it('深色玻璃与遮罩保持现有 index.css 数值（第二段接线不改深色观感）', () => {
    const t = deriveThemeTokens(DEFAULT_THEME_SEED).colors
    expect(t.glassTint).toBe('rgba(0,0,0,0.66)')
    expect(t.glassEdge).toBe('rgba(255,255,255,0.16)')
    expect(t.glassHover).toBe('rgba(255,255,255,0.14)')
    expect(t.scrim).toBe('rgba(0,0,0,0.42)')
    expect(t.scrimSoft).toBe('rgba(0,0,0,0.2)')
    expect(t.scrimSolid).toBe('rgba(0,0,0,0.55)')
  })

  it('overrides 逐个覆盖最终值，未知或非字符串值不生效', () => {
    const base = deriveThemeTokens(DEFAULT_THEME_SEED).colors
    const t = deriveThemeTokens(DEFAULT_THEME_SEED, { canvas: base.panel, text1: WHITE }).colors
    expect(t.canvas).toBe(base.panel)
    expect(t.text1).toBe(WHITE)
    expect(t.window).toBe(base.window)
  })

  it('种子规范化：补默认、夹取范围、非法值回落', () => {
    expect(normalizeThemeSeed({ mode: 'light' })).toEqual({ ...DEFAULT_THEME_SEED, mode: 'light' })
    expect(normalizeThemeSeed({ hue: -30, tint: 1, base: 2, contrast: 99 })).toMatchObject({ hue: 330, tint: 0.08, base: 1, contrast: 3 })
    expect(normalizeThemeSeed({ accent: 'red', contrast: Number.NaN })).toMatchObject({
      accent: DEFAULT_THEME_SEED.accent,
      contrast: DEFAULT_THEME_SEED.contrast,
    })
    expect(normalizeThemeSeed(null)).toEqual(DEFAULT_THEME_SEED)
  })
})
