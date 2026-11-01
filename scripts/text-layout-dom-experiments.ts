import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import esbuild from 'esbuild-wasm'

// 此命令只准备静态实验页；页面中的 DOM 度量须待用户解除显卡暂停后才打开。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (name: string): string | undefined => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
if (!args.includes('--prepare') || !value('--font')) throw new Error('用法：node scripts/text-layout-dom-experiments.ts --prepare --font <本机 TTF/OTF> [--out .tmp/text-layout-dom]')
const fontPath = path.resolve(value('--font')!)
const out = path.resolve(root, value('--out') ?? '.tmp/text-layout-dom')
fs.mkdirSync(out, { recursive: true })
const compiled = await esbuild.build({
  stdin: { contents: `export * from './src/core/imaging/vectorContent/shaping/harfbuzz'; export * from './src/core/imaging/vectorContent/shaping/paragraph'; export * from './src/core/imaging/vectorContent/shaping/table'`, resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', target: 'es2022', write: false,
})
const moduleFile = path.join(out, 'cpu-layout.mjs')
fs.writeFileSync(moduleFile, compiled.outputFiles[0].contents)
const core = await import(pathToFileURL(moduleFile).href) as typeof import('../src/core/imaging/vectorContent/shaping/harfbuzz') & typeof import('../src/core/imaging/vectorContent/shaping/paragraph') & typeof import('../src/core/imaging/vectorContent/shaping/table')
const hb = await import('../resources/video-edit-author/vendor/harfbuzzjs/1.6.4/index.mjs')
const data = fs.readFileSync(fontPath)
const font = { bytes: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, hash: crypto.createHash('sha256').update(data).digest('hex') }
const shaper = new core.TextShaper(hb)
const titles = ['把想法写成画面，今天开始。', '你好（世界），下一行继续。', 'AI 2026：文字与数字相遇', 'Typography AVATAR office', '昨日の夢、今日の物語。', '总收入 1,234.56 增长 25%', '从第一帧开始讲好故事', '先观察，再创作；先表达，再修正。', '一行标题，也有自己的节奏。', 'Hello 世界 Hello 未来']
const cases: Array<{ id: number; text: string; size: number; width: number; ligatures: boolean; ends: number[]; widths: number[]; advance: number; missing: boolean }> = []
try {
  for (const text of titles) for (const size of [20, 28, 36, 48]) for (const width of [100, 160, 240, 360, 600]) {
    const options = { size, maxWidth: width, autospace: false, language: 'zh-CN' }
    const paragraph = new core.ShapedParagraph(shaper, font, text, options), layout = paragraph.layout()
    cases.push({ id: cases.length, text, size, width, ligatures: false, ends: layout.lines.map(line => line.start + text.slice(line.start, line.contentEnd).replace(/\s+$/, '').length), widths: layout.lines.map(line => line.width), advance: paragraph.initial.width, missing: paragraph.initial.glyphs.some(glyph => !glyph.id) })
  }
  // 开连字样本不并入默认 200 例断点分母。
  for (const text of ['office affinity', 'ffi fl AVATAR']) {
    const paragraph = new core.ShapedParagraph(shaper, font, text, { size: 40, maxWidth: 200, ligatures: true, autospace: false })
    const layout = paragraph.layout()
    cases.push({ id: cases.length, text, size: 40, width: 200, ligatures: true, ends: layout.lines.map(line => line.start + text.slice(line.start, line.contentEnd).replace(/\s+$/, '').length), widths: layout.lines.map(line => line.width), advance: paragraph.initial.width, missing: paragraph.initial.glyphs.some(glyph => !glyph.id) })
  }
  const tableInput = { columns: [{ key: 'name' }, { key: 'value', numeric: true }], rows: [{ name: '总收入', value: '1,234.56' }, { name: '增长', value: '25%' }, { name: '成本', value: '-99.00' }] }
  const table = core.layoutShapedTable(shaper, font, tableInput, { size: 28, autospace: false } as Parameters<typeof core.layoutShapedTable>[3], { width: 480, cellPadding: 8, columnGap: 4 })
  const evidence = { font: { file: path.basename(fontPath), hash: font.hash }, hb: hb.versionString(), status: 'DOM_NOT_RUN', cases, table }
  fs.writeFileSync(path.join(out, 'cpu.json'), JSON.stringify(evidence, null, 2))
  const payload = JSON.stringify(evidence).replace(/</g, '\u003c')
  const html = `<!doctype html><meta charset="utf-8"><title>文字排版 DOM 对照实验</title>
<style>@font-face{font-family:TicketFont;src:url(data:font/ttf;base64,${data.toString('base64')})}body{font-family:sans-serif}.sample{font-family:TicketFont;white-space:pre-wrap;word-break:normal;line-break:auto;overflow-wrap:break-word;font-kerning:normal;text-spacing-trim:normal;text-autospace:no-autospace;letter-spacing:0;font-variant-ligatures:no-common-ligatures;box-sizing:content-box;padding:0;border:0;margin:0;line-height:1.2}</style>
<p>实验 1/2/3 的 DOM 对照。仅在显卡恢复后打开；实验 4–7 的正式宿主绘制与性能尚未接入。</p><pre id="report">等待同字节字体加载</pre><main id="samples"></main>
<script type="module">
const input=${payload};
await document.fonts.load('40px TicketFont');await document.fonts.ready;
const results=[];
for(const item of input.cases){
 const element=document.createElement('div');element.className='sample';element.style.width=item.width+'px';element.style.fontSize=item.size+'px';element.style.fontVariantLigatures=item.ligatures?'common-ligatures':'no-common-ligatures';element.textContent=item.text;document.querySelector('#samples').append(element);
 const node=element.firstChild,rows=[];
 for(const segment of new Intl.Segmenter('zh-CN',{granularity:'grapheme'}).segment(item.text)){
  const range=document.createRange();range.setStart(node,segment.index);range.setEnd(node,segment.index+segment.segment.length);
  const rect=range.getBoundingClientRect();let row=rows.find(row=>Math.abs(row.top-rect.top)<0.1);
  if(!row){row={top:rect.top,left:rect.left,right:rect.right,end:0};rows.push(row)}
  if(!/^\\s+$/.test(segment.segment)){row.end=segment.index+segment.segment.length;row.left=Math.min(row.left,rect.left);row.right=Math.max(row.right,rect.right)}
 }
 const ends=rows.map(row=>row.end),widths=rows.map(row=>row.right-row.left);
 results.push({id:item.id,missing:item.missing,ligatures:item.ligatures,expectedEnds:item.ends,actualEnds:ends,expectedWidths:item.widths,actualWidths:widths,breaksMatch:JSON.stringify(item.ends)===JSON.stringify(ends),geometryMatch:widths.length===item.widths.length&&widths.every((width,index)=>Math.abs(width-item.widths[index])<=1/64)});
}
const report={font:input.font,userAgent:navigator.userAgent,dpr:devicePixelRatio,autospaceSupported:CSS.supports('text-autospace','no-autospace'),cases:results,defaultPassed:results.filter(row=>!row.ligatures&&row.breaksMatch&&!row.missing).length,defaultTotal:200,notRun:['4:宿主加载与性能','5:外观栅格','6:轮廓消费','7:真实回退/彩色/AAT','8:DOM逐格表格（仅生成CPU数据）']};
document.querySelector('#report').textContent=JSON.stringify(report,null,2);window.textLayoutExperimentResult=report;
</script>`
  fs.writeFileSync(path.join(out, 'index.html'), html)
  console.log(`已准备 ${cases.length} 例和表格 CPU 数据：${out}；DOM/Electron 未执行。`)
} finally { shaper.dispose() }
