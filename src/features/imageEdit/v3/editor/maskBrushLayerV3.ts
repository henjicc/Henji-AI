import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import {
  isImageEditSparseMaskReferenceV3,
  type ImageEditLayerV3,
  type ImageEditSparseMaskReferenceV3,
} from '@/core/imageEdit/v3/layerTypes'
import type { AnnotationMatrixV3 } from './annotationGeometryV3'
import { resolveAnnotationLayerToOutputMatrixV3 } from './annotationGeometryV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'

export interface EditableImageEditorMaskV3 {
  layer: ImageEditLayerV3 & { mask: ImageEditSparseMaskReferenceV3 }
  matrix: AnnotationMatrixV3
  inverseMatrix: AnnotationMatrixV3
}

export type ImageEditorMaskLayerResolutionV3 =
  | { ready: true; target: EditableImageEditorMaskV3 }
  | {
      ready: false
      reason: 'select-one' | 'missing-mask' | 'legacy-mask' | 'locked' | 'hidden' | 'singular'
    }

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

/** 蒙版在图层自身变换之后求值，因此编辑矩阵只继承祖先变换。 */
export function resolveImageEditorMaskBrushLayerV3(
  document: ImageEditDocumentV3,
  selectedLayerIds: readonly string[],
): ImageEditorMaskLayerResolutionV3 {
  if (selectedLayerIds.length !== 1) return { ready: false, reason: 'select-one' }
  const location = findImageEditLayerLocationV3(document.layers, selectedLayerIds[0])
  if (!location?.layer.mask) return { ready: false, reason: 'missing-mask' }
  if (!isImageEditSparseMaskReferenceV3(location.layer.mask)) {
    return { ready: false, reason: 'legacy-mask' }
  }
  if (location.layer.locked || location.ancestors.some((ancestor) => ancestor.locked)) {
    return { ready: false, reason: 'locked' }
  }
  if (!location.layer.visible || location.ancestors.some((ancestor) => !ancestor.visible)) {
    return { ready: false, reason: 'hidden' }
  }
  const matrix = resolveAnnotationLayerToOutputMatrixV3(
    document,
    location.ancestors.slice().reverse().map((ancestor) => ancestor.transform),
  )
  const inverseMatrix = invert(matrix)
  return inverseMatrix
    ? {
        ready: true,
        target: {
          layer: location.layer as ImageEditLayerV3 & { mask: ImageEditSparseMaskReferenceV3 },
          matrix,
          inverseMatrix,
        },
      }
    : { ready: false, reason: 'singular' }
}
