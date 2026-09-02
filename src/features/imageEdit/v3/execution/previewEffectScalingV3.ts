import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'

const MAX_BLUR_PREVIEW_MIP = 3
const MIN_BLUR_RADIUS_AT_PREVIEW_MIP = 4
const MAX_DISPLAY_PIXELS_PER_BLUR_PREVIEW_PIXEL = 3

function finiteRadius(layer: ImageEditLayerV3): number | null {
  if (layer.type !== 'effect' || !layer.visible || !layer.renderable || layer.opacity <= 0) return null
  const value = layer.effectId === 'image.blur'
    ? layer.params.radiusPixels
    : layer.effectId === 'image.gaussian-blur-v2' || layer.effectId === 'image.fast-blur-v3'
      ? layer.params.radius
      : null
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function maximumVisibleBlurRadius(layers: readonly ImageEditLayerV3[]): number {
  let maximum = 0
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue
    if (layer.type === 'group') {
      maximum = Math.max(maximum, maximumVisibleBlurRadius(layer.children))
      continue
    }
    maximum = Math.max(maximum, finiteRadius(layer) ?? 0)
  }
  return maximum
}

/**
 * 模糊预览允许在保证单个 mip 像素不会被放大成明显方块的前提下降采样。
 * 导出不经过此策略；放大检查细节时自动回到更细 mip。
 */
export function resolveImageEditorBlurPreviewMipV3(
  document: ImageEditDocumentV3,
  viewport: { zoom: number; devicePixelRatio: number },
): number | undefined {
  const radius = maximumVisibleBlurRadius(document.layers)
  if (radius <= 0) return undefined
  const physicalPixelsPerDocumentPixel = viewport.zoom * viewport.devicePixelRatio
  if (!Number.isFinite(physicalPixelsPerDocumentPixel) || physicalPixelsPerDocumentPixel <= 0) {
    throw new Error('模糊预览显示倍率必须是正数')
  }
  const naturalMip = physicalPixelsPerDocumentPixel >= 1
    ? 0
    : Math.max(0, Math.floor(Math.log2(1 / physicalPixelsPerDocumentPixel)))
  const radiusMip = Math.max(0, Math.floor(
    Math.log2(radius / MIN_BLUR_RADIUS_AT_PREVIEW_MIP),
  ))
  const displayMip = Math.max(0, Math.floor(Math.log2(
    MAX_DISPLAY_PIXELS_PER_BLUR_PREVIEW_PIXEL / physicalPixelsPerDocumentPixel,
  )))
  return Math.max(
    naturalMip,
    Math.min(MAX_BLUR_PREVIEW_MIP, radiusMip, displayMip),
  )
}

function scaleLayers(
  layers: readonly ImageEditLayerV3[],
  scale: number,
): ImageEditLayerV3[] {
  return layers.map((layer) => {
    if (layer.type === 'group') return { ...layer, children: scaleLayers(layer.children, scale) }
    if (layer.type === 'effect'
      && (layer.effectId === 'image.gaussian-blur-v2' || layer.effectId === 'image.fast-blur-v3')) {
      return {
        ...layer,
        params: {
          ...layer.params,
          mip: Math.max(0, Math.log2(1 / Math.max(scale, Number.EPSILON))),
        },
      }
    }
    if (layer.type === 'effect' && layer.effectId === 'image.blur') {
      const radiusPixels = Number(layer.params.radiusPixels ?? 0)
      return {
        ...layer,
        params: {
          ...layer.params,
          radiusPixels: Number.isFinite(radiusPixels) ? Math.max(0, radiusPixels * scale) : 0,
        },
      }
    }
    return layer
  })
}

/** 将以文档像素声明的局部效果缩放到目标预览 mip。 */
export function scaleImageEditorPreviewEffectsV3(
  document: ImageEditDocumentV3,
  scale: number,
): ImageEditDocumentV3 {
  return { ...document, layers: scaleLayers(document.layers, scale) }
}
