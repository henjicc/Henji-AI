import { describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts'
import type { ImageEditorV3FastProxy } from '@/platform/contracts/imageEditorV3'
import { ImageEditorPreviewClientV3, ImageEditorPreviewSupersededErrorV3, type ImageEditorPreviewClientOptionsV3 } from './imageEditorPreviewClientV3'
import { FakePreviewWorker, bitmap, flush, waitForRender, createDocument } from './imageEditorPreviewClientV3.testSupport'

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

describe('旧代理预览的真实画笔资源与几何', () => {
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
      describePyramid: async () => ({ tileSize: 512, levels: [{ mip: 0, width: 512, height: 512, columns: 1, rows: 1 }] }),
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
      describePyramid: async () => ({ tileSize: 512, levels: [{ mip: 0, width: 512, height: 512, columns: 1, rows: 1 }] }),
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
      describePyramid: async () => ({ tileSize: 512, levels: [{ mip: 0, width: 512, height: 512, columns: 1, rows: 1 }] }),
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
