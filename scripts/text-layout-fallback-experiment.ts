import type { Font, openHarness } from './text-layout-worker-experiment'
import type { CodeAuthorBundle } from '../src/core/videoEdit/codeAuthorProgram'
import { fontFormatsExperiment } from './text-layout-font-formats-experiment'

export async function runFallbackExperiment(fonts: Font[], host: Awaited<ReturnType<typeof openHarness>>): Promise<unknown> {
  const latin = fonts.find(font => font.family === 'TicketLatin' && font.weight === 400)!, bold = fonts.find(font => font.family === 'TicketLatin' && font.weight === 700)!, variable = fonts.find(font => font.family === 'Noto Sans SC')!
  const mutable = { ...latin, family: 'MutableFont', aliases: [] }; fonts.push(mutable)
  const cases: Array<{ id: string; text: string; missing: boolean; replacement?: Font }> = [
    { id: 'kana', text: 'かなカナ', missing: false },
    { id: 'extended-han', text: '𠀀𠀁', missing: false },
    { id: 'emoji-zwj', text: '👩🏽‍💻', missing: false },
    { id: 'emoji-vs', text: '❤️', missing: false },
    { id: 'emoji-flag', text: '🇨🇳', missing: false },
    { id: 'combining', text: 'e\u0301', missing: false },
    { id: 'missing', text: '\u{10ffff}', missing: true },
    { id: 'same-name-latin', text: 'ABC', missing: false, replacement: latin },
    { id: 'same-name-bold', text: 'ABC', missing: false, replacement: bold },
    { id: 'axis-light', text: 'ABC', missing: false, replacement: { ...variable, variations: { wght: 100 } } },
    { id: 'axis-heavy', text: 'ABC', missing: false, replacement: { ...variable, variations: { wght: 900 } } },
  ]
  const rows = [], captures = [], failures: string[] = [], domFontChecks = []
  const data = new Map<string, ArrayBuffer>()
  for (const font of fonts) {
    const bytes = await (await fetch(font.file)).arrayBuffer(); data.set(font.hash, bytes)
    for (const family of new Set([font.family, ...font.aliases ?? []])) document.fonts.add(await new FontFace(family, bytes, { weight: String(font.weight) }).load())
  }
  await document.fonts.ready
  const pixelData = (bitmap: ImageBitmap) => {
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close()
    return { canvas, bytes: ctx.getImageData(0, 0, canvas.width, canvas.height).data }
  }
  try {
    for (const item of cases) {
      const family = item.replacement ? 'MutableFont' : 'TicketLatin', moduleId = item.replacement ? 'identity' : item.id
      if (item.replacement) { Object.assign(mutable, item.replacement, { family: 'MutableFont', aliases: [] }); await host.send({ id: 0, kind: 'fonts', availableIds: [], fonts: [], reset: true }) }
      const textUrl = new URL('author-text.mjs', location.href).href, fingerprintUrl = new URL('worker-fingerprint.mjs', location.href).href
      const code = `import {layoutText,drawText} from ${JSON.stringify(textUrl)}; import {fingerprintAuthorFrame} from ${JSON.stringify(fingerprintUrl)};
        const p=layoutText(${JSON.stringify(item.text)},{fontFamily:${JSON.stringify(family)},fontSize:40,align:'left',fill:{color:'#ffffff'}},{wrapWidth:120,autospace:false,anchor:{x:20,y:20,horizontal:0,vertical:0}});
        const effect={name:'回退',draw(ctx){drawText(ctx,p)}};
        const fingerprint=fingerprintAuthorFrame(effect,{width:640,height:240},{},{time:0,frameDuration:1/30,clip:{time:0,duration:10}},{},new OffscreenCanvas(1,1).getContext('2d'),undefined,false,{},10);
        self.postMessage({kind:'probe.layout',caseId:${JSON.stringify(moduleId)},lines:p.lines.map(({start,end,width})=>({start,end,width})),graphemes:p.graphemes.map(({text,source})=>({text,source})),diagnostics:p.diagnostics,fingerprint}); export default effect;`
      const bundle: CodeAuthorBundle = { code, map: '', locations: { layers: {} }, apiVersion: 10, libraries: { 'henji-layout': '2.0.0' }, textEntry: 'main.js', textFonts: [{ file: 'main.js', declaration: { faces: [{ family }], text: [item.text] }, diagnostics: [] }] }
      const before = await host.snapshot(); void before
      await host.send({ id: 0, kind: 'authorMetadata', url: moduleId, apiVersion: 10, bundle })
      const snapshot = await host.snapshot(), layout = snapshot.layouts.find(value => value.caseId === moduleId)
      const selections = snapshot.selections.filter(value => value.text.trim())
      if (!layout || !selections.length) throw new Error(`${item.id} 缺少正式 Worker 排版/选脸记录`)
      const segments = [...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(item.text)]
      const intact = layout.graphemes.length === segments.length && layout.graphemes.every((g, i) => g.source.start === segments[i].index && g.source.end === segments[i].index + segments[i].segment.length)
      const missing = selections.some(value => value.missing)
      if (!intact || missing !== item.missing || missing && !layout.diagnostics.length || !layout.fingerprint.digest) failures.push(`${item.id}: 字素/缺字/指纹不满足契约`)
      const frames = []
      let baseline: Uint8ClampedArray | undefined
      for (const time of [0, 7, 1, 10, 0]) {
        const response = await host.frame(moduleId, bundle, time), capture = pixelData(response.bitmap!)
        baseline ??= capture.bytes
        const difference = capture.bytes.reduce((sum, value, i) => sum + Number(value !== baseline![i]), 0)
        const ink = capture.bytes.reduce((sum, value, i) => sum + Number(i % 4 !== 3 && value > 0), 0)
        let colored = 0
        for (let i = 0; i < capture.bytes.length; i += 4) if (Math.max(...capture.bytes.slice(i, i + 3)) - Math.min(...capture.bytes.slice(i, i + 3)) > 20) colored++
        frames.push({ time, difference, ink, colored })
        if (difference || !ink) failures.push(`${item.id}: seek ${time} 像素变化或无墨迹`)
        if (['emoji-zwj', 'emoji-vs'].includes(item.id) && !colored) failures.push(`${item.id}: 彩色 emoji 只有单色基底轮廓`)
        if (time === 7) captures.push({ name: item.id, dataUrl: capture.canvas.toDataURL() })
      }
      const chain = JSON.parse(selections[0].chain) as [unknown, unknown, Array<[string, string | null]>]
      const families = chain[2].map(([key]) => JSON.parse(key)[0] as string)
      const el = document.createElement('div'); el.id = `fallback-${item.id}`
      Object.assign(el.style, { font: `40px ${families.map(f => JSON.stringify(f)).join(',')}`, width: '120px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', fontFeatureSettings: '"liga" 0,"clig" 0', textAutospace: 'no-autospace', color: 'black', lineHeight: '1.25' }); el.textContent = item.text; document.body.append(el)
      const domLines: Array<{ start: number; end: number; top: number; width: number }> = []
      for (const segment of segments) {
        const range = document.createRange(); range.setStart(el.firstChild!, segment.index); range.setEnd(el.firstChild!, segment.index + segment.segment.length)
        const rect = range.getBoundingClientRect(), line = domLines.find(line => Math.abs(line.top - rect.top) < 1)
        if (line) { line.end = segment.index + segment.segment.length; line.width += rect.width }
        else domLines.push({ start: segment.index, end: segment.index + segment.segment.length, top: rect.top, width: rect.width })
      }
      const breaksMatch = JSON.stringify(layout.lines.map(({ start, end }) => [start, end])) === JSON.stringify(domLines.map(({ start, end }) => [start, end]))
      if (!breaksMatch && !item.missing && !item.replacement) failures.push(`${item.id}: DOM 断点不同`)
      const expected = [...new Set(selections.map(s => s.hash))].map(hash => fonts.find(font => font.hash === hash)!).filter(Boolean)
      if (!item.missing && !item.replacement) domFontChecks.push({ selector: `#${el.id}`, expected: expected.map(font => [font.family, ...font.aliases ?? []]), caseId: item.id })
      rows.push({ ...item, selections, layout, frames, domLines, breaksMatch })
      await host.release(moduleId)
    }
    const identities = rows.filter(row => row.replacement).map(row => ({ id: row.id, hash: row.selections[0].hash, chain: row.selections[0].chain, digest: row.layout.fingerprint.digest }))
    if (new Set(identities.map(row => row.digest)).size !== 4 || identities[0].hash === identities[1].hash || identities[2].hash !== identities[3].hash || identities[2].chain === identities[3].chain) failures.push('同名字节/命名轴变化未使字体和指纹失效')
    const formats = await fontFormatsExperiment()
    failures.push(...formats.failures); captures.push(...formats.captures)
    return { cases: [], experiment7: { rows, formats: formats.rows, identities, platform: 'Windows', macOS: '未验', emojiDifference: '系统 emoji Canvas 沿 HB 簇位置绘制；颜色、基线、墨迹和 AA 由系统字体决定，不保证自定义彩色字节像素一致。', fontHashes: fonts.map(({ family, hash }) => ({ family, hash })) }, domFontChecks, captures, gate: { passed: failures.length === 0, failures } }
  } finally { await host.close() }
}
