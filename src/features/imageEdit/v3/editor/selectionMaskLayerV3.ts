import type { ImageEditSelectionCombineModeV3 } from '@/core/imageEdit/v3/selection'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import {
  collectImageEditMaskResourceIdsV3,
  isImageEditSparseMaskReferenceV3,
  type ImageEditLayerV3,
} from '@/core/imageEdit/v3/layerTypes'
import {
  invertAnnotationMatrixV3,
  resolveAnnotationLayerToOutputMatrixV3,
  type AnnotationMatrixV3,
} from './annotationGeometryV3'
import { findImageEditLayerLocationV3 } from './layerTreeV3'

export type ImageEditorSelectionMaskTargetReasonV3 =
  | 'select-one'
  | 'locked'
  | 'hidden'
  | 'singular'
  | 'unsupported-combine'
  | 'missing-resource-size'

export interface ImageEditorSelectionMaskTargetV3 {
  layer: ImageEditLayerV3
  matrix: AnnotationMatrixV3
  inverseMatrix: AnnotationMatrixV3
  allowedCombineModes: readonly ImageEditSelectionCombineModeV3[]
  resourceByteSizes: ReadonlyMap<string, number>
}

export type ImageEditorSelectionMaskTargetResolutionV3 =
  | { ready: true; target: ImageEditorSelectionMaskTargetV3 }
  | { ready: false; reason: ImageEditorSelectionMaskTargetReasonV3 }

const ALL_COMBINE_MODES: readonly ImageEditSelectionCombineModeV3[] = [
  'replace',
  'add',
  'subtract',
  'intersect',
]
const REPLACE_ONLY: readonly ImageEditSelectionCombineModeV3[] = ['replace']

export function imageEditorSelectionAllowedCombineModesV3(
  layer: ImageEditLayerV3 | null,
): readonly ImageEditSelectionCombineModeV3[] {
  return layer?.mask
    && isImageEditSparseMaskReferenceV3(layer.mask)
    && layer.mask.defaultValue === 0
    ? ALL_COMBINE_MODES
    : REPLACE_ONLY
}

export function resolveImageEditorSelectionMaskTargetV3(input: {
  document: ImageEditDocumentV3
  selectedLayerIds: readonly string[]
  combineMode: ImageEditSelectionCombineModeV3
  resourceByteSizes: ReadonlyMap<string, number>
}): ImageEditorSelectionMaskTargetResolutionV3 {
  if (input.selectedLayerIds.length !== 1) return { ready: false, reason: 'select-one' }
  const location = findImageEditLayerLocationV3(input.document.layers, input.selectedLayerIds[0])
  if (!location) return { ready: false, reason: 'select-one' }
  if (location.layer.locked || location.ancestors.some((ancestor) => ancestor.locked)) {
    return { ready: false, reason: 'locked' }
  }
  if (!location.layer.visible || location.ancestors.some((ancestor) => !ancestor.visible)) {
    return { ready: false, reason: 'hidden' }
  }
  const allowedCombineModes = imageEditorSelectionAllowedCombineModesV3(location.layer)
  if (!allowedCombineModes.includes(input.combineMode)) {
    return { ready: false, reason: 'unsupported-combine' }
  }
  if (location.layer.mask) {
    const resourceIds = collectImageEditMaskResourceIdsV3(location.layer.mask)
    if (resourceIds.some((resourceId) => {
      const byteSize = input.resourceByteSizes.get(resourceId)
      return typeof byteSize !== 'number' || !Number.isSafeInteger(byteSize) || byteSize <= 0
    })) {
      return { ready: false, reason: 'missing-resource-size' }
    }
  }
  const matrix = resolveAnnotationLayerToOutputMatrixV3(
    input.document,
    [
      location.layer.transform,
      ...location.ancestors.slice().reverse().map((ancestor) => ancestor.transform),
    ],
  )
  try {
    return {
      ready: true,
      target: {
        layer: location.layer,
        matrix,
        inverseMatrix: invertAnnotationMatrixV3(matrix),
        allowedCombineModes,
        resourceByteSizes: input.resourceByteSizes,
      },
    }
  } catch {
    return { ready: false, reason: 'singular' }
  }
}
