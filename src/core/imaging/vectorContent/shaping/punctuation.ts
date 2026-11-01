import { getCharType, haltedSide, typeFromExtents, type HanKerningFontData } from '../../../../../resources/video-edit-author/vendor/pretext/1.0.0/han-kerning.js'
import { orderedValues, shapingKey, type TextShaper, type ShapeOptions, type FontSource } from './harfbuzz'

export interface PunctuationPlan {
  readonly key: string; readonly halts: readonly number[]; readonly trailingClose: boolean
  readonly pairs: readonly Readonly<{ target: number; earlier: number; later: number }>[]
  readonly closings: readonly number[]
}

/** 规则分析与依赖具体字形的标点决策分别缓存，换同名字体字节也必须重算。 */
export class PunctuationPlanner {
  private readonly plans = new Map<string, PunctuationPlan>()
  private readonly fonts = new Map<string, HanKerningFontData>()
  constructor(private readonly shaper: TextShaper) {}
  plan(source: FontSource, text: string, options: ShapeOptions): PunctuationPlan {
    const key = JSON.stringify([source.hash, source.face ?? 0, orderedValues(source.variations), shapingKey(options), text])
    const cached = this.plans.get(key)
    if (cached) return cached
    if (!/[\u2018-\u301f\uff08-\uff60]/.test(text)) {
      const result = Object.freeze({ key, halts: Object.freeze([] as number[]), pairs: Object.freeze([]), closings: Object.freeze([]), trailingClose: false })
      this.plans.set(key, result)
      return result
    }
    const fontKey = JSON.stringify([source.hash, source.face ?? 0, orderedValues(source.variations), shapingKey(options)])
    const classify = (char: string): number => {
      const shape = this.shaper.shape(source, char, { ...options, script: 'Hani' })
      let x = 0, left = Infinity, right = -Infinity
      for (const glyph of shape.glyphs) {
        const extents = this.shaper.extents(source, glyph.id, options)
        if (extents) { left = Math.min(left, x + glyph.xOffset + extents.left); right = Math.max(right, x + glyph.xOffset + extents.right) }
        x += glyph.advance
      }
      return Number.isFinite(left) ? typeFromExtents(shape.width, left, right) : 0
    }
    const uniformType = (chars: string): number => {
      const types = [...chars].map(classify)
      return types.every(type => type === types[0]) ? types[0] : 0
    }
    let data = this.fonts.get(fontKey)
    if (!data) {
      data = { typeForDot: uniformType('、。，．'), typeForColon: classify('：'), typeForSemicolon: classify('；'), quoteFullwidth: uniformType('‘“') === 1 && uniformType('’”') === 2 }
      this.fonts.set(fontKey, data)
    }
    const halts = new Set<number>()
    const pairs: Array<Readonly<{ target: number; earlier: number; later: number }>> = []
    for (let index = 1; index < text.length; index++) {
      const side = haltedSide(getCharType(data, text, index - 1), getCharType(data, text, index))
      if (side) {
        const target = side === 1 ? index : index - 1
        halts.add(target); pairs.push(Object.freeze({ target, earlier: index - 1, later: index }))
      }
    }
    const closings: number[] = []
    for (let index = 0; index < text.length; index++) if (/[\p{Pe}’”]/u.test(text[index]) && getCharType(data, text, index) === 2) closings.push(index)
    const result = Object.freeze({ key, halts: Object.freeze([...halts]), pairs: Object.freeze(pairs), closings: Object.freeze(closings), trailingClose: !!text.length && getCharType(data, text, text.length - 1) === 2 })
    this.plans.set(key, result)
    return result
  }
  clear(): void { this.plans.clear(); this.fonts.clear() }
}
