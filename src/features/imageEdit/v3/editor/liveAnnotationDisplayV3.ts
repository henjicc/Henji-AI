import { createImageEditRenderHash, type ImageEditHashValue } from '@/core/imageEdit/v3/renderHash'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import {
  type ImageEditAnnotationLayerV3,
  type ImageEditLayerV3,
} from '@/core/imageEdit/v3/layerTypes'

export interface LiveAnnotationDisplayV3 {
  baseDocument: ImageEditDocumentV3
  liveLayers: readonly ImageEditAnnotationLayerV3[]
  baseIdentity: string
}

/**
 * 只有位于根图层栈最上方、普通合成且无蒙版的标注才能安全交给前台矢量层。
 * 这样底下的效果结果可以稳定复用；处在效果下方的标注仍留给 RenderPlan，语义不变。
 */
function canRenderAsLiveAnnotation(layer: ImageEditLayerV3): layer is ImageEditAnnotationLayerV3 {
  return layer.type === 'annotation'
    && layer.blendMode === 'normal'
    && layer.mask === null
}

export function splitLiveAnnotationDisplayV3(
  document: ImageEditDocumentV3,
): LiveAnnotationDisplayV3 {
  let splitIndex = document.layers.length
  while (splitIndex > 0 && canRenderAsLiveAnnotation(document.layers[splitIndex - 1])) {
    splitIndex -= 1
  }
  const liveLayers = document.layers.slice(splitIndex) as ImageEditAnnotationLayerV3[]
  const layers = document.layers.slice(0, splitIndex)
  const baseRenderHash = createImageEditRenderHash({
    geometry: document.geometry,
    color: document.color,
    layers,
  } as unknown as ImageEditHashValue)
  return {
    baseDocument: { ...document, layers },
    liveLayers,
    baseIdentity: `${document.id}:${baseRenderHash}`,
  }
}

export function resolveLiveGaussianBlurRadiusV3(
  document: ImageEditDocumentV3,
): number | null {
  const top = [...document.layers].reverse().find((layer) => layer.visible)
  if (top?.type !== 'effect' || top.effectId !== 'image.gaussian-blur-v2') return null
  const radius = top.params.radius
  return typeof radius === 'number' && Number.isFinite(radius) && radius > 0 ? radius : null
}
