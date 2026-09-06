import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { createFloat32PremultipliedRgbaTile, createFloat32MaskTile } from '@/core/imageEdit/v3/effects/contracts'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import { collectImageEditorPreviewResourceRequestsV3 } from './previewDocumentV3'
import { ContentAddressedResourceStore } from '../../../../../electron/main/services/image-editor-v3/resource-store'
import { ImageEditBrushTileStoreV3 } from '../../../../../electron/main/services/image-editor-v3/brush-tile-store'
import { ImageEditDocumentRepository } from '../../../../../electron/main/services/image-editor-v3/document-repository'
import { describeImageEditorV3DocumentResources } from '../../../../../electron/main/services/image-editor-v3/snapshot-resources'
import { SharpSourceProvider } from '../../../../../electron/main/services/image-editor-v3/source-provider'
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes'

let directory: string
beforeEach(async () => { directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-snapshot-brush-')) })
afterEach(async () => { await fsp.rm(directory, { recursive: true, force: true }) })

it.each([16, 640])('真实资源和文档保存→新实例重开→预览规划及历史重做保持 %i 源的brush类型与存储几何', async (sourceSize) => {
  const store = new ContentAddressedResourceStore(path.join(directory, 'resources'))
  const brushes = new ImageEditBrushTileStoreV3(store)
  const source = await store.putBuffer(await sharp({ create: {
    width: sourceSize, height: sourceSize, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 },
  } }).png().toBuffer(), { mediaType: 'image/png' })
  const width = sourceSize === 16 ? 64 : 128
  const height = sourceSize === 16 ? 64 : 512
  const tileKey = sourceSize === 16 ? '0/0/0' : '0/1/0'
  const tile = createFloat32PremultipliedRgbaTile(width, height, 'linear-light', new Float32Array(width * height * 4).fill(1))
  const brush = await brushes.persistTile(tile)
  let document = createImageEditDocumentV3({ width: 64, height: 64, documentId: 'roundtrip', sourceResourceId: source.id })
  const layerId = document.layers[0].id
  const history = new ImageEditCommandHistoryV3()
  const repository = new ImageEditDocumentRepository(path.join(directory, 'documents'))
  await repository.create({ documentId: document.id, document })
  document = history.execute(document, { type: 'raster.apply-tile-delta', layerId, commandId: 'paint', expectedRevision: 0,
    changes: [{ tileKey, previousResourceId: null, previousByteSize: 0, resourceId: brush.resourceId, byteSize: brush.byteSize }] })
  for (const undo of [false, true]) {
    if (undo) document = history.undo(document).document
    await repository.save({ documentId: document.id, expectedRevision: document.revision - 1,
      document, resourceRefs: [], history: history.createSnapshot() })
    const reloaded = await new ImageEditDocumentRepository(path.join(directory, 'documents')).load(document.id)
    const reopenedStore = new ContentAddressedResourceStore(path.join(directory, 'resources'))
    const reopenedBrushes = new ImageEditBrushTileStoreV3(reopenedStore)
    const readTile = vi.spyOn(reopenedBrushes, 'readTile')
    const resources = await describeImageEditorV3DocumentResources(reloaded.document as ImageEditDocumentV3,
      reloaded.history, reloaded.resourceRefs, (ref) => reopenedStore.describe(ref), reopenedBrushes, new AbortController().signal)
    expect(resources.find((entry) => entry.resourceRef === source.id)?.mediaType).toBeNull()
    expect(resources.find((entry) => entry.resourceRef === brush.resourceId)?.mediaType).toBe('application/x-henji-brush-tile-v3')
    expect(readTile).toHaveBeenCalledOnce()
    let displayed = reloaded.document as ImageEditDocumentV3
    if (undo) {
      const restored = new ImageEditCommandHistoryV3(); restored.restore(displayed, reloaded.history)
      displayed = restored.redo(displayed).document
    }
    const pyramid = await new SharpSourceProvider(reopenedStore).describePyramid(source.id)
    expect(pyramid.levels[0]).toMatchObject({ width: sourceSize, height: sourceSize })
    const requests = collectImageEditorPreviewResourceRequestsV3(displayed, 64, resources,
      new Map([[source.id, pyramid.levels[0]]]))
    expect(requests.find((entry) => entry.kind === 'brush-tile')).toMatchObject({ width, height, tileKey })
  }
})

it('坏brush、错存储、缺失原件及未登记body引用均拒绝，不把普通原件或null MIME伪装成brush', async () => {
  const store = new ContentAddressedResourceStore(path.join(directory, 'resources'))
  const brushes = new ImageEditBrushTileStoreV3(store)
  const wrong = await store.putBuffer(Buffer.alloc(100, 7))
  const mask = await brushes.persistTile(createFloat32MaskTile(2, 2, new Float32Array(4)))
  const document = createImageEditDocumentV3({ width: 2, height: 2, documentId: 'invalid' })
  document.layers = [createImageEditRasterLayerV3('raster', '错误资源')]
  const layer = document.layers[0]
  if (layer.type !== 'raster') throw new Error('fixture')
  for (const id of [wrong.id, mask.resourceId as typeof wrong.id]) {
    layer.tiles = { '0/0/0': id }
    await expect(describeImageEditorV3DocumentResources(document, undefined, [id],
      (ref) => store.describe(ref), brushes, new AbortController().signal)).rejects.toThrow()
  }
  await expect(describeImageEditorV3DocumentResources(document, undefined, [],
    (ref) => store.describe(ref), brushes, new AbortController().signal)).rejects.toThrow('未登记')
  const missing = `sha256:${'f'.repeat(64)}` as const
  layer.tiles = { '0/0/0': missing }
  await expect(describeImageEditorV3DocumentResources(document, undefined, [missing],
    (ref) => store.describe(ref), brushes, new AbortController().signal)).rejects.toThrow()
})

it('正式稀疏蒙版恢复类型，普通源和ICC不被改标；取消解码释放已取得的租约', async () => {
  const store = new ContentAddressedResourceStore(path.join(directory, 'resources'))
  const brushes = new ImageEditBrushTileStoreV3(store)
  const source = await store.putBuffer(Buffer.from('ordinary source'))
  const unrelated = await store.putBuffer(Buffer.from('unclassified resource'))
  const mask = await brushes.persistTile(createFloat32MaskTile(2, 2, new Float32Array(4)))
  const document = createImageEditDocumentV3({ width: 2, height: 2, sourceResourceId: source.id })
  document.color.iccProfileResourceId = unrelated.id
  document.layers[0].mask = { ...createImageEditSparseMaskReferenceV3('mask'), tiles: { '0/0/0': mask.resourceId } }
  const refs = [source.id, unrelated.id, mask.resourceId as typeof source.id]
  const descriptors = await describeImageEditorV3DocumentResources(document, undefined, refs,
    (ref) => store.describe(ref), brushes, new AbortController().signal)
  expect(descriptors.map((entry) => entry.mediaType)).toEqual([null, null, 'application/x-henji-brush-tile-v3'])
  const controller = new AbortController()
  const acquire = store.acquireLease.bind(store)
  const released = vi.fn()
  vi.spyOn(store, 'acquireLease').mockImplementation(async (ids) => {
    const lease = await acquire(ids)
    controller.abort()
    return { ...lease, release: async () => { await lease.release(); released() } }
  })
  await expect(describeImageEditorV3DocumentResources(document, undefined, refs,
    (ref) => store.describe(ref), brushes, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(released).toHaveBeenCalledOnce()
})
