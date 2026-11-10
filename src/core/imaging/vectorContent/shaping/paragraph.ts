import { analyzeText, HARD_BREAK, KIND_BITS, TEXT, SPACE, PRESERVED_SPACE, TAB, SOFT_HYPHEN, UNBROKEN, type TextAnalysis } from '../../../../../resources/video-edit-author/vendor/pretext/1.0.0/analysis.js'
import { findGraphemeEnds } from '../../../../../resources/video-edit-author/vendor/pretext/1.0.0/graphemes.js'
import { normalizePreparedLineStart, stepPreparedLineGeometryFromStart, isDiscretionaryLineEnd, type PreparedLineData } from '../../../../../resources/video-edit-author/vendor/pretext/1.0.0/line-break.js'
import { visualOrder, type BidiLevels } from './bidi'
import { type FontSource, type ShapeOptions, type ShapeResult, type ShapedGlyph, TextShaper } from './harfbuzz'
import { PunctuationPlanner, type PunctuationPlan } from './punctuation'

export interface ParagraphOptions extends ShapeOptions {
  maxWidth?: number
  lineHeight?: number
  autospace?: boolean
  wrap?: 'normal' | 'none' | 'grapheme'
  letterSpacing?: number
  tsume?: number
  spacing?: readonly { start: number; end: number; letterSpacing: number; tsume: number }[]
  /** 段内含从右到左文字时的 UAX #9 层级；缺省表示整段同一方向。 */
  bidi?: BidiLevels
  /** 文字新版接口只接受但忽略；编译器负责给作者提示。 */
  forceGraphemes?: boolean
}
export interface ParagraphRun {
  readonly start: number; readonly end: number
  readonly source: FontSource; readonly options: ShapeOptions & Pick<ParagraphOptions, 'letterSpacing' | 'tsume'>
}
export interface ParagraphLine {
  readonly start: number; readonly end: number; readonly width: number
  readonly contentEnd: number
  readonly glyphs: readonly ShapedGlyph[]
  /** 从右到左的行尾空白排在显示最左边且悬挂在栏外时，第一个字形的起点（负数）。 */
  readonly visualStart?: number
}
/** 每行可用宽度不同（分栏、绕排、缩进）时逐行询问；返回 null 表示放不下了，后面的字不再排。 */
export type LineWidthAt = (lineIndex: number) => number | null
export interface ParagraphLayout {
  readonly text: string
  readonly lines: readonly ParagraphLine[]
  readonly width: number; readonly height: number; readonly overflow: boolean
  /** 分栏或绕排的空间用完时，没排进去的文字从这里开始。 */
  readonly stoppedAt?: number
}
const profile = { lineBreakScan: 'blink', graphemeTable: 'chromium/char', hangTabs: true } as const
// 保留量化前精度；只在 walker 的 fit 边界转换，不逐 glyph 累计舍入误差。
// 可用宽度也走同一种取整：按文字自身的宽度再排一次必须放得下，否则差 1/64 像素就多折一行，末尾的字被行数上限裁掉。
export const layoutUnits = (width: number): number => Math.round(width * 64)
export function graphemeEnds(text: string): number[] {
  const ends = new Int32Array(text.length)
  return Array.from(ends.subarray(0, findGraphemeEnds('chromium/char', text, 0, text.length, ends)))
}
const halfWidthFeature = (options: ShapeOptions): string => options.direction === 'ttb' ? 'vhal' : 'halt'
const ideograph = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const latinOrNumber = /[\p{Script=Latin}\p{Number}]/u
const autospaceBetween = (a: string, b: string): boolean => (ideograph.test(a) && latinOrNumber.test(b)) || (latinOrNumber.test(a) && ideograph.test(b))

/** 段落初始 shape 共用；安全切点切片，unsafe 边界保守修复左右受影响段。 */
export class ShapedParagraph {
  readonly analysis: TextAnalysis
  readonly ends: readonly number[]
  readonly initial: ShapeResult
  private readonly boundaries: Set<number>
  readonly runs: readonly ParagraphRun[]
  private readonly punctuation: readonly PunctuationPlan[]
  private readonly space: ShapeResult
  private readonly runSpaces = new Map<number, ShapeResult>()
  private readonly safeBoundaries = new Set<number>()
  private readonly advances = new Map<number, number>()
  private readonly gaps = new Map<number, number>()
  private readonly gapsAfter = new Map<number, number>()
  private readonly boundaryGaps = new Map<number, number>()
  private readonly hasTabs: boolean
  private readonly segmentEnds: number[][]
  private readonly edgePairs: readonly Readonly<{ target: number; earlier: number; later: number }>[]
  constructor(private readonly shaper: TextShaper, source: FontSource, readonly text: string, readonly options: ParagraphOptions, runs?: readonly ParagraphRun[], sourceGraphemeEnds?: readonly number[]) {
    this.analysis = analyzeText(text, profile, 'pre-wrap', 'normal', options.language ?? 'zh-CN')
    this.hasTabs = text.includes('\t')
    if (this.analysis.normalized !== text) throw new Error('段落输入应先把 CRLF 归一为 LF，并保留原文映射')
    const displayEnds = graphemeEnds(text), displayBoundaries = new Set(displayEnds)
    this.ends = sourceGraphemeEnds ?? displayEnds
    if (this.ends.some((end, index) => !displayBoundaries.has(end) || end <= (this.ends[index - 1] ?? 0)) || (this.ends.at(-1) ?? 0) !== text.length) throw new Error('原文字素映射必须完整覆盖显示文本')
    if (options.wrap === 'grapheme') {
      const starts = [0, ...this.ends.slice(0, -1)]
      const texts = starts.map((start, index) => text.slice(start, this.ends[index]))
      this.analysis = { normalized: text, starts, texts, spaceSources: null, hasUnbroken: false, flags: texts.map(part => part === '\n' ? HARD_BREAK : part === '\t' ? TAB : /^ +$/.test(part) ? PRESERVED_SPACE : TEXT) }
    }
    this.boundaries = new Set([0, ...this.ends])
    // UAX #14 的机会可能落在 UAX #29 字素内部；完整原文字素才是 walker 的最小单位。
    const analysis: TextAnalysis = { ...this.analysis, starts: [], texts: [], flags: [], spaceSources: null }
    this.analysis.starts.forEach((start, index) => {
      if (analysis.starts.length && !this.boundaries.has(start)) {
        const last = analysis.texts.length - 1
        analysis.texts[last] += this.analysis.texts[index]
        // 带组合符的空白已经是可见文字，不能再按整段尾空白悬挂。
        analysis.flags[last] = analysis.flags[last] & ~KIND_BITS | TEXT
      }
      else { analysis.starts.push(start); analysis.texts.push(this.analysis.texts[index]); analysis.flags.push(this.analysis.flags[index]) }
    })
    this.analysis = analysis
    this.segmentEnds = this.analysis.texts.map(() => [])
    let segment = 0
    for (const end of this.ends) {
      while (segment + 1 < this.analysis.starts.length && end > this.analysis.starts[segment] + this.analysis.texts[segment].length) segment++
      this.segmentEnds[segment]?.push(end)
    }
    this.runs = runs ?? [{ start: 0, end: text.length, source, options }]
    let end = 0
    for (const run of this.runs) {
      if (run.start !== end || run.end < run.start || !this.boundaries.has(run.start) || !this.boundaries.has(run.end)) throw new Error('整形 run 必须连续覆盖段落且保持完整字素')
      end = run.end
    }
    if (end !== text.length) throw new Error('整形 run 未覆盖完整段落')
    const planner = new PunctuationPlanner(shaper)
    this.punctuation = this.runs.map(run => planner.plan(run.source, text, run.options))
    this.edgePairs = this.punctuation.flatMap((plan, index) => plan.pairs.filter(pair => pair.target >= this.runs[index].start && pair.target < this.runs[index].end))
    this.space = shaper.shape(this.runs[0]?.source ?? source, ' ', this.runs[0]?.options ?? options)
    this.runSpaces.set(0, this.space)
    this.initial = this.shape(0, text.length)
    const byCluster = new Map<number, { width: number; unsafe: boolean }>()
    for (const glyph of this.initial.glyphs) {
      const entry = byCluster.get(glyph.cluster) ?? { width: 0, unsafe: false }
      entry.width += glyph.advance; entry.unsafe ||= !!(glyph.flags & 1)
      byCluster.set(glyph.cluster, entry)
    }
    let width = 0
    for (const [cluster, entry] of [...byCluster].sort(([a], [b]) => a - b)) {
      this.advances.set(cluster, width); width += entry.width
      if (!entry.unsafe) this.safeBoundaries.add(cluster)
    }
    this.advances.set(text.length, width)
    this.safeBoundaries.add(0); this.safeBoundaries.add(text.length)
    let spacing = 0
    let previousVisible: number | undefined
    const starts = [0, ...this.ends]
    for (let i = 0; i < starts.length; i++) {
      this.gaps.set(starts[i], spacing)
      if (i < starts.length - 1 && byCluster.has(starts[i]) && text[starts[i]] !== '\u00ad') {
        if (previousVisible !== undefined) {
          const gap = this.gapBetween(previousVisible, starts[i])
          this.boundaryGaps.set(starts[i], gap); spacing += gap
        }
        previousVisible = starts[i]
      }
      this.gapsAfter.set(starts[i], spacing)
    }
  }
  private gapBetween(left: number, right: number): number {
    const before = this.text.slice(left, this.graphemeEndAfter(left)), after = this.text.slice(right, this.graphemeEndAfter(right))
    if (/[\r\n]/.test(this.text.slice(left, right) + after)) return 0
    const run = this.runs.find(run => run.start <= left && run.end > left)!
    return (this.spacingAt(left, run.options).letterSpacing ?? 0) + (this.options.autospace !== false && autospaceBetween(before, after) ? this.options.size / 8 : 0)
  }
  private graphemeEndAfter(at: number): number | undefined {
    let low = 0, high = this.ends.length
    while (low < high) { const middle = (low + high) >> 1; if (this.ends[middle] > at) high = middle; else low = middle + 1 }
    return this.ends[low]
  }
  // 间距区间按字素顺序排列；每个字形都要查一次，长段落不能逐个扫描。
  private spacingAt(at: number, fallback: Pick<ParagraphOptions, 'letterSpacing' | 'tsume'>): Pick<ParagraphOptions, 'letterSpacing' | 'tsume'> {
    const spacing = this.options.spacing
    if (!spacing) return fallback
    let low = 0, high = spacing.length
    while (low < high) { const middle = (low + high) >> 1; if (spacing[middle].end > at) high = middle; else low = middle + 1 }
    const span = spacing[low]
    return span && span.start <= at ? span : fallback
  }
  private tabSpace(at: number): ShapeResult {
    const index = this.runs.findIndex(run => run.start <= at && at < run.end)
    let space = this.runSpaces.get(index)
    if (!space) {
      const run = this.runs[index]
      space = this.shaper.shape(run.source, ' ', run.options)
      this.runSpaces.set(index, space)
    }
    return space
  }
  private shape(start: number, end: number, hyphen = false, haltAt?: number): ShapeResult {
    const hyphenAt = start + this.text.slice(start, end).replace(/[\t ]+$/, '').length - 1
    const hyphenRun = hyphen ? this.runs.find(run => run.start <= hyphenAt && run.end > hyphenAt) : undefined
    // Blink 在当前字体有 U+2010 时使用它，缺字才使用 ASCII 连字符。
    const hyphenText = hyphenRun && this.shaper.shape(hyphenRun.source, '\u2010', hyphenRun.options).glyphs.every(glyph => glyph.id !== 0) ? '\u2010' : '-'
    const text = this.text.slice(start, end)
    const glyphs = this.visualPieces(start, end).flatMap(({ index, from, to }) => {
      const run = this.runs[index]
      const featureRanges = [
        ...(run.options.featureRanges ?? []).filter(feature => feature.start < end && feature.end > start).map(feature => ({ ...feature, start: Math.max(0, feature.start - start), end: Math.min(end - start, feature.end - start) })),
        ...this.punctuation[index].pairs.filter(pair => pair.earlier >= start && pair.later < end && pair.target >= from && pair.target < to).map(pair => ({ tag: halfWidthFeature(run.options), value: 1, start: pair.target - start, end: pair.target - start + 1 })),
        ...(haltAt !== undefined && haltAt >= from && haltAt < to ? [{ tag: halfWidthFeature(run.options), value: 1, start: haltAt - start, end: haltAt - start + 1 }] : []),
      ]
      // 行边切断上下文；字体/style run 仍以完整行作 context，不能用子串丢掉邻接信息。
      // 可见软连字符是独立的插入字形，不参与前文字偶距；原文位置仍归属 U+00AD。
      const glyphs = hyphen && from <= hyphenAt && hyphenAt < to
        ? [
          ...(from < hyphenAt ? this.shaper.shape(run.source, text, { ...run.options, featureRanges }, from - start, hyphenAt - start).glyphs : []),
          ...this.shaper.shape(run.source, hyphenText, { ...run.options, featureRanges: featureRanges.filter(feature => feature.start <= hyphenAt - start && feature.end > hyphenAt - start).map(feature => ({ ...feature, start: 0, end: 1 })) }).glyphs.map(glyph => ({ ...glyph, cluster: hyphenAt - start })),
          ...(hyphenAt + 1 < to ? this.shaper.shape(run.source, text, { ...run.options, featureRanges }, hyphenAt + 1 - start, to - start).glyphs : []),
        ]
        : [...this.shaper.shape(run.source, text, { ...run.options, featureRanges }, from - start, to - start).glyphs]
      if (run.options.direction === 'rtl' && hyphen && from <= hyphenAt && hyphenAt < to) glyphs.sort((a, b) => b.cluster - a.cluster)
      const widths = new Map<number, number>()
      for (const glyph of glyphs) widths.set(glyph.cluster, (widths.get(glyph.cluster) ?? 0) + glyph.advance)
      return glyphs.map((glyph, at) => ({ ...glyph,
        advance: glyph.advance - (glyphs[at + 1]?.cluster !== glyph.cluster ? (widths.get(glyph.cluster) ?? 0) * (this.spacingAt(glyph.cluster + start, run.options).tsume ?? 0) / 100 : 0),
        cluster: glyph.cluster + start, ...(this.runs.length > 1 ? { run: index } : {}) }))
    })
    return { width: glyphs.reduce((sum, glyph) => sum + glyph.advance, 0), glyphs }
  }
  /** 一行里按显示顺序排好的 run 片段。行尾空白按 UAX #9 L1 回到段落基准层级。 */
  private visualPieces(start: number, end: number): { index: number; from: number; to: number; level: number }[] {
    const { bidi } = this.options
    const content = bidi ? start + this.text.slice(start, end).replace(/[\t ]+$/, '').length : end
    const base = bidi?.paragraphs.find(paragraph => paragraph.start <= start && start <= paragraph.end)?.level ?? 0
    return visualOrder(this.runs.flatMap((run, index) => {
      const from = Math.max(start, run.start), to = Math.min(end, run.end)
      if (from >= to) return []
      const level = bidi ? bidi.levels[run.start] : run.options.direction === 'rtl' ? 1 : 0
      if (to <= content) return [{ index, from, to, level }]
      return [...(from < content ? [{ index, from, to: content, level }] : []), { index, from: Math.max(from, content), to, level: base }]
    }))
  }
  private safe(at: number): boolean {
    // cluster 内部没有 flags，不能把不存在的边界当作 safe。
    return this.safeBoundaries.has(at)
  }
  private changedEdge(start: number, end: number): boolean {
    return this.edgePairs.some(pair => pair.target >= start && pair.target < end && (pair.earlier < start || pair.later >= end))
  }
  private rangeWidth(start: number, end: number): number {
    if (start === end) return 0
    // 混排时字距和中英间距按显示相邻计算，前缀差只认逻辑相邻，两者可能不等。
    if (!this.options.bidi && this.safe(start) && this.safe(end) && !this.changedEdge(start, end) && !this.hasTabs) {
      // gaps 在边界前累计；行首与前文之间的附加间距必须回收。
      const spacing = (this.gaps.get(end) ?? 0) - (this.gapsAfter.get(start) ?? 0)
      return this.advances.get(end)! - this.advances.get(start)! + spacing
    }
    return this.range(start, end).width
  }
  range(start: number, end: number, hyphen = false, haltAt?: number): ShapeResult {
    if (!this.boundaries.has(start) || !this.boundaries.has(end) || end < start) throw new Error('断行只能发生在完整字素边界')
    let result: ShapeResult
    // 整段结果的显示顺序是按全段定的；混排时每行要各排各的，不能从中截取。
    if (!hyphen && haltAt === undefined && !this.options.bidi && this.safe(start) && this.safe(end) && !this.changedEdge(start, end)) {
      const glyphs = this.initial.glyphs.filter(glyph => glyph.cluster >= start && glyph.cluster < end)
      result = { glyphs, width: glyphs.reduce((sum, glyph) => sum + glyph.advance, 0) }
    } else {
      // 整个受影响 run 是安全的保守拼接边界；不假定两个相邻字符足够恢复上下文。
      result = this.shape(start, end, hyphen, haltAt)
    }
    if (this.boundaryGaps.size || hyphen) {
      const glyphs = result.glyphs.map(glyph => ({ ...glyph }))
      const hyphenAt = start + this.text.slice(start, end).replace(/[\t ]+$/, '').length - 1
      const visibleEnds = glyphs.flatMap((glyph, index) => glyphs[index + 1]?.cluster !== glyph.cluster && (this.text[glyph.cluster] !== '\u00ad' || hyphen && glyph.cluster === hyphenAt) ? [index] : [])
      for (let i = 0; i + 1 < visibleEnds.length; i++) {
        const glyph = glyphs[visibleEnds[i]], next = glyphs[visibleEnds[i + 1]]
        glyph.advance += this.gapBetween(Math.min(glyph.cluster, next.cluster), Math.max(glyph.cluster, next.cluster))
      }
      result = { glyphs, width: glyphs.reduce((sum, glyph) => sum + glyph.advance, 0) }
    }
    if (this.text.slice(start, end).includes('\t')) {
      let advance = 0
      const glyphs = result.glyphs.map(glyph => {
        const space = this.text[glyph.cluster] === '\t' ? this.tabSpace(glyph.cluster) : undefined
        const run = this.runs[glyph.run ?? 0]
        const stop = space ? layoutUnits((space.width + (this.spacingAt(glyph.cluster, run.options).letterSpacing ?? 0)) * 8) : 0
        let tabAdvance = stop > 0 ? (Math.floor(layoutUnits(advance) / stop) + 1) * stop / 64 - advance : 0
        if (space && stop > 0 && layoutUnits(tabAdvance) < layoutUnits(space.width / 2)) tabAdvance += stop / 64
        const value = this.text[glyph.cluster] === '\t'
          ? { ...glyph, id: space!.glyphs[0].id, advance: tabAdvance, xOffset: 0, yOffset: 0 }
          : glyph
        advance += value.advance
        return value
      })
      result = { glyphs, width: advance }
    }
    return result
  }

  /** 用整段结果的前缀差注入上游 walker；不是按词测量后拼接。 */
  private prepared(start: number, available: number): { data: PreparedLineData; ends: number[][] } {
    const { starts, texts, flags } = this.analysis
    const ends = this.segmentEnds
    const measured = new Map<number, number>()
    // 走到这里已经放不下了：再加上最大的行尾标点收缩量也回不到栏内。后面的字不会排进本行，不必为它们整形。
    // 软连字符的预留宽度取全段最大值，每一处都要真实量过，这里不能提前收手。
    const reach = this.analysis.flags.some(flag => (flag & KIND_BITS) === SOFT_HYPHEN) ? Infinity : available + layoutUnits(4 * Math.max(...this.runs.map(run => run.options.size), this.options.size))
    let farthest = 0, farthestEnd = start
    const prefix = (end: number): number => {
      if (end <= start) return 0
      if (farthest > reach && end > farthestEnd) return farthest
      let value = measured.get(end)
      if (value === undefined) {
        value = layoutUnits(this.rangeWidth(start, end)); measured.set(end, value)
        if (value > farthest) { farthest = value; farthestEnd = end }
      }
      return value
    }
    const widths = texts.map((text, index) => {
      const kind = flags[index] & KIND_BITS
      return kind === HARD_BREAK || kind === SOFT_HYPHEN || kind === TAB ? 0 : prefix(starts[index] + text.length) - prefix(starts[index])
    })
    const segmentFlags = new Uint8Array(flags)
    const hasHyphens = flags.some(flag => (flag & KIND_BITS) === SOFT_HYPHEN)
    const hyphenWidths = hasHyphens ? texts.map((text, index) => (flags[index] & KIND_BITS) === SOFT_HYPHEN && starts[index] >= start ? layoutUnits(this.range(start, starts[index] + text.length, true).width) - prefix(starts[index]) : 0) : null
    const endTrims = texts.map((text, index) => {
      const end = starts[index] + text.length, at = end - 1
      // 这一段的起点已经超出本行，不可能成为行尾，不必为它重新整形。
      if (end <= start || prefix(Math.max(start, starts[index])) > available || !this.punctuation.some((plan, run) => at >= this.runs[run].start && at < this.runs[run].end && plan.closings.includes(at))) return 0
      return Math.max(0, prefix(end) - layoutUnits(this.range(start, end, false, at).width))
    })
    const breakAfter = (index: number): boolean => index + 1 === texts.length || (flags[index + 1] & KIND_BITS) === TEXT && !(flags[index + 1] & UNBROKEN)
    const data: PreparedLineData = {
      widths, segmentFlags, simpleLineWalkFastPath: false, simpleLineCountFastPath: false,
      breakableFitAdvances: ends.map((offsets, index) => (flags[index] & KIND_BITS) === TEXT
        ? offsets.map((end, grapheme) => prefix(end) - prefix(grapheme ? offsets[grapheme - 1] : starts[index])) : null),
      breakableLineStartExtras: null, lineStartExtras: null, lineEndTrims: endTrims.map((trim, index) => breakAfter(index) ? trim : 0), overflowLineEndTrims: endTrims.map((trim, index) => breakAfter(index) ? 0 : trim),
      letterSpacing: 0, discretionaryHyphenWidth: Math.max(0, ...hyphenWidths ?? []), discretionaryHyphenContexts: hasHyphens ? texts.map(() => 0) : null,
      tabStopAdvance: layoutUnits(this.space.width * 8), minimumTabAdvance: 0,
      ...(hasHyphens || this.hasTabs ? { items: { hyphenWidths,
        tabStopAdvances: this.hasTabs ? starts.map((at, index) => (flags[index] & KIND_BITS) === TAB ? layoutUnits((this.tabSpace(at).width + (this.spacingAt(at, this.runs.find(run => run.start <= at && at < run.end)!.options).letterSpacing ?? 0)) * 8) : 0) : null,
        minimumTabAdvances: this.hasTabs ? starts.map((at, index) => (flags[index] & KIND_BITS) === TAB ? layoutUnits(this.tabSpace(at).width / 2) : 0) : null,
        hyphenRooms: null, itemEndHalts: null, insideExtras: null, fillExtras: null, openingEdges: null, emptyObjectSpaces: null, emptyObjectReturns: null } } : {}),
    }
    return { data, ends }
  }
  layout(requestedWidth: number | undefined | LineWidthAt = this.options.maxWidth, onLine?: (line: ParagraphLine) => void): ParagraphLayout {
    const perLine = typeof requestedWidth === 'function' ? requestedWidth : undefined
    if (!perLine && (((requestedWidth as number | undefined) ?? 0) < 0 || Number.isNaN(requestedWidth))) throw new Error('段落宽度不能为负数或 NaN')
    let maxWidth = (perLine ? Infinity : requestedWidth as number | undefined) || Infinity
    let stoppedAt: number | undefined
    const lines: ParagraphLine[] = []
    let cursor = { segmentIndex: 0, graphemeIndex: 0 }
    const offsets = (value: typeof cursor, ends: number[][]): number => value.graphemeIndex
      ? ends[value.segmentIndex][value.graphemeIndex - 1] : this.analysis.starts[value.segmentIndex] ?? this.text.length
    // 行首被吃掉的字符会让循环重来一次，这时还是同一行，不能再问一次宽度：绕排会多占一段。
    let askedFor = -1
    while (cursor.segmentIndex < this.analysis.starts.length) {
      if (perLine && askedFor !== lines.length) {
        const width = perLine(lines.length)
        askedFor = lines.length
        if (width === null) { stoppedAt = cursor.graphemeIndex ? this.segmentEnds[cursor.segmentIndex][cursor.graphemeIndex - 1] : this.analysis.starts[cursor.segmentIndex]; break }
        maxWidth = width
      }
      const available = this.options.wrap === 'none' ? Infinity : layoutUnits(maxWidth)
      const segmentStart = this.analysis.starts[cursor.segmentIndex]
      const initialOffset = cursor.graphemeIndex ? this.segmentEnds[cursor.segmentIndex][cursor.graphemeIndex - 1] : segmentStart
      const { data, ends } = this.prepared(initialOffset, available)
      if (!normalizePreparedLineStart(data, cursor)) break
      const start = offsets(cursor, ends)
      if (start !== initialOffset) continue
      const before = { ...cursor }
      const fittedWidth = stepPreparedLineGeometryFromStart(data, cursor, available)
      const rawEnd = offsets(cursor, ends)
      let end = rawEnd
      // 尾空白的占用宽由 walker 决定；部分悬挂不能通过删除整个字素来模拟。
      while (end > start && this.text[end - 1] === '\n') end--
      const tail = start + this.text.slice(start, end).replace(/[\t ]+$/, '').length - 1
      // 自动折行的悬挂空白仍属于本行；其前的软连字符必须参与同一份可见几何。
      const hyphen = isDiscretionaryLineEnd(data.segmentFlags, data.widths.length, cursor.segmentIndex, cursor.graphemeIndex)
        || rawEnd < this.text.length && end === rawEnd && this.text[rawEnd] !== '\n' && this.text[tail] === '\u00ad'
      let shape = this.range(start, end, hyphen)
      if (fittedWidth !== null && layoutUnits(shape.width) > fittedWidth && this.punctuation.some((plan, run) => tail >= this.runs[run].start && tail < this.runs[run].end && plan.closings.includes(tail))) shape = this.range(start, end, hyphen, tail)
      let width = shape.width
      if (/[\t ]$/.test(this.text.slice(start, end)) && fittedWidth !== null && layoutUnits(width) > fittedWidth) {
        const withoutTail = start + this.text.slice(start, end).replace(/[\t ]+$/, '').length
        const contentWidth = hyphen ? this.range(start, withoutTail, true).width : this.rangeWidth(start, withoutTail)
        width = layoutUnits(contentWidth) >= fittedWidth ? contentWidth : fittedWidth / 64
      }
      const rightToLeft = !!this.options.bidi && (this.options.bidi.paragraphs.find(paragraph => paragraph.start <= start && start <= paragraph.end)?.level ?? 0) % 2 === 1
      lines.push(Object.freeze({ start, end: rawEnd, contentEnd: end, width, ...(rightToLeft && width < shape.width ? { visualStart: width - shape.width } : {}), glyphs: Object.freeze(shape.glyphs.map(glyph => Object.freeze({ ...glyph }))) }))
      onLine?.(lines.at(-1)!)
      if (before.segmentIndex === cursor.segmentIndex && before.graphemeIndex === cursor.graphemeIndex) throw new Error('Pretext walker 未推进原文位置')
      cursor = { ...cursor }
    }
    const width = Math.max(0, ...lines.map(line => line.width))
    return Object.freeze({ text: this.text, lines: Object.freeze(lines), width, height: lines.length * (this.options.lineHeight ?? this.options.size * 1.2), overflow: layoutUnits(width) > layoutUnits(maxWidth), ...(stoppedAt === undefined ? {} : { stoppedAt }) })
  }
  intrinsicWidths(): { min: number; max: number } {
    let min = 0, max = 0, lineStart = 0
    for (let index = 0; index < this.analysis.texts.length; index++) {
      const kind = this.analysis.flags[index] & KIND_BITS, start = this.analysis.starts[index], end = start + this.analysis.texts[index].length
      if (kind === HARD_BREAK) { max = Math.max(max, this.range(lineStart, start).width); lineStart = end }
      else if (![SPACE, PRESERVED_SPACE, TAB].includes(kind)) min = Math.max(min, this.range(start, end).width)
    }
    max = Math.max(max, this.range(lineStart, this.text.length).width)
    return { min, max }
  }
}
