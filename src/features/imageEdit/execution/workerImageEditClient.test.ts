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
  it('显式恢复初始化会通知 Worker 重建设备', async () => {
    const worker = new MockWorker()
    const client = new WorkerImageEditClient(() => worker)
    const pending = client.initialize(true)

    expect(worker.requests[0]).toMatchObject({
      type: 'initialize',
      recoverDevice: true,
    })
    client.destroy()
    await expect(pending).rejects.toThrow('已销毁')
  })

  it('保留 Worker 初始化失败的可观测原因，交由统一执行器决定是否降级', async () => {
    const worker = new MockWorker()
    const client = new WorkerImageEditClient(() => worker)
    const pending = client.initialize()
    const request = worker.requests[0]
    if (request.type !== 'initialize') throw new Error('未发送 Worker 初始化请求')

    worker.emit({
      type: 'capabilities',
      requestId: request.requestId,
      capabilities: {
        available: false,
        adapterName: null,
        backend: null,
        isFallbackAdapter: null,
        features: [],
        limits: {},
        rgba16Float: { renderable: false, sampleable: false },
        offscreenCanvas: true,
        imageBitmap: true,
        supportedExportFormats: [],
        initializationFailure: {
          code: 'webgpu-adapter-unavailable',
          detail: 'Worker 未找到可用 GPU adapter',
        },
        reason: 'Worker 未找到可用 GPU adapter',
      },
    })

    await expect(pending).resolves.toMatchObject({
      available: false,
      reason: 'Worker 未找到可用 GPU adapter',
      initializationFailure: {
        code: 'webgpu-adapter-unavailable',
      },
    })
    client.destroy()
  })

  it('只采纳最新 revision 并关闭过期 ImageBitmap', async () => {
    const worker = new MockWorker()
    const client = new WorkerImageEditClient(() => worker)
    const first = client.preview(
      { kind: 'blob', blob: new Blob() },
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      { previewScopeId: 'editor-a' }
    )
    const second = client.preview(
      { kind: 'blob', blob: new Blob() },
      2,
      undefined,
      undefined,
      undefined,
      undefined,
      { previewScopeId: 'editor-a' }
    )
    const previewRequests = worker.requests.filter(
      (request): request is Extract<ImageEditWorkerRequest, { type: 'preview' }> =>
        request.type === 'preview'
    )
    const staleBitmap = fakeBitmap()
    worker.emit({
      type: 'preview-completed',
      requestId: previewRequests[0].requestId,
      previewScopeId: 'editor-a',
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
      previewScopeId: 'editor-a',
      revision: 2,
      bitmap: currentBitmap,
      width: 100,
      height: 100,
      durationMs: 4,
    })
    await expect(second).resolves.toMatchObject({ revision: 2 })
    expect(currentBitmap.close).not.toHaveBeenCalled()
    currentBitmap.close()
    expect(currentBitmap.close).toHaveBeenCalledOnce()
    client.destroy()
  })

  it('不同图片编辑会话的 revision 互不淘汰', async () => {
    const worker = new MockWorker()
    const client = new WorkerImageEditClient(() => worker)
    const olderSession = client.preview(
      { kind: 'blob', blob: new Blob() },
      257,
      undefined,
      undefined,
      undefined,
      undefined,
      { requestId: 'editor-a-preview', previewScopeId: 'editor-a' }
    )
    const newSession = client.preview(
      { kind: 'blob', blob: new Blob() },
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      { requestId: 'editor-b-preview', previewScopeId: 'editor-b' }
    )

    const olderBitmap = fakeBitmap()
    const newBitmap = fakeBitmap()
    worker.emit({
      type: 'preview-completed',
      requestId: 'editor-a-preview',
      previewScopeId: 'editor-a',
      revision: 257,
      bitmap: olderBitmap,
      width: 100,
      height: 100,
      durationMs: 5,
    })
    worker.emit({
      type: 'preview-completed',
      requestId: 'editor-b-preview',
      previewScopeId: 'editor-b',
      revision: 1,
      bitmap: newBitmap,
      width: 100,
      height: 100,
      durationMs: 4,
    })

    await expect(olderSession).resolves.toMatchObject({ revision: 257 })
    await expect(newSession).resolves.toMatchObject({ revision: 1 })
    olderBitmap.close()
    newBitmap.close()
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
