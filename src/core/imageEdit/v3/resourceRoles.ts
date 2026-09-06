import type { ImageEditDocumentV3 } from './documentTypes'
import type { ImageEditCommandHistorySnapshotV3 } from './commandHistoryCodec'
import type { ImageEditCommandV3 } from './commandTypes'
import { isImageEditSparseMaskReferenceV3, type ImageEditLayerV3, type ImageEditMaskReferenceV3 } from './layerTypes'

export type ImageEditSparseResourceStorageV3 = 'rgba-float32' | 'mask-float32'

/** 只从权威字段判断用途，不按 MIME、哈希字符串或历史保留集猜资源类型。 */
export function collectImageEditResourceRolesV3(
  document: Pick<ImageEditDocumentV3, 'layers'>,
  history?: ImageEditCommandHistorySnapshotV3 | null,
): { images: ReadonlySet<string>; sparse: ReadonlyMap<string, ImageEditSparseResourceStorageV3> } {
  const images = new Set<string>()
  const sparse = new Map<string, ImageEditSparseResourceStorageV3>()
  const add = (id: string | null, storage: ImageEditSparseResourceStorageV3): void => {
    if (!id) return
    if (sparse.has(id) && sparse.get(id) !== storage) throw new Error('图片编辑同一资源的稀疏存储类型冲突')
    sparse.set(id, storage)
  }
  const mask = (value: ImageEditMaskReferenceV3 | null): void => {
    if (!value) return
    if (isImageEditSparseMaskReferenceV3(value)) Object.values(value.tiles).forEach((id) => add(id, 'mask-float32'))
    else images.add(value.resourceId)
  }
  const layer = (value: ImageEditLayerV3): void => {
    mask(value.mask)
    if (value.type === 'raster') {
      if (value.source.kind === 'resource') images.add(value.source.resourceId)
      Object.values(value.tiles).forEach((id) => add(id, 'rgba-float32'))
    } else if (value.type === 'group') value.children.forEach(layer)
  }
  const command = (value: ImageEditCommandV3): void => {
    if (value.type === 'layer.add') layer(value.layer)
    else if (value.type === 'layer.group') layer(value.group)
    else if (value.type === 'layer.set-mask') mask(value.mask)
    else if (value.type === 'raster.apply-tile-delta' || value.type === 'mask.apply-tile-delta') {
      const storage = value.type === 'raster.apply-tile-delta' ? 'rgba-float32' : 'mask-float32'
      for (const change of value.changes) { add(change.resourceId, storage); add(change.previousResourceId, storage) }
    }
  }
  document.layers.forEach(layer)
  for (const entry of [...(history?.undo ?? []), ...(history?.redo ?? [])]) {
    command(entry.forward); command(entry.inverse)
  }
  for (const id of images) if (sparse.has(id)) throw new Error('图片编辑同一资源不能同时作为图片与稀疏瓦片')
  return { images, sparse }
}
