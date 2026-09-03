import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type {
  ImageEditRasterLayerV3,
  ImageEditTransformV3,
} from '@/core/imageEdit/v3/layerTypes'

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
  if (document.color.workingSpace !== 'srgb'
    || document.color.bitDepth !== 8
    || document.color.transferFunction !== 'srgb'
    || document.color.hdrMetadata !== null) return null

  const visibleLayers = document.layers.filter((layer) => layer.visible)
  if (visibleLayers.length !== 1) return null
  const layer = visibleLayers[0]
  if (
    layer.type !== 'raster'
    || layer.source.kind !== 'resource'
    || layer.mask !== null
    || layer.opacity !== 1
    || layer.blendMode !== 'normal'
    || Object.keys(layer.tiles).length > 0
  ) return null
  return layer
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
