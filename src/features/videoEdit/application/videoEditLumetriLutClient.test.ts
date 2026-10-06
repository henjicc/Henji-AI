import { afterEach, expect, it, vi } from 'vitest'
import { analyzeVideoEditLumetriOffThread, decodeVideoEditLutOffThread } from './videoEditLumetriLutClient'
class FakeWorker {
  static last: FakeWorker
  onmessage?: (event: MessageEvent) => void
  onerror?: (event: ErrorEvent) => void
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { FakeWorker.last = this }
}
afterEach(() => { vi.unstubAllGlobals() })
it('导入拥有独立 Worker，转移副本不破坏 PAL 数据，成功/错误/取消均释放线程', async () => {
  vi.stubGlobal('Worker', FakeWorker)
  const bytes = new Uint8Array([1, 2]); const operation = decodeVideoEditLutOffThread(bytes)
  const worker = FakeWorker.last; expect(worker.postMessage.mock.calls[0][0].bytes).not.toBe(bytes)
  worker.onmessage?.({ data: { contentIdentity: 'hash', lut: { kind: '1d' } } } as MessageEvent)
  expect(await operation).toMatchObject({ contentIdentity: 'hash' }); expect(worker.terminate).toHaveBeenCalledOnce()
  const failed = decodeVideoEditLutOffThread(bytes); FakeWorker.last.onmessage?.({ data: { error: '尺寸非法' } } as MessageEvent)
  await expect(failed).rejects.toThrow('尺寸非法'); expect(FakeWorker.last.terminate).toHaveBeenCalledOnce()
  const controller = new AbortController(); const cancelled = decodeVideoEditLutOffThread(bytes, controller.signal); controller.abort(new Error('取消'))
  await expect(cancelled).rejects.toThrow('取消'); expect(FakeWorker.last.terminate).toHaveBeenCalledOnce()
})
it('多帧统计和参考匹配转移像素给独立线程，返回同一参数契约', async () => {
  vi.stubGlobal('Worker', FakeWorker)
  const pixels = new Uint8ClampedArray(32); const reference = new Uint8ClampedArray(32)
  const operation = analyzeVideoEditLumetriOffThread(pixels, reference, 'histogram')
  expect(FakeWorker.last.postMessage).toHaveBeenCalledWith({ kind: 'analyze', pixels, reference, method: 'histogram' }, [pixels.buffer, reference.buffer])
  FakeWorker.last.onmessage?.({ data: { parameters: { exposure: 1 } } } as MessageEvent)
  expect(await operation).toEqual({ exposure: 1 }); expect(FakeWorker.last.terminate).toHaveBeenCalledOnce()
})
