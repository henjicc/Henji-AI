import { describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts'
import { ImageEditResourceBudget } from '@/core/imageEdit/v3/resourceBudget'
import {
  IMAGE_EDIT_RENDER_PRIORITY,
  ImageEditRenderScheduler,
  type ImageEditRenderTask,
} from '@/core/imageEdit/v3/renderScheduler'
import type { ImageEditorV3FastProxy } from '@/platform/contracts/imageEditorV3'
import {
  IMAGE_EDITOR_PREVIEW_PROXY_CACHE_MAX_BYTES_V3,
  IMAGE_EDITOR_PREVIEW_PYRAMID_PREWARM_TILE_BUDGET_V3,
  ImageEditorPreviewClientV3,
  ImageEditorPreviewSupersededErrorV3,
  type ImageEditorPreviewClientOptionsV3,
} from './imageEditorPreviewClientV3'
import { ImageEditorResourcePressureErrorV3 } from './imageEditorResourcePressureV3'
import type {
  ImageEditorPreviewWorkerEventV3,
  ImageEditorPreviewWorkerPortV3,
  ImageEditorPreviewWorkerRequestV3,
} from './previewProtocolV3'

class FakePreviewWorker implements ImageEditorPreviewWorkerPortV3 {
  onmessage: ((event: MessageEvent<ImageEditorPreviewWorkerEventV3>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: ImageEditorPreviewWorkerRequestV3[] = []
  readonly transfers: Transferable[][] = []
  readonly terminate = vi.fn()

  postMessage(message: ImageEditorPreviewWorkerRequestV3, transfer: Transferable[] = []): void {
    this.messages.push(message)
    this.transfers.push(transfer)
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

class RecordingRenderScheduler extends ImageEditRenderScheduler {
  readonly tasks: ImageEditRenderTask<unknown>[] = []

  override schedule<T>(task: ImageEditRenderTask<T>): Promise<T> {
    this.tasks.push(task as ImageEditRenderTask<unknown>)
    return super.schedule(task)
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

const SOURCE_RESOURCE = `sha256:${'1'.repeat(64)}` as const
const BRUSH_RESOURCE = `sha256:${'2'.repeat(64)}` as const

function createBrushDocument(revision = 3) {
  const raster = createImageEditRasterLayerV3('raster', '底图', SOURCE_RESOURCE)
  raster.tiles['0/0/0'] = BRUSH_RESOURCE
  return {
    ...createImageEditDocumentV3({ width: 512, height: 512, documentId: 'reopened-brush' }),
    revision,
    layers: [raster],
  }
}

function brushDescriptors() {
  return [
    { resourceRef: SOURCE_RESOURCE, byteLength: 256, mediaType: 'image/png' },
    {
      resourceRef: BRUSH_RESOURCE,
      byteLength: 128,
      mediaType: 'application/x-henji-brush-tile-v3',
    },
  ]
}

function brushTile(width = 512, height = 512) {
  const data = new Float32Array(width * height * 4)
  data.set([0.5, 0, 0, 0.5])
  return createFloat32PremultipliedRgbaTile(
    width,
    height,
    'linear-light',
    data,
    'srgb',
    'srgb',
    203,
  )
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
  it('允许缩略图使用独立低优先级预取流和唯一任务 ID', async () => {
    const worker = new FakePreviewWorker()
    const scheduler = new RecordingRenderScheduler()
    const resourceId = `sha256:${'9'.repeat(64)}` as const
    const describePyramid = vi.fn(async () => ({ tileSize: 512 as const, levels: [] }))
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'shared-session',
      workerFactory: () => worker,
      renderScheduler: scheduler,
      readFastProxy: async (request) => ({
        resourceRef: request.resourceRef,
        width: 512,
        height: 384,
        mediaType: 'image/webp',
        bytes: new ArrayBuffer(8),
      }),
      describePyramid,
      prewarmPyramid: async () => ({ plannedTiles: 0, completedTiles: 0, truncated: false }),
      coalescingKey: 'thumbnail',
      taskKind: 'prefetch',
      purpose: 'thumbnail',
      priority: IMAGE_EDIT_RENDER_PRIORITY.prefetch,
      pyramidPrewarmEnabled: false,
    })
    const rendered = client.render({
      document: createResourceDocument(resourceId),
      quality: 'stable',
      maxDimension: 512,
      resourceDescriptors: [],
    })
    await waitForRender(worker)

    expect(scheduler.tasks[0]).toMatchObject({
      sessionId: 'shared-session',
      coalescingKey: 'thumbnail',
      kind: 'prefetch',
      purpose: 'thumbnail',
      priority: IMAGE_EDIT_RENDER_PRIORITY.prefetch,
    })
    expect(scheduler.tasks[0]?.id).toContain(':thumbnail:preview:')
    expect(describePyramid).not.toHaveBeenCalled()

    const output = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: worker.renders()[0].requestId, sequence: 1,
      width: 512, height: 384, diagnostics: [], bitmap: output,
    })
    ;(await rendered).release()
    client.dispose()
    expect(output.close).toHaveBeenCalledTimes(1)
  })

  it('把 Worker 帧登记为全局 GPU 原子任务，在导出瓦片边界优先执行', async () => {
    const scheduler = new ImageEditRenderScheduler({ cpuConcurrency: 1 })
    const gate = (() => {
      let resolve!: () => void
      return { promise: new Promise<void>((next) => { resolve = next }), resolve }
    })()
    const worker = new FakePreviewWorker()
    const order: string[] = []
    const runningExport = scheduler.schedule({
      id: 'preview-gate-export-1', sessionId: 'export', revision: 1,
      kind: 'export', lane: 'gpu', priority: IMAGE_EDIT_RENDER_PRIORITY.export,
      run: async () => { order.push('export-1'); await gate.promise },
    })
    const queuedExport = scheduler.schedule({
      id: 'preview-gate-export-2', sessionId: 'export', revision: 1,
      kind: 'export', lane: 'gpu', priority: IMAGE_EDIT_RENDER_PRIORITY.export,
      run: async () => { order.push('export-2') },
    })
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'scheduled-preview', workerFactory: () => worker, renderScheduler: scheduler,
    })
    const rendered = client.render({
      document: createDocument(1), quality: 'draft', maxDimension: 960, resourceDescriptors: [],
    })
    await flush()
    expect(worker.renders()).toHaveLength(0)

    gate.resolve()
    await runningExport
    await waitForRender(worker)
    expect(order).toEqual(['export-1'])
    const output = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: worker.renders()[0].requestId, sequence: 1,
      width: 800, height: 600, diagnostics: [], bitmap: output,
    })
    ;(await rendered).release()
    await queuedExport
    expect(order).toEqual(['export-1', 'export-2'])
    client.dispose()
  })

  it('每个会话只保留 running 与 latest-pending，中间 revision 被合并', async () => {
    const worker = new FakePreviewWorker()
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'session',
      workerFactory: () => worker,
    })
    const first = client.render({ document: createDocument(1), quality: 'stable', maxDimension: 1_600, resourceDescriptors: [] })
    const firstSettled = expect(first).rejects.toBeInstanceOf(ImageEditorPreviewSupersededErrorV3)
    await waitForRender(worker)
    const second = client.render({ document: createDocument(2), quality: 'draft', maxDimension: 960, resourceDescriptors: [] })
    const secondSettled = expect(second).rejects.toBeInstanceOf(ImageEditorPreviewSupersededErrorV3)
    const third = client.render({ document: createDocument(3), quality: 'draft', maxDimension: 960, resourceDescriptors: [] })

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
    const old = client.render({ document: createDocument(4), quality: 'stable', maxDimension: 1_600, resourceDescriptors: [] })
    const oldSettled = expect(old).rejects.toBeInstanceOf(ImageEditorPreviewSupersededErrorV3)
    await waitForRender(worker)
    const latest = client.render({ document: createDocument(4), quality: 'draft', maxDimension: 960, resourceDescriptors: [] })
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
    const rendered = client.render({ document, quality: 'stable', maxDimension: 1_600, resourceDescriptors: [] })
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

    const first = client.render({ document, quality: 'stable', maxDimension: 1_600, resourceDescriptors: [] })
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

    const second = client.render({ document, quality: 'stable', maxDimension: 1_600, resourceDescriptors: [] })
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
    const rendered = client.render({ document: createDocument(1), quality: 'stable', maxDimension: 1_600, resourceDescriptors: [] })
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

  it('代理缓存、Worker 传输/工作集与成品都进入同一资源账本并按生命周期释放', async () => {
    const worker = new FakePreviewWorker()
    const budget = new ImageEditResourceBudget({
      totalBytes: 64 * 1024 * 1024,
      cpuCacheTargetBytes: 32 * 1024 * 1024,
      gpuTargetBytes: 16 * 1024 * 1024,
    })
    const resourceId = `sha256:${'a'.repeat(64)}`
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'budgeted-preview',
      resourceBudget: budget,
      workerFactory: () => worker,
      readFastProxy: async (request) => ({
        resourceRef: request.resourceRef,
        width: 800,
        height: 600,
        mediaType: 'image/webp',
        bytes: new ArrayBuffer(8),
      }),
      describePyramid: async () => ({ tileSize: 512, levels: [] }),
      prewarmPyramid: async () => ({ plannedTiles: 0, completedTiles: 0, truncated: false }),
    })

    const rendered = client.render({
      document: createResourceDocument(resourceId),
      quality: 'stable',
      maxDimension: 1_600,
      resourceDescriptors: [],
    })
    await waitForRender(worker)
    expect(budget.snapshot()).toMatchObject({
      byCategory: {
        'cpu-cache': 8,
        gpu: 800 * 600 * 4,
        transfer: 8,
      },
    })
    expect(budget.snapshot().byCategory['in-flight']).toBeGreaterThan(0)

    const output = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: worker.renders()[0].requestId, sequence: 1,
      width: 800, height: 600, diagnostics: [], bitmap: output,
    })
    const result = await rendered
    expect(budget.snapshot()).toMatchObject({
      byCategory: {
        'cpu-cache': 8,
        gpu: 800 * 600 * 4,
        transfer: 0,
        'in-flight': 0,
      },
    })
    result.release()
    expect(budget.snapshot().totalBytes).toBe(8)
    client.dispose()
    expect(budget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
  })

  it('预算不足时在启动 Worker 前返回降低预览尺寸信号并归还预留', async () => {
    const worker = new FakePreviewWorker()
    const budget = new ImageEditResourceBudget({
      totalBytes: 2_000_000,
      cpuCacheTargetBytes: 0,
      gpuTargetBytes: 2_000_000,
    })
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'preview-pressure',
      resourceBudget: budget,
      workerFactory: () => worker,
    })

    const error = await client.render({
      document: createDocument(1),
      quality: 'stable',
      maxDimension: 1_600,
      resourceDescriptors: [],
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ImageEditorResourcePressureErrorV3)
    expect(error).toMatchObject({
      scope: 'managed-preview',
      category: 'in-flight',
      recovery: 'lower-mip',
    })
    expect(worker.renders()).toHaveLength(0)
    expect(budget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
    client.dispose()
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
        resourceDescriptors: [],
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

  it('重开文档后只把普通图片交给代理，并批量读取 brush tile 后 transferable 给 Worker', async () => {
    const worker = new FakePreviewWorker()
    const readFastProxy = vi.fn(async (request): Promise<ImageEditorV3FastProxy> => ({
      resourceRef: request.resourceRef,
      width: 512,
      height: 512,
      mediaType: 'image/webp',
      bytes: new ArrayBuffer(8),
    }))
    const readBrushTiles = vi.fn(async ({ tiles }: Parameters<NonNullable<
      ImageEditorPreviewClientOptionsV3['readBrushTiles']
    >>[0]) => ({
      tiles: tiles.map((item) => ({ tileKey: item.tileKey, tile: brushTile() })),
    }))
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'reopened-brush',
      workerFactory: () => worker,
      readFastProxy,
      readBrushTiles,
      describePyramid: async () => ({ tileSize: 512, levels: [] }),
      prewarmPyramid: async () => ({ plannedTiles: 0, completedTiles: 0, truncated: false }),
    })

    const rendered = client.render({
      document: createBrushDocument(),
      quality: 'stable',
      maxDimension: 1_600,
      resourceDescriptors: brushDescriptors(),
    })
    await waitForRender(worker)

    expect(readFastProxy).toHaveBeenCalledOnce()
    expect(readFastProxy.mock.calls[0][0].resourceRef).toBe(SOURCE_RESOURCE)
    expect(readBrushTiles).toHaveBeenCalledWith({
      requestId: expect.any(String),
      tiles: [{
        tileKey: '0/0/0',
        resource: { resourceId: BRUSH_RESOURCE, byteSize: 128 },
      }],
    }, expect.any(AbortSignal))
    const request = worker.renders()[0]
    expect(request.brushTiles).toHaveLength(1)
    expect(request.brushTiles[0]).toMatchObject({
      resourceId: BRUSH_RESOURCE,
      width: 512,
      height: 512,
    })
    expect(request.brushTiles[0].bytes.byteLength).toBe(512 * 512 * 4 * 4)
    const transfer = worker.transfers[worker.messages.indexOf(request)]
    expect(transfer).toContain(request.brushTiles[0].bytes)

    const output = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: request.requestId, sequence: 1,
      width: 512, height: 512, diagnostics: [], bitmap: output,
    })
    ;(await rendered).release()
    client.dispose()
  })

  it('拒绝 brush IPC 返回的错误 Float32 尺寸，不向 Worker 发布残缺帧', async () => {
    const worker = new FakePreviewWorker()
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'invalid-brush-size',
      workerFactory: () => worker,
      readFastProxy: async (request) => ({
        resourceRef: request.resourceRef,
        width: 512,
        height: 512,
        mediaType: 'image/webp',
        bytes: new ArrayBuffer(8),
      }),
      readBrushTiles: async ({ tiles }) => ({
        tiles: [{ tileKey: tiles[0].tileKey, tile: brushTile(1, 1) }],
      }),
      describePyramid: async () => ({ tileSize: 512, levels: [] }),
      prewarmPyramid: async () => ({ plannedTiles: 0, completedTiles: 0, truncated: false }),
    })

    await expect(client.render({
      document: createBrushDocument(),
      quality: 'stable',
      maxDimension: 1_600,
      resourceDescriptors: brushDescriptors(),
    })).rejects.toThrow(/像素契约与文档不匹配/)
    expect(worker.renders()).toHaveLength(0)
    client.dispose()
  })

  it('新 revision 会取消仍在读取的 brush batch，reader 忽略 signal 也不会阻塞 latest', async () => {
    const worker = new FakePreviewWorker()
    let firstSignal: AbortSignal | undefined
    const readBrushTiles = vi.fn((
      _request: Parameters<NonNullable<ImageEditorPreviewClientOptionsV3['readBrushTiles']>>[0],
      signal?: AbortSignal,
    ) => {
      firstSignal = signal
      return new Promise<never>(() => undefined)
    })
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'cancel-brush',
      workerFactory: () => worker,
      readFastProxy: async (request) => ({
        resourceRef: request.resourceRef,
        width: 512,
        height: 512,
        mediaType: 'image/webp',
        bytes: new ArrayBuffer(8),
      }),
      readBrushTiles,
      describePyramid: async () => ({ tileSize: 512, levels: [] }),
      prewarmPyramid: async () => ({ plannedTiles: 0, completedTiles: 0, truncated: false }),
    })
    const first = client.render({
      document: createBrushDocument(),
      quality: 'stable',
      maxDimension: 1_600,
      resourceDescriptors: brushDescriptors(),
    })
    const firstSettled = expect(first).rejects.toBeInstanceOf(ImageEditorPreviewSupersededErrorV3)
    for (let attempt = 0; attempt < 10 && readBrushTiles.mock.calls.length === 0; attempt += 1) await flush()
    expect(readBrushTiles).toHaveBeenCalledOnce()

    const latest = client.render({
      document: createDocument(4),
      quality: 'draft',
      maxDimension: 960,
      resourceDescriptors: [],
    })
    await firstSettled
    await waitForRender(worker)
    expect(firstSignal?.aborted).toBe(true)
    const output = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: worker.renders()[0].requestId, sequence: 2,
      width: 800, height: 600, diagnostics: [], bitmap: output,
    })
    ;(await latest).release()
    client.dispose()
  })

  it('无 brush 文档不会触发 brush IPC', async () => {
    const worker = new FakePreviewWorker()
    const readBrushTiles = vi.fn()
    const client = new ImageEditorPreviewClientV3({
      sessionId: 'no-brush',
      workerFactory: () => worker,
      readBrushTiles,
    })
    const rendered = client.render({
      document: createDocument(1),
      quality: 'stable',
      maxDimension: 1_600,
      resourceDescriptors: [],
    })
    await waitForRender(worker)
    expect(readBrushTiles).not.toHaveBeenCalled()
    expect(worker.renders()[0].brushTiles).toEqual([])
    const output = bitmap()
    worker.emit({
      type: 'rendered-bitmap', requestId: worker.renders()[0].requestId, sequence: 1,
      width: 800, height: 600, diagnostics: [], bitmap: output,
    })
    ;(await rendered).release()
    client.dispose()
  })
})
