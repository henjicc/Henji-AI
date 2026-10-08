import { ImageEditorV3CommandRepository, createImageEditorV3RequestId, persistImageEditorV3BrushTiles } from '@/commands/imageEditorV3'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import { collectImageEditLayerResourceIdsForCommandV3 } from '@/core/imageEdit/v3/commandTypes'
import { createFloat32MaskTile } from '@/core/imageEdit/v3/effects/contracts'
import { IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3 } from '@/core/imageEdit/v3/colorTypes'
import { collectImageEditMaskResourceIdsV3, createImageEditSparseMaskReferenceV3, isImageEditSparseMaskReferenceV3, type ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences'
import { createLogger } from '@/core/logging'
import { resolveAnnotationLayerToOutputMatrixV3, resolveAnnotationOutputGeometryV3, multiplyAnnotationMatricesV3, invertAnnotationMatrixV3 } from '../editor/annotationGeometryV3'
import { createImageEditorMaskBrushTileLoaderV3 } from '../editor/maskBrushTilesV3'
import { imageEditorV3SourceRegionToMask, loadImageEditorV3SourceRegion } from '../export/sourceRegion'
import { ImageEditSelectionRasterClientV3 } from '../execution/selectionRasterClientV3'
import { findImageEditV3LiveLayer } from './imageEditDocumentRefs'
import type { ImageEditCommandBusV3 } from './imageEditCommandBus'

const logger = createLogger('features.image_edit_v3.selection')

async function collectOrphanSelectionResources(bus: ImageEditCommandBusV3): Promise<void> {
  const snapshot = bus.getPersistenceSnapshot()
  try { await new ImageEditorV3CommandRepository().collectGarbage(snapshot.document.id, collectImageEditJsonResourceIdsV3(snapshot.document, snapshot.retainedResources.map(r => r.resourceId))) }
  catch (cause) { logger.warn('选区临时资源回收失败', { event: 'image_edit.selection.gc.failed', error: cause }) }
}

function layerResourceDescriptors(bus: ImageEditCommandBusV3, layer: ImageEditLayerV3, additions: { resourceId: string; byteSize: number }[]) {
  const sizes = new Map([...Object.entries(bus.getResourceByteSizes()), ...additions.map(r => [r.resourceId, r.byteSize] as const)])
  return collectImageEditLayerResourceIdsForCommandV3(layer).map(resourceId => {
    const byteSize = sizes.get(resourceId)
    if (!Number.isSafeInteger(byteSize) || !byteSize || byteSize <= 0) throw new Error('图片资源信息不完整，请重新打开原文档')
    return { resourceId, byteSize }
  })
}

/** 唯一选区消费服务：UI、通用集合和算法能力共用，先生成资源再原子提交。 */
export async function materializeImageEditSelectionMaskV3(bus: ImageEditCommandBusV3, layer: ImageEditLayerV3, parentId: string | null, mode: 'replace' | 'copy' | 'delete', signal?: AbortSignal, onProgress?: (completed: number, total: number) => void) {
  const start = bus.getSnapshot()
  if (!start.selection) throw new Error('请先创建选区')
  const mask = createImageEditSparseMaskReferenceV3(createImageEditIdV3('mask'), false, 0)
  const sizes = new Map(Object.entries(bus.getResourceByteSizes()))
  const existing = layer.mask
  if (existing && collectImageEditMaskResourceIdsV3(existing).some(id => !sizes.get(id))) throw new Error('蒙版资源信息不完整，请重新打开原文档')
  const oldLoader = mode !== 'replace' && existing && isImageEditSparseMaskReferenceV3(existing)
    ? createImageEditorMaskBrushTileLoaderV3({ document: start.document, mask: existing, resourceByteSizes: sizes }) : null
  const parent = parentId ? findImageEditV3LiveLayer(start.document, parentId) : null
  const ancestors = parent ? [parent.layer, ...parent.ancestors.slice().reverse()] : []
  const matrix = multiplyAnnotationMatricesV3(invertAnnotationMatrixV3(resolveAnnotationOutputGeometryV3(start.document).sourceToOutput), resolveAnnotationLayerToOutputMatrixV3(start.document, [layer.transform, ...ancestors.map(a => a.transform)]))
  const client = new ImageEditSelectionRasterClientV3()
  const fresh = () => {
    const now = bus.getSnapshot()
    if (signal?.aborted) throw new Error('CANCELLED')
    if (now.document.revision !== start.document.revision || now.selectionRevision !== start.selectionRevision) throw new Error('图片或选区已变化，请重新应用')
  }
  logger.info('选区栅格化开始', { event: 'image_edit.selection.materialize.start', context: { documentId: start.document.id, mode } })
  const begun = performance.now()
  try {
    const { width, height } = start.document.geometry
    const total = Math.ceil(width / 512) * Math.ceil(height / 512)
    let completed = 0
    onProgress?.(0, total)
    for (let y = 0; y < height; y += 512) for (let x = 0; x < width; x += 512) {
      fresh()
      const region = { x, y, width: Math.min(512, width - x), height: Math.min(512, height - y) }
      const data = await client.rasterize({ selection: start.selection, size: { width, height }, region, matrix }, signal)
      if (mode === 'delete') for (let i = 0; i < data.length; i++) data[i] = 1 - data[i]
      if (oldLoader) {
        const old = await oldLoader({ mip: 0, x: x / 512, y: y / 512 }, signal ?? new AbortController().signal)
        if (old.tile.storage !== 'mask-float32') throw new Error('蒙版格式不匹配')
        for (let i = 0; i < data.length; i++) data[i] *= existing?.inverted ? 1 - old.tile.data[i] : old.tile.data[i]
      } else if (mode !== 'replace' && existing && !isImageEditSparseMaskReferenceV3(existing)) {
        const color = start.document.color
        const old = imageEditorV3SourceRegionToMask(await loadImageEditorV3SourceRegion(existing.resourceId, region, start.document.geometry, 32, color.workingSpace, color.transferFunction, color.hdrMetadata?.referenceWhiteNits ?? IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3, signal ?? new AbortController().signal, {}))
        for (let i = 0; i < data.length; i++) data[i] *= existing.inverted ? 1 - old.data[i] : old.data[i]
      }
      fresh()
      if (!data.some(v => v > 0)) { onProgress?.(++completed, total); continue }
      const tileKey = `0/${x / 512}/${y / 512}`
      const persisted = await persistImageEditorV3BrushTiles({ requestId: createImageEditorV3RequestId('selection'), tiles: [{ tileKey, tile: createFloat32MaskTile(region.width, region.height, data) }] }, signal)
      fresh()
      const written = persisted.tiles[0]
      if (!written || written.tileKey !== tileKey) throw new Error('选区蒙版写入结果缺失')
      mask.tiles[tileKey] = written.resourceId
      sizes.set(written.resourceId, written.byteSize)
      onProgress?.(++completed, total)
    }
    fresh()
    logger.info('选区栅格化完成', { event: 'image_edit.selection.materialize.completed', context: { documentId: start.document.id, durationMs: performance.now() - begun } })
    const resources = collectImageEditMaskResourceIdsV3(mask).map(resourceId => ({ resourceId, byteSize: sizes.get(resourceId)! }))
    return { mask, resources, expectedRevision: start.document.revision }
  } catch (error) {
    logger.error('选区应用失败', { event: 'image_edit.selection.materialize.failed', error })
    await collectOrphanSelectionResources(bus)
    throw error
  } finally { client.dispose() }
}

export async function applyImageEditSelectionV3(bus: ImageEditCommandBusV3, layerId: string, mode: 'mask' | 'copy' | 'delete', signal?: AbortSignal, onProgress?: (completed: number, total: number) => void) {
  const location = findImageEditV3LiveLayer(bus.getSnapshot().document, layerId)
  if (!location || location.layer.locked || location.ancestors.some(a => a.locked)) throw new Error('请选择未锁定的图层')
  if (mode !== 'mask' && location.layer.type !== 'raster') throw new Error('复制或删除选区内容需要选择像素图层')
  const result = await materializeImageEditSelectionMaskV3(bus, location.layer, location.parentId, mode === 'mask' ? 'replace' : mode, signal, onProgress)
  const commandId = createImageEditIdV3('selection-apply')
  let resultLayerId = layerId
  try {
  if (mode === 'copy') {
    resultLayerId = createImageEditIdV3('layer')
    const layer = { ...structuredClone(location.layer), id: resultLayerId, name: `${location.layer.name} · 选区`, mask: result.mask }
    bus.dispatch({ type: 'layer.add', commandId, expectedRevision: result.expectedRevision, parentId: location.parentId, index: location.index + 1,
      layer, resources: layerResourceDescriptors(bus, layer, result.resources) })
  } else {
    bus.dispatch({ type: 'layer.set-mask', commandId, expectedRevision: result.expectedRevision, layerId, mask: result.mask,
      maskResources: result.resources, previousMaskResources: location.layer.mask ? collectImageEditMaskResourceIdsV3(location.layer.mask).map(resourceId => ({ resourceId, byteSize: bus.getResourceByteSizes()[resourceId] })) : [] })
  }
  return { layerId: resultLayerId, commandId }
  } catch (error) { await collectOrphanSelectionResources(bus); throw error }
}

export async function addImageEditLayerWithSelectionV3(bus: ImageEditCommandBusV3, layer: ImageEditLayerV3, parentId: string | null, index: number, signal?: AbortSignal, onProgress?: (completed: number, total: number) => void) {
  const selection = bus.getSnapshot().selection
  const result = selection && (layer.type === 'adjustment' || layer.type === 'effect')
    ? await materializeImageEditSelectionMaskV3(bus, layer, parentId, 'replace', signal, onProgress) : null
  const commandId = createImageEditIdV3('layer-add')
  const nextLayer = result ? { ...layer, mask: result.mask } : layer
  try {
  bus.dispatch({ type: 'layer.add', commandId, expectedRevision: result?.expectedRevision ?? bus.getSnapshot().document.revision, parentId, index,
    layer: nextLayer, ...(result ? { resources: layerResourceDescriptors(bus, nextLayer, result.resources) } : {}) })
  return commandId
  } catch (error) { if (result) await collectOrphanSelectionResources(bus); throw error }
}
