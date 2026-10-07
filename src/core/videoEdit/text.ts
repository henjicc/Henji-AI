import { z } from 'zod'
import { BLACK_HEX, WHITE_HEX } from '../theme/colorTokens'
import { cssFontFamily } from '../fonts/catalog'
import { videoEditClipToFrame, videoEditFrameToClip, type VideoEditClipPlacement, type VideoEditSize } from './clipGeometry'

const color = z.string().regex(/^#[\da-f]{6}$/i, '请选择有效的颜色。')
/** Persist content colors, never theme colors: changing the application theme must not change the exported title. */
export const videoEditTextStyleSchema = z.object({
  fontFamily: z.string().trim().min(1).max(512).default('sans-serif'),
  fontWeight: z.number().int().min(1).max(1000).default(400), fontStyle: z.enum(['normal', 'italic', 'oblique']).default('normal'),
  fontSize: z.number().finite().min(1).max(8192).default(72).describe('序列像素；1–8192，与最大画幅边长一致。'),
  fauxBold: z.boolean().default(false), fauxItalic: z.boolean().default(false), allCaps: z.boolean().default(false), smallCaps: z.boolean().default(false),
  superscript: z.boolean().default(false), subscript: z.boolean().default(false), underline: z.boolean().default(false),
  align: z.enum(['left', 'center', 'right', 'justify', 'justify-center', 'justify-right', 'justify-all']).default('center'),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).default('middle'),
  tracking: z.number().finite().min(-1000).max(10000).default(0).describe('字距，千分之一 em；-1000–10000。'),
  kerning: z.union([z.literal('auto'), z.number().finite().min(-1000).max(10000)]).default('auto').describe('auto 使用字体字偶距；数值为千分之一 em 的额外字偶距。'),
  leading: z.number().finite().min(0).max(8192).default(0).describe('行距，序列像素；0 自动（字号的1.25倍），最大8192。'),
  baselineShift: z.number().finite().min(-8192).max(8192).default(0).describe('基线偏移，序列像素；正数上移。'),
  tsume: z.number().finite().min(0).max(100).default(0).describe('比例间距压缩百分比，0–100，按字形推进宽度压缩。'),
  fill: z.object({ enabled: z.boolean().default(true), color: color.default(WHITE_HEX) }).strict().default({ enabled: true, color: WHITE_HEX }),
  strokes: z.array(z.object({ enabled: z.boolean().default(true), color, width: z.number().finite().min(0).max(8192), position: z.enum(['outside', 'inside', 'center']) }).strict()).default([]).describe('描边顺序为外到内；宽度为序列像素，层数不限。'),
  background: z.object({ enabled: z.boolean().default(false), color: color.default(BLACK_HEX), opacity: z.number().finite().min(0).max(1).default(.7), padding: z.number().finite().min(0).max(8192).default(12), radius: z.number().finite().min(0).max(8192).default(0) }).strict().default({ enabled: false, color: BLACK_HEX, opacity: .7, padding: 12, radius: 0 }),
  shadows: z.array(z.object({ enabled: z.boolean().default(true), color, opacity: z.number().finite().min(0).max(1), angle: z.number().finite().min(-360).max(360), distance: z.number().finite().min(0).max(8192), size: z.number().finite().min(0).max(8192), blur: z.number().finite().min(0).max(8192) }).strict()).default([]).describe('阴影依数组顺序绘制；角度为顺时针度数（0向右），距离/大小/模糊为序列像素，不透明度0–1，层数不限。'),
  /** Zero is point text; otherwise a fixed width relative to the sequence width, before motion scaling. */
  boxWidth: z.number().finite().min(0).max(1).default(0),
  boxHeight: z.number().finite().min(0).max(1).default(0).describe('文字框高度占画幅比例；0使用实际文字高度。'),
}).strict()
export const VIDEO_EDIT_TEXT_STYLE_DESCRIPTION = '共享样式整体替换，先读后改。fontFamily家族/完整字形名（查询font）；fontWeight 1–1000；fontStyle normal/italic/oblique；fontSize像素1–8192。布尔：fauxBold仿粗体、fauxItalic仿斜体、allCaps全部大写、smallCaps小型大写、superscript上标、subscript下标、underline下划线（上下标同时开则上标优先）。align左/中/右及justify系列两端对齐（末行左/中/右/全部，枚举见schema）；verticalAlign top/middle/bottom。tracking字距、kerning字偶距：千分之一em -1000–10000，kerning还可auto。leading行距像素0–8192（0自动1.25倍字号）；baselineShift基线像素±8192（正数上移）；tsume压缩百分比0–100。fill {enabled,color}；strokes [{enabled,color,width,position:outside|inside|center}]，width像素0–8192；background {enabled,color,opacity,padding,radius}，opacity 0–1、padding/radius像素0–8192；shadows [{enabled,color,opacity,angle,distance,size,blur}]，opacity 0–1、angle顺时针±360度（0向右）、distance/size/blur像素0–8192。描边/阴影层数不限，颜色六位十六进制，enabled布尔。boxWidth/boxHeight文字框占画幅比例0–1（0自动）。完整字形名使用文件内字形，选择时400/normal避免重复合成。'
export type VideoEditTextStyle = z.infer<typeof videoEditTextStyleSchema>
export function defaultVideoEditTextStyle(height: number): VideoEditTextStyle {
  return videoEditTextStyleSchema.parse({ fontSize: Math.max(1, Math.round(height / 15)) })
}
export interface VideoEditTextLayout { lines: string[]; left: number; top: number; width: number; height: number; lineHeight: number; contentTop: number; style: VideoEditTextStyle }
export type VideoEditTextContent = { text: string; textStyle?: VideoEditTextStyle }
export function videoEditTextFont(style: VideoEditTextStyle, size = style.fontSize): string { return `${style.fontStyle} ${style.fontWeight} ${size}px ${cssFontFamily(style.fontFamily)}` }
const textSegments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export function videoEditTextCharacters(text: string, style: VideoEditTextStyle): Array<{ text: string; source: string; size: number }> {
  const scriptScale = style.superscript || style.subscript ? .65 : 1
  return Array.from(textSegments.segment(text), entry => entry.segment).map(character => ({ source: character, text: style.smallCaps || style.allCaps ? character.toLocaleUpperCase() : character, size: style.fontSize * scriptScale * (style.smallCaps && !style.allCaps && character !== character.toLocaleUpperCase() ? .75 : 1) }))
}
export function videoEditTextAdvances(text: string, style: VideoEditTextStyle, measure: (text: string, font: string) => number): number[] {
  const characters = videoEditTextCharacters(text, style)
  return characters.map((character, index) => {
    const font = videoEditTextFont(style, character.size)
    const next = characters[index + 1]
    const glyph = measure(character.text, font)
    const pair = style.kerning === 'auto' && next && next.size === character.size ? measure(character.text + next.text, font) - glyph - measure(next.text, font) : 0
    return glyph * (1 - style.tsume / 100) + (next ? pair + style.fontSize * (style.tracking + (typeof style.kerning === 'number' ? style.kerning : 0)) / 1000 : 0)
  })
}
/** Whole-run measurement preserves native shaping/ligatures whenever glyph advances are unmodified. */
export function videoEditTextWidth(text: string, style: VideoEditTextStyle, measure: (text: string, font: string) => number): number {
  if (!style.smallCaps && !style.superscript && !style.subscript && !style.tracking && style.kerning === 'auto' && !style.tsume) return measure(style.allCaps ? text.toLocaleUpperCase() : text, videoEditTextFont(style))
  return videoEditTextAdvances(text, style, measure).reduce((sum, advance) => sum + advance, 0)
}
/** The same measured layout drives the title texture, hit area, handles and paragraph wrapping. */
export function layoutVideoEditText(clip: VideoEditTextContent, frame: VideoEditSize, measure: (text: string, font: string) => number): VideoEditTextLayout {
  const style = clip.textStyle ?? defaultVideoEditTextStyle(frame.height)
  const lineWidth = (text: string): number => videoEditTextWidth(text, style, measure)
  const fixedWidth = style.boxWidth * frame.width
  const lines = clip.text.split('\n').flatMap(line => {
    if (!fixedWidth || !line) return [line]
    const characters = videoEditTextCharacters(line, style); const advances = videoEditTextAdvances(line, style, measure)
    const wrapped: string[] = []; let current = ''; let currentWidth = 0
    characters.forEach((character, index) => {
      const glyph = measure(character.text, videoEditTextFont(style, character.size)) * (1 - style.tsume / 100)
      const spacing = index ? advances[index - 1] - measure(characters[index - 1].text, videoEditTextFont(style, characters[index - 1].size)) * (1 - style.tsume / 100) : 0
      if (current && currentWidth + spacing + glyph > fixedWidth) { wrapped.push(current); current = ''; currentWidth = 0 }
      currentWidth += (current ? spacing : 0) + glyph; current += character.source
    })
    wrapped.push(current); return wrapped
  })
  const width = fixedWidth || lines.reduce((largest, line) => Math.max(largest, lineWidth(line)), style.fontSize)
  const lineHeight = style.leading || style.fontSize * 1.25
  const contentHeight = Math.max(lineHeight, lines.length * lineHeight)
  const height = style.boxHeight ? style.boxHeight * frame.height : contentHeight
  const top = frame.height / 2 - (style.verticalAlign === 'middle' ? height / 2 : style.verticalAlign === 'bottom' ? height : 0)
  const contentTop = top + (style.verticalAlign === 'middle' ? (height - contentHeight) / 2 : style.verticalAlign === 'bottom' ? height - contentHeight : 0)
  const left = frame.width / 2 - (style.align === 'center' || style.align === 'justify-center' ? width / 2 : style.align === 'right' || style.align === 'justify-right' ? width : 0)
  return { lines, left, top, width, height, lineHeight, contentTop, style }
}
/** Resize all spatial typography together when a template/caption changes its reference frame. */
export function scaleVideoEditTextStyle(style: VideoEditTextStyle, factor: number): VideoEditTextStyle {
  return videoEditTextStyleSchema.parse({ ...style, fontSize: Math.min(8192, Math.max(1, style.fontSize * factor)), leading: style.leading * factor, baselineShift: style.baselineShift * factor, strokes: style.strokes.map(stroke => ({ ...stroke, width: stroke.width * factor })), background: { ...style.background, padding: style.background.padding * factor, radius: style.background.radius * factor }, shadows: style.shadows.map(shadow => ({ ...shadow, distance: shadow.distance * factor, size: shadow.size * factor, blur: shadow.blur * factor })) })
}

export function videoEditTextPoint(client: { x: number; y: number }, rect: { left: number; top: number; width: number; height: number }, clamp = true): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) throw new Error('节目画面尚未就绪。')
  const x = (client.x - rect.left) / rect.width; const y = (client.y - rect.top) / rect.height
  return clamp ? { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : { x, y }
}

/** Uniform motion scale, with the opposite corner fixed in sequence space even on rotated titles. */
export function resizeVideoEditText(clip: VideoEditClipPlacement, frame: VideoEditSize, layout: VideoEditTextLayout, corner: number, point: { x: number; y: number }): Pick<VideoEditClipPlacement, 'x' | 'y' | 'scale'> {
  const corners = [[layout.left, layout.top], [layout.left + layout.width, layout.top], [layout.left + layout.width, layout.top + layout.height], [layout.left, layout.top + layout.height]]
  const opposite = corners[(corner + 2) % 4]; const moving = corners[corner]
  const local = videoEditFrameToClip(clip, frame, frame, point.x, point.y)
  const dx = moving[0] - opposite[0]; const dy = moving[1] - opposite[1]
  const ratio = ((local.u * frame.width - opposite[0]) * dx + (local.v * frame.height - opposite[1]) * dy) / (dx * dx + dy * dy)
  const scale = Math.max(.01, Math.min(4, clip.scale * ratio))
  const oldAnchor = videoEditClipToFrame(clip, frame, frame, opposite[0] / frame.width, opposite[1] / frame.height)
  const nextAnchor = videoEditClipToFrame({ ...clip, scale }, frame, frame, opposite[0] / frame.width, opposite[1] / frame.height)
  return { scale, x: Math.max(-2, Math.min(2, clip.x + oldAnchor.x - nextAnchor.x)), y: Math.max(-2, Math.min(2, clip.y + oldAnchor.y - nextAnchor.y)) }
}
