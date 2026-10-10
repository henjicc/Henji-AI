import { inverseAffine } from '@/core/imaging/transforms';
import { imageEditLayerMaskTransformV3 } from '@/core/imageEdit/v3/renderContracts/maskTransform'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import {
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
      reason: 'select-one' | 'missing-mask' | 'locked' | 'hidden' | 'singular'
    }

function invert(matrix: AnnotationMatrixV3): AnnotationMatrixV3 | null {
  try { return inverseAffine(matrix) } catch { return null }
}

/** 编辑矩阵复用共同附件契约：链接蒙版随内容变换，解绑蒙版使用独立变换。 */
export function resolveImageEditorMaskBrushLayerV3(
  document: ImageEditDocumentV3,
  selectedLayerIds: readonly string[],
): ImageEditorMaskLayerResolutionV3 {
  if (selectedLayerIds.length !== 1) return { ready: false, reason: 'select-one' }
  const location = findImageEditLayerLocationV3(document.layers, selectedLayerIds[0])
  if (!location?.layer.mask) return { ready: false, reason: 'missing-mask' }
  if (location.layer.locked || location.ancestors.some((ancestor) => ancestor.locked)) {
    return { ready: false, reason: 'locked' }
  }
  if (!location.layer.visible || location.ancestors.some((ancestor) => !ancestor.visible)) {
    return { ready: false, reason: 'hidden' }
  }
  const matrix = resolveAnnotationLayerToOutputMatrixV3(
    document,
    [
      imageEditLayerMaskTransformV3(location.layer),
      ...location.ancestors.slice().reverse().map((ancestor) => ancestor.transform),
    ],
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
