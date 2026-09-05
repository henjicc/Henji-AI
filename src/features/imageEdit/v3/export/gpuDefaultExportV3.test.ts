import { afterEach, describe, expect, it, vi } from 'vitest'

import { createImageEditDocumentV3 } from '@/core/imageEdit/v3'
import type { ImageEditorV3RestartableExportTileStream } from '@/commands/imageEditorV3Export'
import type {
  ImageEditorGpuSceneWorkerEventV3,
  ImageEditorGpuSceneWorkerRequestV3,
} from '../gpu/imageEditorGpuSceneProtocolV3'
import { renderImageEditorV3ExportTilesWithGpu } from './gpuDefaultExportV3'
import { ImageEditorGpuExportSessionV3, renderImageEditorV3ExportTilesFromActiveGpuScene } from './gpuExportSessionV3'
import type { ImageEditorGpuSceneClientV3Like } from '../gpu/imageEditorGpuSceneClientV3'

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
  vi.unstubAllGlobals()
  FakeWorker.latest = null
})

describe('默认 GPU 导出临时 Scene', () => {
  it('已失败的活动设备立即进入CPU事务回退，不创建第二个Worker或无限等待ready', async () => {
    vi.stubGlobal('Worker', FakeWorker)
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
    } finally {
      session.dispose()
    }
  })

  it('ready前不导出，完成后销毁Worker并注销registry', async () => {
    vi.stubGlobal('Worker', FakeWorker)
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
    expect(renderImageEditorV3ExportTilesFromActiveGpuScene(request)).toBeNull()
  })

  it.each([
    ['初始化失败', { type: 'failed', sceneGeneration: 1, deviceGeneration: 0,
      requestId: null, code: 'initialization-failed', message: 'adapter unavailable',
      recoverable: true }],
    ['设备丢失', { type: 'device-lost', sceneGeneration: 1, deviceGeneration: 2,
      reason: 'destroyed', retryAfterMs: 0 }],
  ] as const)('%s时拒绝GPU流并完整销毁临时Scene', async (_label, event) => {
    vi.stubGlobal('Worker', FakeWorker)
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
  })
})
