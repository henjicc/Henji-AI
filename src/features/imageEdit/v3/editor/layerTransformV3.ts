import {
  invertImageEditTransformV3,
  isImageEditTransformInvertibleV3,
  mapImageEditTransformPointV3,
  multiplyImageEditTransformsV3,
  type ImageEditDocumentV3,
  type ImageEditTransformV3,
} from '@/core/imageEdit/v3'

import { resolveAnnotationOutputGeometryV3 } from './annotationGeometryV3'
import type { ImageEditLayerLocationV3 } from './layerTreeV3'

const RADIANS_TO_DEGREES = 180 / Math.PI
const DEGREES_TO_RADIANS = Math.PI / 180

export interface ImageEditTransformFieldsV3 {
  x: number
  y: number
  scaleXPercent: number
  scaleYPercent: number
  rotationDegrees: number
  /** QR 分解中的切变项；属性区不暴露，但编辑其他字段时必须无损保留。 */
  shear: number
}

export function isImageEditLayerTransformableV3(
  location: ImageEditLayerLocationV3 | null,
): location is ImageEditLayerLocationV3 {
  return Boolean(
    location
    && (location.layer.type === 'raster'
      || location.layer.type === 'annotation'
      || location.layer.type === 'group')
    && location.layer.visible
    && !location.layer.locked
    && location.ancestors.every((ancestor) => ancestor.visible && !ancestor.locked),
  )
}

export function decomposeImageEditTransformV3(
  transform: ImageEditTransformV3,
): ImageEditTransformFieldsV3 {
  if (!isImageEditTransformInvertibleV3(transform)) throw new Error('图层变换矩阵不可逆')
  const [a, b, c, d, x, y] = transform
  const scaleX = Math.hypot(a, b)
  const determinant = a * d - b * c
  return {
    x,
    y,
    scaleXPercent: scaleX * 100,
    scaleYPercent: determinant / scaleX * 100,
    rotationDegrees: Math.atan2(b, a) * RADIANS_TO_DEGREES,
    shear: (a * c + b * d) / scaleX,
  }
}

export function composeImageEditTransformV3(
  fields: ImageEditTransformFieldsV3,
): ImageEditTransformV3 | null {
  if (!Object.values(fields).every(Number.isFinite)) return null
  const rotation = fields.rotationDegrees * DEGREES_TO_RADIANS
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const scaleX = fields.scaleXPercent / 100
  const scaleY = fields.scaleYPercent / 100
  const transform: ImageEditTransformV3 = [
    cos * scaleX,
    sin * scaleX,
    cos * fields.shear - sin * scaleY,
    sin * fields.shear + cos * scaleY,
    fields.x,
    fields.y,
  ]
  return isImageEditTransformInvertibleV3(transform) ? transform : null
}

function parentToOutputTransformV3(
  document: Pick<ImageEditDocumentV3, 'geometry'>,
  location: Pick<ImageEditLayerLocationV3, 'ancestors'>,
): ImageEditTransformV3 {
  let transform = resolveAnnotationOutputGeometryV3(document).sourceToOutput as ImageEditTransformV3
  for (const ancestor of location.ancestors) {
    transform = multiplyImageEditTransformsV3(transform, ancestor.transform)
  }
  return transform
}

/** 把输出画布坐标映射到所选图层父级坐标，供 move 手势更新 e/f。 */
export function mapImageEditOutputPointToLayerParentV3(
  document: Pick<ImageEditDocumentV3, 'geometry'>,
  location: Pick<ImageEditLayerLocationV3, 'ancestors'>,
  point: readonly [number, number],
): readonly [number, number] {
  return mapImageEditTransformPointV3(
    invertImageEditTransformV3(parentToOutputTransformV3(document, location)),
    point[0],
    point[1],
  )
}

export function translateImageEditLayerTransformV3(
  transform: ImageEditTransformV3,
  deltaX: number,
  deltaY: number,
): ImageEditTransformV3 {
  const next: ImageEditTransformV3 = [
    transform[0], transform[1], transform[2], transform[3],
    transform[4] + deltaX, transform[5] + deltaY,
  ]
  if (!isImageEditTransformInvertibleV3(next)) throw new Error('图层变换矩阵不可逆')
  return next
}
