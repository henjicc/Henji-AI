import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditRasterLayerV3 } from '@/core/imageEdit/v3/layerTypes'
import type { AnnotationMatrixV3 } from './annotationGeometryV3'
import { resolveAnnotationLayerToOutputMatrixV3 } from './annotationGeometryV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'

export interface EditableImageEditorRasterLayerV3 {
  layer: ImageEditRasterLayerV3
  matrix: AnnotationMatrixV3
  inverseMatrix: AnnotationMatrixV3
}

export type ImageEditorRasterLayerResolutionV3 =
  | { ready: true; target: EditableImageEditorRasterLayerV3 }
  | { ready: false; reason: 'select-one' | 'not-raster' | 'locked' | 'hidden' | 'singular' }

function invert(matrix: AnnotationMatrixV3): AnnotationMatrixV3 | null {
  const [a, b, c, d, e, f] = matrix
  const determinant = a * d - b * c
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-8) return null
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ]
}

export function resolveImageEditorRasterBrushLayerV3(
  document: ImageEditDocumentV3,
  selectedLayerIds: readonly string[],
): ImageEditorRasterLayerResolutionV3 {
  if (selectedLayerIds.length !== 1) return { ready: false, reason: 'select-one' }
  const location = findImageEditLayerLocationV3(document.layers, selectedLayerIds[0])
  if (!location || location.layer.type !== 'raster') return { ready: false, reason: 'not-raster' }
  if (location.layer.locked || location.ancestors.some((ancestor) => ancestor.locked)) {
    return { ready: false, reason: 'locked' }
  }
  if (!location.layer.visible || location.ancestors.some((ancestor) => !ancestor.visible)) {
    return { ready: false, reason: 'hidden' }
  }
  const matrix = resolveAnnotationLayerToOutputMatrixV3(document, [
    location.layer.transform,
    ...location.ancestors.slice().reverse().map((ancestor) => ancestor.transform),
  ])
  const inverseMatrix = invert(matrix)
  return inverseMatrix
    ? { ready: true, target: { layer: location.layer, matrix, inverseMatrix } }
    : { ready: false, reason: 'singular' }
}
