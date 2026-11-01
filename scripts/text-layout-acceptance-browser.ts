import { layoutText, drawText } from '../src/features/videoEdit/authorLibraries/text'
import { TextFontSession } from '../src/core/imaging/vectorContent/shaping/fontPolicy'
import { withTextFontSession } from '../src/core/imaging/vectorContent/shaping/fontContext'
import { textStyleSchema } from '../src/core/imaging/vectorContent/text'
import * as pretext from '../.tmp/text-layout-sources/package/dist/layout.js'
import * as richPretext from '../.tmp/text-layout-sources/package/dist/rich-inline.js'
import type { RichTextContent } from '../src/core/imaging/vectorContent/contracts'
import { punctuationExperiment } from './text-layout-punctuation-experiment'
interface Case { id: string; text: string; width: number; size: number; font: string; language: string; runs?: Array<{ text: string; size: number; weight: number; spacing: number }>; origin: unknown }
interface Font { family: string; aliases?: string[]; file: string; hash: string; weight: number; bytes: number; data: ArrayBuffer }
const results: Record<string, unknown> = {}, output = globalThis as typeof globalThis & { textLayoutExperimentResult: unknown }
const snap = (n: number) => Math.round(n * 64) / 64
async function run() {
  const input = await (await fetch('cases.json')).json(), fonts: Font[] = await (await fetch('fonts.json')).json()
  for (const font of fonts) {
    font.data = await (await fetch(font.file)).arrayBuffer()
    const face = new FontFace(font.family, font.data, { weight: String(font.weight), featureSettings: '"liga" 0, "clig" 0' }); document.fonts.add(await face.load())
  }
  await document.fonts.ready
  const session = new TextFontSession('win32', async request => { const family = request.family === 'sans-serif' ? 'Arial' : request.family; const matches = (f: Font) => f.family === family || f.aliases?.includes(family); const font = fonts.find(f => matches(f) && f.weight === (request.weight ?? 400)) ?? fonts.find(matches); return font && { bytes: font.data } })
  let selection: Array<{ text: string; family: string | undefined; hash: string; missing: boolean }> = []
  const choose = session.choose.bind(session)
  session.choose = (...args) => { const result = choose(...args); selection.push({ text: args[1], family: args[0].candidates.find(candidate => candidate.font === result.font)?.family, hash: result.font.hash, missing: result.missing }); return result }
  await session.prepare({ faces: [{ family: 'sans-serif' }, ...fonts.filter(f => f.family.startsWith('Ticket')).map(f => ({ family: f.family, weight: f.weight })), { family: 'TicketCJK', weight: 700 }], text: input.cases.map((item: Case) => item.text) })
  for (const candidate of session.chain().candidates) {
    const font = fonts.find(font => font.hash === candidate.font?.hash)
    if (font && font.family !== candidate.family) document.fonts.add(await new FontFace(candidate.family, font.data, { weight: String(font.weight) }).load())
  }
  const fontStack = (family: string) => session.chain({ family }).candidates.map(candidate => JSON.stringify(candidate.family)).join(', ')
  const create = (item: Case, width = item.width) => {
    const style = { fontFamily: item.font, fontSize: item.size, align: 'left' as const, verticalAlign: 'top' as const }
    const content: string | RichTextContent = item.runs ? { box: { x: 0, y: 0, width: 0, height: 0 }, paragraphs: [{ align: 'left', direction: 'ltr', spaceBefore: 0, spaceAfter: 0, runs: item.runs.map(run => ({ text: run.text, style: textStyleSchema.parse({ ...style, fontSize: run.size, fontWeight: run.weight, tracking: run.spacing / run.size * 1000 }) })) }] } : item.text
    return withTextFontSession(session, () => layoutText(content, style, { wrapWidth: width, autospace: false }))
  }
  const dom = (item: Case, width = item.width, autospace = false) => {
    const el = document.createElement('div'); el.className = 'sample'; el.lang = item.language
    Object.assign(el.style, input.css, { width: width + 'px', font: `${item.size}px ${fontStack(item.font)}`, lineHeight: '1.25', fontKerning: 'normal', fontSynthesis: 'none', fontFeatureSettings: '"liga" 0, "clig" 0', letterSpacing: '0px', textAutospace: autospace ? 'normal' : 'no-autospace' })
    const nodes: Array<{ node: Text; offset: number }> = []; let offset = 0
    for (const run of item.runs ?? [{ text: item.text, size: item.size, weight: 400, spacing: 0 }]) {
      const node = document.createTextNode(run.text), span = document.createElement('span'); span.style.fontSize = run.size + 'px'; span.style.fontWeight = String(run.weight); span.style.letterSpacing = run.spacing + 'px'; span.append(node); el.append(span); nodes.push({ node, offset }); offset += run.text.length
    }
    document.querySelector('#samples')!.append(el)
    const rows: Array<{ top: number; left: number; right: number; start: number; end: number }> = []
    const raw: unknown[] = []
    for (const segment of new Intl.Segmenter(item.language, { granularity: 'grapheme' }).segment(item.text)) {
      const start = segment.index, end = start + segment.segment.length
      const a = nodes.find(({ node, offset }) => start >= offset && start < offset + node.length), b = nodes.find(({ node, offset }) => end > offset && end <= offset + node.length)
      if (!a || !b) continue
      const range = document.createRange(); range.setStart(a.node, start - a.offset); range.setEnd(b.node, end - b.offset)
      const rect = [...range.getClientRects()].at(-1); if (!rect) continue
      raw.push({ start, end, text: segment.segment, rectangles: [...range.getClientRects()].map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })) })
      let row = rows.find(row => Math.abs(row.top - rect.top) < item.size * .7)
      if (!row) { row = { top: rect.top, left: rect.left, right: rect.left, start, end: start }; rows.push(row) }
      if (!/^[\s\u00ad\u200b]+$/u.test(segment.segment)) row.end = end
      if (!/^\s+$/u.test(segment.segment)) { row.left = Math.min(row.left, rect.left); row.right = Math.max(row.right, rect.right) }
    }
    if (item.id === 'P011' && width === item.width) results.softHyphenRanges = raw
    el.remove()
    return rows.map(row => ({ start: row.start, end: row.end, width: row.right - row.left }))
  }
  const canonical = (text: string, lines: Array<{ start: number; end: number; width: number }>) => lines.map(line => { const visible = text.slice(line.start, line.end).replace(/[\s\u00ad\u200b]+$/u, ''); return { start: line.start, end: line.start + visible.length, width: line.width } })
  const planned = (item: Case, layout: ReturnType<typeof layoutText>) => canonical(item.text, layout.lines.map(line => {
    const end = line.start + item.text.slice(line.start, line.end).replace(/[\s\u200b]+$/u, '').length
    const width = layout.graphemes.filter(g => g.line === layout.lines.indexOf(line) && g.source.end <= end).reduce((sum, g) => sum + g.advance, 0)
    return { ...line, occupied: line.width, width }
  }))
  const unmodified = (item: Case) => {
    pretext.setLocale(item.language)
    if (!item.runs) {
      const p = pretext.prepareWithSegments(item.text, `${item.size}px ${fontStack(item.font)}`, { whiteSpace: 'pre-wrap', wordBreak: 'normal' })
      const offsets = p.segments.map((_, i) => p.segments.slice(0, i).join('').length)
      const cursor = (c: pretext.LayoutCursor) => (offsets[c.segmentIndex] ?? item.text.length) + [...new Intl.Segmenter(item.language, { granularity: 'grapheme' }).segment(p.segments[c.segmentIndex] ?? '')].slice(0, c.graphemeIndex).map(g => g.segment).join('').length
      return canonical(item.text, pretext.layoutWithLines(p, item.width, item.size * 1.25).lines.map(l => ({ start: cursor(l.start), end: cursor(l.end), width: l.width })))
    }
    const p = richPretext.prepareRichInline(item.runs.map(r => ({ text: r.text, font: `${r.weight} ${r.size}px ${fontStack(item.font)}`, letterSpacing: r.spacing })), { whiteSpace: 'pre-wrap', wordBreak: 'normal' })
    const lines: Array<{ start: number; end: number; width: number }> = [], offsets = item.runs.map((_, i) => item.runs!.slice(0, i).map(r => r.text).join('').length)
    richPretext.walkRichInlineLineRanges(p, item.width, range => { const line = richPretext.materializeRichInlineLineRange(p, range), a = line.fragments[0], b = line.fragments.at(-1); lines.push({ start: a ? offsets[a.itemIndex] + a.sourceStart : 0, end: b ? offsets[b.itemIndex] + b.sourceEnd : 0, width: line.width }) })
    return canonical(item.text, lines)
  }
  const cases = [], thresholds = []
  for (const item of input.cases as Case[]) {
    try {
      selection = []
      const layout = create(item), expected = planned(item, layout), actual = dom(item), upstream = unmodified(item)
      const breaks = (a: typeof expected, b: typeof expected) => JSON.stringify(a.map(l => [l.start, l.end])) === JSON.stringify(b.map(l => [l.start, l.end]))
      const error = expected.length === actual.length ? Math.max(0, ...expected.map((l, i) => Math.abs(l.width - actual[i].width))) : null
      cases.push({ id: item.id, origin: item.origin, selection, expected, occupied: layout.lines.map(line => line.width), actual, upstream: upstream.map(({ width, ...line }) => ({ ...line, occupiedWidth: width })), breaksMatch: breaks(expected, actual), upstreamBreaksMatch: breaks(upstream, actual), geometryMatch: error !== null && error <= 1 / 32, maxError: error, missing: layout.diagnostics })
    } catch (error) { cases.push({ id: item.id, error: String(error), breaksMatch: false, geometryMatch: false }) }
    for (const delta of [-1 / 64, 0, 1 / 64]) {
      const width = snap(item.width) + delta
      try {
        const laid = planned(item, create(item, width)), measured = dom(item, width)
        thresholds.push({ id: item.id, width, breaksMatch: JSON.stringify(laid.map(l => [l.start, l.end])) === JSON.stringify(measured.map(l => [l.start, l.end])), error: laid.length === measured.length ? Math.max(0, ...laid.map((l, i) => Math.abs(l.width - measured[i].width))) : null })
      } catch (error) { thresholds.push({ id: item.id, width, error: String(error), breaksMatch: false }) }
    }
  }
  results.cases = cases; results.thresholds = thresholds
  results.environment = { userAgent: navigator.userAgent, dpr: devicePixelRatio, locale: navigator.language, autospaceSupported: CSS.supports('text-autospace', 'normal'), fonts: fonts.map(({ data: _, ...meta }) => meta), pipeline: '正式源码作者入口；隔离 Electron，非应用完整 Worker/合成生产验收' }
  const accepted = new Set(['P022', 'P027', 'U003', 'U004', 'U007', 'U008', 'U018'])
  const emoji = new Set((input.cases as Case[]).filter(item => /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\u20e3/u.test(item.text)).map(item => item.id))
  const breakFailures = cases.filter(item => !accepted.has(item.id) && !item.breaksMatch).map(item => item.id)
  const geometryFailures = cases.filter(item => !accepted.has(item.id) && !emoji.has(item.id) && !item.geometryMatch).map(item => item.id)
  const exceptions = cases.filter(item => 'error' in item).map(item => item.id)
  const thresholdExceptions = thresholds.filter(item => typeof item.error !== 'number' && item.error !== null)
  const thresholdFailures = thresholds.filter(item => !accepted.has(item.id) && (!item.breaksMatch || !emoji.has(item.id) && (typeof item.error !== 'number' || item.error > 1 / 32)))
  const gate = { passed: cases.length === 200 && thresholds.length === 600 && !exceptions.length && !thresholdExceptions.length && !breakFailures.length && !geometryFailures.length && !thresholdFailures.length,
    accepted: [...accepted], breaksMatched: cases.filter(item => item.breaksMatch).length, upstreamMatched: cases.filter(item => 'upstreamBreaksMatch' in item && item.upstreamBreaksMatch).length, breakFailures, geometryFailures, thresholdFailures, exceptions, thresholdExceptions }
  results.gate = gate
  if (!gate.passed) {
    results.notRun = ['实验3的DOM墨迹叠图与1×/4×视觉验收', '实验4–8：前置断点/几何门槛未通过']
    session.close(); return
  }
  results.autospace = ['中文AI中文', '中文 AI 中文', '中文2026中文'].map(text => { const item: Case = { id: 'autospace', text, size: 32, width: 600, font: 'TicketCJK', language: 'zh-CN', origin: 'project' }; const off = create(item), on = withTextFontSession(session, () => layoutText(text, { fontFamily: item.font, fontSize: item.size, align: 'left' }, { wrapWidth: item.width })); return { text, hbOff: off.lines[0].width, hbOn: on.lines[0].width, domOff: dom(item)[0].width, domOn: dom(item, item.width, true)[0].width } })
  results.experiment3 = await punctuationExperiment(session, fontStack)
  results.softHyphenDrawing = (input.cases as Case[]).filter(item => ['P021', 'P025'].includes(item.id)).map(item => {
    const layout = create(item), owner = layout.graphemes.findIndex(grapheme => grapheme.source.start === item.text.indexOf('\u00ad'))
    const canvas = new OffscreenCanvas(128, 128), context = canvas.getContext('2d')!
    context.translate(30, 30); drawText(context, layout, { graphemes: [owner], backgroundAndDecorationOpacity: 0 })
    return { id: item.id, advance: layout.graphemes[owner].advance, inkChannels: context.getImageData(0, 0, 128, 128).data.filter(value => value !== 0).length }
  })
  results.notRun = ['实验4–8：等待实验3字位与墨迹验收']
  session.close(); return

}
run().then(() => { output.textLayoutExperimentResult = results }).catch(error => { output.textLayoutExperimentResult = { ...results, fatal: String(error), cases: results.cases ?? [] } })
