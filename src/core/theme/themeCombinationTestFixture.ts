/**
 * 主题组合属性测试的判定集合（任务 5.11，只供测试使用）。
 *
 * 对一组派生令牌检查界面实际会出现的“文字压在哪里”：三档文字、强调文字、选中淡底上的文字、
 * 实底按钮（静息与悬停渐变的标签区间两端）上的文字、玻璃面上的文字、状态文字，以及选中与悬停可区分。
 * 门槛与 themeEngine 求解共用（文字 THEME_TEXT_MIN_CONTRAST、选中/悬停色差 SELECTION_MIN_DELTA），这里只把判定
 * 从“四个预设”推广到任意“预设 × 强调色 × 层级对比度”组合。
 */
import { compositeOver, contrastRatio, deltaEOK, hexToOklch, oklchToHex } from './themeColor'
import { SELECTION_MIN_DELTA, THEME_TEXT_MIN_CONTRAST, type ThemeColorTokens, type ThemeTokens } from './themeEngine'

export interface ThemeCombinationViolation {
  check: string
  detail: string
}

const SURFACE_TEXT_BEDS = ['window', 'panel', 'raised', 'hover', 'selected', 'control', 'controlHover'] as const
const TEXTS = ['text1', 'text2', 'text3'] as const


export function checkThemeCombination(tokens: ThemeTokens): ThemeCombinationViolation[] {
  const t: ThemeColorTokens = tokens.colors
  const dark = tokens.mode === 'dark'
  const violations: ThemeCombinationViolation[] = []

  const need = (check: string, text: string, beds: Array<[string, string]>) => {
    for (const [bedName, bed] of beds) {
      const ratio = contrastRatio(text, bed)
      if (ratio < THEME_TEXT_MIN_CONTRAST) {
        violations.push({ check, detail: `${text} 压在 ${bedName}(${bed}) 上 ${ratio.toFixed(2)}:1` })
        return
      }
    }
  }

  const surfaceBeds = SURFACE_TEXT_BEDS.map((name) => [name, t[name]] as [string, string])
  const selectedBeds = (['selectedAccent', 'selectedAccentHover'] as const).flatMap((tint) =>
    (['window', 'panel', 'raised'] as const).map((bed) => [`${tint}/${bed}`, compositeOver(t[tint], t[bed])] as [string, string]))
  const controlSelectedBeds = (['selectedAccent', 'selectedAccentHover'] as const).flatMap((tint) =>
    (['control', 'controlHover', 'hover'] as const).map((bed) => [`${tint}/${bed}`, compositeOver(t[tint], t[bed])] as [string, string]))
  const glassOverMedia = compositeOver(t.glassTint, t.media)
  const glassSelectedBeds = (['selectedAccent', 'selectedAccentHover', 'glassSelectedAccent'] as const)
    .map((tint) => [`${tint}/玻璃叠媒体`, compositeOver(t[tint], glassOverMedia)] as [string, string])
  const glassBeds: Array<[string, string]> = [
    ...(['window', 'panel', 'raised', 'selected'] as const).map((bed) => [`玻璃/${bed}`, compositeOver(t.glassTint, t[bed])] as [string, string]),
    ...(dark ? [['玻璃/中灰内容', compositeOver(t.glassTint, oklchToHex(0.6, 0, 0))] as [string, string]] : []),
  ]

  // 三档文字：承载表面、选中淡底、玻璃面
  for (const text of TEXTS) {
    need(`${text} 表面`, t[text], surfaceBeds)
    need(`${text} 选中底`, t[text], selectedBeds)
    need(`${text} 玻璃`, t[text], glassBeds)
  }
  // 强调文字：表面、选中淡底、控件层选中、玻璃叠媒体的选中
  need('accentText', t.accentText, [...surfaceBeds, ...selectedBeds, ...controlSelectedBeds, ...glassSelectedBeds])
  // 状态文字：表面与自身浅底
  for (const [text, tint] of [['dangerText', 'dangerTint'], ['successText', 'successTint'], ['warningText', 'warningTint']] as const) {
    need(text, t[text], [
      ...surfaceBeds,
      ...(['window', 'panel', 'raised'] as const).map((bed) => [`${tint}/${bed}`, compositeOver(t[tint], t[bed])] as [string, string]),
    ])
  }
  // 实底按钮：强调主按钮静息渐变中点 + 悬停渐变标签区间两端；危险确认按钮静息、悬停都取两端
  // 扁平实底（重要记录 016）：静息、悬停、按下三种纯色
  need('onAccent 实底', t.onAccent, [['静息', t.accent], ['悬停', t.accentHover], ['按下', t.accentPressed]])
  need('onDanger 实底', t.onDanger, [['静息', t.danger], ['悬停', t.dangerHover], ['按下', t.dangerPressed]])
  need('onSuccess', t.onSuccess, [['success', t.success]])
  need('onWarning', t.onWarning, [['warning', t.warning]])

  // 选中与悬停、静息可区分；选中项悬停再加一档
  for (const bedName of ['panel', 'raised'] as const) {
    const bed = t[bedName]
    const selected = compositeOver(t.selectedAccent, bed)
    const selectedHover = compositeOver(t.selectedAccentHover, bed)
    const pairs: Array<[string, number, number]> = [
      [`选中≠悬停(${bedName})`, deltaEOK(selected, t.hover), SELECTION_MIN_DELTA.vsHover],
      [`选中≠静息(${bedName})`, deltaEOK(selected, bed), SELECTION_MIN_DELTA.vsRest],
      [`选中悬停≠选中(${bedName})`, deltaEOK(selectedHover, selected), SELECTION_MIN_DELTA.hoverVsSelected],
    ]
    for (const [check, delta, min] of pairs) {
      if (delta < min) violations.push({ check, detail: `ΔE ${delta.toFixed(4)} < ${min}` })
    }
  }
  // 扁平实底主按钮悬停一眼可见：悬停与静息的亮度差 ≥ 0.05（重要记录 016）
  const shift = Math.abs(hexToOklch(t.accentHover).L - hexToOklch(t.accent).L)
  if (!(shift >= 0.05)) violations.push({ check: '实底悬停可见', detail: `悬停亮度变化 ${shift.toFixed(4)}` })

  return violations
}
