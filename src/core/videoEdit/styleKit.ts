import { codeMaterialFilesSchema, codeSourceTextSchema } from './codeMaterial/sources'
import { z } from 'zod'
import type { CodeColor } from './codeMaterial/contract'
import { CODE_EASE_NAMES } from './codeMaterial/motion'
import { videoEditBezierSchema, type VideoEditBezier } from './keyframeInterpolation'
import { defaultVideoEditTextStyle, type VideoEditTextStyle } from './text'

const unit = z.number().finite().min(0).max(1)
const color = z.tuple([unit, unit, unit, unit])
export const STYLE_PALETTE_KEYS = ['bg', 'surface', 'fg', 'muted', 'accent', 'accent2', 'positive', 'negative'] as const
export const STYLE_FONT_KEYS = ['display', 'body', 'mono'] as const
export const STYLE_TYPE_KEYS = ['xs', 'sm', 'md', 'lg', 'xl', 'xxl', 'display'] as const
/** Motion roles share one curve vocabulary across code, keyframes and title templates. */
export const STYLE_MOTION_ROLES = ['enter', 'exit', 'move', 'emphasis', 'transition'] as const
export type StyleMotionRole = typeof STYLE_MOTION_ROLES[number]
export const STYLE_STRENGTHS = ['must', 'prefer', 'flexible'] as const
export const STYLE_RULE_KINDS = ['do', 'dont', 'keep', 'vary'] as const
const OVERSHOOT_EASES = ['backOut', 'elasticOut', 'bounceOut']
const font = z.object({ family: z.string().trim().min(1).max(200).regex(/^[^\r\n;{}]+$/u), weight: z.number().int().min(1).max(1000) }).strict()
/** Same value shape as the code `easing` parameter: a public curve name or a cubic Bézier. */
export const styleEasingSchema = z.union([z.enum(CODE_EASE_NAMES as [string, ...string[]]), videoEditBezierSchema]).describe('缓动名，或三次贝塞尔 [x1,y1,x2,y2]（x 在 0–1；y 超出 0–1 即回弹）。')
export type StyleEasing = z.infer<typeof styleEasingSchema>
export function styleEasingOvershoots(value: StyleEasing): boolean { return typeof value === 'string' ? OVERSHOOT_EASES.includes(value) : [value[1], value[3]].some(y => y < 0 || y > 1) }
const defaultPalette = { bg: [.043, .051, .071, 1], surface: [.08, .094, .118, 1], fg: [.949, .957, .969, 1], muted: [.62, .66, .71, 1], accent: [.4, .66, .94, 1], accent2: [.7, .78, .88, 1], positive: [.23, .7, .53, 1], negative: [.9, .35, .36, 1] }
const typeScale = z.object({ baseSize: z.number().finite().min(.001).max(.1).default(36 / 1080), ratio: z.number().finite().min(1.05).max(2).default(1.333) }).strict()
const seconds = z.number().finite().positive()
export const styleMotionSchema = z.object({
  enterDuration: seconds.default(.7), exitDuration: seconds.default(.45), emphasisDuration: seconds.default(.35), transitionDuration: seconds.default(.5),
  stagger: z.number().finite().nonnegative().default(.08).describe('同组元素依次出现的间隔秒数。'),
  enterEase: styleEasingSchema.default('expoOut'), exitEase: styleEasingSchema.default('cubicIn'), moveEase: styleEasingSchema.default('cubicInOut'), emphasisEase: styleEasingSchema.default('quartOut'), transitionEase: styleEasingSchema.default('cubicInOut'),
  allowOvershoot: z.boolean().default(false),
  travel: unit.default(.04).describe('入场/出场位移幅度，占画面高度比例。'),
  settle: z.boolean().default(true).describe('落地后完全静止，不持续漂浮或呼吸。'),
  readingSpeed: z.number().finite().positive().max(40).default(6).describe('每秒可读字数（中文按字、英文按词），据此推算停留时长。'),
  minHold: z.number().finite().nonnegative().max(60).default(1.2).describe('读完后至少再停留的秒数。'),
  sync: z.enum(['speech', 'beat', 'free']).default('speech').describe('动作落点对齐：speech 语句与关键词、beat 音乐节拍、free 不约束。'),
}).strict()
export const styleTokensSchema = z.object({
  palette: z.object(Object.fromEntries(STYLE_PALETTE_KEYS.map(key => [key, color.default(defaultPalette[key] as CodeColor)])) as Record<typeof STYLE_PALETTE_KEYS[number], z.ZodDefault<typeof color>>).strict().default(() => defaultPalette as Record<typeof STYLE_PALETTE_KEYS[number], CodeColor>),
  fonts: z.object({ display: font.default({ family: 'sans-serif', weight: 600 }), body: font.default({ family: 'sans-serif', weight: 400 }), mono: font.default({ family: 'monospace', weight: 500 }) }).strict().default(() => ({ display: { family: 'sans-serif', weight: 600 }, body: { family: 'sans-serif', weight: 400 }, mono: { family: 'monospace', weight: 500 } })),
  typeScale: typeScale.prefault({}),
  shape: z.object({ radius: unit.default(.018), strokeWidth: unit.default(.002), spacing1: unit.default(.012), spacing2: unit.default(.024), spacing3: unit.default(.04) }).strict().prefault({}),
  motion: styleMotionSchema.prefault({}),
  texture: z.object({ grain: unit.default(.02), vignette: unit.default(0), glowIntensity: z.number().finite().min(0).max(16).default(0) }).strict().prefault({}),
  layout: z.object({ safeMargin: z.number().finite().min(0).max(.45).default(.08), grid: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(12) }).strict().prefault({}),
}).strict().superRefine((value, context) => { if (!value.motion.allowOvershoot && STYLE_MOTION_ROLES.some(role => styleEasingOvershoots(value.motion[`${role}Ease`]))) context.addIssue({ code: 'custom', path: ['motion', 'allowOvershoot'], message: '此缓动会回弹，请允许回弹或选择平稳曲线。' }) })
/** Derived steps are never stored: they follow baseSize × ratio^(step − 2), so schemas stay JSON-Schema representable for tools. */
export type StyleTypeScale = { baseSize: number; ratio: number } & Record<typeof STYLE_TYPE_KEYS[number], number>
export function resolveStyleTypeScale<T extends { typeScale: { baseSize: number; ratio: number } }>(tokens: T): T & { typeScale: StyleTypeScale } {
  const { baseSize, ratio } = tokens.typeScale
  return { ...tokens, typeScale: { ...tokens.typeScale, ...Object.fromEntries(STYLE_TYPE_KEYS.map((key, index) => [key, baseSize * ratio ** (index - 2)])) } as StyleTypeScale }
}
export type StyleTokens = z.infer<typeof styleTokensSchema>
export const DEFAULT_STYLE_TOKENS: StyleTokens = styleTokensSchema.parse({})
const id = z.string().min(1).max(100)
const strength = z.enum(STYLE_STRENGTHS).default('prefer').describe('must 违反即返工；prefer 默认遵守，偏离要说明理由；flexible 可破例，需写明情形。')
/** An abstract word is stored only with checkable criteria, so the assistant can execute and self-review it. */
export const styleConceptSchema = z.object({
  id, name: z.string().trim().min(1).max(40).describe('概念名，例如“呼吸感”。'),
  meaning: z.string().trim().min(1).max(400).describe('一句话含义。'),
  criteria: z.array(z.string().trim().min(1).max(200)).min(1).describe('取帧或读回即可判断的判据，至少一条。'),
  tendencies: z.string().trim().max(400).default('').describe('对应的参数倾向，例如时长档、错峰、留白。'),
  positive: z.string().trim().max(400).default('').describe('正例描述。'), negative: z.string().trim().max(400).default('').describe('反例描述。'),
  strength, exceptions: z.string().trim().max(400).default('').describe('可以破例的情形；空表示不破例。'),
}).strict()
export const styleRuleSchema = z.object({
  id, kind: z.enum(STYLE_RULE_KINDS).describe('do 要做；dont 不做；keep 全片必须统一的项；vary 允许变化的项与范围。'),
  text: z.string().trim().min(1).max(400), strength, scope: z.string().trim().max(200).default('').describe('适用范围或破例条件；空表示全片。'),
}).strict()
export const styleProfileSchema = z.object({
  summary: z.string().trim().max(500).default('').describe('一句话定位。'),
  scenarios: z.array(z.string().trim().min(1).max(80)).default([]).describe('适用场景，助手据此推荐风格。'),
  concepts: z.array(styleConceptSchema).default([]),
}).strict()
const shotSeconds = z.object({ min: seconds, max: seconds }).strict().refine(value => value.min <= value.max, '镜头时长下限不能大于上限。')
/** Optional editing rhythm. `auto` and null mean “not constrained”, never a hidden default behaviour. */
export const styleRhythmSchema = z.object({
  shotSeconds: shotSeconds.nullable().default(null).describe('镜头时长区间（秒）；null 不约束。'),
  cutOn: z.enum(['auto', 'speech', 'beat', 'action']).default('auto').describe('切点：语句、音乐节拍、动作；auto 不约束。'),
  transition: z.enum(['auto', 'cut', 'dissolve', 'match', 'wipe', 'zoom']).default('auto').describe('主转场语法；auto 不约束。'),
  sfx: z.enum(['auto', 'none', 'sparse', 'rich']).default('auto').describe('音效密度；auto 不约束。'),
  musicDucking: z.enum(['auto', 'on', 'off']).default('auto').describe('人声时压低背景音乐；auto 不约束。'),
  notes: z.string().trim().max(1000).default(''),
}).strict()
export const styleGenerationSchema = z.object({
  inject: z.boolean().default(true).describe('剪辑就地生成图片/视频时是否把本风格并入提示词。'),
  prompt: z.string().trim().max(1000).default('').describe('附加到生成提示词的风格描述；空则由定位、概念与配色自动组成。'),
}).strict()
export const STYLE_CAPTION_TREATMENTS = ['outline', 'plate', 'pop'] as const
export const styleCaptionSchema = z.object({
  treatment: z.enum(STYLE_CAPTION_TREATMENTS).default('outline').describe('字幕处理：outline 描边字（干净通用），plate 半透明底板（信息类、复杂画面），pop 粗描边硬投影大字（综艺花字）。'),
}).strict()
export const STYLE_SAMPLE_KINDS = ['title', 'lower_third', 'chapter', 'emphasis', 'data', 'transition', 'caption'] as const
export const styleKitSampleSchema = z.object({ id, name: z.string().trim().min(1).max(200), kind: z.enum(STYLE_SAMPLE_KINDS), source: z.union([codeSourceTextSchema, codeMaterialFilesSchema]) }).strict()
const unique = (values: ReadonlyArray<{ id: string }>): boolean => new Set(values.map(value => value.id)).size === values.length
export const styleKitContentSchema = z.object({
  profile: styleProfileSchema.prefault({}), tokens: styleTokensSchema.prefault({}), rhythm: styleRhythmSchema.prefault({}),
  rules: z.array(styleRuleSchema).default([]), notes: z.string().max(20000).default('').describe('补充说明（Markdown），不替代结构化规则。'),
  caption: styleCaptionSchema.prefault({}),
  generation: styleGenerationSchema.prefault({}), samples: z.array(styleKitSampleSchema).default([]),
}).strict().superRefine((value, context) => {
  if (!unique(value.samples)) context.addIssue({ code: 'custom', path: ['samples'], message: '样例标识不能重复。' })
  if (!unique(value.rules)) context.addIssue({ code: 'custom', path: ['rules'], message: '规则标识不能重复。' })
  if (!unique(value.profile.concepts)) context.addIssue({ code: 'custom', path: ['profile', 'concepts'], message: '概念标识不能重复。' })
})
export const styleKitSchema = styleKitContentSchema.safeExtend({ id, name: z.string().trim().min(1).max(200), revision: z.number().int().nonnegative().default(0) })
export type StyleKit = z.infer<typeof styleKitSchema>
export type StyleKitContent = z.infer<typeof styleKitContentSchema>
export type StyleConcept = z.infer<typeof styleConceptSchema>
export type StyleRule = z.infer<typeof styleRuleSchema>
export type StyleRhythm = z.infer<typeof styleRhythmSchema>
export function styleKitContent(kit: StyleKit): StyleKitContent { return { profile: structuredClone(kit.profile), tokens: structuredClone(kit.tokens), rhythm: structuredClone(kit.rhythm), rules: structuredClone(kit.rules), notes: kit.notes, caption: structuredClone(kit.caption), generation: structuredClone(kit.generation), samples: structuredClone(kit.samples) } }
/** v1 → v2 (pure): the old Markdown `rules` becomes `notes`; every new field is filled by the current schema defaults. */
export function migrateStyleKitV1(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  if (typeof record.rules !== 'string') return value
  const { rules, ...rest } = record
  return { ...rest, notes: rules, rules: [] }
}
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
function luminance(value: CodeColor): number { const [r, g, b] = value.slice(0, 3).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b }
export function styleContrast(a: CodeColor, b: CodeColor): number { const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (high + .05) / (low + .05) }
/** Pick the palette ink that reads best on `surface` (used when text sits on an accent plate). */
export function styleInkOn(tokens: StyleTokens, surface: CodeColor): CodeColor { return styleContrast(tokens.palette.fg, surface) >= styleContrast(tokens.palette.bg, surface) ? tokens.palette.fg : tokens.palette.bg }
/** Text defaults that follow a style. Callers merge them over the plain default; explicit user values win. */
export function styleKitTextDefaults(kit: StyleKit, height: number, role: 'display' | 'body' | 'mono' = 'body'): Pick<VideoEditTextStyle, 'fontFamily' | 'fontWeight' | 'fontSize' | 'fill' | 'leading'> {
  if (!Number.isFinite(height) || height <= 0) throw new Error('请提供实际画面高度。')
  const tokens = styleTokensSchema.parse(kit.tokens)
  const fontSize = Math.max(1, Math.min(8192, height * resolveStyleTypeScale(tokens).typeScale[role === 'display' ? 'xl' : 'md']))
  return { fontFamily: tokens.fonts[role].family, fontWeight: tokens.fonts[role].weight, fontSize, fill: { enabled: true, color: styleColorHex(tokens.palette.fg) }, leading: Math.min(8192, fontSize * (role === 'display' ? 1.1 : 1.5)) }
}
/** Plain default text style, or the style-following one when a style is bound. */
export function styledVideoEditTextStyle(kit: StyleKit | undefined, height: number, role: 'display' | 'body' | 'mono' = 'body'): VideoEditTextStyle {
  const base = defaultVideoEditTextStyle(height)
  return kit ? { ...base, ...styleKitTextDefaults(kit, height, role) } : base
}
/** Easings.net control points. Elastic and bounce have no single Bézier; keyframes use the closest overshoot curve. */
const EASE_BEZIER: Readonly<Record<string, VideoEditBezier>> = {
  linear: [0, 0, 1, 1], backOut: [.34, 1.56, .64, 1], elasticOut: [.5, 1.8, .5, 1], bounceOut: [.4, 1.4, .6, 1],
  sineIn: [.12, 0, .39, 0], sineOut: [.61, 1, .88, 1], sineInOut: [.37, 0, .63, 1], quadIn: [.11, 0, .5, 0], quadOut: [.5, 1, .89, 1], quadInOut: [.45, 0, .55, 1],
  cubicIn: [.32, 0, .67, 0], cubicOut: [.33, 1, .68, 1], cubicInOut: [.65, 0, .35, 1], quartIn: [.5, 0, .75, 0], quartOut: [.25, 1, .5, 1], quartInOut: [.76, 0, .24, 1],
  quintIn: [.64, 0, .78, 0], quintOut: [.22, 1, .36, 1], quintInOut: [.83, 0, .17, 1], expoIn: [.7, 0, .84, 0], expoOut: [.16, 1, .3, 1], expoInOut: [.87, 0, .13, 1],
  circIn: [.55, 0, 1, .45], circOut: [0, .55, .45, 1], circInOut: [.85, 0, .15, 1],
}
export function styleEasingBezier(value: StyleEasing): VideoEditBezier { return typeof value === 'string' ? [...(EASE_BEZIER[value] ?? EASE_BEZIER.cubicInOut)] as VideoEditBezier : [...value] as VideoEditBezier }
export interface StyleKeyframeCurve { interpolation: 'bezier'; bezier: VideoEditBezier; durationSeconds: number }
/** Keyframe form of every motion role: the same curves title templates and the assistant write into keyframes. */
export function styleKeyframeCurves(tokens: StyleTokens): Record<StyleMotionRole, StyleKeyframeCurve> {
  const durations: Record<StyleMotionRole, number> = { enter: tokens.motion.enterDuration, exit: tokens.motion.exitDuration, move: tokens.motion.enterDuration, emphasis: tokens.motion.emphasisDuration, transition: tokens.motion.transitionDuration }
  return Object.fromEntries(STYLE_MOTION_ROLES.map(role => [role, { interpolation: 'bezier', bezier: styleEasingBezier(tokens.motion[`${role}Ease`]), durationSeconds: durations[role] }])) as Record<StyleMotionRole, StyleKeyframeCurve>
}
/** Hold time a line of text needs under this style: reading time at `readingSpeed` plus `minHold`. */
export function styleReadingSeconds(tokens: StyleTokens, text: string): number {
  const units = (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0) + (text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ').trim().split(/\s+/u).filter(Boolean).length)
  return units / tokens.motion.readingSpeed + tokens.motion.minHold
}
/** Prompt addition for model generation. Explicit `generation.prompt` wins; otherwise built from profile and palette. */
export function styleKitPromptHint(kit: StyleKit): string {
  if (!kit.generation.inject) return ''
  if (kit.generation.prompt) return kit.generation.prompt
  const parts = [kit.profile.summary, kit.profile.concepts.map(concept => `${concept.name}（${concept.meaning}）`).join('、'), `配色：底色 ${styleColorHex(kit.tokens.palette.bg)}、主色 ${styleColorHex(kit.tokens.palette.fg)}、强调色 ${styleColorHex(kit.tokens.palette.accent)}`]
  if (kit.tokens.texture.grain > .02) parts.push('轻微胶片颗粒')
  if (kit.tokens.texture.vignette > .05) parts.push('轻暗角')
  return parts.filter(Boolean).join('；')
}
