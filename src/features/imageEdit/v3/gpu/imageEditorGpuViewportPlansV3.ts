import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import { resolveImageEditorGpuEffectViewportV3 } from './imageEditorGpuEffectViewportV3'
import type { ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import {
  planImageEditorGpuMaskTilesV3,
  planImageEditorGpuRasterTilesV3,
  type ImageEditorGpuPlannedLayerV3,
} from './imageEditorGpuTilePlannerV3'

interface ImageEditorGpuViewportPlansInputV3 {
  scene: ImageEditorGpuRasterSceneV3 | null
  layout: ImageEditorViewportLayoutV3 | null
  transientTransforms: ReadonlyMap<string, ImageEditTransformV3>
  previousMips: Map<string, number>
  plannedLayers: Map<string, ImageEditorGpuPlannedLayerV3>
  plannedMasks: Map<string, ImageEditorGpuPlannedLayerV3>
  /** 导出已显式携带有限 support halo，不再扩成整图预览域。 */
  expandEffects?: boolean
}

export function replanImageEditorGpuViewportTilesV3(
  input: ImageEditorGpuViewportPlansInputV3,
): void {
  input.plannedLayers.clear()
  input.plannedMasks.clear()
  if (!input.scene || !input.layout) return
  const workingLayout = input.expandEffects === false
    ? input.layout
    : resolveImageEditorGpuEffectViewportV3(input.scene, input.layout).layout
  for (const layer of input.scene.layers) {
    if (!layer.visible || layer.opacity <= 0) continue
    const transform = input.transientTransforms.get(layer.layerId) ?? layer.transform
    const planned = planImageEditorGpuRasterTilesV3(
      input.scene, { ...layer, transform }, workingLayout, input.previousMips.get(layer.layerId),
    )
    input.plannedLayers.set(layer.layerId, planned)
    input.previousMips.set(layer.layerId, planned.mip)
  }
  for (const node of input.scene.graph) {
    if (node.kind === 'source' || node.kind === 'alias') continue
    const transform = node.kind === 'composite'
      ? input.transientTransforms.get(node.layerId) ?? node.transform
      : [1, 0, 0, 1, 0, 0] as ImageEditTransformV3
    const masks = node.kind === 'composite'
      ? [node.mask]
      : node.kind === 'effect' ? [node.mask] : node.adjustments.map((entry) => entry.mask)
    for (const mask of masks) {
      if (!mask || input.plannedMasks.has(mask.maskId)) continue
      input.plannedMasks.set(mask.maskId, planImageEditorGpuMaskTilesV3(
        input.scene, mask, transform, workingLayout,
      ))
    }
  }
}
