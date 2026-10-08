import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { videoEditComposition } from '@/core/videoEdit/document'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'

const boundary = vi.hoisted(() => ({ present: vi.fn(), dispose: vi.fn(), construct: vi.fn() }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  constructor() { boundary.construct() }
  present = boundary.present
  dispose = boundary.dispose
  async updateDocument() {}
} }))
function frames() { const document = createVideoEditTestDocument('试渲染'); return [{ document: videoEditComposition(document, document.sequences[0].id), frame: 0 }] }
function result() { return { presented: true, bitmap: { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap } }
beforeEach(() => { vi.clearAllMocks(); boundary.present.mockResolvedValue(result()); boundary.dispose.mockResolvedValue(undefined) })
afterEach(() => { vi.useRealTimers() })
it('等待中的中止立即返回，但重启请求仍等待前项；不创建多余renderer', async () => {
  let finish!: (value: ReturnType<typeof result>) => void
  boundary.present.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const input = frames(); const first = trialVideoEditCodeFrames(input, new AbortController().signal)
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  const controller = new AbortController(); const cancelled = trialVideoEditCodeFrames(input, controller.signal)
  const assertion = expect(cancelled).rejects.toThrow(); controller.abort(); await assertion
  const restarted = trialVideoEditCodeFrames(input, new AbortController().signal)
  await Promise.resolve(); expect(boundary.construct).toHaveBeenCalledOnce()
  finish(result()); await first; await restarted; expect(boundary.construct).toHaveBeenCalledTimes(2)
})
it('活动请求中止释放队列，迟到bitmap关闭，下一项正常完成', async () => {
  let finish!: (value: ReturnType<typeof result>) => void
  boundary.present.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const input = frames(); const controller = new AbortController()
  const cancelled = trialVideoEditCodeFrames(input, controller.signal)
  const assertion = expect(cancelled).rejects.toThrow()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function')); controller.abort(); await assertion
  await trialVideoEditCodeFrames(input, new AbortController().signal)
  const late = result(); finish(late); await vi.waitFor(() => expect(late.bitmap.close).toHaveBeenCalledOnce())
})
it('单帧卡住30秒后释放队列；后续请求不会被永久阻塞', async () => {
  vi.useFakeTimers()
  boundary.present.mockImplementationOnce(() => new Promise(() => undefined))
  const input = frames(); const stalled = trialVideoEditCodeFrames(input, new AbortController().signal)
  const assertion = expect(stalled).rejects.toThrow('超过30秒')
  await vi.advanceTimersByTimeAsync(0); expect(boundary.present).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(30_000); await assertion
  await trialVideoEditCodeFrames(input, new AbortController().signal)
  expect(boundary.dispose).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0)
})
it('并发等待按序处理，不因等待数量拒绝产品条目，单项失败后继续', async () => {
  const input = frames(); const signal = new AbortController().signal
  boundary.present.mockRejectedValueOnce(new Error('单项失败'))
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => trialVideoEditCodeFrames(input, signal)))
  expect(results.map(result => result.status)).toEqual(['rejected', ...Array.from({ length: 7 }, () => 'fulfilled')])
  expect(boundary.construct).toHaveBeenCalledTimes(8); expect(boundary.dispose).toHaveBeenCalledTimes(8)
})
