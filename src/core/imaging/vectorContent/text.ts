import { z } from 'zod'
import { BLACK_HEX, WHITE_HEX, HEX_COLOR_EXAMPLE } from '../../theme/colorTokens'
import { layoutRichTextFlow } from './richText'
import { textWidth, textBoxLayout, textAlignmentAnchor, scaleTextSpatialStyle } from './metrics'
export { textFont, textCharacters, textAdvances, textWidth, textAlignmentAnchor } from './metrics'
export interface TextFrame { width: number; height: number }

const color = z.string().regex(/^#[\da-f]{6}$/i, `应为 6 位十六进制颜色，例如 ${HEX_COLOR_EXAMPLE}。`)
/** Persist content colors, never theme colors: changing the application theme must not change the exported title. */
export const textStyleSchema = z.object({
  fontFamily: z.string().trim().min(1).max(512).default('sans-serif'),
  fontWeight: z.number().int().min(1).max(1000).default(400), fontStyle: z.enum(['normal', 'italic', 'oblique']).default('normal'),
  fontSize: z.number().finite().min(1).default(72).describe('作品空间字号；栅格输出按宿主的瓦片或纹理预算处理。'),
  fauxBold: z.boolean().default(false), fauxItalic: z.boolean().default(false), allCaps: z.boolean().default(false), smallCaps: z.boolean().default(false),
  superscript: z.boolean().default(false), subscript: z.boolean().default(false), underline: z.boolean().default(false),
  align: z.enum(['left', 'center', 'right', 'justify', 'justify-center', 'justify-right', 'justify-all']).default('center'),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).default('middle'),
  tracking: z.number().finite().min(-1000).max(10000).default(0).describe('字距，千分之一 em；-1000–10000。'),
  kerning: z.union([z.literal('auto'), z.number().finite().min(-1000).max(10000)]).default('auto').describe('auto 使用字体字偶距；数值为千分之一 em 的额外字偶距。'),
  leading: z.number().finite().min(0).default(0).describe('行距，作品空间像素；0 自动（字号的1.25倍）。'),
  baselineShift: z.number().finite().default(0).describe('基线偏移，序列像素；正数上移。'),
  tsume: z.number().finite().min(0).max(100).default(0).describe('比例间距压缩百分比，0–100，按字形推进宽度压缩。'),
  fill: z.object({ enabled: z.boolean().default(true), color: color.default(WHITE_HEX) }).strict().default({ enabled: true, color: WHITE_HEX }),
  strokes: z.array(z.object({ enabled: z.boolean().default(true), color, width: z.number().finite().min(0), position: z.enum(['outside', 'inside', 'center']) }).strict()).default([]).describe('描边顺序为外到内；宽度为序列像素，层数不限。'),
  background: z.object({ enabled: z.boolean().default(false), color: color.default(BLACK_HEX), opacity: z.number().finite().min(0).max(1).default(.7), padding: z.number().finite().min(0).default(12), radius: z.number().finite().min(0).default(0) }).strict().default({ enabled: false, color: BLACK_HEX, opacity: .7, padding: 12, radius: 0 }),
  shadows: z.array(z.object({ enabled: z.boolean().default(true), color, opacity: z.number().finite().min(0).max(1), angle: z.number().finite().min(-360).max(360), distance: z.number().finite().min(0), size: z.number().finite().min(0), blur: z.number().finite().min(0) }).strict()).default([]).describe('阴影依数组顺序绘制；角度为顺时针度数（0向右），距离/大小/模糊为序列像素，不透明度0–1，层数不限。'),
  /** Zero is point text; otherwise a fixed width relative to the sequence width, before motion scaling. */
  boxWidth: z.number().finite().min(0).max(1).default(0),
  boxHeight: z.number().finite().min(0).max(1).default(0).describe('文字框高度占画幅比例；0使用实际文字高度。'),
}).strict()
export const TEXT_STYLE_DESCRIPTION = '共享样式整体替换，未提供的字段使用默认值；保留原样式时先读后改。fontFamily家族/完整字形名（查询font）；fontWeight 1–1000；fontStyle normal/italic/oblique；fontSize为正的作品空间像素。布尔：fauxBold仿粗体、fauxItalic仿斜体、allCaps全部大写、smallCaps小型大写、superscript上标、subscript下标、underline下划线（上下标同时开则上标优先）。align左/中/右及justify系列两端对齐（末行左/中/右/全部，枚举见schema）；verticalAlign top/middle/bottom。tracking字距、kerning字偶距：千分之一em -1000–10000，kerning还可auto。leading行距为非负作品空间像素（0自动1.25倍字号）；baselineShift基线偏移为作品空间像素（正数上移）；tsume压缩百分比0–100。fill {enabled,color}；strokes [{enabled,color,width,position:outside|inside|center}]，width为非负作品空间像素；background {enabled,color,opacity,padding,radius}，opacity 0–1、padding/radius为非负作品空间像素；shadows [{enabled,color,opacity,angle,distance,size,blur}]，opacity 0–1、angle顺时针±360度（0向右）、distance/size/blur为非负作品空间像素。描边/阴影层数不限，颜色六位十六进制，enabled布尔。boxWidth/boxHeight文字框占画幅比例0–1（0自动）。完整字形名使用文件内字形，选择时400/normal避免重复合成。'
export type TextStyle = z.infer<typeof textStyleSchema>
export function defaultTextStyle(height: number): TextStyle {
  return textStyleSchema.parse({ fontSize: Math.max(1, Math.round(height / 15)) })
}
/** 仅新建内容使用宿主提供的默认字体；旧作品布局不得依赖用户当前偏好。 */
let newTextFont: (text: string, documentId?: string, styleFont?: string) => string | undefined = () => undefined
export function setNewTextFontResolver(resolve: typeof newTextFont): void { newTextFont = resolve }
export function newTextStyle(height: number, text = '文字', documentId?: string, styleFont?: string): TextStyle {
  const style = defaultTextStyle(height)
  const font = newTextFont(text, documentId, styleFont) ?? styleFont
  return font ? { ...style, fontFamily: font } : style
}
export interface TextLayout { lines: string[]; left: number; top: number; width: number; height: number; lineHeight: number; contentTop: number; style: TextStyle }
export type TextContent = { text: string; textStyle?: TextStyle }
/** The same measured layout drives the title texture, hit area, handles and paragraph wrapping. */
export function layoutText(clip: TextContent, frame: TextFrame, measure: (text: string, font: string) => number): TextLayout {
  const style = clip.textStyle ?? defaultTextStyle(frame.height)
  const lineWidth = (text: string): number => textWidth(text, style, measure)
  const fixedWidth = style.boxWidth * frame.width
  const rich = layoutRichTextFlow({box:{x:0,y:0,width:fixedWidth,height:0},paragraphs:[{runs:[{text:clip.text,style}],align:'left',direction:'ltr',spaceBefore:0,spaceAfter:0}]},measure,{sourceVersion:'text-layout',time:{kind:'static'},referenceGrid:frame,quality:'final'})
  const lines = rich.lines.map(line => line.text)
  const contentWidth = lines.reduce((largest, line) => Math.max(largest, lineWidth(line)), 0)
  return textBoxLayout(lines, style, contentWidth, { width: fixedWidth || undefined, height: style.boxHeight * frame.height || undefined, anchor: textAlignmentAnchor(style, frame.width / 2, frame.height / 2) })
}
/** Resize all spatial typography together when a template/caption changes its reference frame. */
export function scaleTextStyle(style: TextStyle, factor: number): TextStyle {
  return textStyleSchema.parse(scaleTextSpatialStyle(style, factor))
}

