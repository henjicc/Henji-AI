import { afterEach, expect, it, vi } from 'vitest'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { renderPresetPreviewFrame } from './videoEditPresetPreview'
import { videoEditOffscreenPool } from '../engine/videoEditOffscreenPool'

const boundary = vi.hoisted(() => ({ present: vi.fn(), dispose: vi.fn(async () => undefined) }))
vi.mock('@/platform/runtime', () => ({ getPlatform: () => ({ system: { memoryInfo: async () => ({ availableBytes: 2 ** 32, totalBytes: 2 ** 33 }) } }) }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  present = boundary.present
  dispose = boundary.dispose
  async replaceContent() {}
} }))
afterEach(async () => { await videoEditOffscreenPool.dispose(); vi.useRealTimers(); vi.clearAllMocks() })
function composition() { const doc = createVideoEditTestDocument('preset'); return videoEditComposition(doc, doc.sequences[0].id) }
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
