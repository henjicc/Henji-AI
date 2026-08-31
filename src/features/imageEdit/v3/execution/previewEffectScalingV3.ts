import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditLayerV3 } from '@/core/imageEdit/v3/layerTypes'

function scaleLayers(
  layers: readonly ImageEditLayerV3[],
  scale: number,
): ImageEditLayerV3[] {
  return layers.map((layer) => {
    if (layer.type === 'group') return { ...layer, children: scaleLayers(layer.children, scale) }
    if (layer.type === 'effect' && layer.effectId === 'image.gaussian-blur-v2') {
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
