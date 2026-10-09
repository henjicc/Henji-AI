import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ImageEditCommandHistoryV3 } from '../../../../src/core/imageEdit/v3/commandHistory'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../../../../src/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '../../../../src/core/imageEdit/v3/documentTypes'
import { createFloat32MaskTile } from '../../../../src/core/imageEdit/v3/effects/contracts'
import { createImageEditSparseMaskReferenceV3 } from '../../../../src/core/imageEdit/v3/layerTypes'
import { ImageEditBrushTileStoreV3 } from './brush-tile-store'
import { ImageEditDocumentRepository } from './document-repository'
import { ContentAddressedResourceStore } from './resource-store'
import { HenjiImagePackageCodec } from './package-codec'
import { rewriteImageDocumentPackageHeader } from './image-document/package-file'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) await fsp.rm(directory, { recursive: true, force: true })
})

it.each(['layer', 'filter'] as const)('删除 %s 后的历史资源经过撤销重做、分叉、包副本、解包与 GC 后仍可冷重开', async (kind) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-resource-history-'))
  directories.push(root)
  const resources = new ContentAddressedResourceStore(path.join(root, 'resources'))
  const brushes = new ImageEditBrushTileStoreV3(resources)
  const pixels = new Float32Array([0, .25, .75, 1])
  const tile = await brushes.persistTile(createFloat32MaskTile(2, 2, pixels))
  const mask = { ...createImageEditSparseMaskReferenceV3('mask'), tiles: { '0/0/0': tile.resourceId } }
  let document = createImageEditDocumentV3({ width: 2, height: 2, documentId: 'source' })
  const layer = createImageEditRasterLayerV3('content', '内容')
  if (kind === 'layer') layer.mask = mask
  else layer.filters = [{ id: 'exposure', operationType: 'adjustment', effectId: 'exposure', params: { stops: .5 },
    enabled: true, opacity: 1, blendMode: 'normal', mask }]
  document.layers.push(layer)
  const documents = new ImageEditDocumentRepository(path.join(root, 'documents'), { resources })
  await documents.create({ documentId: document.id, document })
  const history = new ImageEditCommandHistoryV3()
  const command = { commandId: 'delete', expectedRevision: 0, layerId: layer.id,
    resources: [{ resourceId: tile.resourceId, byteSize: tile.byteSize }] }
  document = history.execute(document, kind === 'layer'
    ? { ...command, type: 'layer.delete' }
    : { ...command, type: 'layer.update-common', patch: { filters: [] } })
  const save = async (): Promise<void> => {
    await documents.save({ documentId: document.id, expectedRevision: document.revision - 1,
      document, resourceRefs: [], history: history.createSnapshot() })
    const roots = new Set((await documents.list()).flatMap(entry => entry.resourceRefs))
    expect(roots.has(tile.resourceId as `sha256:${string}`)).toBe(true)
    expect((await resources.garbageCollect(roots, { minimumAgeMs: 0 })).deleted).not.toContain(tile.resourceId)
  }
  await save()
  document = history.undo(document).document
  await save()
  document = history.redo(document).document
  await save()

  // 另存为与引用式副本共用 fork；移除原文档后只用分叉的根保护历史瓦片与页。
  await documents.fork({ sourceDocumentRef: 'image-edit-v3:source', expectedRevision: document.revision, targetDocumentId: 'fork' })
  expect(await documents.deleteIfRevision('source', document.revision)).toBe(true)
  const forkRoots = new Set((await documents.list()).flatMap(entry => entry.resourceRefs))
  expect((await resources.garbageCollect(forkRoots, { minimumAgeMs: 0 })).deleted).not.toContain(tile.resourceId)
  const archive = path.join(root, 'fork.henjiimg')
  await new HenjiImagePackageCodec(resources).export({ targetPath: archive, document: await documents.loadCheckpoint('fork') })
  // 通用文档复制会重写包头/文档 ID，资源及分页仍原样保留。
  await rewriteImageDocumentPackageHeader(archive, { id: 'package-copy' })
  const importedResources = new ContentAddressedResourceStore(path.join(root, 'imported-resources'))
  const importedDocuments = new ImageEditDocumentRepository(path.join(root, 'imported-documents'), { resources: importedResources })
  const imported = await new HenjiImagePackageCodec(importedResources).import(archive)
  try {
    expect((await importedResources.garbageCollect(new Set(), { minimumAgeMs: 0 })).deleted).toEqual([])
    await importedDocuments.replace(imported.manifest.document)
  } finally { await imported.resourceLease.release() }
  const importedRoots = new Set((await importedDocuments.list()).flatMap(entry => entry.resourceRefs))
  expect((await importedResources.garbageCollect(importedRoots, { minimumAgeMs: 0 })).deleted).not.toContain(tile.resourceId)

  const reopenedResources = new ContentAddressedResourceStore(importedResources.rootDir)
  const reopened = await new ImageEditDocumentRepository(importedDocuments.rootDir, { resources: reopenedResources }).load('package-copy')
  const restored = new ImageEditCommandHistoryV3()
  restored.restore(reopened.document as ImageEditDocumentV3, reopened.history)
  const undone = restored.undo(reopened.document as ImageEditDocumentV3).document
  const restoredLayer = undone.layers.find(item => item.id === layer.id)
  expect(kind === 'layer' ? restoredLayer?.mask : restoredLayer?.filters[0].mask).toEqual(mask)
  expect((await new ImageEditBrushTileStoreV3(reopenedResources).readTile(tile)).data).toEqual(pixels)
  expect(restored.redo(undone).document.layers).toEqual((reopened.document as ImageEditDocumentV3).layers)
})
