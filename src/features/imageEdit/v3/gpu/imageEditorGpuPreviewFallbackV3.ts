import type { ImageEditorViewportLayoutV3 } from '../editor/useImageEditorViewportLayoutV3'
import { createImageEditorGpuPyramidDescriptorV3, planImageEditorGpuRasterTilesV3, type ImageEditorGpuPlannedLayerV3 } from './imageEditorGpuTilePlannerV3'
import type { ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'

/** 请求精细瓦片的同时，已有完整低 mip 先按新相机呈现；内容版本仍必须一致。 */
export function resolveImageEditorGpuPreviewFallbackV3(
  scene: ImageEditorGpuRasterSceneV3, layout: ImageEditorViewportLayoutV3,
  requested: ReadonlyMap<string, ImageEditorGpuPlannedLayerV3>,
  displayed: Map<string, ImageEditorGpuPlannedLayerV3>,
  transforms: ReadonlyMap<string, ImageEditTransformV3>,
  available: (key: ImageEditorGpuSceneTileKeyV3) => boolean,
): boolean {
  let fallback = false
  displayed.clear()
  for (const [id, plan] of requested) {
    displayed.set(id, plan)
    if (plan.tiles.every(tile => available(tile.key))) continue
    const layer = scene.layers.find(candidate => candidate.layerId === id)
    if (!layer || layer.deformation || Object.keys(layer.sparseTiles).length) continue
    const transform = transforms.get(id) ?? layer.transform
    const scale = Math.max(Math.hypot(transform[0], transform[1]), Math.hypot(transform[2], transform[3]))
    const nativeSize = layer.rasterCanvasSize ?? scene
    const levels = (layer.sourcePyramid ?? createImageEditorGpuPyramidDescriptorV3(nativeSize.width, nativeSize.height)).levels
    for (const level of levels.filter(level => level.mip > plan.mip).sort((a,b) => a.mip - b.mip)) {
      const coarse = planImageEditorGpuRasterTilesV3(scene, { ...layer, transform }, {
        ...layout, viewport: { ...layout.viewport, devicePixelRatio: 2 ** -level.mip / (layout.viewport.zoom * scale) },
      })
      if (coarse.mip !== level.mip || !coarse.tiles.every(tile => available(tile.key))) continue
      displayed.set(id, coarse); fallback = true; break
    }
  }
  return fallback
}
