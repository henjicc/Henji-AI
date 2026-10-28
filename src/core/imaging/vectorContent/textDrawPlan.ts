import type { RichTextContent, TextParagraph } from './contracts'
import { layoutRichTextFlow, positionRichTextFlow } from './richText'
import { textAdvances, textCharacters, textFont, textWidth, textBoxLayout, scaleTextSpatialStyle } from './metrics'
import type { TextFrame, TextLayout, TextStyle } from './text'

export class TextDrawPlanError extends Error {
  constructor(readonly code: 'BUDGET' | 'CONTEXT', message: string) { super(message); this.name = 'TextDrawPlanError' }
}

export interface TextPlanRect { x: number; y: number; width: number; height: number }
export interface TextPlanMetrics {
  width: number
  actualBoundingBoxLeft?: number
  actualBoundingBoxRight?: number
  actualBoundingBoxAscent?: number
  actualBoundingBoxDescent?: number
  fontBoundingBoxAscent?: number
  fontBoundingBoxDescent?: number
}
export interface TextPlanMeasureState {
  fontKerning: 'auto' | 'normal' | 'none'
  direction: 'ltr' | 'rtl' | 'inherit'
  textBaseline: 'middle' | 'alphabetic'
  textAlign: 'left'
}
/** 度量与绘制必须使用同一字体集和 Canvas 状态；只给推进宽度时，墨迹只能返回保守估计。 */
export type TextPlanMeasure = (text: string, font: string, state: TextPlanMeasureState) => number | TextPlanMetrics
export interface TextDrawConstraints {
  signal?: AbortSignal
  /** 纹理取整的坐标原点；纹理范围相对此原点返回，保留宿主先平移再取整的浮点顺序。 */
  rasterOrigin?: { x: number; y: number }
  /** 仅约束 fit 与超框判定，不隐式换行；只给 maxWidth 且启用 fit 时会缩小长行。 */
  maxWidth?: number
  maxHeight?: number
  maxLines?: number
  fit?: false | { minFontSize: number; maxFontSize?: number; step?: number; algorithm?: 'grid' | 'continuous'; iterations?: number; trigger?: 'overflow' | 'maxLines' }
  wrap?: 'grapheme' | 'word' | 'none'
  /** 独立的换行宽度；省略时仅使用作品比例框或富文本自身的宽度。 */
  wrapWidth?: number
  /** 放置盒尺寸，不作为 fit 限制；省略时按内容或原有比例框计算。 */
  box?: { width?: number; height?: number }
  /** 局部坐标默认从盒子左上开始；锚点比例和位置由调用方决定，不从 align 推断。 */
  anchor?: { x: number; y: number; horizontal: number; vertical: number }
  trim?: boolean
  minimumWidth?: 'font-size' | 'zero'
  baseline?: 'middle' | 'alphabetic'
  /** 旧作者宿主使用 Canvas auto，文字工具默认按 style.kerning 选择 normal/none。 */
  fontKerning?: TextPlanMeasureState['fontKerning']
  /** alphabetic 的行内位置：em 复现作者 DTO，font 复现宿主字体度量修正。 */
  alphabeticPlacement?: 'em' | 'font'
  /** 固定作品像素字距，fit 时不随字号缩放；用于既有作者接口。 */
  letterSpacing?: number
  /** 显式拆字会失去连写；双向混排无法可靠重排时拒绝，不能伪造动画坐标。 */
  forceGraphemes?: boolean
  /** false 保留超限行用于旧作者失败处理；默认截断超出 maxLines/maxHeight 的整行。 */
  truncate?: boolean
  /** 比例文字框依赖作品画幅。 */
  frame?: TextFrame
  direction?: 'ltr' | 'rtl' | 'inherit'
}
export interface TextPlanBaselines {
  /** baseline（字素的 y 同义）采用 baselineKind 指定的 Canvas 基线。 */
  baselineKind: 'middle' | 'alphabetic'
  baseline: number
  middleBaseline: number
  alphabeticBaseline: number
  baselineConversion: 'measured' | 'estimated'
}
export interface TextSourceRange {
  /** UTF-16 偏移；富文本各段落间插入一个换行，样式段之间不插字符。 */
  start: number
  end: number
  paragraph: number
  run: number
  runStart: number
  runEnd: number
}
export interface TextPlanGrapheme extends TextPlanBaselines {
  text: string
  displayText: string
  source: { start: number; end: number }
  /** 相邻 run 共用样式时会一起塑形，一个组合字素可以跨越多个原文样式段。 */
  sources: TextSourceRange[]
  style: TextStyle
  line: number
  group: number
  x: number | null
  /** 与 baseline 同值，基线种类见 baselineKind。 */
  y: number
  advance: number
  /** 原生塑形内部的位置是推进估计，不能据此拆开重画。 */
  positionKind: 'native-estimate' | 'individual' | 'unavailable'
}
export interface TextDrawGroup extends TextPlanBaselines {
  text: string
  font: string
  size: number
  x: number
  baseline: number
  style: TextStyle
  graphemes: number[]
  indivisible: boolean
  inkBounds: TextPlanRect | null
}
export interface TextPlanLine extends TextPlanBaselines {
  text: string
  start: number
  end: number
  x: number
  y: number
  width: number
  height: number
  baseline: number
  groups: number[]
}
export interface TextDrawBatch {
  layout: TextLayout
  direction: TextPlanMeasureState['direction']
  fontKerning: TextPlanMeasureState['fontKerning']
  groups: number[]
  /** 保留逐行次序；下划线也属于覆盖遮罩，不能移到外观合成之后。 */
  rows: Array<{ groups: number[]; underline?: TextPlanRect }>
}
export interface TextDrawPlan {
  sourceText: string
  style: TextStyle
  lines: TextPlanLine[]
  graphemes: TextPlanGrapheme[]
  groups: TextDrawGroup[]
  batches: TextDrawBatch[]
  box: TextPlanRect
  /** 容量从内容起点计量，放置盒的垂直对齐只改变坐标，不改变可容纳的行数。 */
  contentTop: number
  contentSize: { width: number; height: number }
  visibleContentSize: { width: number; height: number }
  inkBounds: TextPlanRect | null
  appearanceBounds: TextPlanRect | null
  boundsKind: 'measured' | 'estimated'
  /** 保守纹理分配范围，相对 constraints.rasterOrigin（默认零）；不能把纹理留白当成正文墨迹。 */
  rasterBounds: TextPlanRect
  /** 完整内容和实际绘出的部分分别报告，正文超限不包括描边与阴影。 */
  overflow: { full: TextPlanOverflow; visible: TextPlanOverflow }
  truncated: boolean
  omittedRanges: Array<TextSourceRange & { reason: 'maxLines' | 'maxHeight' | 'trim' }>
  totalLines: number
  fit: { applied: boolean; failed: boolean; fontSize: number; scale: number; error?: { code: 'BUDGET'; message: string } }
}
export interface TextPlanOverflow { width: boolean; height: boolean; lines: boolean }

interface SourceSpan { start: number; end: number; paragraph: number; run: number; style: TextStyle }
interface PlanSeed {
  autoHeight: boolean
  anchorVertical: number
  kind: 'plain' | 'rich'
  sourceText: string
  spans: SourceSpan[]
  lines: TextPlanLine[]
  batches: Array<{ layout: TextLayout; direction: TextPlanMeasureState['direction']; rows: Array<{ line: number; start: number; originalIndex: number }>; totalRows: number }>
  box: TextPlanRect
  contentTop: number
  contentSize: { width: number; height: number }
  visibleContentSize: { width: number; height: number }
  totalLines: number
  omittedRanges: TextDrawPlan['omittedRanges']
  probe: { overhang: number; ascent: number; descent: number }
}
const evaluation = { sourceVersion: 'text-draw-plan', time: { kind: 'static' as const }, referenceGrid: { width: 1, height: 1 }, quality: 'final' as const }

function union(a: TextPlanRect | null, b: TextPlanRect | null): TextPlanRect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}
function expand(rect: TextPlanRect, pad: number, x = 0, y = 0): TextPlanRect {
  return { x: rect.x - pad + x, y: rect.y - pad + y, width: rect.width + pad * 2, height: rect.height + pad * 2 }
}
function lineRanges(text: string, lines: string[]): Array<{ start: number; end: number }> {
  let cursor = 0
  return lines.map(line => {
    const start = cursor
    cursor += line.length
    const end = cursor
    if (text.slice(cursor, cursor + 2) === '\r\n') cursor += 2
    else if (text[cursor] === '\n') cursor++
    return { start, end }
  })
}
function sourceRanges(spans: SourceSpan[], start: number, length: number): TextSourceRange[] {
  const end = start + length
  if (!length) {
    // 被截断的空行也需要可读回的位置；零长度范围指向所属 run 的插入点。
    const span = spans.find(span => span.start <= start && span.end >= start)
    return span ? [{ start, end, paragraph: span.paragraph, run: span.run, runStart: start - span.start, runEnd: start - span.start }] : []
  }
  return spans.filter(span => span.start < end && span.end > start).map(span => {
    const from = Math.max(start, span.start), to = Math.min(end, span.end)
    return { start: from, end: to, paragraph: span.paragraph, run: span.run, runStart: from - span.start, runEnd: to - span.start }
  })
}
function lineRecord(text: string, start: number, end: number, x: number, y: number, width: number, height: number): TextPlanLine {
  return { text, start, end, x, y, width, height, baseline: y + height / 2, middleBaseline: y + height / 2, alphabeticBaseline: y + height / 2, baselineKind: 'middle', baselineConversion: 'estimated', groups: [] }
}
function measureState(style: TextStyle, direction: TextPlanMeasureState['direction']): TextPlanMeasureState {
  return { fontKerning: style.kerning === 'auto' ? 'normal' : 'none', direction, textBaseline: 'middle', textAlign: 'left' }
}

function seedOverflow(seed: PlanSeed, constraints: TextDrawConstraints): TextPlanOverflow {
  return { width: constraints.maxWidth !== undefined && seed.contentSize.width > constraints.maxWidth, height: constraints.maxHeight !== undefined && seed.contentSize.height > constraints.maxHeight, lines: constraints.maxLines !== undefined && seed.totalLines > constraints.maxLines }
}

function limitSeed(seed: PlanSeed, constraints: TextDrawConstraints): PlanSeed {
  if (constraints.truncate === false) return seed
  const indices = new Map<number, number>(), omittedRanges = [...seed.omittedRanges]
  const lines = seed.lines.filter((line, index) => {
    const reason: 'maxLines' | 'maxHeight' | undefined = constraints.maxLines !== undefined && index >= constraints.maxLines ? 'maxLines' : constraints.maxHeight !== undefined && line.y + line.height > seed.contentTop + constraints.maxHeight ? 'maxHeight' : undefined
    if (reason) { omittedRanges.push(...sourceRanges(seed.spans, line.start, line.end - line.start).map(range => ({ ...range, reason }))); return false }
    indices.set(index, indices.size)
    return true
  })
  const batches = seed.batches.flatMap(batch => {
    const selected = batch.rows.map((row, index) => ({ row, index })).filter(({ row }) => indices.has(row.line))
    if (!selected.length) return []
    return [{ ...batch, layout: { ...batch.layout, lines: selected.map(({ index }) => batch.layout.lines[index]) }, rows: selected.map(({ row }) => ({ ...row, line: indices.get(row.line)! })) }]
  })
  const last = lines.at(-1)
  const visibleContentSize = { width: Math.max(0, ...lines.map(line => line.width)), height: last ? last.y + last.height - seed.contentTop : 0 }
  const box = { ...seed.box }
  let contentTop = seed.contentTop
  if (seed.autoHeight && lines.length < seed.totalLines) {
    // 自动盒跟随可见内容；固定盒保留调用方的尺寸，完整内容尺寸仍用于溢出和 fit 复核。
    box.y += (box.height - visibleContentSize.height) * seed.anchorVertical
    box.height = visibleContentSize.height
    contentTop = box.y
    const shift = contentTop - seed.contentTop
    for (const line of lines) {
      line.y += shift; line.baseline += shift; line.middleBaseline += shift; line.alphabeticBaseline += shift
    }
    for (const batch of batches) {
      batch.layout.top += shift; batch.layout.contentTop += shift
      if (seed.kind === 'plain') batch.layout.height = box.height
    }
  }
  return { ...seed, lines, batches, box, contentTop, omittedRanges, visibleContentSize }

}

// Unicode 17.0 DerivedBidiClass 生成，先应用 @missing 再覆盖显式记录；避免按脚本区间猜方向。
// 数据来源：https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedBidiClass.txt（Unicode 数据许可）。
const bidiRight = /[\u{590}\u{5be}\u{5c0}\u{5c3}\u{5c6}\u{5c8}-\u{5ff}\u{608}\u{60b}\u{60d}\u{61b}-\u{64a}\u{66d}-\u{66f}\u{671}-\u{6d5}\u{6e5}-\u{6e6}\u{6ee}-\u{6ef}\u{6fa}-\u{710}\u{712}-\u{72f}\u{74b}-\u{7a5}\u{7b1}-\u{7ea}\u{7f4}-\u{7f5}\u{7fa}-\u{7fc}\u{7fe}-\u{815}\u{81a}\u{824}\u{828}\u{82e}-\u{858}\u{85c}-\u{88f}\u{892}-\u{896}\u{8a0}-\u{8c9}\u{200f}\u{fb1d}\u{fb1f}-\u{fb28}\u{fb2a}-\u{fbc2}\u{fbd3}-\u{fd3d}\u{fd50}-\u{fd8f}\u{fd92}-\u{fdc7}\u{fdf0}-\u{fdfc}\u{fe70}-\u{fefe}\u{10800}-\u{1091e}\u{10920}-\u{10a00}\u{10a04}\u{10a07}-\u{10a0b}\u{10a10}-\u{10a37}\u{10a3b}-\u{10a3e}\u{10a40}-\u{10ae4}\u{10ae7}-\u{10b38}\u{10b40}-\u{10d23}\u{10d28}-\u{10d2f}\u{10d3a}-\u{10d3f}\u{10d4a}-\u{10d68}\u{10d6f}-\u{10e5f}\u{10e7f}-\u{10eaa}\u{10ead}-\u{10ecf}\u{10ed9}-\u{10ef9}\u{10f00}-\u{10f45}\u{10f51}-\u{10f81}\u{10f86}-\u{10fff}\u{1e800}-\u{1e8cf}\u{1e8d7}-\u{1e943}\u{1e94b}-\u{1eeef}\u{1eef2}-\u{1efff}]/u
// Unicode 分类按单个码点查询，表内组合字符也需要独立匹配。
// eslint-disable-next-line no-misleading-character-class
const bidiLeft = /[\u{41}-\u{5a}\u{61}-\u{7a}\u{aa}\u{b5}\u{ba}\u{c0}-\u{d6}\u{d8}-\u{f6}\u{f8}-\u{2b8}\u{2bb}-\u{2c1}\u{2d0}-\u{2d1}\u{2e0}-\u{2e4}\u{2ee}\u{370}-\u{373}\u{376}-\u{37d}\u{37f}-\u{383}\u{386}\u{388}-\u{3f5}\u{3f7}-\u{482}\u{48a}-\u{589}\u{58b}-\u{58c}\u{903}-\u{939}\u{93b}\u{93d}-\u{940}\u{949}-\u{94c}\u{94e}-\u{950}\u{958}-\u{961}\u{964}-\u{980}\u{982}-\u{9bb}\u{9bd}-\u{9c0}\u{9c5}-\u{9cc}\u{9ce}-\u{9e1}\u{9e4}-\u{9f1}\u{9f4}-\u{9fa}\u{9fc}-\u{9fd}\u{9ff}-\u{a00}\u{a03}-\u{a3b}\u{a3d}-\u{a40}\u{a43}-\u{a46}\u{a49}-\u{a4a}\u{a4e}-\u{a50}\u{a52}-\u{a6f}\u{a72}-\u{a74}\u{a76}-\u{a80}\u{a83}-\u{abb}\u{abd}-\u{ac0}\u{ac6}\u{ac9}-\u{acc}\u{ace}-\u{ae1}\u{ae4}-\u{af0}\u{af2}-\u{af9}\u{b00}\u{b02}-\u{b3b}\u{b3d}-\u{b3e}\u{b40}\u{b45}-\u{b4c}\u{b4e}-\u{b54}\u{b57}-\u{b61}\u{b64}-\u{b81}\u{b83}-\u{bbf}\u{bc1}-\u{bcc}\u{bce}-\u{bf2}\u{bfb}-\u{bff}\u{c01}-\u{c03}\u{c05}-\u{c3b}\u{c3d}\u{c41}-\u{c45}\u{c49}\u{c4e}-\u{c54}\u{c57}-\u{c61}\u{c64}-\u{c77}\u{c7f}-\u{c80}\u{c82}-\u{cbb}\u{cbd}-\u{ccb}\u{cce}-\u{ce1}\u{ce4}-\u{cff}\u{d02}-\u{d3a}\u{d3d}-\u{d40}\u{d45}-\u{d4c}\u{d4e}-\u{d61}\u{d64}-\u{d80}\u{d82}-\u{dc9}\u{dcb}-\u{dd1}\u{dd5}\u{dd7}-\u{e30}\u{e32}-\u{e33}\u{e3b}-\u{e3e}\u{e40}-\u{e46}\u{e4f}-\u{eb0}\u{eb2}-\u{eb3}\u{ebd}-\u{ec7}\u{ecf}-\u{f17}\u{f1a}-\u{f34}\u{f36}\u{f38}\u{f3e}-\u{f70}\u{f7f}\u{f85}\u{f88}-\u{f8c}\u{f98}\u{fbd}-\u{fc5}\u{fc7}-\u{102c}\u{1031}\u{1038}\u{103b}-\u{103c}\u{103f}-\u{1057}\u{105a}-\u{105d}\u{1061}-\u{1070}\u{1075}-\u{1081}\u{1083}-\u{1084}\u{1087}-\u{108c}\u{108e}-\u{109c}\u{109e}-\u{135c}\u{1360}-\u{138f}\u{139a}-\u{13ff}\u{1401}-\u{167f}\u{1681}-\u{169a}\u{169d}-\u{1711}\u{1715}-\u{1731}\u{1734}-\u{1751}\u{1754}-\u{1771}\u{1774}-\u{17b3}\u{17b6}\u{17be}-\u{17c5}\u{17c7}-\u{17c8}\u{17d4}-\u{17da}\u{17dc}\u{17de}-\u{17ef}\u{17fa}-\u{17ff}\u{1810}-\u{1884}\u{1887}-\u{18a8}\u{18aa}-\u{191f}\u{1923}-\u{1926}\u{1929}-\u{1931}\u{1933}-\u{1938}\u{193c}-\u{193f}\u{1941}-\u{1943}\u{1946}-\u{19dd}\u{1a00}-\u{1a16}\u{1a19}-\u{1a1a}\u{1a1c}-\u{1a55}\u{1a57}\u{1a5f}\u{1a61}\u{1a63}-\u{1a64}\u{1a6d}-\u{1a72}\u{1a7d}-\u{1a7e}\u{1a80}-\u{1aaf}\u{1ade}-\u{1adf}\u{1aec}-\u{1aff}\u{1b04}-\u{1b33}\u{1b35}\u{1b3b}\u{1b3d}-\u{1b41}\u{1b43}-\u{1b6a}\u{1b74}-\u{1b7f}\u{1b82}-\u{1ba1}\u{1ba6}-\u{1ba7}\u{1baa}\u{1bae}-\u{1be5}\u{1be7}\u{1bea}-\u{1bec}\u{1bee}\u{1bf2}-\u{1c2b}\u{1c34}-\u{1c35}\u{1c38}-\u{1ccf}\u{1cd3}\u{1ce1}\u{1ce9}-\u{1cec}\u{1cee}-\u{1cf3}\u{1cf5}-\u{1cf7}\u{1cfa}-\u{1dbf}\u{1e00}-\u{1fbc}\u{1fbe}\u{1fc2}-\u{1fcc}\u{1fd0}-\u{1fdc}\u{1fe0}-\u{1fec}\u{1ff0}-\u{1ffc}\u{1fff}\u{200e}\u{2071}-\u{2073}\u{207f}\u{208f}-\u{209f}\u{20f1}-\u{20ff}\u{2102}\u{2107}\u{210a}-\u{2113}\u{2115}\u{2119}-\u{211d}\u{2124}\u{2126}\u{2128}\u{212a}-\u{212d}\u{212f}-\u{2139}\u{213c}-\u{213f}\u{2145}-\u{2149}\u{214e}-\u{214f}\u{2160}-\u{2188}\u{218c}-\u{218f}\u{2336}-\u{237a}\u{2395}\u{242a}-\u{243f}\u{244b}-\u{245f}\u{249c}-\u{24e9}\u{26ac}\u{2800}-\u{28ff}\u{2b74}-\u{2b75}\u{2c00}-\u{2ce4}\u{2ceb}-\u{2cee}\u{2cf2}-\u{2cf8}\u{2d00}-\u{2d7e}\u{2d80}-\u{2ddf}\u{2e5e}-\u{2e7f}\u{2e9a}\u{2ef4}-\u{2eff}\u{2fd6}-\u{2fef}\u{3005}-\u{3007}\u{3021}-\u{3029}\u{302e}-\u{302f}\u{3031}-\u{3035}\u{3038}-\u{303c}\u{3040}-\u{3098}\u{309d}-\u{309f}\u{30a1}-\u{30fa}\u{30fc}-\u{31bf}\u{31e6}-\u{31ee}\u{31f0}-\u{321c}\u{321f}-\u{324f}\u{3260}-\u{327b}\u{327f}-\u{32b0}\u{32c0}-\u{32cb}\u{32d0}-\u{3376}\u{337b}-\u{33dd}\u{33e0}-\u{33fe}\u{3400}-\u{4dbf}\u{4e00}-\u{a48f}\u{a4c7}-\u{a60c}\u{a610}-\u{a66e}\u{a680}-\u{a69d}\u{a6a0}-\u{a6ef}\u{a6f2}-\u{a6ff}\u{a722}-\u{a787}\u{a789}-\u{a801}\u{a803}-\u{a805}\u{a807}-\u{a80a}\u{a80c}-\u{a824}\u{a827}\u{a82d}-\u{a837}\u{a83a}-\u{a873}\u{a878}-\u{a8c3}\u{a8c6}-\u{a8df}\u{a8f2}-\u{a8fe}\u{a900}-\u{a925}\u{a92e}-\u{a946}\u{a952}-\u{a97f}\u{a983}-\u{a9b2}\u{a9b4}-\u{a9b5}\u{a9ba}-\u{a9bb}\u{a9be}-\u{a9e4}\u{a9e6}-\u{aa28}\u{aa2f}-\u{aa30}\u{aa33}-\u{aa34}\u{aa37}-\u{aa42}\u{aa44}-\u{aa4b}\u{aa4d}-\u{aa7b}\u{aa7d}-\u{aaaf}\u{aab1}\u{aab5}-\u{aab6}\u{aab9}-\u{aabd}\u{aac0}\u{aac2}-\u{aaeb}\u{aaee}-\u{aaf5}\u{aaf7}-\u{ab69}\u{ab6c}-\u{abe4}\u{abe6}-\u{abe7}\u{abe9}-\u{abec}\u{abee}-\u{fb1c}\u{fe1a}-\u{fe1f}\u{fe53}\u{fe67}\u{fe6c}-\u{fe6f}\u{ff00}\u{ff21}-\u{ff3a}\u{ff41}-\u{ff5a}\u{ff66}-\u{ffdf}\u{ffe7}\u{ffef}\u{10000}-\u{10100}\u{10102}-\u{1013f}\u{1018d}-\u{1018f}\u{1019d}-\u{1019f}\u{101a1}-\u{101fc}\u{101fe}-\u{102df}\u{102fc}-\u{10375}\u{1037b}-\u{107ff}\u{11000}\u{11002}-\u{11037}\u{11047}-\u{11051}\u{11066}-\u{1106f}\u{11071}-\u{11072}\u{11075}-\u{1107e}\u{11082}-\u{110b2}\u{110b7}-\u{110b8}\u{110bb}-\u{110c1}\u{110c3}-\u{110ff}\u{11103}-\u{11126}\u{1112c}\u{11135}-\u{11172}\u{11174}-\u{1117f}\u{11182}-\u{111b5}\u{111bf}-\u{111c8}\u{111cd}-\u{111ce}\u{111d0}-\u{1122e}\u{11232}-\u{11233}\u{11235}\u{11238}-\u{1123d}\u{1123f}-\u{11240}\u{11242}-\u{112de}\u{112e0}-\u{112e2}\u{112eb}-\u{112ff}\u{11302}-\u{1133a}\u{1133d}-\u{1133f}\u{11341}-\u{11365}\u{1136d}-\u{1136f}\u{11375}-\u{113ba}\u{113c1}-\u{113cd}\u{113cf}\u{113d1}\u{113d3}-\u{113e0}\u{113e3}-\u{11437}\u{11440}-\u{11441}\u{11445}\u{11447}-\u{1145d}\u{1145f}-\u{114b2}\u{114b9}\u{114bb}-\u{114be}\u{114c1}\u{114c4}-\u{115b1}\u{115b6}-\u{115bb}\u{115be}\u{115c1}-\u{115db}\u{115de}-\u{11632}\u{1163b}-\u{1163c}\u{1163e}\u{11641}-\u{1165f}\u{1166d}-\u{116aa}\u{116ac}\u{116ae}-\u{116af}\u{116b6}\u{116b8}-\u{1171c}\u{1171e}\u{11720}-\u{11721}\u{11726}\u{1172c}-\u{1182e}\u{11838}\u{1183b}-\u{1193a}\u{1193d}\u{1193f}-\u{11942}\u{11944}-\u{119d3}\u{119d8}-\u{119d9}\u{119dc}-\u{119df}\u{119e1}-\u{11a00}\u{11a07}-\u{11a08}\u{11a0b}-\u{11a32}\u{11a39}-\u{11a3a}\u{11a3f}-\u{11a46}\u{11a48}-\u{11a50}\u{11a57}-\u{11a58}\u{11a5c}-\u{11a89}\u{11a97}\u{11a9a}-\u{11b5f}\u{11b61}\u{11b65}\u{11b67}-\u{11c2f}\u{11c37}\u{11c3e}-\u{11c91}\u{11ca8}-\u{11ca9}\u{11cb1}\u{11cb4}\u{11cb7}-\u{11d30}\u{11d37}-\u{11d39}\u{11d3b}\u{11d3e}\u{11d46}\u{11d48}-\u{11d8f}\u{11d92}-\u{11d94}\u{11d96}\u{11d98}-\u{11ef2}\u{11ef5}-\u{11eff}\u{11f02}-\u{11f35}\u{11f3b}-\u{11f3f}\u{11f41}\u{11f43}-\u{11f59}\u{11f5b}-\u{11fd4}\u{11ff2}-\u{1343f}\u{13441}-\u{13446}\u{13456}-\u{1611d}\u{1612a}-\u{1612c}\u{16130}-\u{16aef}\u{16af5}-\u{16b2f}\u{16b37}-\u{16f4e}\u{16f50}-\u{16f8e}\u{16f93}-\u{16fe1}\u{16fe3}\u{16fe5}-\u{1bc9c}\u{1bc9f}\u{1bca4}-\u{1cbff}\u{1ccd6}-\u{1ccef}\u{1ccfd}-\u{1ccff}\u{1ceb4}-\u{1ceb9}\u{1ced1}-\u{1cedf}\u{1cef1}-\u{1ceff}\u{1cf2e}-\u{1cf2f}\u{1cf47}-\u{1d166}\u{1d16a}-\u{1d172}\u{1d183}-\u{1d184}\u{1d18c}-\u{1d1a9}\u{1d1ae}-\u{1d1e8}\u{1d1eb}-\u{1d1ff}\u{1d246}-\u{1d2ff}\u{1d357}-\u{1d6c0}\u{1d6c2}-\u{1d6da}\u{1d6dc}-\u{1d6fa}\u{1d6fc}-\u{1d714}\u{1d716}-\u{1d734}\u{1d736}-\u{1d74e}\u{1d750}-\u{1d76e}\u{1d770}-\u{1d788}\u{1d78a}-\u{1d7a8}\u{1d7aa}-\u{1d7c2}\u{1d7c4}-\u{1d7cd}\u{1d800}-\u{1d9ff}\u{1da37}-\u{1da3a}\u{1da6d}-\u{1da74}\u{1da76}-\u{1da83}\u{1da85}-\u{1da9a}\u{1daa0}\u{1dab0}-\u{1dfff}\u{1e007}\u{1e019}-\u{1e01a}\u{1e022}\u{1e025}\u{1e02b}-\u{1e08e}\u{1e090}-\u{1e12f}\u{1e137}-\u{1e2ad}\u{1e2af}-\u{1e2eb}\u{1e2f0}-\u{1e2fe}\u{1e300}-\u{1e4eb}\u{1e4f0}-\u{1e5ed}\u{1e5f0}-\u{1e6e2}\u{1e6e4}-\u{1e6e5}\u{1e6e7}-\u{1e6ed}\u{1e6f0}-\u{1e6f4}\u{1e6f6}-\u{1e7ff}\u{1f02c}-\u{1f02f}\u{1f094}-\u{1f09f}\u{1f0af}-\u{1f0b0}\u{1f0c0}\u{1f0d0}\u{1f0f6}-\u{1f0ff}\u{1f110}-\u{1f12e}\u{1f130}-\u{1f169}\u{1f170}-\u{1f1ac}\u{1f1ae}-\u{1f25f}\u{1f266}-\u{1f2ff}\u{1f6d9}-\u{1f6db}\u{1f6ed}-\u{1f6ef}\u{1f6fd}-\u{1f6ff}\u{1f7da}-\u{1f7df}\u{1f7ec}-\u{1f7ef}\u{1f7f1}-\u{1f7ff}\u{1f80c}-\u{1f80f}\u{1f848}-\u{1f84f}\u{1f85a}-\u{1f85f}\u{1f888}-\u{1f88f}\u{1f8ae}-\u{1f8af}\u{1f8bc}-\u{1f8bf}\u{1f8c2}-\u{1f8cf}\u{1f8d9}-\u{1f8ff}\u{1fa58}-\u{1fa5f}\u{1fa6e}-\u{1fa6f}\u{1fa7d}-\u{1fa7f}\u{1fa8b}-\u{1fa8d}\u{1fac7}\u{1fac9}-\u{1facc}\u{1fadd}-\u{1fade}\u{1faeb}-\u{1faee}\u{1faf9}-\u{1faff}\u{1fb93}\u{1fbfb}-\u{1fffd}\u{20000}-\u{2fffd}\u{30000}-\u{3fffd}\u{40000}-\u{4fffd}\u{50000}-\u{5fffd}\u{60000}-\u{6fffd}\u{70000}-\u{7fffd}\u{80000}-\u{8fffd}\u{90000}-\u{9fffd}\u{a0000}-\u{afffd}\u{b0000}-\u{bfffd}\u{c0000}-\u{cfffd}\u{d0000}-\u{dfffd}\u{e1000}-\u{efffd}\u{f0000}-\u{ffffd}\u{100000}-\u{10fffd}]/u
const bidiArabicNumber = /[\u{600}-\u{605}\u{660}-\u{669}\u{66b}-\u{66c}\u{6dd}\u{890}-\u{891}\u{8e2}\u{10d30}-\u{10d39}\u{10d40}-\u{10d49}\u{10e60}-\u{10e7e}]/u
const bidiEuropeanNumber = /[\u{30}-\u{39}\u{b2}-\u{b3}\u{b9}\u{6f0}-\u{6f9}\u{2070}\u{2074}-\u{2079}\u{2080}-\u{2089}\u{2488}-\u{249b}\u{ff10}-\u{ff19}\u{102e1}-\u{102fb}\u{1ccf0}-\u{1ccf9}\u{1d7ce}-\u{1d7ff}\u{1f100}-\u{1f10a}\u{1fbf0}-\u{1fbf9}]/u

function estimateDirection(text: string, direction: TextPlanMeasureState['direction']): { direction: 'ltr' | 'rtl'; mixed: boolean } {
  let first: 'ltr' | 'rtl' | undefined, left = false, right = false, europeanNumber = false, arabicNumber = false
  let neutral = false, arabicNumberRuns = 0, previousArabicNumber = false
  for (const character of text) {
    if (bidiRight.test(character)) { first ??= 'rtl'; right = true }
    else if (bidiLeft.test(character)) { first ??= 'ltr'; left = true }
    europeanNumber ||= bidiEuropeanNumber.test(character)
    const an = bidiArabicNumber.test(character)
    arabicNumber ||= an
    if (an && !previousArabicNumber) arabicNumberRuns++
    previousArabicNumber = an
    neutral ||= !bidiRight.test(character) && !bidiLeft.test(character) && !bidiEuropeanNumber.test(character) && !an && !/\p{M}/u.test(character)
  }
  const resolved = first ?? (europeanNumber || arabicNumber || direction === 'inherit' ? 'ltr' : direction)
  // 只估计单一方向及单段 AN；中性字符跨方向、分隔数字串和括号需要完整 UBA，不能当成推进误差。
  const complex = neutral && direction !== 'inherit' && direction !== resolved || arabicNumberRuns > 1 || arabicNumber && !first && neutral || /[()[\]{}\u202a-\u202e\u2066-\u2069]/u.test(text)
  return { direction: resolved, mixed: right && (left || europeanNumber) || complex }
}

function rtlGraphemeOffsets(characters: ReturnType<typeof textCharacters>, amounts: number[], width: number): number[] {
  const offsets: number[] = []
  let consumed = 0
  for (let i = 0; i < characters.length;) {
    if (bidiArabicNumber.test(characters[i].source)) {
      let end = i, span = 0
      while (end < characters.length && bidiArabicNumber.test(characters[end].source)) span += amounts[end++]
      let x = width - consumed - span
      while (i < end) { offsets.push(x); x += amounts[i++] }
      consumed += span
    } else { consumed += amounts[i++]; offsets.push(width - consumed) }
  }
  return offsets
}

function placedAlphabeticBaseline(middle: number, style: TextStyle, placement: TextDrawConstraints['alphabeticPlacement'], alpha?: number | TextPlanMetrics): number {
  const delta = typeof alpha === 'object' && alpha.fontBoundingBoxAscent !== undefined && alpha.fontBoundingBoxDescent !== undefined ? (alpha.fontBoundingBoxAscent - alpha.fontBoundingBoxDescent) / 2 : style.fontSize * .3
  return middle + (placement === 'font' ? delta : style.fontSize * .3)
}

function resolveBaselines(middle: number, size: number, style: TextStyle, constraints: TextDrawConstraints, direction: TextPlanMeasureState['direction'], measure: TextPlanMeasure): TextPlanBaselines {
  const font = textFont(style, size), state = measureState(style, direction)
  const mid = measure('Hg汉', font, state), alpha = measure('Hg汉', font, { ...state, textBaseline: 'alphabetic' })
  const measured = typeof mid !== 'number' && typeof alpha !== 'number' && mid.actualBoundingBoxAscent !== undefined && alpha.actualBoundingBoxAscent !== undefined
  const delta = measured ? alpha.actualBoundingBoxAscent! - mid.actualBoundingBoxAscent! : size * .3
  const alphabeticBaseline = constraints.baseline === 'alphabetic' ? placedAlphabeticBaseline(middle, style, constraints.alphabeticPlacement, alpha) : middle + delta
  const middleBaseline = constraints.baseline === 'alphabetic' ? alphabeticBaseline - delta : middle
  return { baselineKind: constraints.baseline ?? 'middle', baseline: constraints.baseline === 'alphabetic' ? alphabeticBaseline : middleBaseline, middleBaseline, alphabeticBaseline, baselineConversion: measured ? 'measured' : 'estimated' }
}

function plainSeed(text: string, style: TextStyle, constraints: TextDrawConstraints, measure: (text: string, font: string) => number): PlanSeed {
  const frame = constraints.frame ?? { width: 1, height: 1 }
  const wrapWidth = constraints.wrap === 'none' ? 0 : constraints.wrapWidth ?? style.boxWidth * frame.width
  const rich = layoutRichTextFlow({ box: { x: 0, y: 0, width: wrapWidth, height: 0 }, paragraphs: [{ runs: [{ text, style }], align: 'left', direction: 'ltr', spaceBefore: 0, spaceAfter: 0 }] }, measure, { ...evaluation, signal: constraints.signal }, constraints.wrap === 'word' ? 'word' : 'grapheme')
  const ranges = lineRanges(text, rich.lines.map(line => line.text))
  const spans = [{ start: 0, end: text.length, paragraph: 0, run: 0, style }]
  const omittedRanges: TextDrawPlan['omittedRanges'] = []
  const lines = rich.lines.map((line, i) => {
    if (!constraints.trim) return line.text
    const trimmed = line.text.trim(), leading = line.text.length - line.text.trimStart().length
    const start = ranges[i].start, end = ranges[i].end
    ranges[i] = { start: start + leading, end: start + leading + trimmed.length }
    for (const [from, to] of [[start, start + leading], [ranges[i].end, end]]) {
      if (to > from) omittedRanges.push(...sourceRanges(spans, from, to - from).map(range => ({ ...range, reason: 'trim' as const })))
    }
    return trimmed
  })
  const widths = lines.map(line => textWidth(line, style, measure))
  if (constraints.letterSpacing !== undefined && widths.some(width => width < 0)) throw new TextDrawPlanError('BUDGET', 'letterSpacing 使文字宽度小于零，请减小负字距。')
  const contentWidth = Math.max(0, ...widths)
  const layout = textBoxLayout(lines, style, contentWidth, {
    width: constraints.box?.width ?? (style.boxWidth * frame.width || undefined),
    height: constraints.box?.height ?? (style.boxHeight * frame.height || undefined),
    minimumWidth: constraints.minimumWidth, anchor: constraints.anchor,
  })
  const { left, top, width, contentTop, height, lineHeight } = layout
  const contentSize = { width: contentWidth, height: lines.length * lineHeight }
  return {
    kind: 'plain', autoHeight: constraints.box?.height === undefined && !style.boxHeight, anchorVertical: constraints.anchor?.vertical ?? 0,
    sourceText: text, spans,
    lines: lines.map((line, i) => lineRecord(line, ranges[i].start, ranges[i].end, left, contentTop + i * lineHeight, widths[i], lineHeight)),
    batches: [{ layout, direction: constraints.direction ?? 'inherit', rows: ranges.map((range, line) => ({ line, start: range.start, originalIndex: line })), totalRows: lines.length }],
    box: { x: left, y: top, width, height }, contentTop, contentSize, visibleContentSize: contentSize, totalLines: lines.length, omittedRanges,
    probe: { overhang: 0, ascent: 0, descent: 0 },
  }
}

function richSeed(content: RichTextContent, constraints: TextDrawConstraints, measure: TextPlanMeasure): PlanSeed {
  const spans: SourceSpan[] = []
  let sourceText = ''
  for (const [paragraph, value] of content.paragraphs.entries()) {
    if (paragraph) sourceText += '\n'
    for (const [run, item] of value.runs.entries()) {
      const start = sourceText.length
      sourceText += item.text
      spans.push({ start, end: sourceText.length, paragraph, run, style: item.style })
    }
  }
  const flowState = { fontKerning: 'auto', direction: 'inherit', textBaseline: 'middle', textAlign: 'left' } as const
  const advance = (text: string, font: string): number => {
    // 富文本宿主的段落度量保留新 Canvas 的 auto；外层基准样式不能覆盖各 run 的换行。
    const result = measure(text, font, flowState)
    return typeof result === 'number' ? result : result.width
  }
  const flowWidth = constraints.wrap === 'none' ? 0 : constraints.wrapWidth ?? content.box.width
  const flow = layoutRichTextFlow({ ...content, box: { ...content.box, width: flowWidth, height: 0 } }, advance, { ...evaluation, signal: constraints.signal }, constraints.wrap === 'word' ? 'word' : 'grapheme')
  const ranges = lineRanges(sourceText, flow.lines.map(line => line.text))
  const omittedRanges: TextDrawPlan['omittedRanges'] = []
  if (constraints.trim) for (const [index, line] of flow.lines.entries()) {
    const text = line.text.trim(), skip = line.text.length - line.text.trimStart().length
    const start = ranges[index].start + skip, end = start + text.length
    for (const [from, to] of [[ranges[index].start, start], [end, ranges[index].end]]) if (to > from) omittedRanges.push(...sourceRanges(spans, from, to - from).map(range => ({ ...range, reason: 'trim' as const })))
    let cursor = ranges[index].start
    line.runs = line.runs.flatMap(run => {
      const from = Math.max(start, cursor), to = Math.min(end, cursor + run.text.length), offset = cursor
      cursor += run.text.length
      return to > from ? [{ ...run, text: run.text.slice(from - offset, to - offset) }] : []
    })
    line.text = text; line.width = line.runs.reduce((sum, run) => sum + textWidth(run.text, run.style, advance), 0)
    ranges[index] = { start, end }
  }
  const box = { ...content.box, width: constraints.box?.width ?? (content.box.width || flow.width), height: constraints.box?.height ?? (content.box.height || flow.height) }
  if (constraints.anchor) {
    box.x = constraints.anchor.x - constraints.anchor.horizontal * box.width
    box.y = constraints.anchor.y - constraints.anchor.vertical * box.height
  }
  const vertical = content.paragraphs.find(paragraph => paragraph.runs.length)?.runs[0].style.verticalAlign ?? 'top'
  const position = positionRichTextFlow(flow, { ...box, width: constraints.box?.width ?? (content.box.width || flowWidth) }, advance, vertical)
  const lines = position.lines.map((line, index) => lineRecord(line.text, ranges[index].start, ranges[index].end, box.x, line.y, line.width, line.lineHeight))
  const batches: PlanSeed['batches'] = []
  for (const [index, positioned] of position.rowRuns.entries()) {
    const logical = positioned[0]?.direction === 'rtl' ? [...positioned].reverse() : positioned
    const starts = new Map<typeof positioned[number], number>()
    let cursor = ranges[index].start
    for (const run of logical) { starts.set(run, cursor); cursor += run.text.length }
    for (const run of positioned) {
      const runStyle = { ...run.style, align: 'left' as const, verticalAlign: 'top' as const, boxWidth: 0, boxHeight: 0 }
      batches.push({ layout: { lines: [run.text], left: run.x, top: run.y, contentTop: run.y, width: run.width, height: run.lineHeight, lineHeight: run.lineHeight, style: runStyle }, direction: run.direction === 'auto' ? 'inherit' : run.direction, rows: [{ line: index, start: starts.get(run)!, originalIndex: 0 }], totalRows: 1 })
    }
  }
  const contentSize = { width: Math.max(0, ...lines.map(line => line.width)), height: flow.height }
  const { contentTop } = position
  return { kind: 'rich', autoHeight: constraints.box?.height === undefined && !content.box.height, anchorVertical: constraints.anchor?.vertical ?? 0, sourceText, spans, lines, batches, box, contentTop, contentSize, visibleContentSize: contentSize, totalLines: lines.length, omittedRanges, probe: { overhang: 0, ascent: 0, descent: 0 } }
}

function appearanceBounds(ink: TextPlanRect | null, layout: TextLayout): TextPlanRect | null {
  const { style } = layout
  const outlineBounds = (rect: TextPlanRect, radius: number): TextPlanRect => {
    const result = expand(rect, radius)
    const shearPad = style.fauxItalic ? radius * .2 : 0
    return { ...result, x: result.x - shearPad, width: result.width + 2 * shearPad }
  }
  let result: TextPlanRect | null = null
  if (ink) {
    const strokes = style.strokes.filter(stroke => stroke.enabled && stroke.width)
    if (style.fill.enabled) result = ink
    for (const stroke of strokes) result = union(result, outlineBounds(ink, stroke.position === 'inside' ? 0 : stroke.width * (stroke.position === 'center' ? .5 : 1)))
    for (const shadow of style.shadows) if (shadow.enabled && shadow.opacity) {
      // 阴影覆盖包含内描边的完整轮廓；这与可见内描边裁入字形的范围不同。
      const radius = Math.max(0, ...strokes.map(stroke => stroke.width * (stroke.position === 'center' ? .5 : 1))) + shadow.size
      const angle = shadow.angle * Math.PI / 180
      result = union(result, expand(outlineBounds(ink, radius), shadow.blur * 4, Math.cos(angle) * shadow.distance, Math.sin(angle) * shadow.distance))
    }
  }
  if (style.background.enabled && style.background.opacity) result = union(result, expand({ x: layout.left, y: layout.top, width: layout.width, height: layout.height }, style.background.padding))
  return result
}

function assemble(seed: PlanSeed, style: TextStyle, constraints: TextDrawConstraints, measure: TextPlanMeasure): TextDrawPlan {
  const groups: TextDrawGroup[] = [], graphemes: TextPlanGrapheme[] = [], batches: TextDrawBatch[] = []
  const describeRows: Array<() => void> = []
  const rasterBatches: Array<() => TextPlanRect> = []
  let inkBounds: TextPlanRect | null = null, paintedBounds: TextPlanRect | null = null, rasterBounds: TextPlanRect | null = null
  let measuredBounds = true
  for (const batch of seed.batches) {
    const { layout, direction } = batch
    const style = layout.style, state = measureState(style, direction)
    let { overhang, ascent, descent } = seed.probe
    const metrics = (text: string, font: string): TextPlanMetrics => {
      const result = measure(text, font, state)
      const value = typeof result === 'number' ? { width: result } : result
      overhang = Math.max(overhang, value.actualBoundingBoxLeft || 0, (value.actualBoundingBoxRight || value.width) - value.width)
      ascent = Math.max(ascent, value.actualBoundingBoxAscent || 0)
      descent = Math.max(descent, value.actualBoundingBoxDescent || 0)
      return value
    }
    const advance = (text: string, font: string): number => metrics(text, font).width
    const drawBatch: TextDrawBatch = { layout, direction, fontKerning: constraints.fontKerning ?? state.fontKerning, groups: [], rows: [] }
    let batchInk: TextPlanRect | null = null
    let left = layout.left, right = layout.left + layout.width
    const rasterRows: Array<() => void> = []
    for (const [row, line] of layout.lines.entries()) {
      const sourceRow = batch.rows[row], lineIndex = sourceRow.line, plannedLine = seed.lines[lineIndex]
      let characters: ReturnType<typeof textCharacters> | undefined, advances: number[] | undefined
      const chars = (): ReturnType<typeof textCharacters> => characters ??= textCharacters(line, style)
      const steps = (): number[] => advances ??= textAdvances(line, style, advance)
      const naturalWidth = textWidth(line, style, advance)
      const justify = style.align.startsWith('justify') && (style.align === 'justify-all' || sourceRow.originalIndex < batch.totalRows - 1)
      const spaces = justify ? chars().filter(character => /\s/u.test(character.text)).length : 0
      const slots = justify ? spaces || Math.max(0, chars().length - 1) : 0
      const extra = justify && slots ? Math.max(0, layout.width - naturalWidth) / slots : 0
      const offset = justify ? 0 : style.align === 'center' || style.align === 'justify-center' ? (layout.width - naturalWidth) / 2 : style.align === 'right' || style.align === 'justify-right' ? layout.width - naturalWidth : 0
      const x = layout.left + offset
      const middle = plannedLine.y + .5 * layout.lineHeight - style.baselineShift + (style.superscript ? -style.fontSize * .35 : style.subscript ? style.fontSize * .2 : 0)
      const lineBaselines = resolveBaselines(middle, style.fontSize, style, constraints, direction, measure)
      if (!plannedLine.groups.length) { plannedLine.x = x; Object.assign(plannedLine, lineBaselines) }
      const custom = style.smallCaps || style.superscript || style.subscript || style.tracking !== 0 || style.kerning !== 'auto' || style.tsume !== 0 || extra > 0 || constraints.forceGraphemes
      const drawRow: TextDrawBatch['rows'][number] = { groups: [] }
      const addGroup = (text: string, size: number, at: number): number => {
        const font = textFont(style, size), value = metrics(text, font)
        const baselines = resolveBaselines(middle, size, style, constraints, direction, measure)
        const measured = [value.actualBoundingBoxLeft, value.actualBoundingBoxRight, value.actualBoundingBoxAscent, value.actualBoundingBoxDescent].every(item => item !== undefined && Number.isFinite(item))
        measuredBounds &&= measured
        let ink: TextPlanRect | null = null
        if (text && (measured ? value.actualBoundingBoxLeft || value.actualBoundingBoxRight || value.actualBoundingBoxAscent || value.actualBoundingBoxDescent : value.width)) {
          const l = measured ? -value.actualBoundingBoxLeft! : -size
          const r = measured ? value.actualBoundingBoxRight! : value.width + size
          const t = measured ? -value.actualBoundingBoxAscent! : -size
          const b = measured ? value.actualBoundingBoxDescent! : size
          const bold = style.fauxBold ? Math.max(.5, size / 30) / 2 : 0
          const shear = style.fauxItalic ? -.2 : 0
          const baselineDelta = baselines.middleBaseline - baselines.baseline
          const x1 = Math.min(l + shear * (t + baselineDelta), l + shear * (b + baselineDelta)) - bold * (1 + Math.abs(shear))
          const x2 = Math.max(r + shear * (t + baselineDelta), r + shear * (b + baselineDelta)) + bold * (1 + Math.abs(shear))
          ink = { x: at + x1, y: baselines.middleBaseline + t - bold, width: x2 - x1, height: b - t + bold * 2 }
        }
        const id = groups.length
        groups.push({ text, font, size, x: at, ...baselines, style, graphemes: [], indivisible: !custom, inkBounds: ink })
        drawBatch.groups.push(id); drawRow.groups.push(id); plannedLine.groups.push(id)
        batchInk = union(batchInk, ink)
        return id
      }
      const nativeGroup = custom ? -1 : addGroup(style.allCaps ? line.toLocaleUpperCase() : line, style.fontSize, x)
      let cursor = x
      const flow = constraints.forceGraphemes ? estimateDirection(line, direction) : undefined
      if (flow?.mixed) throw new TextDrawPlanError('BUDGET', '双向混排需要整体塑形，不能强制拆成字素绘制。')
      let amounts: number[] | undefined
      const portions = (): number[] => {
        if (!amounts) {
          const totalAdvance = steps().reduce((sum, value) => sum + value, 0)
          amounts = chars().map((character, index) => custom
            ? steps()[index] + (spaces ? /\s/u.test(character.text) ? extra : 0 : index < chars().length - 1 ? extra : 0)
            : totalAdvance ? steps()[index] * naturalWidth / totalAdvance : 0)
        }
        return amounts
      }
      const rtlOffsets = flow?.direction === 'rtl' ? rtlGraphemeOffsets(chars(), portions(), naturalWidth + (custom ? extra * slots : 0)) : []
      const characterGroups: number[] = []
      if (custom) for (const [index, character] of chars().entries()) {
        const forcedAt = flow?.direction === 'rtl' ? x + rtlOffsets[index] : cursor
        characterGroups.push(addGroup(character.text, character.size, forcedAt))
        cursor += portions()[index]
      }
      // 纹理分配保留逐字推进的保守边界。
      rasterRows.push(() => {
        let cursor = x
        for (const [index, character] of chars().entries()) {
          const width = advance(character.text, textFont(style, character.size))
          left = Math.min(left, cursor); right = Math.max(right, cursor + width)
          cursor += steps()[index] + (spaces ? /\s/u.test(character.text) ? extra : 0 : index < chars().length - 1 ? extra : 0)
        }
      })
      // 字素与纹理度量在同次构建中完成，不能跨字体加载状态读取。
      describeRows.push(() => {
        const flow = estimateDirection(line, direction)
        const offsets = flow.direction === 'rtl' ? rtlGraphemeOffsets(chars(), portions(), naturalWidth + (custom ? extra * slots : 0)) : []
        let source = sourceRow.start, estimatedAdvance = 0
        for (const [index, character] of chars().entries()) {
          const id = custom ? characterGroups[index] : nativeGroup, group = groups[id], amount = portions()[index]
          const at = custom ? group.x : flow.mixed ? null : flow.direction === 'rtl' ? x + offsets[index] : x + estimatedAdvance
          const graphemeId = graphemes.length
          graphemes.push({ text: character.source, displayText: character.text, source: { start: source, end: source + character.source.length }, sources: sourceRanges(seed.spans, source, character.source.length), style: seed.spans.find(span => span.start <= source && span.end > source)!.style, line: lineIndex, group: id, x: at, y: group.baseline, baseline: group.baseline, baselineKind: group.baselineKind, middleBaseline: group.middleBaseline, alphabeticBaseline: group.alphabeticBaseline, baselineConversion: group.baselineConversion, advance: amount, positionKind: custom ? 'individual' : flow.mixed ? 'unavailable' : 'native-estimate' })
          group.graphemes.push(graphemeId)
          source += character.source.length; estimatedAdvance += amount
        }
      })
      if (style.underline) {
        const underline = { x, y: lineBaselines.middleBaseline + style.fontSize * .45, width: justify ? layout.width : naturalWidth, height: Math.max(1, style.fontSize / 20) }
        drawRow.underline = underline; batchInk = union(batchInk, underline)
      }
      drawBatch.rows.push(drawRow)
    }
    batches.push(drawBatch)
    inkBounds = union(inkBounds, batchInk)
    paintedBounds = union(paintedBounds, appearanceBounds(batchInk, layout))
    rasterBatches.push(() => {
      for (const row of rasterRows) row()
      const glyphPad = Math.max(style.fontSize, overhang, ascent, descent) + (style.fauxItalic ? style.fontSize * .4 : 0)
      const strokePad = Math.max(0, ...style.strokes.filter(stroke => stroke.enabled).map(stroke => stroke.position === 'inside' ? 0 : stroke.width))
      const shadowPad = Math.max(0, ...style.shadows.filter(shadow => shadow.enabled && shadow.opacity).map(shadow => shadow.distance + shadow.size + shadow.blur * 4))
      const pad = Math.ceil(Math.max(strokePad + shadowPad, style.background.enabled ? style.background.padding : 0) + glyphPad + 2)
      const shift = -style.baselineShift + (style.superscript ? -style.fontSize * .35 : style.subscript ? style.fontSize * .2 : 0)
      const origin = constraints.rasterOrigin ?? { x: 0, y: 0 }
      const x = Math.floor(left - origin.x - pad), y = Math.floor(Math.min(layout.top, layout.contentTop + shift) - origin.y - pad)
      return { x, y, width: Math.max(1, Math.ceil(right - origin.x - x + pad)), height: Math.max(1, Math.ceil(Math.max(layout.top + layout.height, layout.contentTop + layout.lines.length * layout.lineHeight + shift) - origin.y - y + pad)) }
    })
  }
  const { maxWidth, maxHeight } = constraints
  for (const row of describeRows) row()
  rasterBounds = rasterBatches.reduce<TextPlanRect | null>((bounds, batch) => union(bounds, batch()), null) ?? { ...seed.box, x: seed.box.x - (constraints.rasterOrigin?.x ?? 0), y: seed.box.y - (constraints.rasterOrigin?.y ?? 0) }
  return {
    sourceText: seed.sourceText, style, lines: seed.lines, graphemes, groups, batches, box: seed.box, contentTop: seed.contentTop,
    contentSize: seed.contentSize, visibleContentSize: seed.visibleContentSize, inkBounds, appearanceBounds: paintedBounds,
    boundsKind: measuredBounds ? 'measured' : 'estimated', rasterBounds,
    overflow: { full: seedOverflow(seed, constraints), visible: { width: maxWidth !== undefined && seed.visibleContentSize.width > maxWidth, height: maxHeight !== undefined && seed.visibleContentSize.height > maxHeight, lines: constraints.maxLines !== undefined && seed.lines.length > constraints.maxLines } },
    truncated: seed.lines.length < seed.totalLines, omittedRanges: seed.omittedRanges, totalLines: seed.totalLines,
    fit: { applied: false, failed: false, fontSize: style.fontSize, scale: 1 },
  }
}

function selectTextPlan(input: string | RichTextContent, textStyle: TextStyle, constraints: TextDrawConstraints, measureInput: TextPlanMeasure): { seed: PlanSeed; style: TextStyle; measure: TextPlanMeasure; fit: TextDrawPlan['fit'] } {
  if (!Number.isFinite(textStyle.fontSize) || textStyle.fontSize < 1 || !Number.isFinite(textStyle.fontWeight)) throw new TextDrawPlanError('BUDGET', '文字字号或字重无效。')
  for (const value of [constraints.maxWidth, constraints.maxHeight, constraints.wrapWidth, constraints.box?.width, constraints.box?.height]) if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new TextDrawPlanError('BUDGET', '文字约束尺寸必须为有限正数。')
  if (constraints.maxLines !== undefined && (!Number.isInteger(constraints.maxLines) || constraints.maxLines < 1)) throw new TextDrawPlanError('BUDGET', '最大行数必须为正整数。')
  if (constraints.frame && ![constraints.frame.width, constraints.frame.height].every(value => Number.isFinite(value) && value > 0)) throw new TextDrawPlanError('BUDGET', '作品画幅必须为有限正数。')
  if (constraints.anchor && !Object.values(constraints.anchor).every(Number.isFinite)) throw new TextDrawPlanError('BUDGET', '文字锚点必须为有限数值。')
  if (constraints.rasterOrigin && !Object.values(constraints.rasterOrigin).every(Number.isFinite)) throw new TextDrawPlanError('BUDGET', '纹理原点必须为有限数值。')
  if (constraints.letterSpacing !== undefined && !Number.isFinite(constraints.letterSpacing)) throw new TextDrawPlanError('BUDGET', '字距必须为有限数值。')
  if (typeof input === 'string' && !constraints.frame && (textStyle.boxWidth || textStyle.boxHeight)) throw new TextDrawPlanError('BUDGET', '比例文字框需要提供作品画幅。')
  const makeSeed = (size: number): { seed: PlanSeed; style: TextStyle; measure: TextPlanMeasure } => {
    const factor = size / textStyle.fontSize, styles = new Map<TextStyle, TextStyle>()
    const scaled = (value: TextStyle): TextStyle => {
      let result = styles.get(value)
      if (!result) {
        result = factor === 1 ? { ...value } : scaleTextSpatialStyle(value, factor)
        if (constraints.letterSpacing !== undefined) result.tracking = constraints.letterSpacing / result.fontSize * 1000
        styles.set(value, result)
      }
      return result
    }
    const style = scaled(textStyle)
    const probe = { overhang: 0, ascent: 0, descent: 0 }
    // 状态键不含正文；短片段以原字符串作 Map 键，长行不缓存，避免序列化所有前缀。
    const states = new WeakMap<TextPlanMeasureState, { state: TextPlanMeasureState; fonts: Map<string, Map<string, TextPlanMetrics>> }>()
    const cache = new Map<string, Map<string, Map<string, TextPlanMetrics>>>()
    let entries = 0
    const measure: TextPlanMeasure = (text, font, state) => {
      let entry = states.get(state)
      if (!entry) {
        const effective = { ...state, fontKerning: constraints.fontKerning ?? state.fontKerning }
        const key = `${effective.fontKerning}|${effective.direction}|${effective.textBaseline}`
        let fonts = cache.get(key)
        if (!fonts) { fonts = new Map(); cache.set(key, fonts) }
        entry = { state: effective, fonts }; states.set(state, entry)
      }
      state = entry.state
      let texts = entry.fonts.get(font)
      const cached = texts?.get(text)
      if (cached) return cached
      const value = measureInput(text, font, state), result = typeof value === 'number' ? { width: value } : value
      if (!Number.isFinite(result.width) || result.width < 0 || [result.actualBoundingBoxLeft, result.actualBoundingBoxRight, result.actualBoundingBoxAscent, result.actualBoundingBoxDescent, result.fontBoundingBoxAscent, result.fontBoundingBoxDescent].some(metric => metric !== undefined && !Number.isFinite(metric))) throw new TextDrawPlanError('CONTEXT', '字体度量无效。')
      if (state.textBaseline === 'middle') {
        probe.overhang = Math.max(probe.overhang, result.actualBoundingBoxLeft || 0, (result.actualBoundingBoxRight || result.width) - result.width)
        probe.ascent = Math.max(probe.ascent, result.actualBoundingBoxAscent || 0)
        probe.descent = Math.max(probe.descent, result.actualBoundingBoxDescent || 0)
      }
      if (text.length <= 128 && entries < 4096) {
        if (!texts) { texts = new Map(); entry.fonts.set(font, texts) }
        texts.set(text, result); entries++
      }
      return result
    }
    const state = measureState(style, constraints.direction ?? 'inherit')
    const seed = typeof input === 'string'
      ? plainSeed(input, style, constraints, (text, font) => { const value = measure(text, font, state); return typeof value === 'number' ? value : value.width })
      : richSeed({ ...input, paragraphs: input.paragraphs.map((paragraph): TextParagraph => ({ ...paragraph, spaceBefore: paragraph.spaceBefore * factor, spaceAfter: paragraph.spaceAfter * factor, runs: paragraph.runs.map(run => ({ ...run, style: scaled(run.style) })) })) }, constraints, measure)
    seed.probe = probe
    return { seed, style, measure }
  }
  const fit = constraints.fit
  const fitActive = !!fit && (fit.trigger !== 'maxLines' || constraints.maxLines !== undefined)
  let selected = makeSeed(fitActive && fit ? fit.maxFontSize ?? textStyle.fontSize : textStyle.fontSize)
  const fits = (value: typeof selected): boolean => !Object.values(seedOverflow(value.seed, constraints)).some(Boolean)
  if (fit) {
    const min = fit.minFontSize, max = fit.maxFontSize ?? textStyle.fontSize, step = fit.step ?? 1, iterations = fit.iterations ?? 12
    if (![min, max, step].every(Number.isFinite) || min < 1 || max < min || step <= 0 || !Number.isSafeInteger(Math.floor((max - min) / step)) || !Number.isInteger(iterations) || iterations < 1 || iterations > 64) throw new TextDrawPlanError('BUDGET', '自动字号需要有效的上下限、步长和迭代次数。')
    if (fitActive && !fits(selected)) {
      selected = makeSeed(min)
      if (fit.algorithm === 'continuous') {
        let low = min, high = max
        for (let i = 0; i < iterations; i++) {
          const mid = (low + high) / 2, candidate = makeSeed(mid)
          if (fits(candidate)) { selected = candidate; low = mid } else high = mid
        }
      } else if (fits(selected)) {
        let low = 1, high = Math.floor((max - min) / step)
        while (low <= high) {
          const mid = Math.floor((low + high) / 2), candidate = makeSeed(min + mid * step)
          if (fits(candidate)) { selected = candidate; low = mid + 1 } else high = mid - 1
        }
      }
    }
  }
  const failed = fitActive && !fits(selected)
  return { ...selected, seed: limitSeed(selected.seed, constraints), fit: { applied: fitActive, failed, fontSize: selected.style.fontSize, scale: selected.style.fontSize / textStyle.fontSize, ...(failed ? { error: { code: 'BUDGET' as const, message: '最小字号仍无法满足文字约束。' } } : {}) } }
}

export interface TextLinePlan extends Pick<TextDrawPlan, 'style' | 'contentSize' | 'fit'> {
  lines: Array<Pick<TextPlanLine, 'text' | 'y' | 'width'>>
  /** 首行的 alphabetic 基线，和 lines[].y 使用相同局部坐标。 */
  baselineOffset: number
}
/** 作者 DTO 只需行几何与首行基线，不能为此前置创建绘制组、墨迹及动画字素。 */
export function createTextLinePlan(input: string, style: TextStyle, constraints: TextDrawConstraints, measure: TextPlanMeasure): TextLinePlan {
  const selected = selectTextPlan(input, style, constraints, measure)
  const first = selected.seed.lines[0]
  const middle = (first?.y ?? selected.seed.contentTop) + (first?.height ?? (selected.style.leading || selected.style.fontSize * 1.25)) / 2 - selected.style.baselineShift + (selected.style.superscript ? -selected.style.fontSize * .35 : selected.style.subscript ? selected.style.fontSize * .2 : 0)
  const direction = constraints.direction ?? 'inherit'
  const baselineOffset = constraints.baseline === 'alphabetic'
    ? placedAlphabeticBaseline(middle, selected.style, constraints.alphabeticPlacement, constraints.alphabeticPlacement === 'font' ? selected.measure('Hg汉', textFont(selected.style), { ...measureState(selected.style, direction), textBaseline: 'alphabetic' }) : undefined)
    : resolveBaselines(middle, selected.style.fontSize, selected.style, constraints, direction, selected.measure).alphabeticBaseline
  return { style: selected.style, lines: selected.seed.lines, contentSize: selected.seed.contentSize, fit: selected.fit, baselineOffset }
}

/** 候选字号仅布局行；选中字号的全部度量在构建时完成，计划读取不再访问字体环境。 */
export function createTextDrawPlan(input: string | RichTextContent, textStyle: TextStyle, constraints: TextDrawConstraints, measure: TextPlanMeasure): TextDrawPlan {
  const selected = selectTextPlan(input, textStyle, constraints, measure)
  const result = assemble(selected.seed, selected.style, constraints, selected.measure)
  result.fit = selected.fit
  return result
}

const legacySegments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
/** 仅供旧作者 DTO 兼容原生前缀塑形；新作者库只暴露普通计划的推进累加位置，禁止导出此接口。 */
export function legacyTextPlanGlyphs(plan: Pick<TextLinePlan, 'style' | 'lines'>, measure: TextPlanMeasure): Array<{ text: string; x: number; y: number; width: number }> {
  const output: Array<{ text: string; x: number; y: number; width: number }> = []
  const font = textFont(plan.style), spacing = plan.style.fontSize * plan.style.tracking / 1000
  const state: TextPlanMeasureState = { fontKerning: 'auto', direction: 'inherit', textBaseline: 'alphabetic', textAlign: 'left' }
  for (const line of plan.lines) {
    let prefix = '', previous = 0, index = 0
    for (const item of legacySegments.segment(line.text)) {
      prefix += item.segment
      const value = measure(prefix, font, state)
      const next = typeof value === 'number' ? value : value.width
      output.push({ text: item.segment, x: previous + index * spacing, y: line.y - plan.lines[0].y, width: next - previous })
      previous = next; index++
    }
  }
  return output
}
