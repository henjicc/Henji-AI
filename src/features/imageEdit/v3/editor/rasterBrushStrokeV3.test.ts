import { describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { ImageEditorRasterBrushInputQueueV3 } from './rasterBrushInputQueueV3'
import { ImageEditorRasterBrushStrokeV3 } from './rasterBrushStrokeV3'
import {
  createImageEditorRasterBrushTargetV3,
  createImageEditorRasterBrushTileLoaderV3,
} from './rasterBrushTilesV3'
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import {
  createImageEditorMaskBrushTargetV3,
  createImageEditorMaskBrushTileLoaderV3,
} from './maskBrushTilesV3'

describe('图片编辑 V3 栅格笔画垂直切片', () => {
  it('手势期只走 PreviewOverride，抬笔批量持久化并只提交一个可撤销历史命令', async () => {
    const document = createImageEditDocumentV3({ width: 1024, height: 32, documentId: 'brush-doc' })
    const layer = createImageEditRasterLayerV3('raster-layer', '栅格图层')
    document.layers = [layer]
    const bus = new ImageEditCommandBusV3(document)
    const persistedIds = [
      `sha256:${'a'.repeat(64)}`,
      `sha256:${'b'.repeat(64)}`,
    ]
    const persistTiles = vi.fn(async (tiles: ReadonlyArray<{ tileKey: string }>) => (
      tiles.map((tile, index) => ({
        tileKey: tile.tileKey,
        resourceId: persistedIds[index],
        byteSize: 80 + index,
      }))
    ))
    const previewChanges = vi.fn()
    const committedTiles = vi.fn()
    const resourceByteSizes = new Map<string, number>()
    const stroke = new ImageEditorRasterBrushStrokeV3({
      bus,
      document,
      layerId: layer.id,
      tool: 'brush',
      shape: { size: 8, hardness: 1, opacity: 1 },
      target: createImageEditorRasterBrushTargetV3(document),
      loadTile: createImageEditorRasterBrushTileLoaderV3({
        document,
        layer,
        resourceByteSizes,
      }),
      resourceByteSizes,
      onPreviewTiles: previewChanges,
      onCommittedTiles: committedTiles,
      persistTiles,
    })

    stroke.begin()
    expect(bus.getSnapshot()).toMatchObject({
      document: { revision: 0 },
      history: { undoCount: 0 },
    })
    expect(Object.values(bus.getSnapshot().previewOverrides)).toHaveLength(1)

    await stroke.append([
      { x: 509, y: 16, screenX: 100, screenY: 20 },
      { x: 515, y: 16, screenX: 108, screenY: 20 },
    ])
    expect(previewChanges).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ tileKey: '0/0/0' }),
      expect.objectContaining({ tileKey: '0/1/0' }),
    ]))
    expect(bus.getSnapshot().document.revision).toBe(0)

    await stroke.finish()
    expect(persistTiles).toHaveBeenCalledOnce()
    expect(committedTiles).toHaveBeenCalledOnce()
    expect(persistTiles.mock.calls[0][0].map((tile) => tile.tileKey)).toEqual([
      '0/0/0',
      '0/1/0',
    ])
    expect(bus.getSnapshot()).toMatchObject({
      document: {
        revision: 1,
        layers: [{ tiles: { '0/0/0': persistedIds[0], '0/1/0': persistedIds[1] } }],
      },
      history: { undoCount: 1, redoCount: 0 },
      previewOverrides: {},
    })
    expect(resourceByteSizes).toEqual(new Map([
      [persistedIds[0], 80],
      [persistedIds[1], 81],
    ]))

    expect(bus.undo()).toBe(true)
    expect(bus.getSnapshot().document.layers[0]).toMatchObject({ tiles: {} })
    expect(bus.redo()).toBe(true)
    expect(bus.getSnapshot().document.layers[0]).toMatchObject({
      tiles: { '0/0/0': persistedIds[0], '0/1/0': persistedIds[1] },
    })
  })

  it('异步瓦片刷新期间把后续 pointer batches 合并为下一次消费', async () => {
    const calls: number[][] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const queue = new ImageEditorRasterBrushInputQueueV3(async (points) => {
      calls.push(points.map((point) => point.x))
      if (calls.length === 1) await firstGate
    })

    queue.enqueue([{ x: 1, y: 1, screenX: 1, screenY: 1 }])
    queue.enqueue([{ x: 2, y: 1, screenX: 2, screenY: 1 }])
    queue.enqueue([{ x: 3, y: 1, screenX: 3, screenY: 1 }])
    releaseFirst?.()
    await queue.flush()

    expect(calls).toEqual([[1], [2, 3]])
  })

  it('蒙版笔画复用 pointer 合并并以一条 mask delta 历史命令提交', async () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64, documentId: 'mask-brush' })
    const layer = createImageEditRasterLayerV3('masked-layer', '蒙版目标')
    layer.mask = createImageEditSparseMaskReferenceV3('mask-1', false, 0)
    document.layers = [layer]
    const bus = new ImageEditCommandBusV3(document)
    const resourceId = `sha256:${'d'.repeat(64)}`
    const stroke = new ImageEditorRasterBrushStrokeV3({
      bus,
      document,
      layerId: layer.id,
      destination: { kind: 'mask', maskId: 'mask-1' },
      tool: 'brush',
      shape: { size: 12, hardness: 1, opacity: 1 },
      target: createImageEditorMaskBrushTargetV3(),
      loadTile: createImageEditorMaskBrushTileLoaderV3({
        document,
        mask: layer.mask,
        resourceByteSizes: new Map(),
      }),
      resourceByteSizes: new Map(),
      onPreviewTiles: vi.fn(),
      persistTiles: vi.fn(async (tiles) => tiles.map(({ tileKey }) => ({
        tileKey,
        resourceId,
        byteSize: 96,
      }))),
    })

    stroke.begin()
    await stroke.append([
      { x: 8, y: 8, screenX: 8, screenY: 8 },
      { x: 18, y: 8, screenX: 18, screenY: 8 },
    ])
    await stroke.finish()

    expect(bus.getSnapshot()).toMatchObject({
      document: {
        revision: 1,
        layers: [{ mask: { maskId: 'mask-1', tiles: { '0/0/0': resourceId } } }],
      },
      history: { undoCount: 1 },
      previewOverrides: {},
    })
    expect(bus.undo()).toBe(true)
    expect(bus.getSnapshot().document.layers[0].mask).toMatchObject({ tiles: {} })
  })

  it('持久化期间取消会中止请求且不会提交陈旧 revision', async () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64, documentId: 'cancel-doc' })
    const layer = createImageEditRasterLayerV3('cancel-layer', '栅格图层')
    document.layers = [layer]
    const bus = new ImageEditCommandBusV3(document)
    let releasePersist!: (value: Array<{
      tileKey: string
      resourceId: string
      byteSize: number
    }>) => void
    const persistGate = new Promise<Array<{
      tileKey: string
      resourceId: string
      byteSize: number
    }>>((resolve) => { releasePersist = resolve })
    let persistedTileKeys: string[] = []
    let persistenceSignal: AbortSignal | undefined
    const persistTiles = vi.fn((tiles: ReadonlyArray<{ tileKey: string }>, signal: AbortSignal) => {
      persistedTileKeys = tiles.map(({ tileKey }) => tileKey)
      persistenceSignal = signal
      return persistGate
    })
    const committedTiles = vi.fn()
    const stroke = new ImageEditorRasterBrushStrokeV3({
      bus,
      document,
      layerId: layer.id,
      tool: 'brush',
      shape: { size: 8, hardness: 1, opacity: 1 },
      target: createImageEditorRasterBrushTargetV3(document),
      loadTile: createImageEditorRasterBrushTileLoaderV3({
        document,
        layer,
        resourceByteSizes: new Map(),
      }),
      resourceByteSizes: new Map(),
      onPreviewTiles: vi.fn(),
      onCommittedTiles: committedTiles,
      persistTiles,
    })

    stroke.begin()
    await stroke.append([
      { x: 8, y: 8, screenX: 8, screenY: 8 },
      { x: 16, y: 8, screenX: 16, screenY: 8 },
    ])
    const finishing = stroke.finish()
    await vi.waitFor(() => expect(persistTiles).toHaveBeenCalledOnce())
    stroke.cancel()
    expect(persistenceSignal?.aborted).toBe(true)
    releasePersist(persistedTileKeys.map((tileKey) => ({
      tileKey,
      resourceId: `sha256:${'c'.repeat(64)}`,
      byteSize: 64,
    })))

    await expect(finishing).resolves.toBeNull()
    expect(bus.getSnapshot()).toMatchObject({
      document: { revision: 0, layers: [{ tiles: {} }] },
      history: { undoCount: 0 },
      previewOverrides: {},
    })
    expect(committedTiles).not.toHaveBeenCalled()
  })
})
