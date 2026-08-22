import { Box3, Vector3 } from 'three'
import type { PerspectiveCamera, Scene } from 'three'
import { STAGE_STYLE_SUBJECT_KEY } from './stageStyleTags'

/**
 * 深度图的归一化区间：把"多远算最亮、多远算最暗"限定在**场景对象**的实际进深上。
 *
 * 直接用相机的 near/far 会让整张深度图挤在极窄的灰度区间里；用整个场景（含 160×160 地面）
 * 的包围盒同样不行——地面一路铺到远处，主体会被压成几乎同一个灰度。因此只统计标了
 * STAGE_STYLE_SUBJECT_KEY 的对象，地面超出区间的部分自然落到纯黑。
 */

export interface StageDepthRange {
  /** 映射为最亮（白）的视距 */
  near: number
  /** 映射为最暗（黑）的视距 */
  far: number
}

/** 场景里一个主体都没有时的兜底进深（单位与场景一致） */
const FALLBACK_DEPTH_SPAN = 40
/** 区间两端各留一点余量，避免最近/最远的像素刚好压在纯白纯黑上 */
const RANGE_PADDING_RATIO = 0.06

const scratchCorner = new Vector3()
const scratchForward = new Vector3()
const scratchOrigin = new Vector3()

/** 收集主体包围盒；没有主体时返回空盒。 */
export function collectStageSubjectBox(scene: Scene, box: Box3 = new Box3()): Box3 {
  box.makeEmpty()
  scene.traverse((node) => {
    if (node.visible && node.userData?.[STAGE_STYLE_SUBJECT_KEY] === true) box.expandByObject(node)
  })
  return box
}

/** 把包围盒投影到相机视线方向，取最近/最远视距。 */
export function resolveDepthRangeFromBox(box: Box3, camera: PerspectiveCamera): StageDepthRange {
  if (box.isEmpty()) {
    return { near: camera.near, far: Math.min(camera.far, camera.near + FALLBACK_DEPTH_SPAN) }
  }

  const forward = camera.getWorldDirection(scratchForward)
  const origin = camera.getWorldPosition(scratchOrigin)
  let minDistance = Number.POSITIVE_INFINITY
  let maxDistance = Number.NEGATIVE_INFINITY
  for (let corner = 0; corner < 8; corner += 1) {
    scratchCorner.set(
      corner & 1 ? box.max.x : box.min.x,
      corner & 2 ? box.max.y : box.min.y,
      corner & 4 ? box.max.z : box.min.z,
    )
    const distance = scratchCorner.sub(origin).dot(forward)
    minDistance = Math.min(minDistance, distance)
    maxDistance = Math.max(maxDistance, distance)
  }

  const padding = Math.max(maxDistance - minDistance, 0.001) * RANGE_PADDING_RATIO
  const near = Math.max(camera.near, minDistance - padding)
  const far = Math.min(camera.far, Math.max(near + 0.001, maxDistance + padding))
  return { near, far: Math.max(near + 0.001, far) }
}

export function resolveStageDepthRange(
  scene: Scene,
  camera: PerspectiveCamera,
  box: Box3 = new Box3(),
): StageDepthRange {
  return resolveDepthRangeFromBox(collectStageSubjectBox(scene, box), camera)
}
