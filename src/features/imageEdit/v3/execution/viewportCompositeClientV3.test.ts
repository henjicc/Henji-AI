import { describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createTileRegion,
  IMAGE_EDIT_RENDER_PRIORITY,
  ImageEditRenderScheduler,
  ImageEditResourceBudget,
} from '@/core/imageEdit/v3'
import type { ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import {
  ImageEditorViewportCompositeClientV3,
  ImageEditorViewportCompositeSupersededErrorV3,
} from './viewportCompositeClientV3'
import { ImageEditorResourcePressureErrorV3 } from './imageEditorResourcePressureV3'
import { prepareImageEditorViewportCompositeV3 } from './viewportCompositeDocumentV3'
import type {
  ImageEditorViewportCompositeWorkerEventV3,
  ImageEditorViewportCompositeWorkerPortV3,
  ImageEditorViewportCompositeWorkerRequestV3,
} from './viewportCompositeProtocolV3'
import { planImageEditorViewportTilesV3 } from './viewportTilePlannerV3'
import type { ImageEditorViewportFrameV3 } from './viewportTileSchedulerV3'

const RESOURCE = `sha256:${'e'.repeat(64)}` as const
const RENDER_IDENTITY = {
  renderGeneration: 1,
  cameraSequence: 1,
  geometryHash: '20000:10000:0:0:0:0:20000:10000',
}

class FakeViewportWorker implements ImageEditorViewportCompositeWorkerPortV3 {
  onmessage: ((event: MessageEvent<ImageEditorViewportCompositeWorkerEventV3>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: ImageEditorViewportCompositeWorkerRequestV3[] = []
  readonly transfers: Transferable[][] = []
  readonly terminate = vi.fn()

  postMessage(message: ImageEditorViewportCompositeWorkerRequestV3, transfer: Transferable[] = []): void {
    this.messages.push(message)
    this.transfers.push(transfer)
  }

  emit(event: ImageEditorViewportCompositeWorkerEventV3): void {
    this.onmessage?.({ data: event } as MessageEvent<ImageEditorViewportCompositeWorkerEventV3>)
  }
}

function pyramid(width: number, height: number) {
  const levels = []
  for (let mip = 0; mip <= 30; mip += 1) {
    const levelWidth = Math.max(1, Math.ceil(width / (2 ** mip)))
    const levelHeight = Math.max(1, Math.ceil(height / (2 ** mip)))
    levels.push({
      mip,
      width: levelWidth,
      height: levelHeight,
      columns: Math.ceil(levelWidth / 512),
      rows: Math.ceil(levelHeight / 512),
    })
    if (levelWidth === 1 && levelHeight === 1) break
  }
  return { tileSize: 512 as const, levels }
}

function createFrame(width = 20_000, height = 10_000): ImageEditorViewportFrameV3 {
  const plan = planImageEditorViewportTilesV3({
    resourceRef: RESOURCE,
    documentSize: { width, height },
    pyramid: pyramid(width, height),
    viewport: {
      documentX: 0,
      documentY: 0,
      width: 1_440,
      height: 900,
      zoom: 1_440 / width,
      devicePixelRatio: 1,
    },
    bitDepth: 8,
  })
  const tiles = plan.tiles.map((request): ImageEditorV3SourceTile => ({
    resourceRef: RESOURCE,
    mip: request.mip,
    tileX: request.tileX,
    tileY: request.tileY,
    halo: request.halo,
    width: request.width,
    height: request.height,
    channels: 4,
    bitDepth: 8,
    sampleFormat: 'uint',
    numericRange: 'unorm8',
    byteOrder: 'little-endian',
    rowStride: request.width * 4,
    colorSpace: 'srgb',
    transferFunction: 'srgb',
    alphaMode: 'straight',
    orientationApplied: true,
    originX: request.originX,
    originY: request.originY,
    pixels: new ArrayBuffer(request.width * request.height * 4),
  }))
  return {
    sequence: 1,
    revision: 0,
    plan,
    tiles,
    resourceTiles: new Map([[RESOURCE, tiles]]),
    release: vi.fn(),
  }
}

function bitmap(width: number, height: number): ImageBitmap {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap
}

async function flushUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt += 1) await Promise.resolve()
  expect(predicate()).toBe(true)
}

describe('图片编辑 V3 视口成品客户端', () => {
  it('把高分辨率视口帧登记为全局 GPU 原子任务', async () => {
    const frame = createFrame()
    const sourceScheduler = {
      render: vi.fn(async () => frame),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const renderScheduler = new ImageEditRenderScheduler({ cpuConcurrency: 1 })
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const order: string[] = []
    const firstExport = renderScheduler.schedule({
      id: 'viewport-gate-export-1', sessionId: 'export', revision: 1,
      kind: 'export', lane: 'gpu', priority: IMAGE_EDIT_RENDER_PRIORITY.export,
      run: async () => { order.push('export-1'); await firstGate },
    })
    const secondExport = renderScheduler.schedule({
      id: 'viewport-gate-export-2', sessionId: 'export', revision: 1,
      kind: 'export', lane: 'gpu', priority: IMAGE_EDIT_RENDER_PRIORITY.export,
      run: async () => { order.push('export-2') },
    })
    const worker = new FakeViewportWorker()
    const document = createImageEditDocumentV3({
      width: 20_000,
      height: 10_000,
      documentId: 'viewport-global-scheduler',
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    const client = new ImageEditorViewportCompositeClientV3({
      sessionId: 'viewport-global-scheduler',
      scheduler: sourceScheduler,
      renderScheduler,
      workerFactory: () => worker,
    })
    const rendered = client.render({
      document,
      ...RENDER_IDENTITY,
      quality: 'draft',
      resourceDescriptors: [],
      viewport: { documentX: 0, documentY: 0, width: 1_440, height: 900, zoom: 0.072, devicePixelRatio: 1 },
      viewportKey: 'scheduled',
    })
    await flushUntil(() => sourceScheduler.render.mock.calls.length === 1)
    expect(worker.messages.some((message) => message.type === 'render')).toBe(false)

    releaseFirst()
    await firstExport
    await flushUntil(() => worker.messages.some((message) => message.type === 'render'))
    expect(order).toEqual(['export-1'])
    const request = worker.messages.find(
      (message): message is Extract<ImageEditorViewportCompositeWorkerRequestV3, { type: 'render' }> => message.type === 'render',
    )
    if (!request) throw new Error('缺少视口 Worker 请求')
    const tiles = frame.plan.tiles.map((tile) => {
      const outputRect = createTileRegion(document.geometry, {
        mip: frame.plan.mip, x: tile.tileX, y: tile.tileY,
      }, tile.halo).outputRect
      return { outputRect, bitmap: bitmap(outputRect.width, outputRect.height) }
    })
    worker.emit({
      type: 'rendered', requestId: request.requestId, sequence: request.sequence,
      renderGeneration: request.renderGeneration,
      cameraSequence: request.cameraSequence,
      geometryHash: request.geometryHash,
      revision: 0, mip: frame.plan.mip, documentWidth: 20_000, documentHeight: 10_000,
      diagnostics: [], tiles,
    })
    ;(await rendered).release()
    await secondExport
    expect(order).toEqual(['export-1', 'export-2'])
    client.dispose()
  })

  it('200MP 只把当前 mip 的小瓦片 transferable 给完整合成 Worker', async () => {
    const frame = createFrame()
    const scheduler = {
      render: vi.fn(async () => frame),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const worker = new FakeViewportWorker()
    const budget = new ImageEditResourceBudget()
    const document = createImageEditDocumentV3({
      width: 20_000,
      height: 10_000,
      documentId: 'viewport-200mp',
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    const client = new ImageEditorViewportCompositeClientV3({
      sessionId: 'viewport-200mp',
      scheduler,
      workerFactory: () => worker,
      resourceBudget: budget,
    })

    const rendered = client.render({
      document,
      ...RENDER_IDENTITY,
      quality: 'stable',
      resourceDescriptors: [],
      viewport: { documentX: 0, documentY: 0, width: 1_440, height: 900, zoom: 1_440 / 20_000, devicePixelRatio: 1 },
      viewportKey: 'fit',
    })
    await flushUntil(() => worker.messages.some((message) => message.type === 'render'))
    const request = worker.messages.find(
      (message): message is Extract<ImageEditorViewportCompositeWorkerRequestV3, { type: 'render' }> => message.type === 'render',
    )
    if (!request) throw new Error('缺少视口 Worker 请求')

    expect(request.plan.mip).toBe(3)
    expect(request.sourceTiles).toHaveLength(15)
    expect(Math.max(...request.sourceTiles.map((tile) => tile.pixels.byteLength)))
      .toBeLessThanOrEqual(512 * 512 * 4)
    expect(request.sourceTiles.reduce((total, tile) => total + tile.pixels.byteLength, 0))
      .toBeLessThan(document.geometry.width * document.geometry.height * 4)
    expect(frame.release).toHaveBeenCalledTimes(1)
    expect(budget.snapshot().byCategory.gpu).toBeGreaterThan(0)

    const tiles = frame.plan.tiles.map((tile) => {
      const outputRect = createTileRegion(
        document.geometry,
        { mip: frame.plan.mip, x: tile.tileX, y: tile.tileY },
        tile.halo,
      ).outputRect
      return { outputRect, bitmap: bitmap(outputRect.width, outputRect.height) }
    })
    worker.emit({
      type: 'rendered',
      requestId: request.requestId,
      sequence: request.sequence,
      renderGeneration: request.renderGeneration,
      cameraSequence: request.cameraSequence,
      geometryHash: request.geometryHash,
      revision: document.revision,
      mip: frame.plan.mip,
      documentWidth: document.geometry.width,
      documentHeight: document.geometry.height,
      diagnostics: [],
      tiles,
    })
    const result = await rendered
    expect(result.tiles).toHaveLength(15)
    result.release()
    expect(tiles.every((tile) => vi.mocked(tile.bitmap.close).mock.calls.length === 1)).toBe(true)
    expect(budget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
    client.dispose()
  })

  it('成品 GPU 预算不足时不调用 Worker，并给出全局预览回退信号', async () => {
    const frame = createFrame()
    const scheduler = {
      render: vi.fn(async () => frame),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const worker = new FakeViewportWorker()
    const document = createImageEditDocumentV3({
      width: 20_000,
      height: 10_000,
      documentId: 'viewport-pressure',
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    const prepared = prepareImageEditorViewportCompositeV3(document, 'stable', [])
    const transferBytes = frame.tiles.reduce((total, tile) => total + tile.pixels.byteLength, 0)
    const maxRegionPixels = frame.plan.tiles.reduce(
      (largest, tile) => Math.max(largest, tile.width * tile.height),
      0,
    )
    const workingBytes = maxRegionPixels * 4 * Float32Array.BYTES_PER_ELEMENT
      * Math.max(3, prepared.plan.nodes.length + 2)
    const outputBytes = frame.plan.tiles.reduce((total, tile) => {
      const output = createTileRegion(
        document.geometry,
        { mip: frame.plan.mip, x: tile.tileX, y: tile.tileY },
        tile.halo,
      ).outputRect
      return total + output.width * output.height * 4
    }, 0)
    const budget = new ImageEditResourceBudget({
      totalBytes: transferBytes + workingBytes + outputBytes - 1,
      cpuCacheTargetBytes: 0,
      gpuTargetBytes: 0,
    })
    const client = new ImageEditorViewportCompositeClientV3({
      sessionId: 'viewport-pressure',
      scheduler,
      workerFactory: () => worker,
      resourceBudget: budget,
    })

    const error = await client.render({
      document,
      ...RENDER_IDENTITY,
      quality: 'stable',
      resourceDescriptors: [],
      viewport: { documentX: 0, documentY: 0, width: 1_440, height: 900, zoom: 1_440 / 20_000, devicePixelRatio: 1 },
      viewportKey: 'pressure',
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ImageEditorResourcePressureErrorV3)
    expect(error).toMatchObject({
      scope: 'viewport-composite',
      category: 'gpu',
      requestedBytes: outputBytes,
      recovery: 'fallback-managed-preview',
    })
    expect(worker.messages.some((message) => message.type === 'render')).toBe(false)
    expect(frame.release).toHaveBeenCalledTimes(1)
    expect(budget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
    client.dispose()
  })

  it('取消尚未返回的 source frame 后拒绝旧请求，并释放晚到租约', async () => {
    let resolveFrame: ((frame: ImageEditorViewportFrameV3) => void) | undefined
    const scheduler = {
      render: vi.fn(() => new Promise<ImageEditorViewportFrameV3>((resolve) => { resolveFrame = resolve })),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const client = new ImageEditorViewportCompositeClientV3({
      sessionId: 'viewport-cancel',
      scheduler,
      workerFactory: () => new FakeViewportWorker(),
    })
    const document = createImageEditDocumentV3({
      width: 20_000,
      height: 10_000,
      documentId: 'viewport-cancel',
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    const pending = client.render({
      document,
      ...RENDER_IDENTITY,
      quality: 'stable',
      resourceDescriptors: [],
      viewport: { documentX: 0, documentY: 0, width: 1_440, height: 900, zoom: 0.072, devicePixelRatio: 1 },
      viewportKey: 'cancel',
    })
    const settled = expect(pending).rejects.toBeInstanceOf(
      ImageEditorViewportCompositeSupersededErrorV3,
    )
    await flushUntil(() => scheduler.render.mock.calls.length === 1)
    client.cancel()
    await settled
    const lateFrame = createFrame()
    resolveFrame?.(lateFrame)
    await flushUntil(() => vi.mocked(lateFrame.release).mock.calls.length === 1)
    expect(scheduler.cancel).toHaveBeenCalledTimes(1)
    client.dispose()
  })

  it('Worker 已接管帧后取消通过协议确认回收，不销毁常驻 Worker', async () => {
    const frame = createFrame()
    const scheduler = {
      render: vi.fn(async () => frame),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const worker = new FakeViewportWorker()
    const budget = new ImageEditResourceBudget()
    const client = new ImageEditorViewportCompositeClientV3({
      sessionId: 'viewport-posted-cancel',
      scheduler,
      workerFactory: () => worker,
      resourceBudget: budget,
    })
    const document = createImageEditDocumentV3({
      width: 20_000,
      height: 10_000,
      documentId: 'viewport-posted-cancel',
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    const pending = client.render({
      document,
      ...RENDER_IDENTITY,
      quality: 'stable',
      resourceDescriptors: [],
      viewport: { documentX: 0, documentY: 0, width: 1_440, height: 900, zoom: 0.072, devicePixelRatio: 1 },
      viewportKey: 'cancel-after-post',
    })
    const settled = expect(pending).rejects.toBeInstanceOf(
      ImageEditorViewportCompositeSupersededErrorV3,
    )
    await flushUntil(() => worker.messages.some((message) => message.type === 'render'))
    const request = worker.messages.find(
      (message): message is Extract<ImageEditorViewportCompositeWorkerRequestV3, { type: 'render' }> => (
        message.type === 'render'
      ),
    )
    if (!request) throw new Error('缺少视口 Worker 请求')
    const reservedBeforeCancel = budget.snapshot().totalBytes
    expect(reservedBeforeCancel).toBeGreaterThan(0)

    client.cancel()
    await settled
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(worker.messages).toContainEqual({ type: 'cancel', requestId: request.requestId })
    worker.emit({
      type: 'failed',
      requestId: request.requestId,
      sequence: request.sequence,
      renderGeneration: request.renderGeneration,
      code: 'aborted',
      message: 'cancelled',
    })
    expect(budget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
    client.dispose()
  })

  it('连续更新视口时已取消 Worker 不得堆积占满全局预算', async () => {
    const frames: ImageEditorViewportFrameV3[] = []
    const sourceScheduler = {
      render: vi.fn(async () => {
        const frame = createFrame()
        frames.push(frame)
        return frame
      }),
      cancel: vi.fn(),
      dispose: vi.fn(),
    }
    const workers: FakeViewportWorker[] = []
    const budget = new ImageEditResourceBudget({
      totalBytes: 64 * 1024 * 1024,
      cpuCacheTargetBytes: 0,
      gpuTargetBytes: 0,
    })
    const client = new ImageEditorViewportCompositeClientV3({
      sessionId: 'viewport-rapid-update',
      scheduler: sourceScheduler,
      workerFactory: () => {
        const worker = new FakeViewportWorker()
        workers.push(worker)
        return worker
      },
      resourceBudget: budget,
    })
    const document = createImageEditDocumentV3({
      width: 20_000,
      height: 10_000,
      documentId: 'viewport-rapid-update',
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    const request = (viewportKey: string) => ({
      document,
      ...RENDER_IDENTITY,
      quality: 'stable' as const,
      resourceDescriptors: [],
      viewport: {
        documentX: 0, documentY: 0, width: 1_440, height: 900,
        zoom: 0.072, devicePixelRatio: 1,
      },
      viewportKey,
    })

    const first = client.render(request('rapid-1'))
    const firstSettled = expect(first).rejects.toBeInstanceOf(
      ImageEditorViewportCompositeSupersededErrorV3,
    )
    await flushUntil(() => workers[0]?.messages.some((message) => message.type === 'render') ?? false)
    const singleJobBytes = budget.snapshot().totalBytes
    expect(singleJobBytes).toBeGreaterThan(0)

    const second = client.render(request('rapid-2'))
    await firstSettled
    const firstRequest = workers[0]?.messages.find(
      (message): message is Extract<ImageEditorViewportCompositeWorkerRequestV3, { type: 'render' }> => (
        message.type === 'render'
      ),
    )
    if (!firstRequest) throw new Error('缺少第一次视口 Worker 请求')
    workers[0].emit({
      type: 'failed',
      requestId: firstRequest.requestId,
      sequence: firstRequest.sequence,
      renderGeneration: firstRequest.renderGeneration,
      code: 'aborted',
      message: 'cancelled',
    })
    await flushUntil(() => workers[0]?.messages.filter((message) => message.type === 'render').length === 2)
    expect(workers).toHaveLength(1)
    expect(budget.snapshot().totalBytes).toBeLessThanOrEqual(singleJobBytes)

    const secondRequest = workers[0]?.messages.filter(
      (message): message is Extract<ImageEditorViewportCompositeWorkerRequestV3, { type: 'render' }> => (
        message.type === 'render'
      ),
    )[1]
    const secondFrame = frames[1]
    if (!secondRequest || !secondFrame) throw new Error('缺少第二次视口 Worker 请求')
    const tiles = secondFrame.plan.tiles.map((tile) => {
      const outputRect = createTileRegion(document.geometry, {
        mip: secondFrame.plan.mip,
        x: tile.tileX,
        y: tile.tileY,
      }, tile.halo).outputRect
      return { outputRect, bitmap: bitmap(outputRect.width, outputRect.height) }
    })
    workers[0].emit({
      type: 'rendered',
      requestId: secondRequest.requestId,
      sequence: secondRequest.sequence,
      renderGeneration: secondRequest.renderGeneration,
      cameraSequence: secondRequest.cameraSequence,
      geometryHash: secondRequest.geometryHash,
      revision: document.revision,
      mip: secondFrame.plan.mip,
      documentWidth: document.geometry.width,
      documentHeight: document.geometry.height,
      diagnostics: [],
      tiles,
    })
    ;(await second).release()
    expect(budget.snapshot()).toMatchObject({ totalBytes: 0, leaseCount: 0 })
    client.dispose()
  })
})
