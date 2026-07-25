import { describe, expect, it, vi } from 'vitest'
import type {
  ImageEditWorkerEvent,
  ImageEditWorkerRequest,
} from '@/core/imageEdit/worker/protocol'
import { WorkerImageEditClient } from './workerImageEditClient'

class MockWorker {
  readonly requests: ImageEditWorkerRequest[] = []
  private listener: ((event: MessageEvent<unknown>) => void) | null = null

  postMessage(message: ImageEditWorkerRequest): void {
    this.requests.push(message)
  }

  addEventListener(
    _type: 'message',
    listener: (event: MessageEvent<unknown>) => void
  ): void {
    this.listener = listener
  }

  removeEventListener(): void {
    this.listener = null
  }

  terminate(): void {}

  emit(event: ImageEditWorkerEvent): void {
    this.listener?.({ data: event } as MessageEvent<unknown>)
  }
}

function fakeBitmap(): ImageBitmap {
  return {
    close: vi.fn(),
  } as unknown as ImageBitmap
}

describe('WorkerImageEditClient', () => {
  it('只采纳最新 revision 并关闭过期 ImageBitmap', async () => {
    const worker = new MockWorker()
    const client = new WorkerImageEditClient(() => worker)
    const first = client.preview({ kind: 'blob', blob: new Blob() }, 1)
    const second = client.preview({ kind: 'blob', blob: new Blob() }, 2)
    const previewRequests = worker.requests.filter(
      (request): request is Extract<ImageEditWorkerRequest, { type: 'preview' }> =>
        request.type === 'preview'
    )
    const staleBitmap = fakeBitmap()
    worker.emit({
      type: 'preview-completed',
      requestId: previewRequests[0].requestId,
      revision: 1,
      bitmap: staleBitmap,
      width: 100,
      height: 100,
      durationMs: 5,
    })
    await expect(first).rejects.toThrow('已过期')
    expect(staleBitmap.close).toHaveBeenCalledOnce()

    const currentBitmap = fakeBitmap()
    worker.emit({
      type: 'preview-completed',
      requestId: previewRequests[1].requestId,
      revision: 2,
      bitmap: currentBitmap,
      width: 100,
      height: 100,
      durationMs: 4,
    })
    await expect(second).resolves.toMatchObject({ revision: 2 })
    client.releasePreview()
    expect(currentBitmap.close).toHaveBeenCalledOnce()
    client.destroy()
  })

  it('转发导出进度并可按 requestId 取消', async () => {
    const worker = new MockWorker()
    const onProgress = vi.fn()
    const client = new WorkerImageEditClient(() => worker)
    const { requestId, result } = client.export(
      { kind: 'blob', blob: new Blob() },
      { format: 'image/png', onProgress }
    )
    worker.emit({
      type: 'export-progress',
      requestId,
      completedTiles: 2,
      totalTiles: 4,
    })
    expect(onProgress).toHaveBeenCalledWith(2, 4)

    client.cancel(requestId)
    expect(worker.requests[worker.requests.length - 1]).toEqual({
      type: 'cancel',
      requestId,
    })
    worker.emit({ type: 'cancelled', requestId })
    await expect(result).rejects.toThrow('已取消')
    client.destroy()
  })

  it('设备丢失时以可识别错误结束等待中的 GPU 请求', async () => {
    const worker = new MockWorker()
    const client = new WorkerImageEditClient(() => worker)
    const pending = client.preview({ kind: 'blob', blob: new Blob() }, 1)
    worker.emit({
      type: 'device-lost',
      reason: 'diagnostic-device-lost',
      recoverable: true,
    })
    await expect(pending).rejects.toThrow(
      'WebGPU 设备丢失：diagnostic-device-lost'
    )
    client.destroy()
  })
})
