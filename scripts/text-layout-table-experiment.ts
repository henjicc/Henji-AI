import * as hb from '../resources/video-edit-author/vendor/harfbuzzjs/1.6.4/index.mjs'
import { TextShaper } from '../src/core/imaging/vectorContent/shaping/harfbuzz'
import { TextFontSession } from '../src/core/imaging/vectorContent/shaping/fontPolicy'
import { withTextFontSession } from '../src/core/imaging/vectorContent/shaping/fontContext'
import { layoutTable } from '../src/features/videoEdit/authorLibraries/table'
import { drawText } from '../src/features/videoEdit/authorLibraries/text'

async function run(): Promise<unknown> {
  const fonts: Array<{ family: string; file: string; hash: string; weight: number }> = await (await fetch('fonts.json')).json()
  const bytes = new Map<string, ArrayBuffer>()
  for (const font of fonts) {
    const data = await (await fetch(font.file)).arrayBuffer(); bytes.set(font.hash, data)
    document.fonts.add(await new FontFace(font.family, data, { weight: String(font.weight) }).load())
  }
  await document.fonts.ready
  const session = new TextFontSession('win32', async request => { const font = fonts.find(font => font.family === (request.family === 'sans-serif' ? 'Arial' : request.family)); return font && { bytes: bytes.get(font.hash)! } })
  await session.prepare({ faces: [{ family: 'sans-serif' }, ...fonts.map(font => ({ family: font.family }))] })
  const shaper = new TextShaper(hb), failures: string[] = [], rows = [], captures = []
  try {
    const metrics = fonts.filter(font => font.weight === 400).map(font => {
      const source = { bytes: bytes.get(font.hash)!, hash: font.hash }, blob = new hb.Blob(source.bytes), face = new hb.Face(blob, 0)
      try {
        const options = { size: face.upem, features: { tnum: 1, pnum: 0 } }
        const digits = [...'0123456789'].map(text => shaper.shape(source, text, options))
        return { family: font.family, hash: font.hash, upem: face.upem, advances: digits.map(digit => digit.width), missing: digits.some(digit => digit.glyphs.some(g => !g.id)), symbols: [...'+-.,% '].map(text => ({ text, advance: shaper.shape(source, text, options).width })) }
      } finally { face.dispose(); blob.dispose() }
    })
    const supported = metrics.find(font => font.family === 'TicketLatin')!
    if (supported.missing || new Set(supported.advances).size !== 1) failures.push('Calibri tnum 数字 font units 不等宽')
    const unsupported = metrics.find(font => !font.missing && new Set(font.advances).size > 1)
    if (!unsupported) throw new Error('需要一个实际不提供等宽数字的字体做诊断对照')
    const diagnostics = withTextFontSession(session, () => layoutTable({ columns: [{ key: 'n', numeric: true }], rows: [{ n: '0123456789' }], style: { fontFamily: unsupported.family } }).diagnostics)
    if (!diagnostics.length) failures.push('不等宽数字字体没有诊断')
    for (const [id, width, fixed] of [['auto', 500, undefined], ['narrow', 120, undefined], ['fixed', 360, 80], ['fixed-zero', 100, 0]] as const) {
      const values = [{ label: 'Revenue growth', n: '1,234.50%' }, { label: 'Profit margin', n: '-56.7%' }, { label: '0123456789', n: '+890' }]
      const input = { columns: [{ key: 'label', width: fixed }, { key: 'n', numeric: true }], rows: values, style: { fontFamily: 'TicketLatin', fontSize: 30, leading: 0, align: 'left' as const, fill: { color: '#000000' } } }
      const table = withTextFontSession(session, () => layoutTable(input, { width, cellPadding: 6, columnGap: 4, rowGap: 3 }))
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(Math.max(640, table.box.width + 20)); canvas.height = Math.ceil(table.box.height + 20)
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.strokeStyle = '#ff0000'
      for (const cell of table.cells) { ctx.strokeRect(cell.box.x, cell.box.y, cell.box.width, cell.box.height); drawText(ctx as unknown as OffscreenCanvasRenderingContext2D, cell.text) }
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let ink = 0
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 100 && pixels[i + 1] < 100 && pixels[i + 2] < 100) ink++
      if (!ink) failures.push(`${id}: 缺少文字墨迹`)
      captures.push({ name: `table-${id}`, dataUrl: canvas.toDataURL() })
      let geometryError = 0, breaksMatch = true, overlap = false
      const cells = []
      for (const cell of table.cells) {
        const value = values[cell.row][cell.column ? 'n' : 'label']
        const el = document.createElement('div'); el.textContent = value
        Object.assign(el.style, { font: '30px TicketLatin', width: `${cell.contentBox.width}px`, lineHeight: '1.25', textAlign: cell.column ? 'right' : 'left', fontVariantNumeric: cell.column ? 'tabular-nums' : 'normal', fontFeatureSettings: cell.column ? '"tnum" 1,"pnum" 0,"liga" 0,"clig" 0' : '"liga" 0,"clig" 0', overflowWrap: 'break-word', whiteSpace: 'pre-wrap', textAutospace: 'no-autospace' }); document.body.append(el)
        const domLines: Array<{ start: number; end: number; top: number }> = [], positions = []
        const origin = el.getBoundingClientRect()
        for (const [index, g] of cell.text.graphemes.entries()) {
          const range = document.createRange(); range.setStart(el.firstChild!, g.source.start); range.setEnd(el.firstChild!, g.source.end)
          const rect = range.getBoundingClientRect(), line = domLines.find(line => Math.abs(line.top - rect.top) < 1)
          if (line) line.end = g.source.end; else domLines.push({ start: g.source.start, end: g.source.end, top: rect.top })
          const error = g.x === null ? 0 : Math.abs(g.x - cell.contentBox.x - (rect.x - origin.x))
          if (!/^\s+$/u.test(g.text) && cell.contentBox.width > 0) geometryError = Math.max(geometryError, error)
          positions.push({ index, text: g.text, hbX: g.x, domX: rect.x - origin.x + cell.contentBox.x, error })
        }
        const boundaries = (lines: Array<{ start: number; end: number }>) => lines.map(l => [l.start, l.start + value.slice(l.start, l.end).trimEnd().length])
        const same = JSON.stringify(boundaries(domLines)) === JSON.stringify(boundaries(cell.text.lines))
        if (cell.contentBox.width > 0) breaksMatch &&= same
        const next = table.cells.find(other => other.row === cell.row && other.column === cell.column + 1)
        overlap ||= !!next && cell.box.x + cell.box.width > next.box.x
        cells.push({ row: cell.row, column: cell.column, box: cell.box, lines: cell.text.lines, domLines, positions, breaksMatch: same }); el.remove()
      }
      if (overlap || !breaksMatch || geometryError > 1 / 32) failures.push(`${id}: overlap=${overlap}, breaks=${breaksMatch}, geometry=${geometryError}`)
      if (id === 'narrow' && !table.overflow || id === 'fixed-zero' && !table.overflow) failures.push(`${id}: 未报告溢出`)
      const replacements = ['111.00%', '999.00%'].map(n => withTextFontSession(session, () => layoutTable({ ...input, rows: [{ label: 'Fixed label', n }] }, { width, cellPadding: 6, columnGap: 4 })))
      const stableDigits = JSON.stringify(replacements[0].columns) === JSON.stringify(replacements[1].columns)
      if (!stableDigits) failures.push(`${id}: 等位数数字换值造成列横跳`)
      rows.push({ id, width, columns: table.columns, height: table.box.height, overflow: table.overflow, diagnostics: table.diagnostics, cells, overlap, geometryError, breaksMatch, stableDigits, ink })
    }
    return { cases: [], experiment8: { metrics, unsupported, diagnostics, rows, cssDifference: '列宽按已定义的 auto-table 子集分配；DOM 在同一最终列宽下对照逐格换行/对齐，不宣称完整 CSS 表格列分配一致。零内容宽列只验溢出与列框，Canvas 文字墨迹可越出零宽框。' }, captures, gate: { passed: !failures.length, failures } }
  } finally { shaper.dispose(); session.close() }
}
run().then(result => { (globalThis as typeof globalThis & { textLayoutExperimentResult: unknown }).textLayoutExperimentResult = result }).catch(error => { (globalThis as typeof globalThis & { textLayoutExperimentResult: unknown }).textLayoutExperimentResult = { cases: [], fatal: String(error), gate: { passed: false } } })
