import quantize from 'quantize'
import { DEFAULT_STYLE_TOKENS, styleKitSchema, type StyleKit, type StyleTokens } from './styleKit'
import type { CodeColor, CodeParameterValues } from './codeMaterial/contract'
import { CODE_EASE_NAMES } from './codeMaterial/motion'

export interface StylePaletteCluster { color: CodeColor; weight: number }
export function styleLuminance(value: CodeColor): number { const channels = value.slice(0, 3).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4); return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 }
export function styleContrast(a: CodeColor, b: CodeColor): number { const x = styleLuminance(a); const y = styleLuminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
const distance = (a: readonly number[], b: readonly number[]): number => a.slice(0, 3).reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0)
/** 128² sampled pixels bounds quantizer/histogram memory; not an input image size limit. */
export function extractStylePalettePixels(pixels: Uint8ClampedArray | Uint8Array): StylePaletteCluster[] {
  if (!pixels.length || pixels.length % 4 || pixels.length > 128 * 128 * 4) throw new Error('请提供最多 128×128 的 RGBA 采样面。')
  const samples: number[][] = []; const alphas: number[] = []
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] >= 26) { samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]); alphas.push(pixels[i + 3] / 255) }
  if (!samples.length) throw new Error('参考图完全透明，无法提取配色。')
  const unique = [...new Map(samples.map(sample => [sample.join(','), sample])).values()]
  const map = unique.length < 2 ? false : quantize(samples, Math.min(8, unique.length))
  const colors = unique.length < 2 ? unique : map ? map.palette() : undefined
  if (!colors?.length) throw new Error('参考图配色提取失败，请换一张参考。')
  const weights = colors.map(() => 0); const sums = colors.map(() => [0, 0, 0]); let total = 0
  samples.forEach((sample, index) => { const nearest = colors.reduce((best, value, i) => distance(value, sample) < distance(colors[best], sample) ? i : best, 0); const weight = alphas[index]; total += weight; weights[nearest] += weight; for (let c = 0; c < 3; c++) sums[nearest][c] += sample[c] * weight })
  return colors.flatMap((_, i) => weights[i] ? [{ color: [...sums[i].map(value => value / weights[i] / 255), 1] as CodeColor, weight: weights[i] / total }] : []).sort((a, b) => b.weight - a.weight)
}
export function stylePaletteFromClusters(clusters: readonly StylePaletteCluster[]): StyleTokens['palette'] {
  if (!clusters.length) throw new Error('没有可用配色。')
  const ranked = [...clusters].sort((a, b) => b.weight - a.weight); const bg = ranked[0].color
  const neutralDark: CodeColor = [.025, .03, .035, 1]; const neutralLight: CodeColor = [.98, .98, .97, 1]
  const candidates = [...ranked.map(value => value.color), neutralDark, neutralLight]
  const fg = candidates.reduce((best, color) => styleContrast(bg, color) > styleContrast(bg, best) ? color : best)
  const contrasting = ranked.filter(value => styleContrast(bg, value.color) >= 3 && distance(bg, value.color) > .02)
  const saturation = (color: CodeColor): number => Math.max(...color.slice(0, 3)) - Math.min(...color.slice(0, 3))
  const accent = [...contrasting].sort((a, b) => saturation(b.color) * Math.sqrt(b.weight) - saturation(a.color) * Math.sqrt(a.weight))[0]?.color ?? fg
  const accent2 = contrasting.find(value => distance(value.color, accent) > .05)?.color ?? accent
  const surface = bg.map((value, i) => i === 3 ? 1 : value * .9 + fg[i] * .1) as CodeColor
  // Pick the nearest muted blend that preserves normal-text contrast.
  let muted = [...fg] as CodeColor
  for (let factor = .55; factor <= 1; factor += .05) { const color = bg.map((value, i) => i === 3 ? 1 : value * (1 - factor) + fg[i] * factor) as CodeColor; if (styleContrast(surface, color) >= 4.5) { muted = color; break } }
  return { ...structuredClone(DEFAULT_STYLE_TOKENS.palette), bg: [...bg], surface, fg: [...fg], muted, accent: [...accent], accent2: [...accent2] }
}
export interface StyleWorkObservation { height: number; fonts: Array<{ family: string; weight: number; size: number }>; colors: CodeColor[]; colorRoles?: Partial<StyleTokens['palette']>; parameters?: CodeParameterValues; enterSeconds?: number; exitSeconds?: number; ease?: string; radius?: number; strokeWidth?: number }
const most = <T>(values: T[], fallback: T): T => { const map = new Map<string, { value: T; count: number }>(); for (const value of values) { const key = JSON.stringify(value); const found = map.get(key); map.set(key, { value, count: (found?.count ?? 0) + 1 }) } return [...map.values()].sort((a, b) => b.count - a.count)[0]?.value ?? fallback }
const median = (values: number[], fallback: number): number => { const sorted = values.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : fallback }
/** Aggregation never invents hard-coded model/style branches or product count limits. */
export function extractStyleFromWork(observations: readonly StyleWorkObservation[], base: StyleKit, name: string): StyleKit {
  const tokens = structuredClone(base.tokens)
  const fonts = observations.flatMap(value => value.fonts)
  if (fonts.length) {
    const body = most(fonts.filter(font => font.size <= median(fonts.map(value => value.size), 36)), fonts[0])
    const display = most(fonts.filter(font => font.size > body.size), body)
    tokens.fonts.body = { family: body.family, weight: body.weight }; tokens.fonts.display = { family: display.family, weight: display.weight }
    tokens.typeScale.baseSize = Math.min(.1, Math.max(.001, median(observations.flatMap(value => value.fonts.map(font => font.size / value.height)), tokens.typeScale.baseSize)))
  }
  const colors = observations.flatMap(value => value.colors)
  const counts = new Map<string, StylePaletteCluster>()
  for (const color of colors) { const key = JSON.stringify(color); const entry = counts.get(key); counts.set(key, { color, weight: (entry?.weight ?? 0) + 1 }) }
  if (counts.size) tokens.palette = stylePaletteFromClusters([...counts.values()])
  for (const role of Object.keys(tokens.palette) as Array<keyof StyleTokens['palette']>) {
    const values = observations.flatMap(value => value.colorRoles?.[role] ? [value.colorRoles[role]!] : [])
    if (values.length) tokens.palette[role] = most(values, tokens.palette[role])
  }
  // Text counts are not pixel coverage: retain a readable stage around an observed foreground.
  if (observations.some(value => value.colorRoles?.fg) && !observations.some(value => value.colorRoles?.bg)) {
    const bg = styleContrast(base.tokens.palette.bg, tokens.palette.fg) >= 4.5 ? base.tokens.palette.bg : stylePaletteFromClusters([{ color: tokens.palette.fg, weight: 1 }]).fg
    const stage = stylePaletteFromClusters([{ color: bg, weight: 1 }])
    tokens.palette.bg = [...bg]
    if (!observations.some(value => value.colorRoles?.surface)) tokens.palette.surface = stage.surface
    tokens.palette.muted = stage.muted
  }
  const numberParams = (key: string): number[] => observations.flatMap(value => typeof value.parameters?.[key] === 'number' ? [value.parameters[key] as number] : [])
  tokens.motion.enterDuration = median([...observations.flatMap(value => value.enterSeconds ? [value.enterSeconds] : []), ...numberParams('enterDuration')], tokens.motion.enterDuration)
  tokens.motion.exitDuration = median([...observations.flatMap(value => value.exitSeconds ? [value.exitSeconds] : []), ...numberParams('exitDuration')], tokens.motion.exitDuration)
  tokens.motion.stagger = median(numberParams('stagger'), tokens.motion.stagger)
  const eases = observations.flatMap(value => [value.ease, value.parameters?.enterEase].filter((ease): ease is string => typeof ease === 'string' && CODE_EASE_NAMES.includes(ease)))
  tokens.motion.enterEase = most(eases, tokens.motion.enterEase)
  tokens.motion.allowOvershoot ||= ['backOut', 'elasticOut', 'bounceOut'].includes(tokens.motion.enterEase)
  tokens.shape.radius = Math.min(1, median(observations.flatMap(value => value.radius ? [value.radius / value.height] : []), tokens.shape.radius))
  tokens.shape.strokeWidth = Math.min(1, median(observations.flatMap(value => value.strokeWidth ? [value.strokeWidth / value.height] : []), tokens.shape.strokeWidth))
  return styleKitSchema.parse({ ...base, id: crypto.randomUUID(), revision: 0, name, tokens, rules: `${base.rules}\n\n## 当前作品提取\n字体、颜色与动效从当前序列聚合得到；先预览并确认角色分配。助手可补充气质和做/不做，未经确认不覆盖作品。` })
}
