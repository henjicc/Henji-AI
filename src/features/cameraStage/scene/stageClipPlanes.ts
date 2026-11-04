import type { StageVec3 } from '../domain/sceneTypes'
import type { StageSceneExtent } from '../application/stageSceneExtent'

/**
 * 透视视口的远近裁剪面按场景尺度和看的距离走。
 *
 * 远裁剪面必须罩住整个场景，否则缩远一截画面就空了；近裁剪面决定深度精度：远近比越大，
 * 远处的路面、楼体越容易互相穿插闪烁，深度图与线稿也越早失真。所以近裁剪面跟着
 * “正在看多远”放大：凑近一个角色时 5 厘米，拉到几百米外看整片城区时最多 1 米。
 * 不用对数深度：深度图与线稿要按标准透视深度反算视距，对数深度会破坏这一步。
 */

/** 小场景沿用的远裁剪面，场景小于它时不改变原有画面 */
export const STAGE_MIN_FAR = 1000
export const STAGE_MIN_NEAR = 0.05
const STAGE_MAX_NEAR = 1
const NEAR_PER_FOCUS_DISTANCE = 0.002
const FAR_MARGIN = 1.2

export interface StageClipPlanes {
  near: number
  far: number
}

/** focusDistance：到正在看的那一点的距离（自由视角取环绕中心，摄像机取注视点）。 */
export function resolveStageClipPlanes(
  cameraPosition: StageVec3,
  focusDistance: number,
  extent: StageSceneExtent,
): StageClipPlanes {
  const toCenter = Math.hypot(
    cameraPosition.x - extent.center.x,
    cameraPosition.y - extent.center.y,
    cameraPosition.z - extent.center.z,
  )
  const far = Math.max(STAGE_MIN_FAR, (toCenter + extent.radius) * FAR_MARGIN)
  const near = Number.isFinite(focusDistance)
    ? Math.min(STAGE_MAX_NEAR, Math.max(STAGE_MIN_NEAR, focusDistance * NEAR_PER_FOCUS_DISTANCE))
    : STAGE_MIN_NEAR
  return { near, far: Number.isFinite(far) ? far : STAGE_MIN_FAR }
}

/** 正交视图相机离注视面的距离：足够远，场景里再高的楼也在相机前面。正交深度是线性的，远近比不影响精度。 */
export const STAGE_FIXED_VIEW_DISTANCE = 5000

/** 注视面可能被聚焦挪到场景另一侧，所以按整个场景直径两倍放宽。 */
export function resolveFixedViewFar(extent: StageSceneExtent): number {
  const centerOffset = Math.hypot(extent.center.x, extent.center.y, extent.center.z)
  return STAGE_FIXED_VIEW_DISTANCE + 2 * (centerOffset + extent.radius) + STAGE_MIN_FAR
}
