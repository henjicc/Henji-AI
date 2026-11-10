import type { RichTextContent, TextParagraph } from '../contracts'
import type { TextStyle } from '../text'
import { scaleTextSpatialStyle } from '../metrics'
import { appearanceBounds, fitTextLayout, union, type TextDrawConstraints, type TextDrawPlan, type TextPlanGrapheme, type TextPlanRect, type TextSourceRange } from '../textDrawPlan'
import { prepareShapingRuns, textFontRequest, type ShapingRuns } from './runs'
import { ShapedParagraph, layoutUnits, type ParagraphLine } from './paragraph'
import { type TextFontAccess } from './fontSession'
import { type TextOutline, type ShapeOptions, TextShaper } from './harfbuzz'
import { TextFlow, logicalExclusions, type TextExclusion, type TextFlowFrame, type TextFlowSlot } from './textFlow'

export type ShapedTextOptions = Omit<TextDrawConstraints, 'wrap'> & {
  wrap?: 'normal' | 'word' | 'grapheme' | 'none'; ligatures?: boolean; autospace?: boolean; features?: ShapeOptions['features']; axes?: ShapeOptions['axes']
  /** vertical：从上到下成列，第一列在最右边。 */
  writingMode?: 'horizontal' | 'vertical'
  /** 文字排满一栏接着排下一栏；没给栏高（竖排时是栏宽）就自动等高。 */
  columns?: { count: number; gap?: number }
  /** 文字绕开这些区域，坐标相对放置盒左上。 */
  exclusions?: readonly TextExclusion[]
}
/** 列表标记：纯符号或按段落顺序计数。 */
interface TextParagraphList { type?: 'decimal' | 'cjk' | 'alpha' | 'bullet'; level?: number; start?: number; indent?: number; marker?: string }
/** 段落的版式：缩进和列表都不进入文字内容本身。 */
export interface TextParagraphLayout { firstLineIndent?: number; indent?: number; indentEnd?: number; list?: TextParagraphList }
interface OutlinePlacement { outline: TextOutline; x: number; y: number; scale: number }
export interface ShapedTextCluster { owner: number; style: TextStyle; x: number; baseline: number; advance: number; glyphs: OutlinePlacement[]; inkBounds: TextPlanRect | null; emoji?: string
  /** 竖排里旋转的拉丁文：簇原点上再转这个角度。 */
  rotate?: number
  /** 旋转簇在自身坐标里的墨迹范围；描边、阴影要在这个坐标系里栅格。 */
  localInk?: TextPlanRect | null
  /** 竖排直立的 emoji：字形原点相对簇原点有偏移。 */
  upright?: boolean
}
interface ShapedTextGrapheme extends Omit<TextPlanGrapheme, 'positionKind'> { owner: number; positionKind: 'individual' | 'shared-cluster' }
export interface ShapedTextPlan extends Omit<TextDrawPlan, 'batches' | 'rasterBounds' | 'graphemes'> { graphemes: ShapedTextGrapheme[]; clusters: ShapedTextCluster[]; diagnostics: Array<{ kind: 'missing-glyph' | 'inferred-script'; source: { start: number; end: number }; text: string }>; fontIdentity: string; intrinsicWidths: { min: number; max: number }; vertical: boolean }
interface Row { paragraph: number; sourceOffset: number; source: string; runs: ShapingRuns; line: ParagraphLine; y: number; height: number; baselineOffset: number; align: TextStyle['align']; slot?: TextFlowSlot; lineIndent: number; lineEndIndent: number; marker?: { rightToLeft: boolean; text: string; style: TextStyle } }
const ideographic = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const boundsAt = (rect: TextPlanRect, x: number, y: number): TextPlanRect => ({ ...rect, x: rect.x + x, y: rect.y + y })
// 动态排版每帧都可能换栏宽，整形结果与栏宽无关；按内容、样式和字体复用，换宽度只重新断行。
const PARAGRAPH_CACHE_SIZE = 32
const CJK_DIGITS = '零一二三四五六七八九'
const cjkNumber = (value: number): string => value < 10 ? CJK_DIGITS[value] : value < 20 ? `十${value % 10 ? CJK_DIGITS[value % 10] : ''}` : value < 100 ? `${CJK_DIGITS[Math.floor(value / 10)]}十${value % 10 ? CJK_DIGITS[value % 10] : ''}` : String(value)
const BULLETS = ['\u2022', '\u25e6', '\u25aa']
const RTL_FIRST = /^[^\p{L}]*[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u
function listMarker(list: TextParagraphList, value: number): string {
  if (list.marker !== undefined) return list.marker
  const level = list.level ?? 0
  switch (list.type ?? 'bullet') {
    case 'decimal': return `${value}.`
    case 'cjk': return `${cjkNumber(value)}、`
    case 'alpha': return `${String.fromCharCode(96 + ((value - 1) % 26) + 1)}.`
    default: return BULLETS[level % BULLETS.length]
  }
}
const paragraphCaches = new WeakMap<TextShaper, Map<string, { runs: ShapingRuns; shape: ShapedParagraph; intrinsic: { min: number; max: number } }>>()

/** 整形、选行与放置共用一个段落结果；fit 每次改变实际字号重新整形。 */
export function createShapedTextPlan(shaper: TextShaper, fonts: TextFontAccess, input: string | RichTextContent, originalStyle: TextStyle, options: ShapedTextOptions = {}): ShapedTextPlan {
  const original: Array<TextParagraph & TextParagraphLayout> = typeof input === 'string' ? [{ runs: [{ text: input, style: originalStyle }], align: originalStyle.align, direction: 'auto', spaceBefore: 0, spaceAfter: 0 }] : input.paragraphs
  const vertical = options.writingMode === 'vertical'
  const sourceText = original.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n')
  const richBox = typeof input === 'string' ? undefined : input.box
  const boxWidth = options.box?.width || originalStyle.boxWidth * (options.frame?.width ?? 0) || richBox?.width || undefined
  const boxHeight = options.box?.height ?? (originalStyle.boxHeight * (options.frame?.height ?? 0) || richBox?.height || undefined)
  // 行内方向：横排是宽，竖排是高。行堆叠方向相反。
  const inlineBox = vertical ? boxHeight : boxWidth, blockBox = vertical ? boxWidth : boxHeight
  const inlineLimit = vertical ? options.maxHeight : options.maxWidth, blockLimit = vertical ? options.maxWidth : options.maxHeight
  // 只给行内上限时按它折行；同时要 fit 又没给行数或行堆叠方向的上限，折行后永远放得下、fit 就失效了，所以按单行缩字号。
  const fitActive = !!options.fit && (options.fit.trigger !== 'maxLines' || options.maxLines !== undefined)
  const wrapsAtLimit = !fitActive || (options.maxLines ?? 1) > 1 || blockLimit !== undefined || !!options.columns || !!options.exclusions?.length
  const wrapWidth = options.wrapWidth ?? inlineBox ?? (wrapsAtLimit ? inlineLimit : undefined)
  const exclusions = options.exclusions?.length ? logicalExclusions(options.exclusions, vertical, boxWidth) : []
  const flowing = !!options.columns || exclusions.length > 0
  if (flowing && wrapWidth === undefined) throw new Error('分栏和绕排需要确定的行内尺寸：横排给 box.width 或 maxWidth，竖排给 box.height 或 maxHeight')
  if (options.columns && (!Number.isInteger(options.columns.count) || options.columns.count < 1)) throw new Error('columns.count 必须是正整数')
  const constraints: TextDrawConstraints = { ...options, wrap: options.wrap === 'normal' ? 'word' : options.wrap }
  const make = (size: number) => {
    const factor = size / originalStyle.fontSize, style = scaleTextSpatialStyle(originalStyle, factor)
    let min = 0, max = 0
    const prepareParagraph = (paragraph: TextParagraph & TextParagraphLayout) => {
      let at = 0
      const spans = paragraph.runs.map(run => { const start = at; at += run.text.length; return { start, end: at, style: scaleTextSpatialStyle(run.style, factor) } })
      const source = paragraph.runs.map(run => run.text).join('')
      const base = options.direction === 'rtl' || options.direction === 'ltr' ? options.direction : paragraph.direction
      const shapeOptions: ShapeOptions = { size, direction: base === 'rtl' ? 'rtl' : 'ltr', ligatures: options.ligatures, features: options.features, axes: options.axes }
      const fallback = fonts.chain().candidates.find(candidate => candidate.font)?.font
      if (!fallback) throw new Error('默认文字字体不可用')
      let cache = paragraphCaches.get(shaper)
      if (!cache) paragraphCaches.set(shaper, cache = new Map())
      const cacheKey = JSON.stringify([source, base, shapeOptions, options.autospace, options.wrap, vertical, spans, spans.map(span => fonts.chain(textFontRequest(span.style)).identity), fonts.chain().identity])
      let prepared = cache.get(cacheKey)
      if (prepared) cache.delete(cacheKey)
      else {
        const runs = prepareShapingRuns(shaper, fonts, source, spans, shapeOptions, base, vertical)
        const shape = new ShapedParagraph(shaper, runs.runs[0]?.source ?? fallback, runs.text, { ...shapeOptions, bidi: runs.bidi, spacing: runs.spacing, autospace: options.autospace, wrap: options.wrap === 'word' ? 'normal' : options.wrap }, runs.runs, runs.graphemes.map(g => g.end))
        prepared = { runs, shape, intrinsic: shape.intrinsicWidths() }
        if (cache.size >= PARAGRAPH_CACHE_SIZE) cache.delete(cache.keys().next().value!)
      }
      cache.set(cacheKey, prepared)
      min = Math.max(min, prepared.intrinsic.min); max = Math.max(max, prepared.intrinsic.max)
      return { ...prepared, source, spans, fallback, shapeOptions }
    }
    const prepared = original.map(prepareParagraph)
    // 按 CSS 的行盒算：每种样式的半行距分到自己字号的上下，混大字号时基线和行高都由最高的那部分决定。
    const primaryMetrics = new Map<TextStyle, { ascent: number; descent: number }>()
    const lineBox = (styles: readonly TextStyle[], shapeOptions: ShapeOptions, fallback: NonNullable<ReturnType<typeof prepareParagraph>['fallback']>): { height: number; baseline: number } => {
      let above = 0, below = 0
      for (const value of new Set(styles)) {
        let metric = primaryMetrics.get(value)
        if (!metric) {
          const font = fonts.chain(textFontRequest(value)).candidates.find(candidate => candidate.font)?.font ?? fallback
          metric = shaper.metrics(font, { ...shapeOptions, size: value.fontSize }); primaryMetrics.set(value, metric)
        }
        const leading = value.leading || value.fontSize * 1.25, half = (leading - metric.ascent - metric.descent) / 2
        above = Math.max(above, metric.ascent + half); below = Math.max(below, metric.descent + half)
      }
      return { height: above + below, baseline: above }
    }
    const layoutRows = (flow: TextFlow | null) => {
      const rows: Row[] = [], counters: Array<{ type: TextParagraphList['type']; count: number; start?: number }> = []
      let offset = 0, y = 0, stopped: { paragraph: number; at: number } | undefined
      for (const [paragraphIndex, paragraph] of original.entries()) {
        const { runs, shape, source, spans, fallback, shapeOptions } = prepared[paragraphIndex]
        const list = paragraph.list
        const direction = options.direction === 'rtl' || options.direction === 'ltr' ? options.direction : paragraph.direction
        const rightToLeft = !vertical && (direction === 'rtl' || direction === 'auto' && RTL_FIRST.test(source))
        const defaultIndent = list ? (list.indent ?? 2) * size * ((list.level ?? 0) + 1) : 0
        const indent = (paragraph.indent ?? 0) * factor + defaultIndent, indentEnd = (paragraph.indentEnd ?? 0) * factor, firstLine = (paragraph.firstLineIndent ?? 0) * factor
        let marker: Row['marker']
        if (list) {
          const level = list.level ?? 0
          counters.length = level + 1
          // 换了编号类型或写了新的 start 就重新数；每项都写同一个 start 仍是同一个列表。
          const previous = counters[level], fresh = !previous || previous.type !== list.type || list.start !== undefined && list.start !== previous.start
          counters[level] = { type: list.type, count: fresh ? list.start ?? 1 : previous.count + 1, start: list.start ?? previous?.start }
          marker = { text: listMarker(list, counters[level].count), style: spans[0]?.style ?? style, rightToLeft }
        } else counters.length = 0
        const firstStyle = spans[0]?.style ?? style
        const estimate = lineBox(spans.length ? spans.map(span => span.style) : [firstStyle], shapeOptions, fallback).height
        if (flow) flow.skip(paragraph.spaceBefore * factor); else y += paragraph.spaceBefore * factor
        const pendingSlots: Array<{ slot?: TextFlowSlot; lineIndent: number; lineEndIndent: number }> = []
        const needsPerLine = !!flow || indent !== 0 || indentEnd !== 0 || firstLine !== 0
        const widthAt = (lineIndex: number): number | null => {
          const lead = indent + (lineIndex === 0 ? firstLine : 0)
          const near = rightToLeft ? indentEnd : lead, far = rightToLeft ? lead : indentEnd
          if (flow) {
            const slot = flow.next(estimate, near, far)
            if (!slot) return null
            pendingSlots.push({ slot, lineIndent: 0, lineEndIndent: 0 })
            return slot.inlineSize
          }
          pendingSlots.push({ lineIndent: near, lineEndIndent: far })
          return wrapWidth === undefined ? Infinity : Math.max(size, wrapWidth - lead - indentEnd)
        }
        const addRow = (line: ParagraphLine): void => {
          const styles = runs.graphemes.filter(g => g.start >= line.start && g.start < line.contentEnd).map(g => g.style)
          // 空行仍属于源段落；字形数组为空不能抹掉作者的字号和行距。
          const emptyStyle = runs.graphemes.find(g => g.start <= line.start && g.end > line.start)?.style ?? runs.graphemes.at(-1)?.style ?? firstStyle
          const box = lineBox(styles.length ? styles : [emptyStyle], shapeOptions, fallback)
          const place = pendingSlots.shift() ?? { lineIndent: 0, lineEndIndent: 0 }
          const rowY = place.slot?.block ?? y
          rows.push({ paragraph: paragraphIndex, sourceOffset: offset, source, runs, line, y: rowY, height: box.height, baselineOffset: box.baseline, align: paragraph.align, slot: place.slot, lineIndent: place.lineIndent, lineEndIndent: place.lineEndIndent, ...(marker && line.start === 0 ? { marker } : {}) })
          if (flow) flow.placed(box.height); else y += box.height
        }
        const laid = shape.layout(needsPerLine ? widthAt : wrapWidth, addRow)
        if (!laid.lines.length || runs.text.endsWith('\n')) {
          // 空段落和末尾的空行也占一行：要走同样的缩进和绕排，否则列表标记和后面的行都错位。
          pendingSlots.length = 0
          if (widthAt(laid.lines.length) !== null) addRow({ start: runs.text.length, end: runs.text.length, contentEnd: runs.text.length, width: 0, glyphs: [] })
        }
        if (laid.stoppedAt !== undefined) { stopped = { paragraph: paragraphIndex, at: laid.stoppedAt }; break }
        if (flow) flow.endParagraph(paragraph.spaceAfter * factor); else y += paragraph.spaceAfter * factor
        offset += source.length + 1
      }
      const rowsEnd = Math.max(0, ...rows.map(row => row.y + row.height))
      return { rows, stopped, height: flow ? rowsEnd : y }
    }
    const inlineSize = wrapWidth ?? Infinity
    const framesFor = (blockSize: number | undefined): TextFlowFrame[] => {
      const count = options.columns?.count ?? 1, gap = options.columns?.gap ?? size
      const column = (inlineSize - gap * (count - 1)) / count
      // 分栏时栏沿行堆叠方向并排的版面用不上，栏一律沿行内方向排开，下一栏回到行堆叠方向的起点。
      return Array.from({ length: count }, (_, index) => ({ inlineStart: index * (column + gap), inlineSize: column, blockStart: 0, blockSize }))
    }
    const flowFor = (blockSize: number | undefined): TextFlow => new TextFlow(framesFor(blockSize), exclusions, size)
    let laid = !flowing ? layoutRows(null) : undefined
    if (flowing) {
      const fixedBlock = blockBox ?? blockLimit
      if (fixedBlock !== undefined || !options.columns) laid = layoutRows(flowFor(fixedBlock))
      else {
        // 没给栏高：先把全文排进第一栏量总高，再逐步加高到所有栏放得下，让各栏尽量等高。
        const single = layoutRows(new TextFlow([{ ...framesFor(undefined)[0] }], exclusions, size))
        const step = Math.max(size, single.rows[0]?.height ?? size)
        let height = Math.ceil(single.height / options.columns.count / step) * step
        for (let attempt = 0; attempt < 256; attempt++) {
          laid = layoutRows(flowFor(height))
          if (!laid.stopped) break
          height += step
        }
      }
    }
    const result = laid!
    return { style, rows: result.rows, stopped: result.stopped, width: Math.max(0, ...result.rows.map(row => row.line.width + (row.slot ? row.slot.inlineStart : row.lineIndent + row.lineEndIndent))), height: result.height, intrinsicWidths: { min, max } }
  }
  const overflow = (value: Pick<ReturnType<typeof make>, 'width' | 'height' | 'rows' | 'stopped'>) => {
    const inline = !!inlineLimit && layoutUnits(value.width) > layoutUnits(inlineLimit), block = !!value.stopped || blockLimit !== undefined && layoutUnits(value.height) > layoutUnits(blockLimit)
    return { width: vertical ? block : inline, height: vertical ? inline : block, lines: options.maxLines !== undefined && value.rows.length > options.maxLines }
  }
  const selected = fitTextLayout(originalStyle, constraints, make, value => !Object.values(overflow(value)).some(Boolean))
  const visible = options.truncate === false ? selected.rows : selected.rows.filter((row, index) => (options.maxLines === undefined || index < options.maxLines) && (blockLimit === undefined || flowing || layoutUnits(row.y + row.height) <= layoutUnits(blockLimit)))
  const visibleBlock = Math.max(0, ...visible.map(row => row.y + row.height))
  const visibleInline = Math.max(selected.style.fontSize, ...visible.map(row => row.line.width + (row.slot ? row.slot.inlineStart : row.lineIndent + row.lineEndIndent)))
  const flowInline = flowing ? wrapWidth : undefined
  const width = boxWidth ?? (vertical ? visibleBlock : flowInline ?? visibleInline), height = boxHeight ?? (vertical ? flowInline ?? visibleInline : visibleBlock)
  const anchor = options.anchor ?? { x: richBox?.x ?? 0, y: richBox?.y ?? 0, horizontal: 0, vertical: 0 }
  const box = { x: anchor.x - anchor.horizontal * width, y: anchor.y - anchor.vertical * height, width, height }
  const verticalAlign = typeof input === 'string' ? selected.style.verticalAlign : original.find(p => p.runs.length)?.runs[0].style.verticalAlign ?? 'top'
  // 竖排时 verticalAlign 管行堆叠方向：top 贴最右，bottom 贴最左。
  // 绕排区域的坐标相对放置盒，内容整体挪动就压字了，所以分栏和绕排总从起点排。
  const blockFree = flowing ? 0 : (vertical ? width : height) - visibleBlock
  const top = box.y + (vertical ? 0 : verticalAlign === 'middle' ? blockFree / 2 : verticalAlign === 'bottom' ? blockFree : 0)
  const blockShift = vertical ? (verticalAlign === 'middle' ? blockFree / 2 : verticalAlign === 'bottom' ? blockFree : 0) : 0
  const lines: ShapedTextPlan['lines'] = [], graphemes: ShapedTextGrapheme[] = [], clusters: ShapedTextCluster[] = [], groups: ShapedTextPlan['groups'] = [], omittedRanges: ShapedTextPlan['omittedRanges'] = []
  let inkBounds: TextPlanRect | null = null, paintedBounds: TextPlanRect | null = null
  const diagnostics: ShapedTextPlan['diagnostics'] = []
  for (const row of selected.rows) for (const g of row.runs.graphemes) if (g.missing && g.start >= row.line.start && g.start < row.line.contentEnd && !/^\s+$/u.test(row.source.slice(g.sourceStart, g.sourceEnd))) diagnostics.push({ kind: 'missing-glyph', source: { start: row.sourceOffset + g.sourceStart, end: row.sourceOffset + g.sourceEnd }, text: row.source.slice(g.sourceStart, g.sourceEnd) })
  for (const row of selected.rows) for (const g of row.runs.graphemes) if (g.inferredScript && g.start >= row.line.start && g.start < row.line.contentEnd) diagnostics.push({ kind: 'inferred-script', source: { start: row.sourceOffset + g.sourceStart, end: row.sourceOffset + g.sourceEnd }, text: row.source.slice(g.sourceStart, g.sourceEnd) })
  const range = (row: Row, from: number, to: number): TextSourceRange[] => {
    let at = 0
    return original[row.paragraph].runs.flatMap((run, index) => {
      const start = at; at += run.text.length
      return at > from && start < to || from === to && start <= from && at >= to ? [{ start: row.sourceOffset + Math.max(start, from), end: row.sourceOffset + Math.min(at, to), paragraph: row.paragraph, run: index, runStart: Math.max(0, from - start), runEnd: Math.min(run.text.length, to - start) }] : []
    })
  }
  const sourceAt = (row: Row, at: number): number => row.runs.graphemes.find(g => g.start >= at)?.sourceStart ?? row.source.length
  for (const row of selected.rows) if (!visible.includes(row)) {
    const reason = options.maxLines !== undefined && selected.rows.indexOf(row) >= options.maxLines ? 'maxLines' : 'maxHeight'
    omittedRanges.push(...range(row, sourceAt(row, row.line.start), sourceAt(row, row.line.end)).map(value => ({ ...value, reason } as const)))
  }
  if (selected.stopped) {
    let offset = 0
    original.forEach((paragraph, index) => {
      const source = paragraph.runs.map(run => run.text).join('')
      if (index >= selected.stopped!.paragraph) {
        const graphemeStart = index === selected.stopped!.paragraph ? selected.rows.find(row => row.paragraph === index)?.runs.graphemes.find(g => g.start >= selected.stopped!.at)?.sourceStart ?? 0 : 0
        const synthetic = { paragraph: index, sourceOffset: offset } as Row
        omittedRanges.push(...range(synthetic, graphemeStart, source.length).map(value => ({ ...value, reason: 'maxHeight' } as const)))
      }
      offset += source.length + 1
    })
  }
  // 同一字形在一份版面里反复出现，字形范围和轮廓按字体与字号各查一次。
  const inkCache = new Map<string, ReturnType<TextShaper['ink']>>(), outlineCache = new Map<string, TextOutline>(), metricCache = new Map<string, ReturnType<TextShaper['metrics']>>()
  let visibleExtent = 0
  for (const row of visible) {
    const { line, runs } = row, lineIndex = lines.length
    const actual = runs.graphemes.filter(g => g.start >= line.start && g.start < line.contentEnd)
    const last = selected.rows[selected.rows.indexOf(row) + 1]?.paragraph !== row.paragraph
    const justify = row.align.startsWith('justify') && (!last || row.align === 'justify-all')
    const ends = [...new Set(line.glyphs.map(g => g.cluster))].sort((a, b) => a - b)
    const segments = new Map(ends.map((at, index) => [at, runs.text.slice(at, ends[index + 1] ?? line.contentEnd)]))
    // 余量加在显示相邻的两簇之间；混排时显示相邻不一定是逻辑相邻。
    const pairKey = (a: number, b: number): string => `${Math.min(a, b)}:${Math.max(a, b)}`
    const shown = line.glyphs.map(g => g.cluster).filter((at, index, all) => at !== all[index - 1])
    // 行尾连续的空白悬挂在栏外，它们之间不能分余量。
    const trailing = line.start + runs.text.slice(line.start, line.contentEnd).replace(/\s+$/u, '').length
    const legal = new Set(shown.flatMap((at, index) => {
      if (!index || Math.max(at, shown[index - 1]) >= trailing) return []
      const before = segments.get(Math.min(at, shown[index - 1])) ?? '', after = segments.get(Math.max(at, shown[index - 1])) ?? ''
      return /\s/u.test(before) || ideographic.test(before) && ideographic.test(after) ? [pairKey(at, shown[index - 1])] : []
    }))
    // 这一行能用的行内范围：绕排和分栏给定段，普通段落是整个盒子减缩进。
    const inlineExtent = vertical ? height : width
    const slotStart = row.slot ? row.slot.inlineStart : row.lineIndent
    const slotSize = row.slot ? row.slot.inlineSize : Math.max(0, inlineExtent - row.lineIndent - row.lineEndIndent)
    const extra = justify && legal.size ? Math.max(0, slotSize - line.width) / legal.size : 0
    const occupied = line.width + legal.size * extra, align = row.align === 'justify-center' ? 'center' : row.align === 'justify-right' ? 'right' : row.align
    const inlineOffset = slotStart + (align === 'center' ? (slotSize - occupied) / 2 : align === 'right' ? slotSize - occupied : 0)
    visibleExtent = Math.max(visibleExtent, slotStart + occupied + row.lineEndIndent)
    const columnLeft = box.x + width - blockShift - row.y - row.height
    const x = vertical ? columnLeft + row.height / 2 : box.x + inlineOffset
    const inlineOrigin = vertical ? box.y + inlineOffset : x
    const baseline = vertical ? x : top + row.y + row.baselineOffset
    const baselines = { baselineKind: 'alphabetic' as const, baseline, alphabeticBaseline: baseline, middleBaseline: vertical ? x : top + row.y + row.height / 2, baselineConversion: 'measured' as const }
    const rowGroups: number[] = [], owned = new Map<number, ShapedTextCluster>()
    if (row.marker) {
      // 列表标记单独排版，贴在正文起点前面；它不属于原文，source 是空范围。
      const plan = createShapedTextPlan(shaper, fonts, row.marker.text, { ...row.marker.style, align: 'left' }, { wrap: 'none', writingMode: options.writingMode, autospace: options.autospace, anchor: { x: 0, y: 0, horizontal: 0, vertical: 0 } })
      const gap = selected.style.fontSize * .4, markerSize = plan.contentSize[vertical ? 'height' : 'width']
      const dx = vertical ? x - plan.box.x - plan.box.width / 2 : row.marker.rightToLeft ? inlineOrigin + occupied + gap : inlineOrigin - gap - markerSize, dy = vertical ? inlineOrigin - gap - markerSize : baseline - (plan.lines[0]?.baseline ?? 0)
      const graphemeBase = graphemes.length, groupBase = groups.length, position = row.sourceOffset
      for (const cluster of plan.clusters) clusters.push({ ...cluster, owner: cluster.owner + graphemeBase, x: cluster.x + dx, baseline: cluster.baseline + dy, inkBounds: cluster.inkBounds && boundsAt(cluster.inkBounds, dx, dy) })
      for (const g of plan.graphemes) graphemes.push({ ...g, x: (g.x ?? 0) + dx, y: g.y + dy, baseline: g.baseline + dy, alphabeticBaseline: g.alphabeticBaseline + dy, middleBaseline: g.middleBaseline + dy, text: '', source: { start: position, end: position }, sources: [], line: lineIndex, group: g.group + groupBase, owner: g.owner + graphemeBase })
      for (const group of plan.groups) {
        rowGroups.push(groups.length)
        groups.push({ ...group, x: group.x + dx, baseline: group.baseline + dy, alphabeticBaseline: group.alphabeticBaseline + dy, middleBaseline: group.middleBaseline + dy, graphemes: group.graphemes.map(index => index + graphemeBase), inkBounds: group.inkBounds && boundsAt(group.inkBounds, dx, dy) })
        inkBounds = union(inkBounds, group.inkBounds && boundsAt(group.inkBounds, dx, dy))
        paintedBounds = union(paintedBounds, group.inkBounds && boundsAt(group.inkBounds, dx, dy))
      }
    }
    const firstGrapheme = graphemes.length
    let advance = line.visualStart ?? 0
    for (const [glyphIndex, glyph] of line.glyphs.entries()) {
      let low = 0, high = actual.length
      while (low < high) { const middle = (low + high) >> 1; if (actual[middle].start > glyph.cluster) high = middle; else low = middle + 1 }
      if (!low) continue
      const source = actual[low - 1], owner = low - 1 + graphemes.length, run = runs.runs[glyph.run ?? 0]
      const runKey = `${row.paragraph}:${glyph.run ?? 0}`, glyphKey = `${runKey}:${glyph.id}`
      let ink = inkCache.get(glyphKey), outline = outlineCache.get(glyphKey), metric = metricCache.get(runKey)
      if (ink === undefined) inkCache.set(glyphKey, ink = shaper.ink(run.source, glyph.id, run.options))
      if (!outline) outlineCache.set(glyphKey, outline = shaper.outlineShape(run.source, glyph.id, run.options.axes))
      if (!metric) metricCache.set(runKey, metric = shaper.metrics(run.source, run.options))
      const upright = vertical && run.options.direction === 'ttb', sideways = vertical && !upright
      let cluster = owned.get(source.start)
      if (!cluster) {
        // 竖排：直立的字以列中线为原点；旋转的拉丁文把字身中线对到列中线上，基线落在列中线左侧。
        const originX = !vertical ? x + advance : (upright ? x : x - (metric.ascent - metric.descent) / 2) - source.baselineShift
        const originY = !vertical ? baseline + source.baselineShift : inlineOrigin + advance
        cluster = { owner, style: source.style, x: originX, baseline: originY, advance: 0, glyphs: [], inkBounds: null, ...(sideways ? { rotate: Math.PI / 2, localInk: null } : {}), ...(upright ? { upright: true } : {}) }
        owned.set(source.start, cluster); clusters.push(cluster)
      }
      const gx = !vertical ? x + advance + glyph.xOffset : upright ? cluster.x + glyph.xOffset : cluster.x + cluster.advance + glyph.xOffset
      const gy = !vertical ? baseline + source.baselineShift - glyph.yOffset : upright ? inlineOrigin + advance - glyph.yOffset : cluster.baseline - glyph.yOffset
      cluster.glyphs.push({ outline, x: gx - cluster.x, y: gy - cluster.baseline, scale: metric.scale })
      if (ink && sideways) {
        const bold = source.style.fauxBold ? Math.max(.5, run.options.size / 30) / 2 : 0, lean = source.style.fauxItalic ? .2 * ink.height : 0
        const localX = gx - cluster.x + ink.x - bold - lean, localY = gy - cluster.baseline + ink.y - bold, inkWidth = ink.width + bold * 2 + lean * 2, inkHeight = ink.height + bold * 2
        cluster.localInk = union(cluster.localInk ?? null, { x: localX, y: localY, width: inkWidth, height: inkHeight })
        cluster.inkBounds = union(cluster.inkBounds, { x: cluster.x - localY - inkHeight, y: cluster.baseline + localX, width: inkHeight, height: inkWidth })
      } else if (ink) {
        const placed = boundsAt(ink, gx, gy), bold = source.style.fauxBold ? Math.max(.5, run.options.size / 30) / 2 : 0
        const shear = source.style.fauxItalic ? -.2 : 0
        const left = Math.min(placed.x + shear * (placed.y - cluster.baseline), placed.x + shear * (placed.y + placed.height - cluster.baseline))
        cluster.inkBounds = union(cluster.inkBounds, { x: left - bold, y: placed.y - bold, width: placed.width + Math.abs(shear) * placed.height + bold * 2, height: placed.height + bold * 2 })
      }
      if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(runs.text.slice(source.start, source.end)) && (!outline.svg || shaper.isColorGlyph(run.source, glyph.id, run.options.axes))) cluster.emoji = runs.text.slice(source.start, source.end)
      advance += glyph.advance; cluster.advance += glyph.advance
      const next = line.glyphs[glyphIndex + 1]
      if (next && glyph.cluster !== next.cluster && legal.has(pairKey(glyph.cluster, next.cluster))) { advance += extra; cluster.advance += extra }
    }
    actual.forEach(g => {
      const cluster = owned.get(g.start) ?? [...owned.entries()].sort(([a], [b]) => b - a).find(([start]) => start <= g.start)?.[1]
      const owner = cluster?.owner ?? graphemes.length, start = row.sourceOffset + g.sourceStart, end = row.sourceOffset + g.sourceEnd
      const gx = cluster?.x ?? x
      graphemes.push({ ...baselines, baseline: cluster?.baseline ?? baseline, alphabeticBaseline: cluster?.baseline ?? baseline, y: cluster?.baseline ?? baseline, text: row.source.slice(g.sourceStart, g.sourceEnd), displayText: runs.text.slice(g.start, g.end), source: { start, end }, sources: range(row, g.sourceStart, g.sourceEnd), style: g.style, line: lineIndex, group: groups.length, x: gx, advance: owner === graphemes.length ? cluster?.advance ?? 0 : 0, owner, positionKind: owner === graphemes.length ? 'individual' : 'shared-cluster' })
    })
    const members = new Map<number, number[]>()
    for (let index = firstGrapheme; index < graphemes.length; index++) {
      const list = members.get(graphemes[index].owner)
      if (list) list.push(index); else members.set(graphemes[index].owner, [index])
    }
    for (const cluster of owned.values()) {
      rowGroups.push(groups.length)
      for (const index of members.get(cluster.owner) ?? []) graphemes[index].group = groups.length
      groups.push({ ...baselines, text: graphemes[cluster.owner]?.displayText ?? '', font: cluster.style.fontFamily, size: cluster.style.fontSize, x: cluster.x, baseline: cluster.baseline, style: cluster.style, graphemes: members.get(cluster.owner) ?? [], indivisible: true, inkBounds: cluster.inkBounds })
      inkBounds = union(inkBounds, cluster.inkBounds)
      paintedBounds = union(paintedBounds, appearanceBounds(cluster.inkBounds, { lines: [], left: cluster.x, top: top + row.y, width: occupied, height: row.height, lineHeight: row.height, contentTop: top, style: { ...cluster.style, background: { ...cluster.style.background, enabled: false } } }))
    }
    lines.push({ ...baselines, text: row.source.slice(sourceAt(row, line.start), sourceAt(row, line.contentEnd)), start: row.sourceOffset + sourceAt(row, line.start), end: row.sourceOffset + sourceAt(row, line.end), ...(vertical ? { x: columnLeft, y: inlineOrigin, width: row.height, height: occupied } : { x, y: top + row.y, width: occupied, height: row.height }), groups: rowGroups })
  }
  paintedBounds = union(paintedBounds, appearanceBounds(null, { lines: [], left: box.x, top: box.y, width, height, lineHeight: 0, contentTop: top, style: selected.style }))
  return { sourceText, diagnostics, style: selected.style, lines, graphemes, groups, clusters, intrinsicWidths: selected.intrinsicWidths, fontIdentity: JSON.stringify([...new Set(selected.rows.map(row => row.runs.fontIdentity))]), box, contentTop: top, contentSize: vertical ? { width: selected.height, height: selected.width } : { width: selected.width, height: selected.height }, visibleContentSize: vertical ? { width: visibleBlock, height: visibleExtent } : { width: visibleExtent, height: visibleBlock }, inkBounds, appearanceBounds: paintedBounds, boundsKind: 'measured', overflow: { full: overflow(selected), visible: overflow({ rows: visible, stopped: undefined, width: visibleExtent, height: visibleBlock }) }, truncated: visible.length < selected.rows.length || !!selected.stopped, omittedRanges, totalLines: selected.rows.length, fit: selected.fit, vertical }
}
