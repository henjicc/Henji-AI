import { readClipboardImage } from '@/commands/clipboard'
import { createImageEditorV3RequestId, ingestImageEditorV3Source, loadImageEditorV3Document, pinImageEditorV3RepairResources, releaseImageEditorV3RepairResources } from '@/commands/imageEditorV3'
import { materializeImageEditorV3StandaloneRaster } from '@/commands/imageEditorV3Export'
import { createImageEditGroupLayerV3, createImageEditIdV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { applyImageEditCommandV3 } from '@/core/imageEdit/v3/commandReducer'
import { collectImageEditLayerResourceIdsForCommandV3 } from '@/core/imageEdit/v3/commandTypes'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import { getPlatform } from '@/platform/runtime'
import { createImageEditDuplicateIdMapV3 } from '../editor/layerTreeV3'
import { findImageEditDocumentInstanceV3 } from './imageEditDocumentInstances'
import { createImageMarkV3RasterExportSpec } from './imageEditRasterExportSpecV3'
import { materializeImageEditSelectionMaskV3 } from './imageEditSelectionServiceV3'
import type { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { createLogger } from '@/core/logging'
import { collectImageEditResourceRolesV3 } from '@/core/imageEdit/v3/resourceRoles'
import { IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE } from './imageEditorResourceDescriptorsV3'

const logger = createLogger('features.imageEdit.v3.clipboard')
let editableCopy: { dataUrl: string; layer: ImageEditLayerV3; sizes: Readonly<Record<string, number>>; lease: string } | undefined

/** 保留选中子树及其父组的变换、透明度和蒙版，复制不改变原文档。 */
export function projectImageEditClipboardLayersV3(layers: readonly ImageEditLayerV3[], selected: ReadonlySet<string>): ImageEditLayerV3[] {
  return layers.flatMap(layer => {
    if (selected.has(layer.id)) return [structuredClone(layer)]
    if (layer.type !== 'group') return []
    const children = projectImageEditClipboardLayersV3(layer.children, selected)
    return children.length ? [{ ...structuredClone(layer), children }] : []
  })
}

async function clearEditableCopy(): Promise<void> {
  const previous = editableCopy; editableCopy = undefined
  if (previous) await releaseImageEditorV3RepairResources(previous.lease)
}

export async function copyImageEditClipboardV3(bus: ImageEditCommandBusV3, layerIds: readonly string[], merged = false, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const start = bus.getSnapshot()
  const document = structuredClone(start.document)
  if (!merged) document.layers = projectImageEditClipboardLayersV3(document.layers, new Set(layerIds))
  if (!document.layers.length) throw new Error('请先选择要复制的图层')
  const group = createImageEditGroupLayerV3(createImageEditIdV3('clipboard'), start.selection ? '选区内容' : merged ? '合成结果' : '复制的图层')
  group.children = document.layers
  let sizes = { ...bus.getResourceByteSizes() }
  if (start.selection) {
    const selection = await materializeImageEditSelectionMaskV3(bus, group, null, 'copy', signal)
    group.mask = selection.mask
    sizes = { ...sizes, ...Object.fromEntries(selection.resources.map(resource => [resource.resourceId, resource.byteSize])) }
  }
  document.layers = [group]
  const lease = createImageEditIdV3('clipboard-lease')
  const ids = collectImageEditLayerResourceIdsForCommandV3(group)
  await pinImageEditorV3RepairResources(lease, ids)
  try {
    const owner = findImageEditDocumentInstanceV3(document.id)?.persistenceOwner
    if (!owner) throw new Error('图片尚未就绪，请稍后复制')
    await owner.confirm(false)
    const snapshot = await loadImageEditorV3Document({ requestId: createImageEditorV3RequestId('clipboard-read'), documentRef: `image-edit-v3:${document.id}` }, signal)
    if (!snapshot || snapshot.revision !== start.document.revision) throw new Error('图片已变化，请重新复制')
    const { prepareImageEditorV3ExportRender, renderImageEditorV3ExportTilesWithGpu } = await import('../export')
    const spec = createImageMarkV3RasterExportSpec(document, 'clipboard.png', { format: 'png8' })
    prepareImageEditorV3ExportRender(document, spec.description)
    const sparse = collectImageEditResourceRolesV3(document).sparse
    const resources = Object.entries(sizes).map(([resourceRef, byteLength]) => ({ resourceRef: resourceRef as `sha256:${string}`, byteLength,
      mediaType: sparse.has(resourceRef) ? IMAGE_EDITOR_V3_BRUSH_TILE_MEDIA_TYPE : null }))
    const result = await materializeImageEditorV3StandaloneRaster({ documentRef: snapshot.documentRef, revision: snapshot.revision,
      sourceFingerprint: snapshot.sourceFingerprint, format: spec.format, description: spec.description, tileSize: 512,
      tiles: renderImageEditorV3ExportTilesWithGpu({ document, resourceDescriptors: resources, description: spec.description, tileSize: 512, signal }) }, signal)
    signal?.throwIfAborted()
    try { await getPlatform().clipboard.writeImageFromSource(result.imagePath) }
    finally { await getPlatform().image.releaseManagedGenerationMedia(result.createdFilePaths) }
    const image = await readClipboardImage()
    if (!image) throw new Error('复制后未能读回剪贴板图片，请重试')
    await clearEditableCopy()
    if (image && !merged) {
      editableCopy = { dataUrl: image.dataUrl, layer: group, sizes, lease }
      bus.getLifecycleSignal().addEventListener('abort', () => {
        if (editableCopy?.lease === lease) void clearEditableCopy().catch(error => logger.warn('释放剪贴板资源失败', { event: 'image_edit.clipboard.release.failed', error }))
      }, { once: true })
    } else await releaseImageEditorV3RepairResources(lease)
    logger.info('图片已复制', { event: 'image_edit.clipboard.copy.completed', context: { merged, selection: Boolean(start.selection) } })
  } catch (error) { await releaseImageEditorV3RepairResources(lease); throw error }
}

export async function pasteImageEditClipboardV3(bus: ImageEditCommandBusV3, signal?: AbortSignal): Promise<string> {
  const image = await readClipboardImage()
  if (!image) throw new Error('剪贴板中没有图片')
  signal?.throwIfAborted()
  let layer: ImageEditLayerV3
  let sizes: Readonly<Record<string, number>>
  if (editableCopy?.dataUrl === image.dataUrl) {
    const copy = editableCopy
    const document = { ...bus.getSnapshot().document, layers: [structuredClone(copy.layer)] }
    const idMap = createImageEditDuplicateIdMapV3(copy.layer)
    const result = applyImageEditCommandV3(document, { type: 'layer.duplicate', commandId: createImageEditIdV3('clipboard-clone'),
      expectedRevision: document.revision, layerId: copy.layer.id, parentId: null, index: 1, idMap,
      resources: collectImageEditLayerResourceIdsForCommandV3(copy.layer).map(resourceId => ({ resourceId, byteSize: copy.sizes[resourceId] })) })
    layer = result.document.layers[1]; sizes = copy.sizes
  } else {
    await clearEditableCopy()
    const source = await ingestImageEditorV3Source({ requestId: createImageEditorV3RequestId('clipboard-paste'), source: { kind: 'data-url', dataUrl: image.dataUrl } }, signal)
    layer = createImageEditRasterLayerV3(createImageEditIdV3('layer'), image.name || '粘贴的图片', source.resource.resourceRef)
    layer.rasterCanvasSize = { width: source.metadata.width, height: source.metadata.height }
    const geometry = bus.getSnapshot().document.geometry
    layer.transform = [1,0,0,1, (geometry.width - source.metadata.width) / 2, (geometry.height - source.metadata.height) / 2]
    sizes = { [source.resource.resourceRef]: source.resource.byteLength }
  }
  signal?.throwIfAborted()
  const current = bus.getSnapshot().document
  bus.dispatch({ type: 'layer.add', commandId: createImageEditIdV3('clipboard-paste'), expectedRevision: current.revision,
    parentId: null, index: current.layers.length, layer, resources: collectImageEditLayerResourceIdsForCommandV3(layer).map(resourceId => ({ resourceId, byteSize: sizes[resourceId] })) })
  logger.info('图片已粘贴为新图层', { event: 'image_edit.clipboard.paste.completed' })
  return layer.id
}
