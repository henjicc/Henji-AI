import { createImageEditorV3RequestId, persistImageEditorV3BrushTiles, repairImageEditorV3Raster, pinImageEditorV3RepairResources, releaseImageEditorV3RepairResources, ImageEditorV3CommandRepository } from '@/commands/imageEditorV3'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import { appendImageEditSelectionV3, type ImageEditSelectionSessionV3 } from '@/core/imageEdit/v3/selection/session'
import type { ImageEditRasterTileChangeV3 } from '@/core/imageEdit/v3/commandTypes'
import { createFloat32PremultipliedRgbaTile, type Float32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects/contracts'
import type { ImageEditRepairBitmapV3, ImageEditRepairRectV3 } from '@/core/imageEdit/v3/repair'
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences'
import { createLogger } from '@/core/logging'
import { ImageEditSelectionRasterClientV3 } from '../execution/selectionRasterClientV3'
import { ImageEditRepairPixelsClientV3 } from '../execution/repairPixelsClientV3'
import { createImageEditorRasterBrushTileLoaderV3 } from '../editor/rasterBrushTilesV3'
import { multiplyAnnotationMatricesV3, invertAnnotationMatrixV3, resolveAnnotationLayerToOutputMatrixV3, resolveAnnotationOutputGeometryV3, mapAnnotationPointV3 } from '../editor/annotationGeometryV3'
import { loadImageEditorV3SourceRegion } from '../export/sourceRegion'
import { exportCurrentImageEditSelectionV3 } from './imageEditSelectionExportV3'
import { findImageEditV3LiveLayer } from './imageEditDocumentRefs'
import type { ImageEditCommandBusV3 } from './imageEditCommandBus'

const logger = createLogger('features.image_edit_v3.repair')
const active = new WeakSet<ImageEditCommandBusV3>()
export interface ImageEditRepairOptionsV3 {
  action: 'remove' | 'repair'
  quality?: 'fast' | 'fine'
  /** 未裁剪画面比例矩形；省略时使用当前选区，不修改会话选区。 */
  rectangle?: { x: number; y: number; width: number; height: number }
  selection?: ImageEditSelectionSessionV3
  /** 干净来源的画面比例中心，保持选区形状和尺寸。 */
  sourceRegion?: { x: number; y: number }
  sourceOffset?: { x: number; y: number }
  signal?: AbortSignal
  progress?: (value: { stage: 'selecting' | 'preparing' | 'downloading' | 'processing' | 'committing'; done: number; total: number }) => void
}

/** UI 与算法能力共用：采样当前像素层（含既有补丁，不烘焙蒙版/变换/上方调整），最后一次提交。 */
export async function repairImageEditRegionV3(bus: ImageEditCommandBusV3, layerId: string, options: ImageEditRepairOptionsV3): Promise<{ layerId: string; commandId: string; durationMs: number; patchCount: number }> {
  if (active.has(bus)) throw new Error('这张图片正在修复，请先完成或取消当前修复')
  const start = bus.getSnapshot(), location = findImageEditV3LiveLayer(start.document, layerId)
  if (!location || location.layer.type !== 'raster' || location.layer.locked || location.ancestors.some(layer => layer.locked)
    || !location.layer.visible || location.ancestors.some(layer => !layer.visible)) throw new Error('请选择一个可见且未锁定的像素图层')
  const { document } = start, layer = location.layer
  if (document.color.workingSpace !== 'srgb' || document.color.hdrMetadata || !['srgb', 'linear'].includes(document.color.transferFunction)) throw new Error('当前修复仅支持标准色域图片；宽色域与 HDR 图片暂未开放修复')
  const selection = options.rectangle ? appendImageEditSelectionV3(null, { type: 'rectangle', ...options.rectangle }, 'replace') : options.selection ?? start.selection
  if (!selection) throw new Error('请先框选区域，或用移除画笔涂抹物体')
  if (options.action === 'repair' && !options.sourceRegion && !options.sourceOffset) throw new Error('请把选区拖到干净区域取样')
  const abort = new AbortController(), signal = abort.signal
  const cancel = (): void => abort.abort()
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) abort.abort()
  const fresh = (): void => {
    signal.throwIfAborted()
    const now = bus.getSnapshot()
    if (now.document.revision !== document.revision || now.selectionRevision !== start.selectionRevision) throw new Error('图片或选区已变化，请重新修复')
  }
  const monitor = bus.subscribe(() => { if (bus.getSnapshot().document.revision !== document.revision || bus.getSnapshot().selectionRevision !== start.selectionRevision) abort.abort() })
  const leaseId = createImageEditorV3RequestId('repair-lease'), begun = performance.now()
  const maskClient = new ImageEditSelectionRasterClientV3(), pixels = new ImageEditRepairPixelsClientV3()
  const sizes = new Map(Object.entries(bus.getResourceByteSizes()))
  const loader = createImageEditorRasterBrushTileLoaderV3({ document, layer, resourceByteSizes: sizes })
  const matrix = multiplyAnnotationMatricesV3(invertAnnotationMatrixV3(resolveAnnotationOutputGeometryV3(document).sourceToOutput), resolveAnnotationLayerToOutputMatrixV3(document, [layer.transform, ...location.ancestors.slice().reverse().map(parent => parent.transform)]))
  active.add(bus)
  logger.info('区域修复开始', { event: 'image_edit.repair.start', context: { documentId: document.id, layerId, action: options.action, quality: options.quality ?? 'fast' } })
  let committed = false
  try {
    fresh()
    await pinImageEditorV3RepairResources(leaseId, collectImageEditJsonResourceIdsV3(document))
    const size = await loader.resolveStorageSize(signal)
    // 复用 ie3 的流式单通道遮罩/ROI；此遍只取实际 ROI，不把整幅遮罩留在内存。
    const exportMask = exportCurrentImageEditSelectionV3(bus, signal, { selection, size, matrix })
    let count = 0
    const scans = Math.ceil(size.width / 512) * Math.ceil(size.height / 512)
    let block = await exportMask.next()
    while (!block.done) { options.progress?.({ stage: 'selecting', done: ++count, total: scans }); block = await exportMask.next() }
    const roi = block.value
    fresh()
    if (!roi) throw new Error('选区没有覆盖当前像素图层，请重新选择')
    let offset = { x: 0, y: 0 }
    if (options.sourceRegion) {
      const source = mapAnnotationPointV3(invertAnnotationMatrixV3(matrix), [options.sourceRegion.x * document.geometry.width, options.sourceRegion.y * document.geometry.height])
      offset = { x: Math.round(source[0] - roi.left - roi.width / 2), y: Math.round(source[1] - roi.top - roi.height / 2) }
      if (roi.left + offset.x < 0 || roi.top + offset.y < 0 || roi.left + roi.width + offset.x > size.width || roi.top + roi.height + offset.y > size.height) throw new Error('来源区域超出图层边界，请把整个选区拖到图内')
    }
    if (options.sourceOffset) {
      const inverse = invertAnnotationMatrixV3(matrix)
      const origin = mapAnnotationPointV3(inverse, [0, 0]), target = mapAnnotationPointV3(inverse, [options.sourceOffset.x * document.geometry.width, options.sourceOffset.y * document.geometry.height])
      offset = { x: Math.round(target[0] - origin[0]), y: Math.round(target[1] - origin[1]) }
      if (roi.left + offset.x < 0 || roi.top + offset.y < 0 || roi.left + roi.width + offset.x > size.width || roi.top + roi.height + offset.y > size.height) throw new Error('来源区域超出图层边界，请把整个选区拖到图内')
    }
    const quality = options.quality === 'fine' ? 'fine' : roi.width <= 32 && roi.height <= 32 ? 'blemish' : 'fast'
    const leftTile = Math.floor(roi.left / 512), topTile = Math.floor(roi.top / 512)
    const rightTile = Math.ceil((roi.left + roi.width) / 512), bottomTile = Math.ceil((roi.top + roi.height) / 512)
    const total = (rightTile - leftTile) * (bottomTile - topTile)
    const changes: ImageEditRasterTileChangeV3[] = []
    let done = 0
    const sample = async (region: ImageEditRepairRectV3, coverage?: Float32Array, sampleScale = 1): Promise<ImageEditRepairBitmapV3> => {
      let bitmap: ImageEditRepairBitmapV3 = { region, sampleScale, rgba: new Uint8Array(region.width * region.height * 4), mask: new Uint8Array(region.width * region.height) }
      if (coverage) { const converted = await pixels.run({ type: 'mask', bitmap, coverage }, signal); if (!converted.bitmap) throw new Error('选区遮罩结果缺失'); bitmap = converted.bitmap }
      for (let y = Math.max(0, Math.floor(region.y / 512)); y < Math.min(Math.ceil(size.height / 512), Math.ceil((region.y + region.height * sampleScale) / 512)); y++) {
        for (let x = Math.max(0, Math.floor(region.x / 512)); x < Math.min(Math.ceil(size.width / 512), Math.ceil((region.x + region.width * sampleScale) / 512)); x++) {
          fresh(); const loaded = await loader({ mip: 0, x, y }, signal)
          if (loaded.tile.storage !== 'rgba-float32') throw new Error('像素图层格式不匹配')
          const result = await pixels.run({ type: 'source', tile: loaded.tile, origin: { x: x * 512, y: y * 512 }, bitmap }, signal)
          if (!result.bitmap) throw new Error('来源像素结果缺失')
          bitmap = result.bitmap
        }
      }
      return bitmap
    }
    let guide: { tile: Float32PremultipliedRgbaTile; x: number; y: number; scale: number } | undefined
    if (options.action === 'remove') {
      // 模型的固定工作分辨率不是图片尺寸上限。整块选区共享上下文，避免大物体内部瓦片没有已知像素。
      const bounds = { x: Math.max(0, roi.left - 64), y: Math.max(0, roi.top - 64), width: 0, height: 0 }
      bounds.width = Math.min(size.width, roi.left + roi.width + 64) - bounds.x
      bounds.height = Math.min(size.height, roi.top + roi.height + 64) - bounds.y
      const scale = Math.max(1, bounds.width / 640, bounds.height / 640)
      const proxy = { x: bounds.x, y: bounds.y, width: Math.ceil(bounds.width / scale), height: Math.ceil(bounds.height / scale) }
      const proxyMatrix = multiplyAnnotationMatricesV3(matrix, [scale, 0, 0, scale, bounds.x, bounds.y])
      const coverage = await maskClient.rasterize({ selection, size: document.geometry, region: { ...proxy, x: 0, y: 0 }, matrix: proxyMatrix }, signal)
      const bitmap = await sample(proxy, coverage, scale)
      const result = await repairImageEditorV3Raster({ requestId: createImageEditorV3RequestId('repair'), leaseId, width: proxy.width, height: proxy.height,
        rgba: bitmap.rgba.buffer as ArrayBuffer, mask: bitmap.mask.buffer as ArrayBuffer, quality }, signal,
        value => options.progress?.({ stage: value.stage === 'downloading' ? 'downloading' : 'processing', done: value.done, total: value.total }))
      const tile = await loadImageEditorV3SourceRegion(result.patch.resourceRef, { x: 0, y: 0, width: proxy.width, height: proxy.height }, proxy, 8, 'srgb', document.color.transferFunction, 203, signal, {})
      guide = { tile, x: bounds.x, y: bounds.y, scale }
    }
    for (let y = topTile; y < bottomTile; y++) for (let x = leftTile; x < rightTile; x++) {
      fresh()
      const core = { x: x * 512, y: y * 512, width: Math.min(512, size.width - x * 512), height: Math.min(512, size.height - y * 512) }
      // 来源修补逐块搬运纹理；统一全局选区距离场由内核的 halo 提供，边缘始终向内融合。
      const region = options.action === 'remove' ? core : { x: Math.max(0, core.x - 64), y: Math.max(0, core.y - 64), width: 0, height: 0 }
      if (options.action === 'repair') {
        region.width = Math.min(size.width, core.x + core.width + 64) - region.x
        region.height = Math.min(size.height, core.y + core.height + 64) - region.y
      }
      options.progress?.({ stage: 'preparing', done, total })
      const coverage = await maskClient.rasterize({ selection, size: document.geometry, region, matrix }, signal)
      if (!coverage.some(value => value > 0)) { done++; continue }
      const bitmap = await sample(region, coverage)
      const sampled = options.action === 'repair' ? await sample({ ...region, x: region.x + offset.x, y: region.y + offset.y }) : undefined
      fresh()
      const result = guide ? undefined : await repairImageEditorV3Raster({ requestId: createImageEditorV3RequestId('repair'), leaseId, width: region.width, height: region.height,
        rgba: new Uint8Array(bitmap.rgba).buffer, mask: new Uint8Array(bitmap.mask).buffer, ...(sampled ? { sample: new Uint8Array(sampled.rgba).buffer } : {}), quality }, signal,
        value => options.progress?.({ stage: value.stage === 'downloading' ? 'downloading' : 'processing', done: done + value.done / Math.max(1, value.total), total }))
      fresh()
      const patch = guide?.tile ?? await loadImageEditorV3SourceRegion(result!.patch.resourceRef, { x: 0, y: 0, width: region.width, height: region.height }, region, 8, 'srgb', document.color.transferFunction, 203, signal, {})
      const original = await loader({ mip: 0, x, y }, signal)
      if (original.tile.storage !== 'rgba-float32') throw new Error('像素图层格式不匹配')
      const merged = await pixels.run({ type: 'merge', tile: original.tile, origin: { x: core.x, y: core.y }, patch, bitmap, ...(guide ? { guide: { x: guide.x, y: guide.y, scale: guide.scale } } : {}) }, signal)
      if (!merged.data) throw new Error('修复像素结果缺失')
      const tile: Float32PremultipliedRgbaTile = { ...original.tile, data: merged.data }
      const tileKey = `0/${x}/${y}`
      const saved = await persistImageEditorV3BrushTiles({ requestId: createImageEditorV3RequestId('repair-patch'), tiles: [{ tileKey, tile: createFloat32PremultipliedRgbaTile(tile.width, tile.height, tile.colorDomain, tile.data, tile.workingSpace, tile.transferFunction, tile.referenceWhiteNits) }] }, signal)
      fresh()
      const written = saved.tiles[0]
      if (!written || written.tileKey !== tileKey) throw new Error('修复补丁写入结果缺失')
      await pinImageEditorV3RepairResources(leaseId, [written.resourceId])
      if (written.resourceId !== original.resource?.resourceId) changes.push({ tileKey, previousResourceId: original.resource?.resourceId ?? null, previousByteSize: original.resource?.byteSize ?? 0, resourceId: written.resourceId, byteSize: written.byteSize })
      options.progress?.({ stage: 'processing', done: ++done, total })
    }
    fresh()
    if (!changes.length) throw new Error('修复结果没有改变图片，可以换一个来源或质量档重试')
    const commandId = createImageEditIdV3(options.action === 'remove' ? 'remove-region' : 'repair-region')
    options.progress?.({ stage: 'committing', done: total, total })
    monitor() // 原子提交本身不能被本次过期监视当作外部修改。
    bus.dispatch({ type: 'raster.apply-tile-delta', commandId, expectedRevision: document.revision, layerId, changes })
    committed = true
    const durationMs = performance.now() - begun
    logger.info('区域修复完成', { event: 'image_edit.repair.completed', context: { documentId: document.id, layerId, durationMs, patchCount: changes.length } })
    return { layerId, commandId, durationMs, patchCount: changes.length }
  } catch (error) {
    logger.warn('区域修复未提交', { event: 'image_edit.repair.failed', error, context: { documentId: document.id, cancelled: signal.aborted } })
    throw error
  } finally {
    monitor(); options.signal?.removeEventListener('abort', cancel); maskClient.dispose(); pixels.dispose(); active.delete(bus)
    try { await releaseImageEditorV3RepairResources(leaseId) } catch (error) { logger.warn('修复资源租约释放失败', { event: 'image_edit.repair.cleanup.failed', error }) }
    if (!committed) {
      const snapshot = bus.getPersistenceSnapshot()
      try { await new ImageEditorV3CommandRepository().collectGarbage(document.id, collectImageEditJsonResourceIdsV3(snapshot.document, snapshot.retainedResources.map(resource => resource.resourceId))) } catch (error) { logger.warn('修复临时资源回收失败', { event: 'image_edit.repair.cleanup.failed', error }) }
    }
  }
}
