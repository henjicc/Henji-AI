import { imageEditorGpuRetainedStateKeyV3 } from './imageEditorGpuRasterSupportV3'
import type { ImageEditorGpuRasterCompositorStatsV3 } from './imageEditorGpuRasterPipelineContractsV3'
import type { ImageEditorGpuPlannedLayerV3,
  ImageEditorGpuPlannedTileV3 } from './imageEditorGpuTilePlannerV3'
import { imageEditorGpuSceneTileKeyV3,
  type ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

export function findImageEditorGpuPlannedTileV3(
  plans: ReadonlyMap<string, ImageEditorGpuPlannedLayerV3>,
  stateKey: string,
): ImageEditorGpuPlannedTileV3 | null {
  for (const plan of plans.values()) {
    const tile = plan.tiles.find((entry) => (
      imageEditorGpuRetainedStateKeyV3(plan.layerId, entry.key) === stateKey
    ))
    if (tile) return tile
  }
  return null
}

export function refreshImageEditorGpuAtlasStatsV3(
  stats: ImageEditorGpuRasterCompositorStatsV3,
  snapshot: { pages: number; allocations: number; allocatedBytes: number },
  plans: ReadonlyMap<string, ImageEditorGpuPlannedLayerV3>,
): void {
  const mips = [...plans.values()].map((plan) => plan.mip)
  stats.residentTileCount = snapshot.allocations
  stats.atlasPageCount = snapshot.pages
  stats.allocatedAtlasBytes = snapshot.allocatedBytes
  stats.minimumPlannedMip = mips.length > 0 ? Math.min(...mips) : 0
  stats.maximumPlannedMip = mips.length > 0 ? Math.max(...mips) : 0
}

export function collectImageEditorGpuRequiredResourceKeysV3(
  layers: ReadonlyMap<string, ImageEditorGpuPlannedLayerV3>,
  masks: ReadonlyMap<string, ImageEditorGpuPlannedLayerV3>,
  layerId?: string,
): readonly ImageEditorGpuSceneTileKeyV3[] {
  const unique = new Map<string, ImageEditorGpuSceneTileKeyV3>()
  for (const plan of layers.values()) {
    if (layerId && plan.layerId !== layerId) continue
    for (const tile of plan.tiles) unique.set(imageEditorGpuSceneTileKeyV3(tile.key), tile.key)
  }
  for (const plan of masks.values()) {
    for (const tile of plan.tiles) unique.set(imageEditorGpuSceneTileKeyV3(tile.key), tile.key)
  }
  return [...unique.values()]
}

export function pruneImageEditorGpuRetainedStatesV3<T extends { buffer: { destroy(): void } }>(
  states: Map<string, T>,
  active: ReadonlySet<string>,
): void {
  for (const [stateKey, state] of states) {
    if (active.has(stateKey)) continue
    state.buffer.destroy()
    states.delete(stateKey)
  }
}
