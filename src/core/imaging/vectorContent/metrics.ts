import { cssFontFamily } from '../../fonts/catalog'
import type { TextStyle, TextLayout } from './text'
export function textFont(style: TextStyle, size = style.fontSize): string { return `${style.fontStyle} ${style.fontWeight} ${size}px ${cssFontFamily(style.fontFamily)}` }
const textSegments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export function textCharacters(text: string, style: TextStyle): Array<{ text: string; source: string; size: number }> {
  const scriptScale = style.superscript || style.subscript ? .65 : 1
  return Array.from(textSegments.segment(text), entry => entry.segment).map(character => ({ source: character, text: style.smallCaps || style.allCaps ? character.toLocaleUpperCase() : character, size: style.fontSize * scriptScale * (style.smallCaps && !style.allCaps && character !== character.toLocaleUpperCase() ? .75 : 1) }))
}
export function textAdvances(text: string, style: TextStyle, measure: (text: string, font: string) => number): number[] {
  const characters = textCharacters(text, style)
  return characters.map((character, index) => {
    const font = textFont(style, character.size)
    const next = characters[index + 1]
    const glyph = measure(character.text, font)
    const pair = style.kerning === 'auto' && next && next.size === character.size ? measure(character.text + next.text, font) - glyph - measure(next.text, font) : 0
    return glyph * (1 - style.tsume / 100) + (next ? pair + style.fontSize * (style.tracking + (typeof style.kerning === 'number' ? style.kerning : 0)) / 1000 : 0)
  })
}
/** Whole-run measurement preserves native shaping/ligatures whenever glyph advances are unmodified. */
export function textWidth(text: string, style: TextStyle, measure: (text: string, font: string) => number): number {
  if (!style.smallCaps && !style.superscript && !style.subscript && !style.tracking && style.kerning === 'auto' && !style.tsume) return measure(style.allCaps ? text.toLocaleUpperCase() : text, textFont(style))
  return textAdvances(text, style, measure).reduce((sum, advance) => sum + advance, 0)
}

export interface TextAnchor { x: number; y: number; horizontal: number; vertical: number }

/** 文字工具的中心原点由宿主传入；作者布局可以直接使用左上锚点。 */
export function textAlignmentAnchor(style: TextStyle, x = 0, y = 0): TextAnchor {
  return { x, y, horizontal: style.align === 'center' || style.align === 'justify-center' ? .5 : style.align === 'right' || style.align === 'justify-right' ? 1 : 0, vertical: style.verticalAlign === 'middle' ? .5 : style.verticalAlign === 'bottom' ? 1 : 0 }
}

/** 换行已经确定后才放置盒子，尺寸约束不能隐式改变锚点。 */
export function textBoxLayout(lines: string[], style: TextStyle, contentWidth: number, options: { width?: number; height?: number; anchor?: TextAnchor; minimumWidth?: 'zero' | 'font-size' }): TextLayout {
  const width = options.width ?? Math.max(options.minimumWidth === 'zero' ? 0 : style.fontSize, contentWidth)
  const lineHeight = style.leading || style.fontSize * 1.25
  const contentHeight = Math.max(lineHeight, lines.length * lineHeight)
  const height = options.height ?? contentHeight
  const anchor = options.anchor ?? { x: 0, y: 0, horizontal: 0, vertical: 0 }
  const left = anchor.x - anchor.horizontal * width, top = anchor.y - anchor.vertical * height
  const contentTop = top + (style.verticalAlign === 'middle' ? (height - contentHeight) / 2 : style.verticalAlign === 'bottom' ? height - contentHeight : 0)
  return { lines, style, left, top, contentTop, width, height, lineHeight }
}

/** 数值缩放不承担输入 schema 校验，旧作者允许的字体参数必须原样保留。 */
export function scaleTextSpatialStyle(style: TextStyle, factor: number): TextStyle {
  return { ...style, fontSize: Math.max(1, style.fontSize * factor), leading: style.leading * factor, baselineShift: style.baselineShift * factor,
    strokes: style.strokes.map(stroke => ({ ...stroke, width: stroke.width * factor })),
    background: { ...style.background, padding: style.background.padding * factor, radius: style.background.radius * factor },
    shadows: style.shadows.map(shadow => ({ ...shadow, distance: shadow.distance * factor, size: shadow.size * factor, blur: shadow.blur * factor })),
  }
}
