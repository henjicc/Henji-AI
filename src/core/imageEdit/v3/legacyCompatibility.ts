import { IMAGE_EDIT_OPERATION_IDS } from '../types'
import type { ImageEditDocumentV3 } from './documentTypes'
import { IMAGE_EDIT_IDENTITY_TRANSFORM_V3, type ImageEditLayerV3 } from './layerTypes'

const LEGACY_EFFECT_ORDER: readonly string[] = [
  IMAGE_EDIT_OPERATION_IDS.blur,
  IMAGE_EDIT_OPERATION_IDS.diffusion,
  IMAGE_EDIT_OPERATION_IDS.vgpuGlow,
]

function hasLegacyCommonShape(layer: ImageEditLayerV3): boolean {
  return layer.mask === null
    && layer.opacity === 1
    && layer.blendMode === 'normal'
    && layer.transform.every((value, index) => value === IMAGE_EDIT_IDENTITY_TRANSFORM_V3[index])
}

/**
 * 仅在当前 V3 文档不会因回退而丢失语义时开放旧版入口。
 * 判断保持保守：组、蒙版、画笔瓦片、重复/重排效果和调整层均不可降级。
 */
export function isImageEditDocumentLegacyExpressibleV3(document: ImageEditDocumentV3): boolean {
  if (document.color.bitDepth !== 8 || document.color.hdrMetadata !== null) return false
  if (document.layers.length === 0 || !document.layers.every(hasLegacyCommonShape)) return false
  const [base, ...rest] = document.layers
  if (base.type !== 'raster' || base.source.kind !== 'resource' || Object.keys(base.tiles).length > 0) {
    return false
  }
  const annotations = rest.filter((layer) => layer.type === 'annotation')
  if (annotations.length > 1) return false
  if (annotations.length === 1 && rest.at(-1) !== annotations[0]) return false
  const effects = rest.filter((layer) => layer.type === 'effect')
  if (rest.length !== effects.length + annotations.length) return false
  if (effects.some((layer) => !layer.renderable || !LEGACY_EFFECT_ORDER.includes(layer.effectId))) return false
  if (new Set(effects.map((layer) => layer.effectId)).size !== effects.length) return false
  const indexes = effects.map((layer) => LEGACY_EFFECT_ORDER.indexOf(layer.effectId))
  return indexes.every((value, index) => index === 0 || value > indexes[index - 1])
}
