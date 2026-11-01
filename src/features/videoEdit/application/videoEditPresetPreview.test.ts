import fs from 'node:fs'
import { videoEditStyleSchema } from '@/core/videoEdit/styles/styleSchemas'
import { afterEach, expect, it, vi } from 'vitest'
import { build } from 'esbuild-wasm'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { presetPreviewTimeline, renderPresetPreviewFrame, styleSampleTimeline, videoEditPresetPreviewKey } from './videoEditPresetPreview'
import { useVideoEditEffectLibraryStore } from './videoEditEffectPresets'
import { compileVideoEditCode } from './videoEditCodeState'
import { videoEditOffscreenPool } from '../engine/videoEditOffscreenPool'
import { testAuthorBundle, testAuthorProgram } from '../engine/videoEditAuthorTestFixtures'
import { bundleAuthorFiles } from '../engine/videoEditAuthorBundle'
import { resolveAuthorBuiltInImport } from '../engine/videoEditAuthorModules'
import { videoEditTemplateStyle } from './videoEditPresetCatalog'
import * as desktopApi from '@/platform/desktopApi'

const boundary = vi.hoisted(() => ({ present: vi.fn(), dispose: vi.fn(async () => undefined) }))
vi.mock('./videoEditCodeState', () => ({ compileVideoEditCode: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => false, getPlatform: () => ({ system: { memoryInfo: async () => ({ availableBytes: 2 ** 32, totalBytes: 2 ** 33 }) } }) }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  present = boundary.present
  dispose = boundary.dispose
  async replaceContent() {}
} }))
afterEach(async () => { await videoEditOffscreenPool.dispose(); vi.useRealTimers(); vi.clearAllMocks() })
function composition() { const doc = createVideoEditTestDocument('preset'); return videoEditComposition(doc, doc.sequences[0].id) }
it('v6 样片的预览文档沿用编译版本，允许排版与字体库导入', async () => {
  const code = { entry: 'main.ts', files: { 'main.ts': `
    import { layoutText, drawText } from 'henji-layout/text';
    import { parse } from 'opentype.js';
    export default { name: '排版样片', draw(ctx) { drawText(ctx, layoutText('样片', {})); void parse; } };
  ` } }
  vi.mocked(compileVideoEditCode).mockImplementationOnce(async input => {
    const files = typeof input === 'string' ? { entry: code.entry, files: { [code.entry]: input } } : input
    const bundle = await bundleAuthorFiles({ ...files, apiVersion: 6 }, build)
    return { ...testAuthorProgram(testAuthorBundle({ ...files, apiVersion: 6 })), bundle }
  })
  const { composition: document } = await styleSampleTimeline({ code, apiVersion: 6, libraries: { 'henji-layout': '1.0.0', 'opentype.js': '2.0.0' }, width: 320, height: 180, durationSeconds: 2, fps: 30, thumbnail: 0, anchors: [0] }, new AbortController().signal)
  const instance = document.clips[0].code!
  const version = document.codeMaterials![0].versions[0]
  expect(version).toMatchObject({ apiVersion: 6, languageVersion: 4 })
  const { compilation } = codeMaterialSource(document, instance)
  const bundle = await bundleAuthorFiles(compilation, build)
  expect(version.libraries).toEqual(bundle.libraries)
  for (const specifier of ['henji-layout/text', 'opentype.js']) {
    expect(resolveAuthorBuiltInImport(specifier, code.entry, compilation)).toHaveProperty('library')
  }
})

it('预览键只受风格身份和风格件内容影响，全局库修订会使预览失效', () => {
  const style = videoEditStyleSchema.parse(JSON.parse(fs.readFileSync('tests/fixtures/persistence/video-style-library/v7.json', 'utf8')).content)
  const source = { category: 'style' as const, sample: style.sample, style }
  const size = { width: 320, height: 180 }, key = videoEditPresetPreviewKey(source, size)
  expect(videoEditPresetPreviewKey({ ...source, style: { ...style, name: '改名', guide: '说明书' } }, size)).toBe(key)
  const changed = structuredClone(style); changed.effectPresets![0].effects[0].amount = .2
  expect(videoEditPresetPreviewKey({ ...source, style: changed }, size)).not.toBe(key)
  const previous = useVideoEditEffectLibraryStore.getState().revision
  try {
    useVideoEditEffectLibraryStore.setState({ revision: previous + 1 })
    expect(videoEditPresetPreviewKey(source, size)).not.toBe(key)
  } finally { useVideoEditEffectLibraryStore.setState({ revision: previous }) }
})
it('取消卡住的预设会释放共享队列，迟到位图关闭，其他请求仍能完成', async () => {
  const doc = composition(); const controller = new AbortController()
  let finish!: (value: { bitmap: { close: () => void } }) => void
  boundary.present.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const pending = renderPresetPreviewFrame(doc, 0, controller.signal)
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(finish).toBeTypeOf('function')); controller.abort(); await rejected
  boundary.present.mockResolvedValueOnce({ presented: false })
  expect(await renderPresetPreviewFrame(doc, 1, new AbortController().signal)).toBeNull()
  const late = { close: vi.fn() }; finish({ bitmap: late })
  await vi.waitFor(() => expect(late.close).toHaveBeenCalledOnce())
})
it('预设单帧超时销毁其会话，不无限阻塞共享取帧', async () => {
  vi.useFakeTimers(); boundary.present.mockImplementationOnce(() => new Promise(() => undefined))
  const pending = renderPresetPreviewFrame(composition(), 0, new AbortController().signal)
  const rejected = expect(pending).rejects.toThrow('超过30秒')
  await vi.advanceTimersByTimeAsync(30_001); await rejected
  expect(boundary.dispose).toHaveBeenCalledOnce()
})

it('完整风格上下文供实时预览与正式样片共用，风格件保留在组合快照中', async () => {
  const style = videoEditStyleSchema.parse(JSON.parse(fs.readFileSync('tests/fixtures/persistence/video-style-library/v7.json', 'utf8')).content)
  style.sample.code = { entry: 'main.js', files: { 'main.js': 'export default { name:"样片", draw(ctx){ctx.fillRect(0,0,20,10)} }' } }
  vi.mocked(compileVideoEditCode).mockImplementation(async input => { const files = typeof input === 'string' ? { entry:'main.js',files:{'main.js':input} } : input; return testAuthorProgram(testAuthorBundle(files)) })
  const live = await presetPreviewTimeline({ category:'style',sample:style.sample,style },{width:320,height:180})
  const rendered = await styleSampleTimeline(style.sample,new AbortController().signal,[],style)
  for (const {composition} of [live,rendered]) {
    expect(composition.styleId).toBe(style.id)
    expect(composition.styles![0].effectPresets).toEqual(style.effectPresets)
  }
  const template = { style: { id: style.id, version: style.version }, body: { kind: 'code' as const, code: style.sample.code } }
  expect(videoEditTemplateStyle(template, [style])).toBe(style)
  expect(() => videoEditTemplateStyle(template, [])).toThrow(/所属风格/)
  const path = vi.spyOn(desktopApi, 'getBundledResourcePath').mockResolvedValue('/preview/backdrop.webp')
  try {
    const preview = await presetPreviewTimeline({ category: 'template', body: template.body, style }, { width: 320, height: 180 })
    expect(preview.composition.styleId).toBe(style.id)
    expect(preview.composition.styles![0].effectPresets).toEqual(style.effectPresets)
  } finally { path.mockRestore() }
})
