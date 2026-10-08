import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageEditSelectionRasterClientV3 } from './selectionRasterClientV3'
import type { SelectionRasterRequestV3 } from './selectionRaster.worker'

class WorkerStub {
  static current: WorkerStub
  onmessage: ((event: { data: { coverage: Float32Array } }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { WorkerStub.current = this }
}
const request: SelectionRasterRequestV3 = { selection: { operations: [], feather: 0, inverted: false }, size: { width: 1, height: 1 }, region: { x: 0, y: 0, width: 1, height: 1 } }
afterEach(() => { vi.unstubAllGlobals() })
describe('选区 Worker 生命周期', () => {
  it('释放和取消拒绝待处理请求，已经终止的实例不能复用', async () => {
    vi.stubGlobal('Worker', WorkerStub)
    for (const viaSignal of [false, true]) {
      const client = new ImageEditSelectionRasterClientV3(), abort = new AbortController()
      const promise = client.rasterize(request, abort.signal)
      const rejection = expect(promise).rejects.toThrow('CANCELLED')
      if (viaSignal) abort.abort(); else client.dispose()
      await rejection
      expect(WorkerStub.current.terminate).toHaveBeenCalled()
      await expect(client.rasterize(request)).rejects.toThrow('CANCELLED')
    }
  })
  it('同一实例串行消费，错误或结果均清除待处理监听器', async () => {
    vi.stubGlobal('Worker', WorkerStub)
    const client = new ImageEditSelectionRasterClientV3()
    const first = client.rasterize(request)
    await expect(client.rasterize(request)).rejects.toThrow('串行')
    WorkerStub.current.onmessage?.({ data: { coverage: new Float32Array([1]) } })
    expect([...await first]).toEqual([1])
    const second = client.rasterize(request)
    WorkerStub.current.onerror?.({ message: 'worker failed' })
    await expect(second).rejects.toThrow('worker failed')
    expect(WorkerStub.current.onmessage).toBeNull()
    client.dispose()
  })
})
