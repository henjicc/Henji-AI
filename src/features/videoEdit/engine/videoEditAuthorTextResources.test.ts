import { afterEach, beforeAll, afterAll, expect, it, vi } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { convert } from 'fontverter'
import { build } from 'esbuild'
import ts from 'typescript'
import { readStaticTextFonts } from '@/core/videoEdit/codeMaterial/textFonts'
import type { CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import type { FontPort } from '@/core/imaging/vectorContent/shaping/fontChannel'
import type { FontReader } from '@/core/imaging/vectorContent/shaping/fontSession'

type Runtime = typeof import('./videoEditAuthorModule') & typeof import('./videoEditAuthorTextResources') & typeof import('./videoEditTextFontChannel') & typeof import('./videoEditAuthorTrust') & typeof import('@/core/imaging/vectorContent/shaping/fontChannel') & typeof import('@/core/imaging/vectorContent/shaping/fontContext')
let runtime: Runtime, directory: string, fontBytes: Uint8Array
const cleanup: Array<() => void> = []
beforeAll(async () => {
  directory = fs.mkdtempSync(path.resolve('.tmp/henji-text-resources-'))
  const modulePath = path.join(directory, 'runtime.cjs')
  const entries = ['videoEditAuthorModule', 'videoEditAuthorTextResources', 'videoEditTextFontChannel', 'videoEditAuthorTrust'].map(file => `export * from './src/features/videoEdit/engine/${file}';`).join('')
  await build({ stdin: { contents: entries + "export * from './src/core/imaging/vectorContent/shaping/fontChannel';export * from './src/core/imaging/vectorContent/shaping/fontContext'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', plugins: [{ name: 'native-font-runtime', setup(api) { api.onResolve({filter:/fontPolicy$/}, () => ({path:pathToFileURL(path.resolve('resources/video-edit-author/frozen/henji-layout/2.0.0/font-session.mjs')).href,external:true})); api.onResolve({filter:/harfbuzzjs.*index\.mjs$/}, () => ({path:pathToFileURL(path.resolve('resources/video-edit-author/vendor/harfbuzzjs/1.6.4/index.mjs')).href,external:true})); api.onLoad({filter:/codeMaterial[\\/]authorLibraries\.ts$/}, args => ({contents:fs.readFileSync(args.path,'utf8').replace('return `henji-media://${AUTHOR_LIBRARY_HOST}/${library}/${version}/${path}`', 'return `'+pathToFileURL(path.resolve('resources/video-edit-author/frozen')).href+'/${library}/${version}/${path}`'),loader:'ts'})) } }], outfile: modulePath, alias: { '@': path.resolve('src') }, define: { 'import.meta.env': '{}' }, logLevel: 'silent' })
  runtime = createRequire(path.resolve('package.json'))(modulePath) as Runtime
  fontBytes = await convert(fs.readFileSync('node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'), 'sfnt')
  runtime.installAuthorTrustGate(async () => undefined)
})
afterEach(() => { runtime.closeTextFontChannel(); cleanup.splice(0).forEach(close => close()) })
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }))
function connect(read: FontReader): ReturnType<typeof vi.fn> {
  const ports = new MessageChannel(), close = vi.fn()
  cleanup.push(runtime.serveFontChannel(ports.port1 as unknown as FontPort, async () => ({ platform: 'win32', revision: 1, read, close }), error => { throw error }))
  runtime.attachTextFontChannel(ports.port2 as unknown as MessagePort)
  return close
}

it('首次求值等待完整字体屏障；参数字体在同步调用前准备，关闭拒绝后续使用', async () => {
  let finish!: () => void
  const close = connect(async request => {
    if (request.family === 'sans-serif' && (request.weight ?? 400) === 400 && (request.style ?? 'normal') === 'normal') await new Promise<void>(resolve => { finish = resolve })
    return { bytes: Uint8Array.from(fontBytes).buffer }
  })
  const code = `const fonts=()=>globalThis[Symbol.for('henji-layout.text.font-session')]; const identity=fonts().chain().identity; export default {name:identity,params:[{key:'font',type:'font',default:'Dynamic'}],draw(ctx,time,params){ctx.value=fonts().chain({family:params.font}).identity}}`
  const bundle: CodeAuthorBundle = { code, map: '', locations: { layers: {} }, apiVersion: 10, libraries: { 'henji-layout': '2.0.0' }, textEntry: 'main.js', textFonts: [{ file: 'main.js', declaration: {}, diagnostics: [] }] }
  const done = vi.fn()
  const pending = runtime.loadAuthorModule(`data:text/javascript,${encodeURIComponent(code)}`, undefined, bundle.apiVersion, bundle).then(effect => { done(); return effect })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  expect(done).not.toHaveBeenCalled()
  expect(() => runtime.currentTextFontSession()).toThrow('宿主')
  finish()
  const effect = await pending
  expect(effect.name).toContain('sans-serif')
  const before = await runtime.prepareAuthorTextParameters(effect, {})
  expect(before?.identity).toContain('dynamic')
  const after = await runtime.prepareAuthorTextParameters(effect, { font: 'Selected' })
  expect(after?.identity).toContain('selected')
  expect(after?.identity).not.toBe(before?.identity)
  const ctx = {} as OffscreenCanvasRenderingContext2D & { value?: string }
  runtime.withTextFontSession(after?.fonts, () => effect.draw!(ctx, 0, { font: 'Selected' }, 100, 100, {}, { time: 0, frameDuration: 1 / 30, clip: { time: 0, duration: 1 } }))
  expect(after?.fonts.chain({ family: 'Dynamic' }).request?.family).toBe('sans-serif')
  expect(() => before?.fonts.chain({ family: 'Dynamic' })).not.toThrow()
  expect(ctx.value).toContain('selected')
  expect(() => runtime.currentTextFontSession()).toThrow('宿主')
  await effect.dispose?.()
  runtime.closeTextFontChannel()
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  await expect(runtime.prepareAuthorTextParameters(effect, {})).rejects.toThrow('释放')
})

it('动态字体族按本模块默认字体回退，不借用其他模块的准备状态', async () => {
  const close = connect(async () => ({ bytes: Uint8Array.from(fontBytes).buffer }))
  const lease = await runtime.acquireSharedTextFontLease('2.0.0')
  await lease.fonts.prepare({ faces: [{ family: 'OtherModule' }] })
  const code = `const f=globalThis[Symbol.for('henji-layout.text.font-session')]; f.chain({family:'OtherModule'}); export default {name:'test',draw(){}}`
  const bundle: CodeAuthorBundle = { code, map: '', locations: { layers: {} }, apiVersion: 10, libraries: { 'henji-layout': '2.0.0' }, textEntry: 'entry.js', textFonts: [{ file: 'entry.js', declaration: {}, diagnostics: [] }] }
  const effect = await runtime.loadAuthorModule(`data:text/javascript,${encodeURIComponent(code)}`, undefined, bundle.apiVersion, bundle)
  const prepared = await runtime.prepareAuthorTextParameters(effect, {})
  expect(prepared?.fonts.chain({ family: 'OtherModule' }).request?.family).toBe('sans-serif')
  expect(prepared?.fonts.diagnostics?.()).toHaveLength(1)
  await effect.dispose?.()
  lease.release()
  runtime.closeTextFontChannel()
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
})

it('冻结版零声明粗体/斜体、声明族粗体及参数展开覆盖字重均可同步排版', async () => {
  connect(async () => ({ bytes: Uint8Array.from(fontBytes).buffer }))
  const text = await import(/* @vite-ignore */ pathToFileURL(path.resolve('resources/video-edit-author/frozen/henji-layout/2.0.0/text.mjs')).href) as typeof import('../authorLibraries/shapedText')
  const cases = [
    { source: `layoutText('Bold',{fontWeight:700})`, style: { fontWeight: 700 } },
    { source: `layoutText('Italic',{fontStyle:'italic'})`, style: { fontStyle: 'italic' as const } },
    { source: `export const textFonts={faces:[{family:'Declared'}]};layoutText('Bold',{fontFamily:'Declared',fontWeight:700})`, style: { fontFamily: 'Declared', fontWeight: 700 } },
    { source: `export default {params:[{key:'style',type:'textStyle',default:{fontFamily:'Dynamic',fontWeight:400}}]};layoutText('Bold',{...params.style,fontWeight:700})`, style: { fontFamily: 'Dynamic', fontWeight: 700 } },
  ]
  for (const item of cases) {
    const source = `import {layoutText} from 'henji-layout/text';${item.source}`
    const declaration = readStaticTextFonts(ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true), 10)
    const lease = await runtime.acquireSharedTextFontLease('2.0.0')
    const resource = new runtime.AuthorTextResources(lease, { code: '', map: '', locations: { layers: {} }, apiVersion: 10, textEntry: 'main.js', textFonts: [{ file: 'main.js', ...declaration }] })
    try {
      const prepared = await resource.prepare()
      const layout = runtime.withTextFontSession(prepared.fonts, () => text.layoutText('Bold', item.style))
      expect(layout.contentSize.width).toBeGreaterThan(0)
      expect(prepared.fonts.diagnostics?.()).toEqual([])
      if (item.style.fontFamily === 'Dynamic') {
        expect(() => runtime.withTextFontSession(prepared.fonts, () => text.layoutText('Bold', { fontFamily: 'Dynamic', fontWeight: 600 }))).not.toThrow()
        expect(prepared.fonts.diagnostics?.()).toHaveLength(1)
      }
    } finally { resource.close() }
  }
})

it('纯 GPU 模块不捕获字体目录，也不准备字节', async () => {
  const read = vi.fn(async () => ({ bytes: Uint8Array.from(fontBytes).buffer }))
  connect(read)
  expect(await runtime.prepareAuthorTextResources({ code: '', map: '', locations: { layers: {} }, apiVersion: 10, libraries: { 'three': '0.186.1' }, textFonts: [] })).toBeUndefined()
  expect(read).not.toHaveBeenCalled()
})
