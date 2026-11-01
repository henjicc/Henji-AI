import type { TextStyle } from '../text'
import type { TextFontAccess, TextFontRequest } from './fontSession'
import { TextShaper, shapingKey, orderedValues, type ShapeOptions } from './harfbuzz'
import { graphemeEnds, type ParagraphOptions, type ParagraphRun } from './paragraph'

export interface TextStyleSpan { readonly start: number; readonly end: number; readonly style: TextStyle }
export interface DisplayGrapheme {
  readonly start: number; readonly end: number
  readonly sourceStart: number; readonly sourceEnd: number
  readonly style: TextStyle; readonly baselineShift: number; readonly missing: boolean; readonly inferredScript: boolean
}
export interface ShapingRuns {
  readonly text: string; readonly runs: readonly ParagraphRun[]
  readonly graphemes: readonly DisplayGrapheme[]; readonly fontIdentity: string
  readonly spacing: NonNullable<ParagraphOptions['spacing']>
}

// ECMAScript 的 Unicode Script/Script_Extensions 负责分类；Common/Inherited 沿段落邻接上下文归属。
const scripts = ['Latn', 'Hani', 'Hira', 'Kana', 'Hang', 'Arab', 'Hebr', 'Cyrl', 'Grek', 'Deva', 'Beng', 'Guru', 'Gujr', 'Orya', 'Taml', 'Telu', 'Knda', 'Mlym', 'Sinh', 'Thai', 'Laoo', 'Tibt', 'Mymr', 'Geor', 'Armn', 'Ethi', 'Khmr']
// Unicode 17 PropertyValueAliases.txt 的 Script 值；分类交给运行时 Unicode 表，不自行维护码点区间。
const unicodeScripts = 'Adlm Aghb Ahom Arab Armi Armn Avst Bali Bamu Bass Batk Beng Berf Bhks Bopo Brah Brai Bugi Buhd Cakm Cans Cari Cham Cher Chrs Copt Cpmn Cprt Cyrl Deva Diak Dogr Dsrt Dupl Egyp Elba Elym Ethi Gara Geor Glag Gong Gonm Goth Gran Grek Gujr Gukh Guru Hang Hani Hano Hatr Hebr Hira Hluw Hmng Hmnp Hung Ital Java Kali Kana Kawi Khar Khmr Khoj Kits Knda Krai Kthi Lana Laoo Latn Lepc Limb Lina Linb Lisu Lyci Lydi Mahj Maka Mand Mani Marc Medf Mend Merc Mero Mlym Modi Mong Mroo Mtei Mult Mymr Nagm Nand Narb Nbat Newa Nkoo Nshu Ogam Olck Onao Orkh Orya Osge Osma Ougr Palm Pauc Perm Phag Phli Phlp Phnx Plrd Prti Rjng Rohg Runr Samr Sarb Saur Sgnw Shaw Shrd Sidd Sidt Sind Sinh Sogd Sogo Sora Soyo Sund Sunu Sylo Syrc Tagb Takr Tale Talu Taml Tang Tavt Tayo Telu Tfng Tglg Thaa Thai Tibt Tirh Tnsa Todr Tols Toto Tutg Ugar Vaii Vith Wara Wcho Xpeo Xsux Yezi Yiii Zanb'.split(' ')
const scriptPatterns = unicodeScripts.flatMap(script => {
  // Node 与 Electron 的 Unicode 版本可能不同；不认识的新系统仍走基础整形。
  try { return [[script, new RegExp(`\\p{Script=${script}}`, 'u')] as const] }
  catch { return [] }
})
export function textScript(text: string): string | undefined {
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(text)) return 'Emoji'
  return scriptPatterns.find(([, pattern]) => pattern.test(text))?.[0] ?? ([...text].some(char => /\p{Letter}/u.test(char) && !/[\p{Script=Common}\p{Script=Inherited}]/u.test(char)) ? 'Zzzz' : undefined)
}
export const textFontRequest = (style: TextStyle): TextFontRequest => ({ family: style.fontFamily, weight: style.fontWeight, style: style.fontStyle })

/** 富文本的绘制样式单独保留；仅真正影响 shaping 的事实划分 run。 */
export function prepareShapingRuns(shaper: TextShaper, fonts: TextFontAccess, source: string, spans: readonly TextStyleSpan[], options: ShapeOptions): ShapingRuns {
  const ends = graphemeEnds(source)
  let covered = 0
  for (const span of spans) {
    if (span.start !== covered || span.end < span.start || span.end > source.length) throw new Error('富文本样式必须连续覆盖原文')
    covered = span.end
  }
  if (covered !== source.length) throw new Error('富文本样式未覆盖完整原文')
  let spanIndex = 0
  const original = ends.map((end, index) => {
    const start = index ? ends[index - 1] : 0
    while (spans[spanIndex]?.end <= start) spanIndex++
    const span = spans[spanIndex]
    if (!span) throw new Error('字素缺少文字样式')
    const value = source.slice(start, end)
    return { start, end, style: span.style, value, script: textScript(value) }
  })
  const runs: ParagraphRun[] = [], graphemes: DisplayGrapheme[] = [], identities = new Set<string>()
  const following: Array<string | undefined> = []
  let nextScript: string | undefined
  for (let index = original.length - 1; index >= 0; index--) {
    if (/^[\r\n]+$/.test(original[index].value)) nextScript = undefined
    nextScript = original[index].script ?? nextScript
    following[index] = nextScript
  }
  let text = '', previousKey = '', inherited: string | undefined
  original.forEach((item, index) => {
    const style = item.style
    // CRLF 是同一原文字素；大小写展开后仍由这一个原文字素拥有。
    const normalized = item.value.replace(/\r\n?/g, '\n')
    const small = !style.allCaps && style.smallCaps && normalized.toUpperCase() !== normalized
    const value = style.allCaps || small ? normalized.toUpperCase() : normalized
    const size = style.fontSize * (small ? .75 : 1) * (style.superscript || style.subscript ? .65 : 1)
    const script = item.script ?? inherited ?? following[index] ?? options.script ?? 'Latn'
    inherited = value === '\n' ? undefined : script
    const shapeOptions: ShapeOptions = { ...options, size, features: { ...options.features, kern: style.kerning === 'auto' ? 1 : 0 }, script: script === 'Emoji' ? 'Zyyy' : script === 'Zzzz' ? options.script : script }
    const request = textFontRequest(style), chain = fonts.chain(request)
    identities.add(chain.identity)
    const { font, missing } = fonts.choose(chain, value, shaper, shapeOptions)
    const start = text.length, end = start + value.length
    const key = JSON.stringify([font.hash, font.face ?? 0, orderedValues(font.variations), shapingKey(shapeOptions), script === 'Zzzz' ? item.value : script])
    const last = runs.at(-1)
    if (last && previousKey === key && value !== '\n' && text.at(-1) !== '\n') runs[runs.length - 1] = { ...last, end }
    else runs.push({ start, end, source: font, options: shapeOptions })
    previousKey = key
    text += value
    graphemes.push(Object.freeze({ start, end, sourceStart: item.start, sourceEnd: item.end, style, missing, inferredScript: script !== 'Emoji' && !scripts.includes(script) && !options.script,
      baselineShift: (style.superscript ? -.35 * style.fontSize : style.subscript ? .2 * style.fontSize : 0) - style.baselineShift }))
  })
  const spacing = graphemes.map(({ start, end, style }) => Object.freeze({ start, end, tsume: style.tsume, letterSpacing: style.fontSize * (style.tracking + (typeof style.kerning === 'number' ? style.kerning : 0)) / 1000 }))
  return Object.freeze({ text, runs: Object.freeze(runs.map(run => Object.freeze(run))), graphemes: Object.freeze(graphemes), spacing: Object.freeze(spacing), fontIdentity: JSON.stringify([...identities]) })
}
