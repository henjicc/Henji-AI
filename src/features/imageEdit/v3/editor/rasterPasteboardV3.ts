import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type {
  ImageEditRasterLayerV3,
  ImageEditTransformV3,
} from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'

const SUPPORTED_RASTER_PASTEBOARD_MEDIA_TYPES_V3 = new Set([
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
])

export const IMAGE_EDITOR_RASTER_PASTEBOARD_MAX_LAYERS_V3 = 16

function hasDirectRasterPasteboardColorV3(document: ImageEditDocumentV3): boolean {
  return document.color.workingSpace === 'srgb'
    && document.color.bitDepth === 8
    && document.color.transferFunction === 'srgb'
    && document.color.hdrMetadata === null
    && document.color.iccProfileResourceId === null
}

function isDirectRasterPasteboardLayerV3(
  layer: ImageEditDocumentV3['layers'][number],
): layer is ImageEditRasterLayerV3 {
  return layer.type === 'raster'
    && layer.source.kind === 'resource'
    && layer.mask === null
    && layer.opacity === 1
    && layer.blendMode === 'normal'
    && Object.keys(layer.tiles).length === 0
}

function hasSupportedRasterPasteboardDescriptorV3(
  layer: ImageEditRasterLayerV3,
  descriptors: ReadonlyMap<`sha256:${string}`, ImageEditorV3ResourceDescriptor>,
): boolean {
  if (layer.source.kind !== 'resource') return false
  const descriptor = descriptors.get(layer.source.resourceId as `sha256:${string}`)
  return Boolean(
    descriptor
    && descriptor.byteLength > 0
    && (
      descriptor.mediaType === null
      || SUPPORTED_RASTER_PASTEBOARD_MEDIA_TYPES_V3.has(descriptor.mediaType.toLowerCase())
    ),
  )
}

/**
 * 原始单栅格文档可以保留完整源图层，再由外层图片矩形统一裁切。
 * 这样反向移动能立即找回先前越界的像素；复杂图层仍交给受管合成器，
 * 避免用源图冒充蒙版、画笔或效果后的成品。
 */
export function resolveImageEditorRasterPasteboardLayerV3(
  document: ImageEditDocumentV3,
): ImageEditRasterLayerV3 | null {
  const { crop, orientation } = document.geometry
  if (crop || orientation.rotate !== 0 || orientation.mirrored) return null
  if (!hasDirectRasterPasteboardColorV3(document)) return null

  // sourceImageUrl 只证明“原始单图文档”的资源；多图层节点的 URL 是合成预览，
  // 即使用户隐藏到只剩一层也不能把合成图冒充该层资源。
  if (document.layers.length !== 1) return null
  const visibleLayers = document.layers.filter((layer) => layer.visible)
  if (visibleLayers.length !== 1) return null
  const layer = visibleLayers[0]
  if (!isDirectRasterPasteboardLayerV3(layer)) return null
  return layer
}

/**
 * 普通分层结果可由完整的 DOM 栅格栈精确替代稳定合成帧。
 * 只有整份可见栈都能直显时才返回，避免在旧合成帧上叠一层造成重影或层序错误。
 */
export function resolveImageEditorRasterPasteboardStackV3(
  document: ImageEditDocumentV3,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
): readonly ImageEditRasterLayerV3[] | null {
  const { crop, orientation } = document.geometry
  if (crop || orientation.rotate !== 0 || orientation.mirrored) return null
  if (!hasDirectRasterPasteboardColorV3(document)) return null

  const visibleLayers = document.layers.filter((layer) => layer.visible)
  if (
    visibleLayers.length < 1
    || document.layers.length < 2
    || visibleLayers.length > IMAGE_EDITOR_RASTER_PASTEBOARD_MAX_LAYERS_V3
    || !visibleLayers.every(isDirectRasterPasteboardLayerV3)
  ) return null

  const descriptors = new Map(resourceDescriptors.map((descriptor) => [
    descriptor.resourceRef,
    descriptor,
  ]))
  const resourcesReady = visibleLayers.every((layer) => (
    layer.type === 'raster' && hasSupportedRasterPasteboardDescriptorV3(layer, descriptors)
  ))
  return resourcesReady ? visibleLayers : null
}

/**
 * 为当前可直显文档准备稳定资源集合。隐藏一个普通层不会撤销并重读其余代理，
 * 但隐藏的复杂层与无描述资源不会被错误拉进快路径。
 */
export function resolveImageEditorRasterPasteboardResourceLayersV3(
  document: ImageEditDocumentV3,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
): readonly ImageEditRasterLayerV3[] {
  const descriptors = new Map(resourceDescriptors.map((descriptor) => [
    descriptor.resourceRef,
    descriptor,
  ]))
  const layers = document.layers.filter((layer): layer is ImageEditRasterLayerV3 => (
    isDirectRasterPasteboardLayerV3(layer)
    && hasSupportedRasterPasteboardDescriptorV3(layer, descriptors)
  ))
  return layers.length <= IMAGE_EDITOR_RASTER_PASTEBOARD_MAX_LAYERS_V3 ? layers : []
}

export function imageEditorRasterPasteboardTransformV3(
  transform: ImageEditTransformV3,
  stageWidth: number,
  documentWidth: number,
): string {
  const scale = documentWidth > 0 ? stageWidth / documentWidth : 1
  const [a, b, c, d, e, f] = transform
  const x = Number((e * scale).toFixed(6))
  const y = Number((f * scale).toFixed(6))
  return `matrix(${a}, ${b}, ${c}, ${d}, ${x}, ${y})`
}

/** 将有界代理像素映射回权威源像素，再应用文档图层矩阵与视口缩放。 */
export function imageEditorRasterProxyTransformV3(
  transform: ImageEditTransformV3,
  stageWidth: number,
  documentWidth: number,
  proxyWidth: number,
  proxyHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): string {
  const stageScale = documentWidth > 0 ? stageWidth / documentWidth : 1
  const proxyScaleX = proxyWidth > 0 ? sourceWidth / proxyWidth : 1
  const proxyScaleY = proxyHeight > 0 ? sourceHeight / proxyHeight : 1
  const [a, b, c, d, e, f] = transform
  const values = [
    a * stageScale * proxyScaleX,
    b * stageScale * proxyScaleX,
    c * stageScale * proxyScaleY,
    d * stageScale * proxyScaleY,
    e * stageScale,
    f * stageScale,
  ].map((value) => Number(value.toFixed(6)))
  return `matrix(${values.join(', ')})`
}
