import { afterEach, expect, it, vi } from 'vitest'
import { ImageEditRepairPixelsClientV3 } from './repairPixelsClientV3'
import type { RepairPixelsRequestV3 } from './repairPixels.worker'

class ControlledWorker {
  static latest: ControlledWorker
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn()
  postMessage = vi.fn()
  constructor() { ControlledWorker.latest = this }
}
afterEach(() => { vi.unstubAllGlobals() })
const input: RepairPixelsRequestV3 = { type: 'mask', bitmap: { region: { x: 0, y: 0, width: 1, height: 1 }, rgba: new Uint8Array(4), mask: new Uint8Array(1) }, coverage: new Float32Array([1]) }
it('取消立即终止像素 Worker，迟到消息不能恢复调用，重复 dispose 安全', async () => {
  vi.stubGlobal('Worker', ControlledWorker)
  const client = new ImageEditRepairPixelsClientV3(), abort = new AbortController()
  const pending = client.run(input, abort.signal)
  await expect(client.run(input, abort.signal)).rejects.toThrow('串行')
  abort.abort()
  await expect(pending).rejects.toThrow('CANCELLED')
  expect(ControlledWorker.latest.terminate).toHaveBeenCalled()
  expect(ControlledWorker.latest.onmessage).toBeNull()
  await expect(client.run(input, new AbortController().signal)).rejects.toThrow('CANCELLED'); client.dispose()
})
it('传输失败明确结束等待，下个请求可恢复，不遗留 abort 监听器', async () => {
  vi.stubGlobal('Worker', ControlledWorker)
  const client = new ImageEditRepairPixelsClientV3(), signal = new AbortController().signal
  const pending = client.run(input, signal); ControlledWorker.latest.onmessageerror?.()
  await expect(pending).rejects.toThrow('传输失败')
  const retry = client.run(input, signal)
  ControlledWorker.latest.onmessage?.({ data: { bitmap: input.bitmap } } as MessageEvent)
  await expect(retry).resolves.toEqual({ bitmap: input.bitmap }); client.dispose()
})
