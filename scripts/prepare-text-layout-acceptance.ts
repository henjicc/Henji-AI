import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import esbuild, { type Plugin } from 'esbuild-wasm'
import { pathToFileURL } from 'node:url'
const root = process.cwd(), out = path.join(root, '.tmp/text-layout-acceptance')
fs.mkdirSync(out, { recursive: true })
const frozen = process.argv.includes('--frozen')
const frozenPolicy: Plugin = { name: 'frozen-font-policy', setup(build) {
  build.onResolve({ filter: /shaping\/fontPolicy$/ }, () => ({ path: '/frozen-layout/font-session.mjs', external: true }))
  build.onLoad({ filter: /codeMaterial[\\/]authorLibraries\.ts$/ }, args => ({ contents: fs.readFileSync(args.path, 'utf8').replace('return `henji-media://${AUTHOR_LIBRARY_HOST}/${library}/${version}/${path}`', "return new URL(`/frozen-layout/${path}`, globalThis.location.href).href"), loader: 'ts' }))
} }
const frozenText: Plugin = { name: 'frozen-text', setup(build) {
  build.onResolve({ filter: /authorLibraries\/text$/ }, () => ({ path: '/frozen-layout/text.mjs', external: true }))
} }

if (frozen) fs.cpSync(path.join(root, 'resources/video-edit-author/frozen/henji-layout/2.0.0'), path.join(out, 'frozen-layout'), { recursive: true })
await esbuild.build({ stdin: { contents: 'export { standaloneFont, parseFontFile } from "./electron/main/services/fonts/metadata"', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: path.join(out, 'font-metadata.mjs') })
const { standaloneFont, parseFontFile } = await import(pathToFileURL(path.join(out, 'font-metadata.mjs')).href)
// 源码模块按应用的解析规则互相导入（无扩展名），脚本经同一打包器读取，不直接交给 Node。
await esbuild.build({ stdin: { contents: 'export { readStaticTextFonts } from "./src/core/videoEdit/codeMaterial/textFonts"', resolveDir: root }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: path.join(out, 'text-fonts.mjs') })
const { readStaticTextFonts } = await import(pathToFileURL(path.join(out, 'text-fonts.mjs')).href) as typeof import('../src/core/videoEdit/codeMaterial/textFonts')
const fonts = [{ family: 'TicketCJK', file: 'simhei.ttf' }, { family: 'TicketLatin', file: 'calibri.ttf' }, { family: 'TicketLatin', file: 'calibrib.ttf', weight: 700 }, { family: 'TicketEmoji', file: 'seguiemj.ttf' }]
const manifest = []
for (const font of fonts) {
  const bytes = fs.readFileSync(path.join('C:/Windows/Fonts', font.file)); fs.writeFileSync(path.join(out, font.file), bytes)
  manifest.push({ ...font, aliases: [parseFontFile(bytes)[0].face.family], weight: font.weight ?? 400, hash: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length })
}
for (const file of ['gabriola.ttf', 'arial.ttf', 'arialbd.ttf', 'NotoSansSC-VF.ttf', 'NotoSansJP-Regular.otf', 'msyh.ttc', 'msjh.ttc', 'simsun.ttc', 'simsunb.ttf', 'SimsunExtG.ttf', 'YuGothR.ttc', 'malgun.ttf', 'seguiemj.ttf', 'seguisym.ttf', 'seguihis.ttf', 'Nirmala.ttf', 'LeelawUI.ttf', 'tahoma.ttf', 'segoeui.ttf', 'times.ttf']) {
  const original = fs.readFileSync(path.join('C:/Windows/Fonts', file))
  for (const { face, index } of parseFontFile(original)) {
    if (face.variation) continue
    const bytes = await standaloneFont(original, index), target = `${file}-${index}.sfnt`
    fs.writeFileSync(path.join(out, target), bytes)
    manifest.push({ family: face.family, aliases: face.aliases, file: target, weight: face.weight, hash: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length })
  }
}
fs.writeFileSync(path.join(out, 'fonts.json'), JSON.stringify(manifest))
fs.copyFileSync('scripts/fixtures/text-layout-cases.json', path.join(out, 'cases.json'))
await esbuild.build({ entryPoints: ['scripts/text-layout-acceptance-browser.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', outfile: path.join(out, 'experiment.mjs'), plugins: frozen ? [frozenText, frozenPolicy] : [], external: ['module', 'node:module', 'fs', 'node:fs', 'path', 'url'], alias: { '@': path.join(root, 'src') } })
fs.copyFileSync('resources/video-edit-author/vendor/harfbuzzjs/1.6.4/harfbuzz.wasm', path.join(out, 'harfbuzz.wasm'))
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><title>文字排版固定样本</title><style>body{margin:0;background:white;color:black}#samples{position:absolute;left:0;top:0}.sample{box-sizing:content-box;padding:0;border:0;margin:0}</style><div id="samples"></div><script type="module" src="experiment.mjs"></script>')
if (process.argv.includes('--worker')) {
  const dynamicText = '★ ✓ ① 한 𠀀'
  const dynamicCases = [
    { id: 'parameter-slice', value: dynamicText, expression: 'params.text.slice(0, Math.floor(time * 100))' },
    { id: 'parameter-template', value: dynamicText, expression: '`标题 ${params.text}`' },
    { id: 'parameter-json-array', value: JSON.stringify([{ title: dynamicText }]), expression: 'JSON.parse(params.text).map(row => row.title).join(" ")' },
    { id: 'unknown-dynamic', value: '', expression: 'String.fromCodePoint(9733,32,10003,32,9312,32,54620,32,131072)' },
    // 下列写法必须走逐字准备而不是完整候选集。
    { id: 'module-constant-concat', value: 'A', prelude: `const MARK=' ★ ✓ ① 한 𠀀';`, expression: 'params.text + MARK', precise: true },
    { id: 'constant-array-template', value: 'A', prelude: `const ICONS=['★','✓','①','한','𠀀'];`, expression: '`${params.text} ${ICONS[0]} ${ICONS[1]} ${ICONS[2]} ${ICONS[3]} ${ICONS[4]}`', precise: true },
    { id: 'pure-literal', value: '', prelude: `const TITLE='★ ✓ ①';`, expression: '`${TITLE} 한 𠀀`', options: '{wrapWidth:600+Math.floor(time),anchor:{x:20,y:30+Math.sin(time),horizontal:0,vertical:0}}', precise: true },
  ].map(item => {
    const code = `import {layoutText,drawText} from 'henji-layout/text'; ${item.prelude ?? ''} export default {name:'动态字符',params:[{key:'text',type:'text',default:${JSON.stringify(item.value)}}],draw(ctx,time,params){const p=layoutText(${item.expression},{fontSize:40,fill:{color:'#ffffff'}},${item.options ?? '{wrapWidth:600,anchor:{x:20,y:30,horizontal:0,vertical:0}}'});drawText(ctx,p)}}`
    return { id: item.id, code, precise: !!item.precise, resources: readStaticTextFonts(ts.createSourceFile('main.js', code, ts.ScriptTarget.Latest, true), 10) }
  })
  fs.writeFileSync(path.join(out, 'dynamic-cases.json'), JSON.stringify(dynamicCases))
  // 专项只插入计时；匹配不到正式实现时拒绝构建，避免静默漏计。
  const timingProbe: Plugin = { name: 'text-stage-timing', setup(build) {
    build.onLoad({ filter: /videoEditAuthorRuntime\.ts$/ }, args => {
      let contents = fs.readFileSync(args.path, 'utf8').replace(/\r\n/g, '\n')
      const insertions = [
        ['const previous = this.history.get(slot)', 'const experimentRecordStarted = performance.now();\n          const previous = this.history.get(slot)'],
        ['return { painted, volatile: quiet < QUIET_FRAMES,', "recordVideoEditPreparation('experimentRecord', performance.now() - experimentRecordStarted);\n          return { painted, volatile: quiet < QUIET_FRAMES,"],
        ['const recorded = parts.every(part => part.painted)', 'const experimentSurfaceStarted = performance.now();\n          const recorded = parts.every(part => part.painted)'],
        ['if (!raster) { statistics.reused += layers; statistics.video += video; return }', "if (!raster) { recordVideoEditPreparation('experimentEmptySurface', 0); statistics.reused += layers; statistics.video += video; return }"],
        ['statistics.video += video\n          //', "statistics.video += video\n          recordVideoEditPreparation('experimentSurface', performance.now() - experimentSurfaceStarted);\n          //"],
      ]
      for (const [needle, replacement] of insertions) {
        if (contents.split(needle).length !== 2) throw new Error(`文字阶段计时插入点不唯一：${needle}`)
        contents = contents.replace(needle, replacement)
      }
      return { contents, loader: 'ts' }
    })
  } }
  await esbuild.build({ entryPoints: {
    'render-worker': 'src/features/videoEdit/engine/videoEditWorker.ts',
    'author-text': 'src/features/videoEdit/authorLibraries/text.ts',
    'worker-timing': 'src/features/videoEdit/engine/videoEditPreparationTiming.ts',
    'worker-shaper': 'src/core/imaging/vectorContent/shaping/harfbuzz.ts',
    'worker-font-session': 'src/core/imaging/vectorContent/shaping/fontPolicy.ts',
    'worker-fingerprint': 'src/features/videoEdit/engine/videoEditAuthorFingerprint.ts',
    'worker-experiment': 'scripts/text-layout-worker-experiment.ts',
  }, outdir: out, outExtension: { '.js': '.mjs' }, chunkNames: 'chunks/[name]-[hash]', splitting: true, bundle: true, minify: true, platform: 'browser', format: 'esm', target: 'es2022', alias: { '@': path.join(root, 'src') }, define: { 'import.meta.env': '{}' }, external: ['module', 'node:module', 'fs', 'node:fs', 'path', 'url'], loader: { '.wgsl': 'text', '.wasm': 'file' }, plugins: [...frozen ? [frozenPolicy] : [], timingProbe, { name: 'raw', setup(build) { build.onLoad({ filter: /\?raw$/ }, args => ({ contents: fs.readFileSync(args.path.replace(/\?raw$/, ''), 'utf8'), loader: 'text' })) } }] })
  const baseline = 'resources/video-edit-author/frozen/henji-layout/1.2.0'
  fs.mkdirSync(path.join(out, 'layout-1.2.0'), { recursive: true })
  for (const file of fs.readdirSync(baseline).filter(file => file.endsWith('.mjs'))) fs.copyFileSync(path.join(baseline, file), path.join(out, 'layout-1.2.0', file))
  fs.copyFileSync('resources/video-edit-author/vendor/harfbuzzjs/1.6.4/harfbuzz.wasm', path.join(out, 'chunks/harfbuzz.wasm'))
  fs.copyFileSync('scripts/text-layout-worker-probe.mjs', path.join(out, 'worker-probe.mjs'))
  fs.writeFileSync(path.join(out, 'worker.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="worker-experiment.mjs"></script>')
  if (frozen) { fs.writeFileSync(path.join(out, 'author-text.mjs'), "export * from './frozen-layout/text.mjs';\n"); fs.writeFileSync(path.join(out, 'worker-font-session.mjs'), "export * from './frozen-layout/font-session.mjs';\n") }
}
if (process.argv.includes('--outlines')) {
  await esbuild.build({ entryPoints: ['scripts/text-layout-outline-experiment.ts'], bundle: true, minify: true, platform: 'browser', format: 'esm', target: 'es2022', outfile: path.join(out, 'outlines.mjs'), alias: { '@': path.join(root, 'src') }, external: ['module', 'node:module', 'fs', 'node:fs', 'path', 'url'] })
  fs.writeFileSync(path.join(out, 'outlines.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="outlines.mjs"></script>')
}
if (process.argv.includes('--table')) {
  await esbuild.build({ entryPoints: ['scripts/text-layout-table-experiment.ts'], bundle: true, minify: true, platform: 'browser', format: 'esm', target: 'es2022', outfile: path.join(out, 'table.mjs'), alias: { '@': path.join(root, 'src') }, external: ['module', 'node:module', 'fs', 'node:fs', 'path', 'url'], plugins: frozen ? [{ name: 'frozen-table', setup(build) {
    build.onResolve({ filter: /authorLibraries\/(text|table)$/ }, args => ({ path: `./frozen-layout/${args.path.split('/').at(-1)}.mjs`, external: true }))
  } }] : [] })
  fs.writeFileSync(path.join(out, 'table.html'), '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:white}</style><script type="module" src="table.mjs"></script>')
}
console.log(out)
