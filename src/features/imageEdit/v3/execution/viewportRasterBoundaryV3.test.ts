import { describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, ImageEditRenderScheduler, ImageEditResourceBudget, IMAGE_EDIT_RENDER_PRIORITY } from '@/core/imageEdit/v3'
import { prepareImageEditorViewportCompositeV3, createImageEditorViewportSourceTileRequestsV3,
  estimateImageEditorViewportWorkingRegionPixelsV3 } from './viewportCompositeDocumentV3'
import { planImageEditorViewportTilesV3 } from './viewportTilePlannerV3'
import { ImageEditorViewportCompositeClientV3 } from './viewportCompositeClientV3'
import { FakeViewportWorker, RESOURCE, createFrame, flushUntil, RENDER_IDENTITY } from './viewportCompositeClientV3.testSupport'

const BRUSH = `sha256:${'f'.repeat(64)}` as const
describe('视口共享像素源的边界预算与缩略图优先级', () => {
  it('薄图mip10跨画笔边界只补读必要的mip0块，并预留真实解码大小', () => {
    const document = createImageEditDocumentV3({ width: 1024, height: 1, sourceResourceId: RESOURCE })
    const layer = document.layers[0]
    if (layer.type !== 'raster') throw new Error('缺少栅格层')
    layer.tiles['0/1/0'] = BRUSH
    const prepared = prepareImageEditorViewportCompositeV3(document, 'stable',
      [{ resourceRef: BRUSH, byteLength: 8192, mediaType: 'application/x-henji-brush-tile-v3' }])
    const candidate = planImageEditorViewportTilesV3({ documentSize: document.geometry,
      pyramid: { tileSize: 512, levels: Array.from({ length: 11 }, (_, mip) => ({ mip,
        width: 1024 / 2 ** mip, height: 1, columns: Math.ceil(1024 / 2 ** mip / 512), rows: 1 })) },
      preferredMip: 10, bitDepth: 8, viewport: { documentX: 0, documentY: 0, width: 1, height: 1, zoom: 1 / 1024, devicePixelRatio: 1 } })
    const sizes = new Map([[RESOURCE, { width: 1024, height: 1 }]])
    const requests = createImageEditorViewportSourceTileRequestsV3(prepared, candidate, 8, false, sizes)
    expect(requests.map(({ mip, tileX, width, height }) => ({ mip, tileX, width, height })))
      .toEqual([{ mip: 10, tileX: 0, width: 1, height: 1 }, { mip: 0, tileX: 0, width: 512, height: 1 }])
    expect(estimateImageEditorViewportWorkingRegionPixelsV3(
      prepared,
      candidate,
      false,
      sizes,
      new Map([[RESOURCE, 10]]),
      requests.reduce((total, tile) => total + tile.width * tile.height, 0),
    )).toBe(513)
  })

  it('小原图全局分析仍按文档输出尺寸预留，不能只预算16像素原图', () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64, sourceResourceId: RESOURCE })
    const prepared = prepareImageEditorViewportCompositeV3(document, 'stable', [])
    expect(estimateImageEditorViewportWorkingRegionPixelsV3(prepared,
      { mip: 0, tiles: [], estimatedBytes: 0 }, true,
      new Map([[RESOURCE, { width: 16, height: 16 }]]),
      new Map([[RESOURCE, 0]]))).toBe(64 * 64)
  })

  it('缩略图复用真实viewport客户端时登记为prefetch，而不是抢占前台target优先级', async () => {
    const frame = createFrame(64, 64), worker = new FakeViewportWorker()
    const scheduler = new ImageEditRenderScheduler(), schedule = vi.spyOn(scheduler, 'schedule')
    const client = new ImageEditorViewportCompositeClientV3({ sessionId: 'thumbnail-priority', purpose: 'thumbnail',
      resourceBudget: new ImageEditResourceBudget(), renderScheduler: scheduler, workerFactory: () => worker,
      scheduler: { render: vi.fn(async () => frame), cancel: vi.fn(), dispose: vi.fn() } })
    const pending = client.render({ document: createImageEditDocumentV3({ width: 64, height: 64, sourceResourceId: RESOURCE }),
      ...RENDER_IDENTITY, quality: 'stable', resourceDescriptors: [], viewportKey: 'thumbnail', phase: 'target', coverage: 'document',
      viewport: { documentX: 0, documentY: 0, width: 64, height: 64, zoom: 1, devicePixelRatio: 1 } })
    const rejected = expect(pending).rejects.toThrow()
    await flushUntil(() => schedule.mock.calls.length === 1)
    expect(schedule.mock.calls[0][0]).toMatchObject({ kind: 'prefetch', purpose: 'thumbnail',
      coalescingKey: 'thumbnail', priority: IMAGE_EDIT_RENDER_PRIORITY.prefetch })
    client.dispose()
    await rejected
  })
})
