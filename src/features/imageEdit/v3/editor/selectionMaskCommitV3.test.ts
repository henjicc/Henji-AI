import { describe, expect, it, vi } from 'vitest'

import type { ImageEditBrushTileV3 } from '@/core/imageEdit/v3/brush/contracts'
import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import {
  IMAGE_EDITOR_SELECTION_PERSIST_BATCH_SIZE_V3,
  ImageEditorSelectionMaskCommitV3,
} from './selectionMaskCommitV3'

const OLD_RESOURCE_ID = `sha256:${'a'.repeat(64)}`

function createFixture(width = 64, height = 64) {
  const document = createImageEditDocumentV3({
    width,
    height,
    documentId: 'selection-commit-test',
  })
  const layer = createImageEditRasterLayerV3('layer', '图层')
  document.layers = [layer]
  return { bus: new ImageEditCommandBusV3(document), document, layer }
}

function persistedResourceId(index: number): string {
  return `sha256:${index.toString(16).padStart(64, '0')}`
}

function persistWithSequentialHashes() {
  let index = 1
  return vi.fn(async (tiles: ReadonlyArray<{ tileKey: string; tile: ImageEditBrushTileV3 }>) => (
    tiles.map(({ tileKey, tile }) => ({
      tileKey,
      resourceId: persistedResourceId(index++),
      byteSize: tile.data.byteLength,
    }))
  ))
}

describe('图片编辑 V3 选区蒙版原子提交', () => {
  it('无蒙版 replace 写成严格 default0 稀疏蒙版，整次手势只产生一条可撤销历史', async () => {
    const { bus, document, layer } = createFixture()
    const persistTiles = persistWithSequentialHashes()
    const resourceByteSizes = new Map<string, number>()
    const commit = new ImageEditorSelectionMaskCommitV3({
      bus,
      document,
      layer,
      shape: { type: 'rectangle', x: 2, y: 3, width: 10, height: 12 },
      combineMode: 'replace',
      resourceByteSizes,
      persistTiles,
      collectGarbage: vi.fn(),
    })

    await expect(commit.commit()).resolves.toBe(true)
    expect(persistTiles).toHaveBeenCalledOnce()
    expect(bus.getSnapshot()).toMatchObject({
      document: {
        revision: 1,
        layers: [{ mask: { kind: 'sparse-mask', defaultValue: 0 } }],
      },
      history: { undoCount: 1, redoCount: 0, retainedResourceCount: 1 },
    })
    const entry = bus.getPersistenceSnapshot().history.undo[0]
    expect(entry.forward).toMatchObject({
      type: 'layer.set-mask',
      maskResources: [{ byteSize: 64 * 64 * 4 }],
      previousMaskResources: [],
    })
    expect(JSON.stringify(entry.forward)).not.toContain('pixel')
    expect(bus.undo()).toBe(true)
    expect(bus.getSnapshot().document.layers[0].mask).toBeNull()
    expect(bus.redo()).toBe(true)
    expect(bus.getSnapshot().document.layers[0].mask).toMatchObject({ defaultValue: 0 })
  })

  it('legacy/default1 的边界外 replace 不读旧像素并清空旧资源引用', async () => {
    const { bus, document, layer } = createFixture()
    layer.mask = { resourceId: OLD_RESOURCE_ID, inverted: true }
    const persistTiles = persistWithSequentialHashes()
    const commit = new ImageEditorSelectionMaskCommitV3({
      bus,
      document,
      layer,
      shape: { type: 'rectangle', x: 100, y: 100, width: 10, height: 10 },
      combineMode: 'replace',
      resourceByteSizes: new Map([[OLD_RESOURCE_ID, 73]]),
      persistTiles,
      collectGarbage: vi.fn(),
    })

    await expect(commit.commit()).resolves.toBe(true)
    expect(persistTiles).not.toHaveBeenCalled()
    expect(bus.getSnapshot().document.layers[0].mask).toMatchObject({
      kind: 'sparse-mask', defaultValue: 0, inverted: true, tiles: {},
    })
    expect(bus.getSnapshot().history).toMatchObject({
      undoCount: 1, retainedResourceCount: 1, retainedResourceBytes: expect.any(Number),
    })
    expect(bus.getPersistenceSnapshot().history.undo[0].forward).toMatchObject({
      type: 'layer.set-mask',
      maskResources: [],
      previousMaskResources: [{ resourceId: OLD_RESOURCE_ID, byteSize: 73 }],
    })
    expect(bus.undo()).toBe(true)
    expect(bus.getSnapshot().document.layers[0].mask).toEqual({
      resourceId: OLD_RESOURCE_ID, inverted: true,
    })
  })

  it('跨 13 个瓦片时以 12+1 有界批次持久化，但只提交一条 mask delta', async () => {
    const width = 13 * 512
    const { bus, document, layer } = createFixture(width, 1)
    layer.mask = createImageEditSparseMaskReferenceV3('mask', false, 0)
    const persistTiles = persistWithSequentialHashes()
    const commit = new ImageEditorSelectionMaskCommitV3({
      bus,
      document,
      layer,
      shape: { type: 'rectangle', x: 0, y: 0, width, height: 1 },
      combineMode: 'add',
      resourceByteSizes: new Map(),
      persistTiles,
      collectGarbage: vi.fn(),
    })

    await expect(commit.commit()).resolves.toBe(true)
    expect(persistTiles.mock.calls.map(([tiles]) => tiles.length)).toEqual([
      IMAGE_EDITOR_SELECTION_PERSIST_BATCH_SIZE_V3,
      1,
    ])
    expect(bus.getSnapshot()).toMatchObject({
      document: { revision: 1 },
      history: { undoCount: 1, retainedResourceCount: 13 },
    })
    expect(bus.getPersistenceSnapshot().history.undo[0].forward).toMatchObject({
      type: 'mask.apply-tile-delta',
      changes: expect.arrayContaining([expect.objectContaining({ tileKey: '0/12/0' })]),
    })
    expect(bus.undo()).toBe(true)
    expect(bus.getSnapshot().document.layers[0].mask).toMatchObject({ tiles: {} })
  })

  it('持久化途中取消时不留下半提交，并按当前文档/历史调度孤儿回收', async () => {
    const { bus, document, layer } = createFixture()
    let releasePersist!: (value: Array<{
      tileKey: string
      resourceId: string
      byteSize: number
    }>) => void
    const gate = new Promise<Array<{
      tileKey: string
      resourceId: string
      byteSize: number
    }>>((resolve) => { releasePersist = resolve })
    let requestedKeys: string[] = []
    const persistTiles = vi.fn((tiles: ReadonlyArray<{ tileKey: string }>) => {
      requestedKeys = tiles.map(({ tileKey }) => tileKey)
      return gate
    })
    const collectGarbage = vi.fn(async () => undefined)
    const commit = new ImageEditorSelectionMaskCommitV3({
      bus,
      document,
      layer,
      shape: { type: 'rectangle', x: 0, y: 0, width: 20, height: 20 },
      combineMode: 'replace',
      resourceByteSizes: new Map(),
      persistTiles,
      collectGarbage,
    })

    const pending = commit.commit()
    await vi.waitFor(() => expect(persistTiles).toHaveBeenCalledOnce())
    commit.cancel()
    releasePersist(requestedKeys.map((tileKey) => ({
      tileKey, resourceId: persistedResourceId(99), byteSize: 16_384,
    })))

    await expect(pending).resolves.toBe(false)
    expect(bus.getSnapshot()).toMatchObject({
      document: { revision: 0, layers: [{ mask: null }] },
      history: { undoCount: 0 },
    })
    expect(collectGarbage).toHaveBeenCalledWith(document.id, [])
  })

  it('持久化返回后 revision 已变化时回收孤儿且不覆盖新文档', async () => {
    const { bus, document, layer } = createFixture()
    const collectGarbage = vi.fn(async () => undefined)
    const persistTiles = vi.fn(async (tiles: ReadonlyArray<{ tileKey: string }>) => {
      bus.dispatch({
        type: 'layer.update-common', commandId: 'concurrent-change', expectedRevision: 0,
        layerId: layer.id, patch: { opacity: 0.5 },
      })
      return tiles.map(({ tileKey }) => ({
        tileKey, resourceId: persistedResourceId(77), byteSize: 16_384,
      }))
    })
    const commit = new ImageEditorSelectionMaskCommitV3({
      bus,
      document,
      layer,
      shape: { type: 'rectangle', x: 0, y: 0, width: 20, height: 20 },
      combineMode: 'replace',
      resourceByteSizes: new Map(),
      persistTiles,
      collectGarbage,
    })

    await expect(commit.commit()).rejects.toThrow('文档已变化')
    expect(bus.getSnapshot()).toMatchObject({
      document: { revision: 1, layers: [{ opacity: 0.5, mask: null }] },
      history: { undoCount: 1 },
    })
    expect(collectGarbage).toHaveBeenCalledOnce()
  })
})
