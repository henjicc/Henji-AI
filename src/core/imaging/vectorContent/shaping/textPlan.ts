import type { RichTextContent, TextParagraph } from '../contracts'
import type { TextStyle } from '../text'
import { scaleTextSpatialStyle } from '../metrics'
import { appearanceBounds, fitTextLayout, union, type TextDrawConstraints, type TextDrawPlan, type TextPlanGrapheme, type TextPlanRect, type TextSourceRange } from '../textDrawPlan'
import { prepareShapingRuns, textFontRequest, type ShapingRuns } from './runs'
import { ShapedParagraph, layoutUnits, availableUnits, type ParagraphLine } from './paragraph'
import { type TextFontAccess } from './fontSession'
import { type TextOutline, type ShapeOptions, TextShaper } from './harfbuzz'

export type ShapedTextOptions = Omit<TextDrawConstraints, 'wrap'> & { wrap?: 'normal' | 'word' | 'grapheme' | 'none'; ligatures?: boolean; autospace?: boolean; features?: ShapeOptions['features']; axes?: ShapeOptions['axes'] }
export interface OutlinePlacement { outline: TextOutline; x: number; y: number; scale: number }
export interface ShapedTextCluster { owner: number; style: TextStyle; x: number; baseline: number; advance: number; glyphs: OutlinePlacement[]; inkBounds: TextPlanRect | null; emoji?: string }
export interface ShapedTextGrapheme extends Omit<TextPlanGrapheme, 'positionKind'> { owner: number; positionKind: 'individual' | 'shared-cluster' }
export interface ShapedTextPlan extends Omit<TextDrawPlan, 'batches' | 'rasterBounds' | 'graphemes'> { graphemes: ShapedTextGrapheme[]; clusters: ShapedTextCluster[]; diagnostics: Array<{ kind: 'missing-glyph' | 'inferred-script'; source: { start: number; end: number }; text: string }>; fontIdentity: string; intrinsicWidths: { min: number; max: number } }
interface Row { paragraph: number; sourceOffset: number; source: string; runs: ShapingRuns; line: ParagraphLine; y: number; height: number; ascent: number; descent: number; align: TextStyle['align'] }
const ideographic = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const boundsAt = (rect: TextPlanRect, x: number, y: number): TextPlanRect => ({ ...rect, x: rect.x + x, y: rect.y + y })
// 动态排版每帧都可能换栏宽，整形结果与栏宽无关；按内容、样式和字体复用，换宽度只重新断行。
const PARAGRAPH_CACHE_SIZE = 32
const paragraphCaches = new WeakMap<TextShaper, Map<string, { runs: ShapingRuns; shape: ShapedParagraph; intrinsic: { min: number; max: number } }>>()

/** 整形、选行与放置共用一个段落结果；fit 每次改变实际字号重新整形。 */
export function createShapedTextPlan(shaper: TextShaper, fonts: TextFontAccess, input: string | RichTextContent, originalStyle: TextStyle, options: ShapedTextOptions = {}): ShapedTextPlan {
  const original: TextParagraph[] = typeof input === 'string' ? [{ runs: [{ text: input, style: originalStyle }], align: originalStyle.align, direction: 'auto', spaceBefore: 0, spaceAfter: 0 }] : input.paragraphs
  const sourceText = original.map(paragraph => paragraph.runs.map(run => run.text).join('')).join('\n')
  const richBox = typeof input === 'string' ? undefined : input.box
  const boxWidth = options.box?.width || originalStyle.boxWidth * (options.frame?.width ?? 0) || richBox?.width || undefined
  const boxHeight = options.box?.height ?? (originalStyle.boxHeight * (options.frame?.height ?? 0) || richBox?.height || undefined)
  // 只给 maxWidth 时按它折行；同时要 fit 又没给行数或高度上限，折行后永远放得下、fit 就失效了，所以按单行缩字号。
  const fitActive = !!options.fit && (options.fit.trigger !== 'maxLines' || options.maxLines !== undefined)
  const wrapsAtMaxWidth = !fitActive || (options.maxLines ?? 1) > 1 || options.maxHeight !== undefined
  const wrapWidth = options.wrapWidth ?? boxWidth ?? (wrapsAtMaxWidth ? options.maxWidth : undefined)
  const constraints: TextDrawConstraints = { ...options, wrap: options.wrap === 'normal' ? 'word' : options.wrap }
  const make = (size: number) => {
    const factor = size / originalStyle.fontSize, style = scaleTextSpatialStyle(originalStyle, factor), rows: Row[] = []
    let offset = 0, y = 0, min = 0, max = 0
    original.forEach((paragraph, paragraphIndex) => {
      let at = 0
      const spans = paragraph.runs.map(run => { const start = at; at += run.text.length; return { start, end: at, style: scaleTextSpatialStyle(run.style, factor) } })
      const source = paragraph.runs.map(run => run.text).join('')
      const base = options.direction === 'rtl' || options.direction === 'ltr' ? options.direction : paragraph.direction
      const shapeOptions: ShapeOptions = { size, direction: base === 'rtl' ? 'rtl' : 'ltr', ligatures: options.ligatures, features: options.features, axes: options.axes }
      const fallback = fonts.chain().candidates.find(candidate => candidate.font)?.font
      if (!fallback) throw new Error('默认文字字体不可用')
      let cache = paragraphCaches.get(shaper)
      if (!cache) paragraphCaches.set(shaper, cache = new Map())
      const cacheKey = JSON.stringify([source, base, shapeOptions, options.autospace, options.wrap, spans, spans.map(span => fonts.chain(textFontRequest(span.style)).identity), fonts.chain().identity])
      let prepared = cache.get(cacheKey)
      if (prepared) cache.delete(cacheKey)
      else {
        const runs = prepareShapingRuns(shaper, fonts, source, spans, shapeOptions, base)
        const shape = new ShapedParagraph(shaper, runs.runs[0]?.source ?? fallback, runs.text, { ...shapeOptions, bidi: runs.bidi, spacing: runs.spacing, autospace: options.autospace, wrap: options.wrap === 'word' ? 'normal' : options.wrap }, runs.runs, runs.graphemes.map(g => g.end))
        prepared = { runs, shape, intrinsic: shape.intrinsicWidths() }
        if (cache.size >= PARAGRAPH_CACHE_SIZE) cache.delete(cache.keys().next().value!)
      }
      cache.set(cacheKey, prepared)
      const { runs, intrinsic } = prepared
      const lines = [...prepared.shape.layout(wrapWidth).lines]
      min = Math.max(min, intrinsic.min); max = Math.max(max, intrinsic.max)
      if (!lines.length || runs.text.endsWith('\n')) lines.push({ start: runs.text.length, end: runs.text.length, contentEnd: runs.text.length, width: 0, glyphs: [] })
      y += paragraph.spaceBefore * factor
      lines.forEach(line => {
        const active = runs.runs.filter(run => run.start < line.contentEnd && run.end > line.start)
        const styles = runs.graphemes.filter(g => g.start >= line.start && g.start < line.contentEnd).map(g => g.style)
        // 空行仍属于源段落；字形数组为空不能抹掉作者的字号和行距。
        const emptyStyle = runs.graphemes.find(g => g.start <= line.start && g.end > line.start)?.style ?? runs.graphemes.at(-1)?.style ?? spans[0]?.style ?? style
        const metrics = active.map(run => shaper.metrics(run.source, run.options))
        if (!metrics.length) {
          const font = fonts.chain(textFontRequest(emptyStyle)).candidates.find(candidate => candidate.font)?.font ?? fallback
          metrics.push(shaper.metrics(font, { ...shapeOptions, size: emptyStyle.fontSize }))
        }
        const ascent = Math.max(...metrics.map(m => m.ascent)), descent = Math.max(...metrics.map(m => m.descent))
        const height = Math.max(...(styles.length ? styles : [emptyStyle]).map(value => value.leading || value.fontSize * 1.25))
        rows.push({ paragraph: paragraphIndex, sourceOffset: offset, source, runs, line, y, height, ascent, descent, align: paragraph.align })
        y += height
      })
      y += paragraph.spaceAfter * factor
      offset += source.length + 1
    })
    return { style, rows, width: Math.max(0, ...rows.map(row => row.line.width)), height: y, intrinsicWidths: { min, max } }
  }
  const overflow = (value: ReturnType<typeof make>) => ({ width: !!options.maxWidth && layoutUnits(value.width) > availableUnits(options.maxWidth), height: options.maxHeight !== undefined && layoutUnits(value.height) > availableUnits(options.maxHeight), lines: options.maxLines !== undefined && value.rows.length > options.maxLines })
  const selected = fitTextLayout(originalStyle, constraints, make, value => !Object.values(overflow(value)).some(Boolean))
  const visible = options.truncate === false ? selected.rows : selected.rows.filter((row, index) => (options.maxLines === undefined || index < options.maxLines) && (options.maxHeight === undefined || layoutUnits(row.y + row.height) <= availableUnits(options.maxHeight)))
  const visibleHeight = visible.length ? visible.at(-1)!.y + visible.at(-1)!.height : 0
  const width = boxWidth ?? Math.max(selected.style.fontSize, ...visible.map(row => row.line.width)), height = boxHeight ?? visibleHeight
  const anchor = options.anchor ?? { x: richBox?.x ?? 0, y: richBox?.y ?? 0, horizontal: 0, vertical: 0 }
  const box = { x: anchor.x - anchor.horizontal * width, y: anchor.y - anchor.vertical * height, width, height }
  const verticalAlign = typeof input === 'string' ? selected.style.verticalAlign : original.find(p => p.runs.length)?.runs[0].style.verticalAlign ?? 'top'
  const top = box.y + (verticalAlign === 'middle' ? (height - visibleHeight) / 2 : verticalAlign === 'bottom' ? height - visibleHeight : 0)
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
  // 同一字形在一份版面里反复出现，字形范围和轮廓按字体与字号各查一次。
  const inkCache = new Map<string, ReturnType<TextShaper['ink']>>(), outlineCache = new Map<string, TextOutline>(), metricCache = new Map<string, ReturnType<TextShaper['metrics']>>()
  for (const row of visible) {
    const { line, runs } = row, lineIndex = lines.length, firstGrapheme = graphemes.length
    const actual = runs.graphemes.filter(g => g.start >= line.start && g.start < line.contentEnd)
    const last = selected.rows[selected.rows.indexOf(row) + 1]?.paragraph !== row.paragraph
    const justify = row.align.startsWith('justify') && (!last || row.align === 'justify-all')
    const ends = [...new Set(line.glyphs.map(g => g.cluster))].sort((a, b) => a - b)
    const segments = new Map(ends.map((at, index) => [at, runs.text.slice(at, ends[index + 1] ?? line.contentEnd)]))
    // 余量加在显示相邻的两簇之间；混排时显示相邻不一定是逻辑相邻。
    const pairKey = (a: number, b: number): string => `${Math.min(a, b)}:${Math.max(a, b)}`
    const shown = line.glyphs.map(g => g.cluster).filter((at, index, all) => at !== all[index - 1])
    const legal = new Set(shown.flatMap((at, index) => {
      if (!index) return []
      const before = segments.get(Math.min(at, shown[index - 1])) ?? '', after = segments.get(Math.max(at, shown[index - 1])) ?? ''
      return /\s/u.test(before) || ideographic.test(before) && ideographic.test(after) ? [pairKey(at, shown[index - 1])] : []
    }))
    const extra = justify && legal.size ? Math.max(0, width - line.width) / legal.size : 0
    const occupied = line.width + legal.size * extra, align = row.align === 'justify-center' ? 'center' : row.align === 'justify-right' ? 'right' : row.align
    const x = box.x + (align === 'center' ? (width - occupied) / 2 : align === 'right' ? width - occupied : 0)
    const baseline = top + row.y + (row.height - row.ascent - row.descent) / 2 + row.ascent
    const baselines = { baselineKind: 'alphabetic' as const, baseline, alphabeticBaseline: baseline, middleBaseline: top + row.y + row.height / 2, baselineConversion: 'measured' as const }
    const rowGroups: number[] = [], owned = new Map<number, ShapedTextCluster>()
    let advance = line.visualStart ?? 0
    for (const [glyphIndex, glyph] of line.glyphs.entries()) {
      let low = 0, high = actual.length
      while (low < high) { const middle = (low + high) >> 1; if (actual[middle].start > glyph.cluster) high = middle; else low = middle + 1 }
      if (!low) continue
      const source = actual[low - 1], owner = low - 1 + graphemes.length, run = runs.runs[glyph.run ?? 0]
      let cluster = owned.get(source.start)
      if (!cluster) { cluster = { owner, style: source.style, x: x + advance, baseline: baseline + source.baselineShift, advance: 0, glyphs: [], inkBounds: null }; owned.set(source.start, cluster); clusters.push(cluster) }
      const gx = x + advance + glyph.xOffset, gy = baseline + source.baselineShift - glyph.yOffset
      const runKey = `${row.paragraph}:${glyph.run ?? 0}`, glyphKey = `${runKey}:${glyph.id}`
      let ink = inkCache.get(glyphKey), outline = outlineCache.get(glyphKey), metric = metricCache.get(runKey)
      if (ink === undefined) inkCache.set(glyphKey, ink = shaper.ink(run.source, glyph.id, run.options))
      if (!outline) outlineCache.set(glyphKey, outline = shaper.outlineShape(run.source, glyph.id, run.options.axes))
      if (!metric) metricCache.set(runKey, metric = shaper.metrics(run.source, run.options))
      cluster.glyphs.push({ outline, x: gx - cluster.x, y: gy - cluster.baseline, scale: metric.scale })
      if (ink) {
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
    lines.push({ ...baselines, text: row.source.slice(sourceAt(row, line.start), sourceAt(row, line.contentEnd)), start: row.sourceOffset + sourceAt(row, line.start), end: row.sourceOffset + sourceAt(row, line.end), x, y: top + row.y, width: occupied, height: row.height, groups: rowGroups })
  }
  paintedBounds = union(paintedBounds, appearanceBounds(null, { lines: [], left: box.x, top: box.y, width, height, lineHeight: 0, contentTop: top, style: selected.style }))
  return { sourceText, diagnostics, style: selected.style, lines, graphemes, groups, clusters, intrinsicWidths: selected.intrinsicWidths, fontIdentity: JSON.stringify([...new Set(selected.rows.map(row => row.runs.fontIdentity))]), box, contentTop: top, contentSize: { width: selected.width, height: selected.height }, visibleContentSize: { width: Math.max(0, ...lines.map(line => line.width)), height: visibleHeight }, inkBounds, appearanceBounds: paintedBounds, boundsKind: 'measured', overflow: { full: overflow(selected), visible: overflow({ ...selected, rows: visible, width: Math.max(0, ...lines.map(line => line.width)), height: visibleHeight }) }, truncated: visible.length < selected.rows.length, omittedRanges, totalLines: selected.rows.length, fit: selected.fit }
}
