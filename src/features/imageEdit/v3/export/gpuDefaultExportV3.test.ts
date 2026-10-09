import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3'
import type { ImageEditorV3RestartableExportTileStream } from '@/commands/imageEditorV3Export'
import type {
  ImageEditorGpuSceneWorkerEventV3,
  ImageEditorGpuSceneWorkerRequestV3,
} from '../gpu/imageEditorGpuSceneProtocolV3'
import { renderImageEditorV3ExportTilesWithGpu } from './gpuDefaultExportV3'
import { ImageEditorGpuExportSessionV3, renderImageEditorV3ExportTilesFromActiveGpuScene } from './gpuExportSessionV3'
import type { ImageEditorGpuSceneClientV3Like } from '../gpu/imageEditorGpuSceneClientV3'
import { buildCpuRegionTestWorkerV3, CpuRegionNodeTestWorkerV3 } from '../../../../core/imageEdit/v3/execution/cpuRegionWorker.testSupport'

class FakeWorker {
  static latest: FakeWorker | null = null
  onmessage: ((event: MessageEvent<ImageEditorGpuSceneWorkerEventV3>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: ImageEditorGpuSceneWorkerRequestV3[] = []
  terminated = false

  constructor() { FakeWorker.latest = this }

  postMessage(message: ImageEditorGpuSceneWorkerRequestV3): void { this.messages.push(message) }
  terminate(): void { this.terminated = true }
  emit(event: ImageEditorGpuSceneWorkerEventV3): void {
    this.onmessage?.({ data: event } as MessageEvent<ImageEditorGpuSceneWorkerEventV3>)
  }
}

let cpuWorkerCode: string
const cpuWorkers: CpuRegionNodeTestWorkerV3[] = []
beforeAll(async () => { cpuWorkerCode = await buildCpuRegionTestWorkerV3() })
beforeEach(() => {
  // GPU 事件由用例驱动；CPU 回退必须执行正式 runtime，不能被 GPU 消息替身吞掉。
  vi.stubGlobal('Worker', vi.fn(function (url: URL) {
    if (url.pathname.endsWith('/cpuRenderRegion.worker.ts')) {
      const worker = new CpuRegionNodeTestWorkerV3(cpuWorkerCode)
      vi.spyOn(worker, 'terminate')
      cpuWorkers.push(worker)
      return worker
    }
    if (url.pathname.endsWith('/imageEditorGpuScene.worker.ts')) return new FakeWorker()
    throw new Error(`未适配的测试 Worker：${url.pathname}`)
  }))
})

const document = createImageEditDocumentV3({
  width: 16, height: 16, documentId: 'ephemeral-export-document',
})
const request = {
  document,
  resourceDescriptors: [],
  description: {
    width: 16,
    height: 16,
    bitDepth: 8 as const,
    sampleFormat: 'uint' as const,
    colorSpace: 'srgb' as const,
    transferFunction: 'srgb' as const,
    alphaMode: 'straight' as const,
  },
  tileSize: 16,
}

afterEach(() => {
  cpuWorkers.forEach(worker => worker.terminate())
  cpuWorkers.length = 0
  FakeWorker.latest?.terminate()
  vi.unstubAllGlobals()
  FakeWorker.latest = null
})

describe('默认 GPU 导出临时 Scene', () => {
  it('没有Worker的环境直接完成CPU导出，不等待线程消息', async () => {
    vi.stubGlobal('Worker', undefined)
    const tiles = []
    for await (const tile of renderImageEditorV3ExportTilesWithGpu(request)) tiles.push(tile)
    expect(tiles).toHaveLength(1)
    expect(tiles[0].pixels).toEqual(new Uint8Array(1024))
    expect(FakeWorker.latest).toBeNull()
    expect(cpuWorkers).toHaveLength(0)
  })

  it('已失败的活动设备立即进入CPU事务回退，不创建第二个Worker或无限等待ready', async () => {
    const client: ImageEditorGpuSceneClientV3Like = {
      syncScene: vi.fn(), uploadTiles: vi.fn(), updateTransientLayerTransform: vi.fn(),
      clearTransientLayerTransform: vi.fn(), updateViewport: vi.fn(), requestFrame: vi.fn(),
      subscribe: vi.fn(() => () => undefined), dispose: vi.fn(),
      requestExport: vi.fn(), cancelExport: vi.fn(), acknowledgeExportTile: vi.fn(),
    }
    const session = new ImageEditorGpuExportSessionV3(client)
    session.syncSnapshot({ document, renderGeneration: 1, geometryHash: 'a', quality: 'stable', resourceDescriptors: [] })
    const failure = new Error('Reality 注入：GPU 初始化失败')
    session.notifyDeviceUnavailable(failure, true)
    try {
      const stream = renderImageEditorV3ExportTilesWithGpu(request) as ImageEditorV3RestartableExportTileStream
      await expect(stream[Symbol.asyncIterator]().next()).rejects.toBe(failure)
      expect(FakeWorker.latest).toBeNull()
      expect(client.requestExport).not.toHaveBeenCalled()
      const tiles = []
      for await (const tile of stream.createCpuFallback(failure)) tiles.push(tile)
      expect(tiles).toHaveLength(1)
      expect(tiles[0]).toMatchObject({ x: 0, y: 0, width: 16, height: 16 })
      expect(tiles[0].pixels).toEqual(new Uint8Array(1024))
      expect(FakeWorker.latest).toBeNull()
      expect(cpuWorkers).toHaveLength(1)
      expect(cpuWorkers[0].terminate).toHaveBeenCalledOnce()
    } finally {
      session.dispose()
    }
  })

  it('ready前不导出，完成后销毁Worker并注销registry', async () => {
    const stream = renderImageEditorV3ExportTilesWithGpu(request) as
      ImageEditorV3RestartableExportTileStream
    const worker = FakeWorker.latest!
    expect(worker.messages.map((entry) => entry.type)).toEqual(['initialize', 'sync-scene'])
    const iterator = stream[Symbol.asyncIterator]()
    const waiting = iterator.next()
    expect(worker.messages.some((entry) => entry.type === 'export')).toBe(false)

    worker.emit({ type: 'ready', sceneGeneration: 1, deviceGeneration: 1, recovered: false })
    const exportRequest = worker.messages.find((entry) => entry.type === 'export')
    expect(exportRequest?.type).toBe('export')
    if (exportRequest?.type !== 'export') throw new Error('缺少导出请求')
    worker.emit({
      type: 'export-tile', sceneGeneration: 1, deviceGeneration: 1,
      requestId: exportRequest.requestId, tileX: 0, tileY: 0,
      x: 0, y: 0, width: 16, height: 16, rowStride: 64,
      pixels: new ArrayBuffer(1024), completed: true,
    })
    await expect(waiting).resolves.toMatchObject({ value: { x: 0, y: 0 }, done: false })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })

    expect(worker.messages.at(-1)).toMatchObject({ type: 'dispose' })
    expect(worker.terminated).toBe(true)
    expect(cpuWorkers).toHaveLength(0)
    expect(renderImageEditorV3ExportTilesFromActiveGpuScene(request)).toBeNull()
  })

  it.each([
    ['初始化失败', { type: 'failed', sceneGeneration: 1, deviceGeneration: 0,
      requestId: null, code: 'initialization-failed', message: 'adapter unavailable',
      recoverable: true }],
    ['设备丢失', { type: 'device-lost', sceneGeneration: 1, deviceGeneration: 2,
      reason: 'destroyed', retryAfterMs: 0 }],
  ] as const)('%s时拒绝GPU流并完整销毁临时Scene', async (_label, event) => {
    const stream = renderImageEditorV3ExportTilesWithGpu(request) as
      ImageEditorV3RestartableExportTileStream
    const worker = FakeWorker.latest!
    const waiting = stream[Symbol.asyncIterator]().next()
    worker.emit(event)

    await expect(waiting).rejects.toThrow()
    await vi.waitFor(() => expect(worker.terminated).toBe(true))
    expect(worker.messages.at(-1)).toMatchObject({ type: 'dispose' })
    expect(renderImageEditorV3ExportTilesFromActiveGpuScene(request)).toBeNull()
    expect(stream.createCpuFallback(new Error('gpu failed'))).toBeDefined()
    const tiles = []
    for await (const tile of stream.createCpuFallback(new Error('gpu failed'))) tiles.push(tile)
    expect(tiles).toHaveLength(1)
    expect(tiles[0].pixels).toEqual(new Uint8Array(1024))
    expect(FakeWorker.latest).toBe(worker)
    expect(cpuWorkers).toHaveLength(1)
    expect(cpuWorkers[0].terminate).toHaveBeenCalledOnce()
  })
})
