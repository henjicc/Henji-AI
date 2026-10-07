import { describe, expect, it } from 'vitest'

import { WHITE, compositeOver, contrastRatio, deltaEOK, hexToOklch, minContrast, oklchToHex, parseColor, withAlpha } from './themeColor'
import {
  DEFAULT_THEME_SEED,
  MEDIA_OVERLAY_TOKENS,
  THEME_COLOR_TOKEN_NAMES,
  THEME_CONTRAST_LEVELS,
  THEME_PRESETS,
  THEME_PRESET_IDS,
  FLAT_SOLID_STATE_DELTA,
  THEME_TEXT_MIN_CONTRAST,
  deriveThemeTokens,
  normalizeThemeSeed,
  solidLabelBeds,
  solveSolidRamp,
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

/** 扁平实底按钮（重要记录 016）上文字实际所在处：静息、悬停、按下三种纯色。 */
const visibleSolid = (t: ThemeColorTokens, kind: 'accent' | 'danger') =>
  kind === 'accent'
    ? [t.accent, t.accentHover, t.accentPressed]
    : [t.danger, t.dangerHover, t.dangerPressed]

/** 悬停相对静息的亮度变化幅度（扁平按钮的悬停只靠底色变化，必须一眼可见） */
const hoverShift = (t: ThemeColorTokens, kind: 'accent' | 'danger') => {
  const [rest, hover] = visibleSolid(t, kind)
  return Math.abs(hexToOklch(hover).L - hexToOklch(rest).L)
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
    // 记录 010 的实算基于当时的石墨种子（2026-10-07 用户把石墨调亮到 base 0.2、tint 0.003 之前）。
    const graphite010 = referenceDerive({ ...REFERENCE_PRESETS.graphite, tint: 0.006, base: 0.17, contrast: 1 })
    expect(referenceContrast(graphite010.text3, graphite010.selected)).toBeCloseTo(4.33, 2)
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

  it.each(COMBOS)('$id/$level：强调/危险实底按钮在静息、悬停、按下底色上，成功/警示实底上的文字 ≥ 4.5', ({ seed }) => {
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
    }
    for (const id of THEME_PRESET_IDS) {
      const t = tokens(id)
      const referenceL = hexToOklch(referenceDerive(REFERENCE_PRESETS[id]).accent).L
      expect(hexToOklch(t.accent).L).toBeGreaterThanOrEqual(referenceL - 0.04 - 0.003)
      expect(t.onDanger).toBe(WHITE)
    }
  })

  it.each(THEME_PRESET_IDS)('%s：扁平主按钮悬停、按下逐档变化且朝文字更清楚的方向走（重要记录 016）', (id) => {
    const t = deriveThemeTokens(THEME_PRESETS[id].seed).colors
    const [rest, hover, pressed] = visibleSolid(t, 'accent').map((hex) => hexToOklch(hex).L)
    const direction = t.onAccent === WHITE ? -1 : 1
    expect((hover - rest) * direction).toBeGreaterThanOrEqual(FLAT_SOLID_STATE_DELTA.hover - 0.005)
    expect((pressed - hover) * direction).toBeGreaterThan(0)
    expect(minContrast(t.onAccent, visibleSolid(t, 'accent'))).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
  })

  it.each(THEME_PRESET_IDS)('%s：强调文字压在控件层与玻璃（叠在媒体上）的选中淡底上 ≥ 4.5（5.7，纸白曾 4.36 / 3.77）', (id) => {
    const seed = THEME_PRESETS[id].seed
    const t = deriveThemeTokens(seed).colors
    const glassOverMedia = compositeOver(t.glassTint, t.media)
    const beds = [
      ...[t.selectedAccent, t.selectedAccentHover].flatMap((tint) => [t.control, t.controlHover, t.hover].map((bed) => compositeOver(tint, bed))),
      ...[t.selectedAccent, t.selectedAccentHover, t.glassSelectedAccent].map((tint) => compositeOver(tint, glassOverMedia)),
    ]
    expect(minContrast(t.accentText, beds)).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
  })

  it('回归基线：危险实底只判渐变中点时，悬停渐变的标签上端达不到 4.5（5.3 / 5.6 实测 4.28–4.43）', () => {
    const options = { startL: 0.6, floorL: 0, chroma: 0.19, hue: 25, ink: WHITE, allowInk: false } as const
    const midpointOnly = solveSolidRamp(options)
    const band = solveSolidRamp({ ...options, coverage: 'labelBand' })
    const worst = (L: number) => minContrast(WHITE, solidLabelBeds(L, 0.19, 25, 'labelBand'))
    expect(worst(midpointOnly.L)).toBeLessThan(THEME_TEXT_MIN_CONTRAST)
    expect(worst(band.L)).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
    expect(band.L).toBeLessThan(midpointOnly.L)
  })

  it('扁平实底的悬停一眼可见：亮度变化 ≥ 0.05（预设与任意强调色，重要记录 016）', () => {
    for (const { seed } of COMBOS) {
      const t = deriveThemeTokens(seed).colors
      expect(hoverShift(t, 'accent')).toBeGreaterThanOrEqual(0.05)
      expect(hoverShift(t, 'danger')).toBeGreaterThanOrEqual(0.05)
    }
    for (const mode of ['dark', 'light'] as const) {
      for (let hue = 0; hue < 360; hue += 30) {
        for (const L of [0.45, 0.55, 0.62, 0.7]) {
          const t = deriveThemeTokens({ ...DEFAULT_THEME_SEED, mode, base: mode === 'dark' ? 0.17 : 0.975, accent: oklchToHex(L, 0.15, hue) }).colors
          expect(hoverShift(t, 'accent')).toBeGreaterThanOrEqual(0.05)
          expect(minContrast(t.onAccent, visibleSolid(t, 'accent'))).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
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
    expect(t.glassTint).toBe('rgba(0,0,0,0.72)') // 4.3：由 0.66 提到 0.72，辅助文字在玻璃上 ≥ 4.5
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

describe('选中淡强调底（重要记录 012，任务 4.3）', () => {
  it.each(THEME_PRESET_IDS)('%s：选中与悬停、静息一眼可辨，选中文字 ≥ 4.5，字段悬停与静息可辨', (id) => {
    const t = deriveThemeTokens(THEME_PRESETS[id].seed).colors
    for (const bed of [t.panel, t.raised]) {
      const selected = compositeOver(t.selectedAccent, bed)
      const selectedHover = compositeOver(t.selectedAccentHover, bed)
      // 悬停只用中性抬升；选中与悬停不得同色
      expect(deltaEOK(selected, t.hover)).toBeGreaterThanOrEqual(0.03)
      expect(deltaEOK(selected, bed)).toBeGreaterThanOrEqual(0.06)
      expect(deltaEOK(selectedHover, selected)).toBeGreaterThanOrEqual(0.015)
      for (const surface of [selected, selectedHover]) {
        expect(contrastRatio(t.accentText, surface)).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
        expect(contrastRatio(t.text1, surface)).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
        // 选中导航/菜单项里的次要与辅助文字（如许可列表的版本号）
        expect(contrastRatio(t.text2, surface)).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
        expect(contrastRatio(t.text3, surface)).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
      }
    }
    // 字段触发器悬停改 control-hover：与 raised 静息拉开（原 hover 只差 0.012–0.017）
    expect(deltaEOK(t.raised, t.controlHover)).toBeGreaterThanOrEqual(0.03)
  })
})

describe('深色玻璃面辅助文字（任务 4.3）', () => {
  it.each(THEME_PRESET_IDS)('%s：玻璃下是中灰内容时，辅助文字在玻璃上 ≥ 4.5（纸白玻璃为浅底，另行断言不变）', (id) => {
    const t = deriveThemeTokens(THEME_PRESETS[id].seed).colors
    if (THEME_PRESETS[id].seed.mode === 'dark') {
      // 中灰内容（OKLab L 0.6 ≈ sRGB #808080）压在玻璃下
      const glassBed = compositeOver(t.glassTint, oklchToHex(0.6, 0, 0))
      expect(contrastRatio(t.text3, glassBed)).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
      for (const surface of [t.window, t.panel, t.raised, t.selected]) {
        expect(contrastRatio(t.text3, compositeOver(t.glassTint, surface))).toBeGreaterThanOrEqual(THEME_TEXT_MIN_CONTRAST)
      }
    } else {
      expect(t.glassTint).toBe(withAlpha(t.panel, 0.82))
    }
  })
})
