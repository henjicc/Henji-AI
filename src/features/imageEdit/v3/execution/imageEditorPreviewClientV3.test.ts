import { describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorV3FastProxy } from '@/platform/contracts/imageEditorV3'
import {
  IMAGE_EDITOR_PREVIEW_PROXY_CACHE_MAX_BYTES_V3,
  IMAGE_EDITOR_PREVIEW_PYRAMID_PREWARM_TILE_BUDGET_V3,
  ImageEditorPreviewClientV3,
  ImageEditorPreviewSupersededErrorV3,
} from './imageEditorPreviewClientV3'
import type {
  ImageEditorPreviewWorkerEventV3,
  ImageEditorPreviewWorkerPortV3,
  ImageEditorPreviewWorkerRequestV3,
} from './previewProtocolV3'

class FakePreviewWorker implements ImageEditorPreviewWorkerPortV3 {
  onmessage: ((event: MessageEvent<ImageEditorPreviewWorkerEventV3>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: ImageEditorPreviewWorkerRequestV3[] = []
  readonly terminate = vi.fn()

  postMessage(message: ImageEditorPreviewWorkerRequestV3): void {
    this.messages.push(message)
  }

  emit(event: ImageEditorPreviewWorkerEventV3): void {
    this.onmessage?.({ data: event } as MessageEvent<ImageEditorPreviewWorkerEventV3>)
  }

  renders(): Extract<ImageEditorPreviewWorkerRequestV3, { type: 'render' }>[] {
    return this.messages.filter(
      (message): message is Extract<ImageEditorPreviewWorkerRequestV3, { type: 'render' }> => (
        message.type === 'render'
      ),
    )
  }
}

function createDocument(revision: number) {
  return {
    ...createImageEditDocumentV3({ width: 800, height: 600, documentId: 'client-test' }),
    revision,
  }
}

function createResourceDocument(resourceId: string) {
  return createImageEditDocumentV3({
    width: 800,
    height: 600,
    documentId: `resource-${resourceId.slice(7, 11)}`,
    sourceResourceId: resourceId,
    idFactory: () => `layer-${resourceId.slice(7, 11)}`,
  })
}

function bitmap() {
  return { close: vi.fn(), width: 800, height: 600 } as unknown as ImageBitmap
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function waitForRender(worker: FakePreviewWorker, count = 1): Promise<void> {
  for (let attempt = 0; attempt < 10 && worker.renders().length < count; attempt += 1) {
    await flush()
  }
  expect(worker.renders()).toHaveLength(count)
}

describe('ImageEditorPreviewClientV3 调度与资源所有权', () => {
  it('每个会话只保留 running 与 latest-pending，中间 revision 被合并', async () => {
    const worker = new FakePreviewWorker()
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'session',
      workerFactory: () => worker,
    })
    const first = client.render({ document: createDocument(1), quality: 'stable', maxDimension: 1_600 })
    const firstSettled = expect(first).rejects.toBeInstanceOf(ImageEditorPreviewSupersededErrorV3)
    await waitForRender(worker)
    const second = client.render({ document: createDocument(2), quality: 'draft', maxDimension: 960 })
    const secondSettled = expect(second).rejects.toBeInstanceOf(ImageEditorPreviewSupersededErrorV3)
    const third = client.render({ document: createDocument(3), quality: 'draft', maxDimension: 960 })

    expect(worker.renders().map((request) => request.sequence)).toEqual([1])
    const staleBitmap = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: worker.renders()[0].requestId, sequence: 1,
      width: 800, height: 600, diagnostics: [], bitmap: staleBitmap,
    })
    await firstSettled
    await secondSettled
    await waitForRender(worker, 2)

    expect(staleBitmap.close).toHaveBeenCalledTimes(1)
    expect(worker.renders().map((request) => request.sequence)).toEqual([1, 3])
    const latestBitmap = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: worker.renders()[1].requestId, sequence: 3,
      width: 800, height: 600, diagnostics: [], bitmap: latestBitmap,
    })
    const result = await third
    expect(result.kind).toBe('bitmap')
    result.release()
    expect(latestBitmap.close).toHaveBeenCalledTimes(1)
    client.dispose()
  })

  it('旧帧即使晚到也永远不会作为新请求结果发布', async () => {
    const worker = new FakePreviewWorker()
    const client = new ImageEditorPreviewClientV3({ sessionId: 'stale', workerFactory: () => worker })
    const old = client.render({ document: createDocument(4), quality: 'stable', maxDimension: 1_600 })
    const oldSettled = expect(old).rejects.toBeInstanceOf(ImageEditorPreviewSupersededErrorV3)
    await waitForRender(worker)
    const latest = client.render({ document: createDocument(4), quality: 'draft', maxDimension: 960 })
    const stale = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: worker.renders()[0].requestId, sequence: 1,
      width: 800, height: 600, diagnostics: [], bitmap: stale,
    })
    await oldSettled
    await waitForRender(worker, 2)
    const currentRequest = worker.renders()[1]
    const current = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: currentRequest.requestId, sequence: 2,
      width: 800, height: 600, diagnostics: [], bitmap: current,
    })
    expect((await latest).kind).toBe('bitmap')
    expect(stale.close).toHaveBeenCalledTimes(1)
    client.dispose()
    expect(current.close).toHaveBeenCalledTimes(1)
  })

  it('代理只通过受管 reader 读取且稳定预览不请求原尺寸', async () => {
    const worker = new FakePreviewWorker()
    const resourceId = `sha256:${'d'.repeat(64)}`
    const document = createImageEditDocumentV3({
      width: 20_000,
      height: 10_000,
      documentId: 'managed-source',
      sourceResourceId: resourceId,
      idFactory: () => 'raster',
    })
    const reader = vi.fn(async (request): Promise<ImageEditorV3FastProxy> => ({
      resourceRef: request.resourceRef,
      width: 1_600,
      height: 800,
      mediaType: 'image/webp',
      bytes: new ArrayBuffer(8),
    }))
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'managed', workerFactory: () => worker, readFastProxy: reader,
      describePyramid: async () => ({ tileSize: 512, levels: [] }),
      prewarmPyramid: async () => ({ plannedTiles: 0, completedTiles: 0, truncated: false }),
    })
    const rendered = client.render({ document, quality: 'stable', maxDimension: 1_600 })
    await waitForRender(worker)
    expect(reader).toHaveBeenCalledWith(expect.objectContaining({
      resourceRef: resourceId,
      maxDimension: 1_600,
    }), expect.any(AbortSignal))
    expect(worker.renders()[0].proxies[0]).toMatchObject({
      resourceId,
      width: 1_600,
      height: 800,
    })
    const output = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: worker.renders()[0].requestId, sequence: 1,
      width: 1_600, height: 800, diagnostics: [], bitmap: output,
    })
    ;(await rendered).release()
    client.dispose()
  })

  it('首帧不等待后台粗 mip 金字塔预热，且同一资源每会话只启动一次', async () => {
    const worker = new FakePreviewWorker()
    const resourceId = `sha256:${'f'.repeat(64)}` as const
    const document = createImageEditDocumentV3({
      width: 20_000,
      height: 10_000,
      documentId: 'pyramid-prewarm',
      sourceResourceId: resourceId,
      idFactory: () => 'raster',
    })
    const reader = vi.fn(async (request): Promise<ImageEditorV3FastProxy> => ({
      resourceRef: request.resourceRef,
      width: 1_600,
      height: 800,
      mediaType: 'image/webp',
      bytes: new ArrayBuffer(8),
    }))
    const describePyramid = vi.fn(async () => ({
      tileSize: 512 as const,
      levels: [
        { mip: 0, width: 20_000, height: 10_000, columns: 40, rows: 20 },
        { mip: 4, width: 1_250, height: 625, columns: 3, rows: 2 },
        { mip: 15, width: 1, height: 1, columns: 1, rows: 1 },
      ],
    }))
    const prewarmPyramid = vi.fn(async () => ({
      plannedTiles: 7,
      completedTiles: 7,
      truncated: false,
    }))
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'prewarm', workerFactory: () => worker, readFastProxy: reader,
      describePyramid, prewarmPyramid,
    })

    const first = client.render({ document, quality: 'stable', maxDimension: 1_600 })
    await waitForRender(worker)
    for (let attempt = 0; attempt < 10 && prewarmPyramid.mock.calls.length === 0; attempt += 1) await flush()
    expect(prewarmPyramid).toHaveBeenCalledWith(expect.objectContaining({
      resourceRef: resourceId,
      minimumMip: 4,
      maximumMip: 15,
      tileBudget: IMAGE_EDITOR_PREVIEW_PYRAMID_PREWARM_TILE_BUDGET_V3,
      bitDepth: 8,
    }), expect.any(AbortSignal))
    const firstOutput = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: worker.renders()[0].requestId, sequence: 1,
      width: 1_600, height: 800, diagnostics: [], bitmap: firstOutput,
    })
    ;(await first).release()

    const second = client.render({ document, quality: 'stable', maxDimension: 1_600 })
    await waitForRender(worker, 2)
    const secondOutput = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: worker.renders()[1].requestId, sequence: 2,
      width: 1_600, height: 800, diagnostics: [], bitmap: secondOutput,
    })
    ;(await second).release()
    expect(describePyramid).toHaveBeenCalledTimes(1)
    expect(prewarmPyramid).toHaveBeenCalledTimes(1)
    client.dispose()
  })

  it('卸载会终止 Worker 并回收未消费的 Object URL', async () => {
    const worker = new FakePreviewWorker()
    const revoke = vi.fn()
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'release',
      workerFactory: () => worker,
      urlFactory: { create: () => 'blob:managed-preview', revoke },
    })
    const rendered = client.render({ document: createDocument(1), quality: 'stable', maxDimension: 1_600 })
    await waitForRender(worker)
    worker.emit({
      type: 'rendered-blob', requestId: worker.renders()[0].requestId, sequence: 1,
      width: 800, height: 600, diagnostics: [], mediaType: 'image/png', bytes: new ArrayBuffer(4),
    })
    expect((await rendered).kind).toBe('url')
    expect(revoke).not.toHaveBeenCalled()
    client.dispose()
    expect(revoke).toHaveBeenCalledWith('blob:managed-preview')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(worker.messages.at(-1)).toEqual({ type: 'dispose' })
  })

  it('代理 LRU 有明确字节上限，超限条目不会在会话内无限滞留', async () => {
    const worker = new FakePreviewWorker()
    const reader = vi.fn(async (request): Promise<ImageEditorV3FastProxy> => ({
      resourceRef: request.resourceRef,
      width: 800,
      height: 600,
      mediaType: 'image/webp',
      bytes: new ArrayBuffer(8),
    }))
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'bounded-cache',
      workerFactory: () => worker,
      readFastProxy: reader,
      describePyramid: async () => ({ tileSize: 512, levels: [] }),
      prewarmPyramid: async () => ({ plannedTiles: 0, completedTiles: 0, truncated: false }),
      proxyCacheMaxBytes: 0,
    })
    const resourceId = `sha256:${'e'.repeat(64)}`
    for (let sequence = 1; sequence <= 2; sequence += 1) {
      const promise = client.render({
        document: createResourceDocument(resourceId),
        quality: 'stable',
        maxDimension: 1_600,
      })
      await waitForRender(worker, sequence)
      const output = bitmap()
      worker.emit({
        type: 'rendered-bitmap',
        requestId: worker.renders()[sequence - 1].requestId,
        sequence,
        width: 800,
        height: 600,
        diagnostics: [],
        bitmap: output,
      })
      ;(await promise).release()
    }
    expect(IMAGE_EDITOR_PREVIEW_PROXY_CACHE_MAX_BYTES_V3).toBe(128 * 1024 * 1024)
    expect(reader).toHaveBeenCalledTimes(2)
    client.dispose()
  })
})
