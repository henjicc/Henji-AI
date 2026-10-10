import { cssFontFamily } from '../../fonts/catalog'
import type { TextStyle } from './text'
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
