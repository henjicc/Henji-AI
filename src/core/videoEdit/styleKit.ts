import { codeMaterialFilesSchema, codeSourceTextSchema } from './codeMaterial/sources'
import { z } from 'zod'
import type { CodeColor } from './codeMaterial/contract'
import { CODE_EASE_NAMES } from './codeMaterial/motion'
import type { VideoEditTextStyle } from './text'

const unit = z.number().finite().min(0).max(1)
const color = z.tuple([unit, unit, unit, unit])
export const STYLE_PALETTE_KEYS = ['bg', 'surface', 'fg', 'muted', 'accent', 'accent2', 'positive', 'negative'] as const
export const STYLE_FONT_KEYS = ['display', 'body', 'mono'] as const
export const STYLE_TYPE_KEYS = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'display'] as const
const font = z.object({ family: z.string().trim().min(1).max(200).regex(/^[^\r\n;{}]+$/u), weight: z.number().int().min(1).max(1000) }).strict()
const ease = z.string().refine(value => CODE_EASE_NAMES.includes(value), '请选择作者语言支持的缓动。')
const defaultPalette = { bg: [.043, .051, .071, 1], surface: [.08, .094, .118, 1], fg: [.949, .957, .969, 1], muted: [.62, .66, .71, 1], accent: [.4, .66, .94, 1], accent2: [.7, .78, .88, 1], positive: [.23, .7, .53, 1], negative: [.9, .35, .36, 1] }
const typeScale = z.object({ baseSize: z.number().finite().min(.001).max(.1).default(36 / 1080), ratio: z.number().finite().min(1.05).max(2).default(1.333) }).strict()
export const styleTokensSchema = z.object({
  palette: z.object(Object.fromEntries(STYLE_PALETTE_KEYS.map(key => [key, color.default(defaultPalette[key] as CodeColor)])) as Record<typeof STYLE_PALETTE_KEYS[number], z.ZodDefault<typeof color>>).strict().default(() => defaultPalette as Record<typeof STYLE_PALETTE_KEYS[number], CodeColor>),
  fonts: z.object({ display: font.default({ family: 'sans-serif', weight: 600 }), body: font.default({ family: 'sans-serif', weight: 400 }), mono: font.default({ family: 'monospace', weight: 500 }) }).strict().default(() => ({ display: { family: 'sans-serif', weight: 600 }, body: { family: 'sans-serif', weight: 400 }, mono: { family: 'monospace', weight: 500 } })),
  typeScale: typeScale.prefault({}),
  shape: z.object({ radius: unit.default(.018), strokeWidth: unit.default(.002), spacing1: unit.default(.012), spacing2: unit.default(.024), spacing3: unit.default(.04) }).strict().prefault({}),
  motion: z.object({ enterDuration: z.number().finite().positive().default(.7), exitDuration: z.number().finite().positive().default(.45), stagger: z.number().finite().nonnegative().default(.08), enterEase: ease.default('expoOut'), exitEase: ease.default('cubicIn'), moveEase: ease.default('cubicInOut'), allowOvershoot: z.boolean().default(false) }).strict().prefault({}),
  texture: z.object({ grain: unit.default(.02), vignette: unit.default(0), glowIntensity: z.number().finite().min(0).max(16).default(0) }).strict().prefault({}),
  layout: z.object({ safeMargin: z.number().finite().min(0).max(.45).default(.08), grid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(12) }).strict().prefault({}),
}).strict().superRefine((value, context) => { if (!value.motion.allowOvershoot && [value.motion.enterEase, value.motion.exitEase, value.motion.moveEase].some(name => ['backOut', 'elasticOut', 'bounceOut'].includes(name))) context.addIssue({ code: 'custom', path: ['motion', 'allowOvershoot'], message: '此缓动会回弹，请允许回弹或选择平稳曲线。' }) })
/** Derived steps are never stored: they follow baseSize × ratio^(step − 2), so schemas stay JSON-Schema representable for tools. */
export type StyleTypeScale = { baseSize: number; ratio: number } & Record<typeof STYLE_TYPE_KEYS[number], number>
export function resolveStyleTypeScale<T extends { typeScale: { baseSize: number; ratio: number } }>(tokens: T): T & { typeScale: StyleTypeScale } {
  const { baseSize, ratio } = tokens.typeScale
  return { ...tokens, typeScale: { ...tokens.typeScale, ...Object.fromEntries(STYLE_TYPE_KEYS.map((key, index) => [key, baseSize * ratio ** (index - 2)])) } as StyleTypeScale }
}
export type StyleTokens = z.infer<typeof styleTokensSchema>
export const DEFAULT_STYLE_TOKENS: StyleTokens = styleTokensSchema.parse({})
export const styleKitSampleSchema = z.object({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), kind: z.enum(['title', 'lower_third', 'chapter', 'emphasis', 'data', 'transition']), source: z.union([codeSourceTextSchema, codeMaterialFilesSchema]) }).strict()
export const styleKitContentSchema = z.object({ tokens: styleTokensSchema.prefault({}), rules: z.string().default(''), samples: z.array(styleKitSampleSchema).default([]) }).strict().superRefine((value, context) => { if (new Set(value.samples.map(sample => sample.id)).size !== value.samples.length) context.addIssue({ code: 'custom', path: ['samples'], message: '样例标识不能重复。' }) })
export const styleKitSchema = styleKitContentSchema.safeExtend({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), revision: z.number().int().nonnegative().default(0) })
export type StyleKit = z.infer<typeof styleKitSchema>
export type StyleKitContent = z.infer<typeof styleKitContentSchema>
export function styleKitContent(kit: StyleKit): StyleKitContent { return { tokens: structuredClone(kit.tokens), rules: kit.rules, samples: structuredClone(kit.samples) } }
export function styleKitRenderKey(kit?: StyleKit): string { return JSON.stringify(kit ? [kit.id, kit.revision, kit.tokens] : DEFAULT_STYLE_TOKENS) }
/** Portable style snapshot; a local-library deletion never invalidates project references. */
export function resolveVideoEditStyleKit(document: { styleKits?: StyleKit[] }, sequence: { styleKitId?: string }, clip?: { styleKitId?: string }): StyleKit | undefined {
  const id = clip?.styleKitId ?? sequence.styleKitId
  if (!id) return undefined
  const kit = document.styleKits?.find(value => value.id === id)
  if (!kit) throw new Error('绑定的风格包不存在，请读取本工程风格包后重新绑定。')
  return kit
}
export function styleColorCss(value: CodeColor): string { return `rgb(${value.slice(0, 3).map(channel => Math.round(channel * 255)).join(' ')} / ${value[3]})` }
export function styleColorHex(value: CodeColor): string { return '#' + value.slice(0, 3).map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('') }
export function styleColorFromHex(value: string, alpha = 1): CodeColor { if (!/^#[\da-f]{6}$/iu.test(value)) throw new Error('颜色须为六位 RGB。'); return color.parse([1, 3, 5].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255).concat(alpha)) }
/** Pure recommendation only: text/title/graphic consumers are owned by t69. */
export function recommendedStyleKitText(kit: StyleKit, height: number, role: 'display' | 'body' | 'mono' = 'body'): Pick<VideoEditTextStyle, 'fontFamily' | 'fontWeight' | 'fontSize' | 'fill' | 'leading'> {
  if (!Number.isFinite(height) || height <= 0) throw new Error('请提供实际画面高度。')
  const tokens = styleTokensSchema.parse(kit.tokens)
  const fontSize = Math.max(1, Math.min(8192, height * resolveStyleTypeScale(tokens).typeScale[role === 'display' ? 'xl' : 'md']))
  return { fontFamily: tokens.fonts[role].family, fontWeight: tokens.fonts[role].weight, fontSize, fill: { enabled: true, color: styleColorHex(tokens.palette.fg) }, leading: Math.min(8192, fontSize * (role === 'display' ? 1.1 : 1.5)) }
}
