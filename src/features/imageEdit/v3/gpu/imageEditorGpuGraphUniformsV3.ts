import { invertImageEditTransformV3 } from '@/core/imageEdit/v3/execution/affineTransform'
import type { ImageEditBlendModeV3, ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import {
  imageEditorGpuCurveDataV3,
  imageEditorGpuExposureParametersV3,
  imageEditorGpuHslParametersV3,
  imageEditorGpuTemperatureMatrixV3,
} from './imageEditorGpuAdjustmentParametersV3'
import {
  imageEditorGpuSourceColorUniformV3,
  imageEditorGpuWorkingLinearSourceUniformV3,
  packImageEditorGpuColorMatrixRowsV3,
} from './imageEditorGpuColorPipelineV3'
import type {
  ImageEditorGpuGraphAdjustmentNodeV3,
  ImageEditorGpuGraphAdjustmentV3,
  ImageEditorGpuGraphCompositeNodeV3,
  ImageEditorGpuRasterSceneV3,
} from './imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditorGpuPlannedTileV3 } from './imageEditorGpuTilePlannerV3'
import type { ImageEditorGpuTileAtlasAllocationV3 } from './imageEditorGpuTileAtlasV3'

export function imageEditorGpuGraphCompositeValuesV3(
  node: ImageEditorGpuGraphCompositeNodeV3,
  virtualSource: boolean,
  transientTransform: ImageEditTransformV3 | undefined,
  layout: ImageEditorViewportLayoutV3,
): Float32Array {
  const transform = virtualSource ? transientTransform ?? node.transform : [1, 0, 0, 1, 0, 0] as ImageEditTransformV3
  const inverse = invertImageEditTransformV3(transform)
  const viewport = layout.viewport
  const scale = viewport.zoom * viewport.devicePixelRatio
  const translationX = scale * (
    inverse[0] * viewport.documentX + inverse[2] * viewport.documentY + inverse[4] - viewport.documentX
  )
  const translationY = scale * (
    inverse[1] * viewport.documentX + inverse[3] * viewport.documentY + inverse[5] - viewport.documentY
  )
  return new Float32Array([
    inverse[0], inverse[1], inverse[2], inverse[3], translationX, translationY, 0, 0,
    node.opacity, imageEditorGpuGraphBlendIndexV3(node.blendMode), 0, 0,
    node.mask ? 1 : 0, node.mask?.defaultValue ?? 1, node.mask?.inverted ? 1 : 0, 0,
  ])
}

export function imageEditorGpuGraphSourceTileValuesV3(
  scene: ImageEditorGpuRasterSceneV3,
  layer: ImageEditorGpuRasterSceneV3['layers'][number],
  planned: ImageEditorGpuPlannedTileV3,
  resource: Pick<ImageEditorGpuTileAtlasAllocationV3, 'tile' | 'atlasLayer'>,
  transform: ImageEditTransformV3,
): Float32Array {
  const inverse = invertImageEditTransformV3(transform)
  const color = planned.key.format === 'rgba16float'
    ? imageEditorGpuWorkingLinearSourceUniformV3(scene.color)
    : imageEditorGpuSourceColorUniformV3(resource.tile, scene.color)
  return new Float32Array([
    inverse[0], inverse[1], inverse[2], inverse[3], inverse[4], inverse[5], 1, 0,
    resource.tile.originX, resource.tile.originY, 2 ** planned.key.mip, resource.atlasLayer,
    resource.tile.width, resource.tile.height, color.transferCode, color.referenceWhiteNits,
    planned.coreOriginX, planned.coreOriginY, planned.coreWidth, planned.coreHeight,
    ...packImageEditorGpuColorMatrixRowsV3(color.sourceToWorking),
  ])
}

export function imageEditorGpuGraphAdjustmentValuesV3(node: ImageEditorGpuGraphAdjustmentNodeV3): Float32Array {
  const first = node.adjustments[0]
  const mask = first.mask
  const values = new Float32Array(40)
  const kind = first.definitionId === 'adjustment.exposure' ? 0
    : first.definitionId === 'adjustment.temperature-tint' ? 1 : 2
  values.set([kind, node.adjustments.length, first.opacity,
    imageEditorGpuGraphBlendIndexV3(first.blendMode), mask ? 1 : 0,
    mask?.defaultValue ?? 1, mask?.inverted ? 1 : 0, 0])
  if (kind === 0) first && node.adjustments.slice(0, 8).forEach((entry, index) => (
    values.set(imageEditorGpuExposureParametersV3(entry.parameters), 8 + index * 4)
  ))
  else if (kind === 1) values.set(imageEditorGpuTemperatureMatrixV3(first.parameters), 8)
  else values.set(imageEditorGpuHslParametersV3(first.parameters), 8)
  return values
}

export function imageEditorGpuGraphCurveValuesV3(adjustment: ImageEditorGpuGraphAdjustmentV3): {
  readonly values: Float32Array
  readonly curve: ReturnType<typeof imageEditorGpuCurveDataV3>
} {
  const curve = imageEditorGpuCurveDataV3(adjustment.parameters)
  const mask = adjustment.mask
  return { curve, values: new Float32Array([
    adjustment.opacity, imageEditorGpuGraphBlendIndexV3(adjustment.blendMode), 0, 0,
    mask ? 1 : 0, mask?.defaultValue ?? 1, mask?.inverted ? 1 : 0, 0,
    ...curve.slopes,
  ]) }
}

export function imageEditorGpuGraphBlendIndexV3(mode: ImageEditBlendModeV3): number {
  return mode === 'multiply' ? 1 : mode === 'screen' ? 2 : mode === 'overlay' ? 3 : mode === 'soft-light' ? 4 : 0
}

export function imageEditorGpuGraphViewportFingerprintV3(layout: ImageEditorViewportLayoutV3): string {
  const viewport = layout.viewport
  return [viewport.documentX, viewport.documentY, viewport.zoom, viewport.devicePixelRatio,
    viewport.width, viewport.height].join(':')
}
