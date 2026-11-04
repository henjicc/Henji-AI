import { clampStageFogDistance, STAGE_FOG_DEFAULT_DISTANCE } from '../domain/sceneDefaults'
import type { StageFogSettings, StageObject, StageVec3 } from '../domain/sceneTypes'
import { calculateStageObjectBounds } from './sceneAnalysis'

/**
 * 场景尺度：视口裁剪面、地面范围与布景生成后的雾距按它走。
 *
 * 布景从十几米的街角到上千米的城区都有；任何写死的距离（远裁剪 1000 米、地面 160 米、雾 90 米）
 * 都会在某一档尺度上把画面吃掉。这里只看可见对象的包围盒，转角按包围盒对角线放宽，
 * 不必逐个处理朝向。
 */

export interface StageSceneExtent {
  /** 包围全部可见对象的球；场景为空时是原点处半径 0 */
  center: StageVec3
  radius: number
  /** 地面以原点为中心铺开：对象离原点最远的水平距离（x 或 z 方向） */
  reach: number
}

/** 默认地面边长，也是小场景的地面边长 */
export const STAGE_GROUND_MIN_SIZE = 160

export function resolveStageSceneExtent(objects: readonly StageObject[]): StageSceneExtent {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  let reach = 0
  for (const object of objects) {
    if (!object.visible) continue
    const bounds = calculateStageObjectBounds(object)
    // 不看朝向：转过的楼最远也不超过中心加半条水平对角线
    const half = Math.hypot(bounds.size.x, bounds.size.z) / 2
    const { x, z } = bounds.center
    if (![x, z, bounds.min.y, bounds.max.y, half].every(Number.isFinite)) continue
    minX = Math.min(minX, x - half)
    maxX = Math.max(maxX, x + half)
    minZ = Math.min(minZ, z - half)
    maxZ = Math.max(maxZ, z + half)
    minY = Math.min(minY, bounds.min.y)
    maxY = Math.max(maxY, bounds.max.y)
    reach = Math.max(reach, Math.abs(x) + half, Math.abs(z) + half)
  }
  if (minX > maxX) return { center: { x: 0, y: 0, z: 0 }, radius: 0, reach: 0 }
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
    radius: Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2,
    reach,
  }
}

/**
 * 地面边长：比场景再往外铺一半，缩远时看到的是地平线而不是地面边缘。
 * 按 160 米取整，场景里挪动对象不会每次都换一块地面。
 */
export function stageGroundSize(extent: StageSceneExtent): number {
  const half = Math.max(STAGE_GROUND_MIN_SIZE / 2, extent.reach * 1.5)
  return Math.ceil((half * 2) / STAGE_GROUND_MIN_SIZE) * STAGE_GROUND_MIN_SIZE
}

/** 与场景尺度相配的雾距：从布景一侧看过去，对面边缘正好淡进天空。小场景保持默认值。 */
export function stageSceneFogDistance(extent: StageSceneExtent): number {
  return clampStageFogDistance(Math.max(STAGE_FOG_DEFAULT_DISTANCE, Math.round((extent.reach * 3) / 10) * 10))
}

/**
 * 生成或删除布景后让雾距跟上场景尺度，但不覆盖用户自己的设置：
 * 只有雾开着、雾距还是默认值或上一次自动给出的值时才改。关掉的雾、手调过的雾距原样保留。
 */
export function followSceneScaleFog(
  fog: StageFogSettings,
  before: readonly StageObject[],
  after: readonly StageObject[],
): StageFogSettings {
  if (!fog.enabled) return fog
  const untouched = fog.distance === STAGE_FOG_DEFAULT_DISTANCE
    || fog.distance === stageSceneFogDistance(resolveStageSceneExtent(before))
  if (!untouched) return fog
  const distance = stageSceneFogDistance(resolveStageSceneExtent(after))
  return distance === fog.distance ? fog : { ...fog, distance }
}
