import { afterEach, expect, it, vi } from 'vitest'
import { build } from 'esbuild-wasm'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { codeMaterialSource } from '@/core/videoEdit/codeMaterialDocument'
import { renderPresetPreviewFrame, styleSampleTimeline } from './videoEditPresetPreview'
import { compileVideoEditCode } from './videoEditCodeState'
import { videoEditOffscreenPool } from '../engine/videoEditOffscreenPool'
import { testAuthorBundle, testAuthorProgram } from '../engine/videoEditAuthorTestFixtures'
import { bundleAuthorFiles } from '../engine/videoEditAuthorBundle'
import { resolveAuthorBuiltInImport } from '../engine/videoEditAuthorModules'

const boundary = vi.hoisted(() => ({ present: vi.fn(), dispose: vi.fn(async () => undefined) }))
vi.mock('./videoEditCodeState', () => ({ compileVideoEditCode: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ system: { memoryInfo: async () => ({ availableBytes: 2 ** 32, totalBytes: 2 ** 33 }) } }) }))
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
    const bundle = await bundleAuthorFiles(files, build)
    return { ...testAuthorProgram(testAuthorBundle(files)), bundle }
  })
  const { composition: document } = await styleSampleTimeline({ code, width: 320, height: 180, durationSeconds: 2, fps: 30, thumbnail: 0, anchors: [0] }, new AbortController().signal)
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
