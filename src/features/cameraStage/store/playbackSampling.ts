/**
 * 把某时间点的动画采样值落回场景对象（scrub / 暂停 / 停止时用）。
 *
 * 播放中走命令式 appliers 直改 three 对象、不写 store；一旦不在播放态，
 * store 才是权威——此处按各轨道采样并用注册表 applyToObject 生成新对象列表。
 */

import { getAnimatablePropByPath } from '../domain/animatableProps'
import { resolveCameraLookAtTarget, rotationFromPositionAndTarget } from '../domain/cameraUtils'
import { sampleTrack } from '../domain/keyframeEngine'
import { sampleSpatialMotion } from '../domain/spatialPath'
import type { StageAnimationSampleSource, StageCameraOrientationEntry, StageSceneAnimation } from '../domain/animationTypes'
import type { StageCameraObject, StageObject, StageVec3 } from '../domain/sceneTypes'

export interface SampledAnimationFrame {
  objects: StageObject[]
  trackKeys: ReadonlySet<string>
}

function trackKey(objectId: string, propertyPath: string): string {
  return `${objectId}::${propertyPath}`
}

/** 取覆盖该时刻的朝向区间；时间落在全部区间之外时按首尾区间夹取，与轨道首尾取值一致。 */
function findOrientationEntry(
  entries: StageCameraOrientationEntry[],
  cameraId: string,
  time: number,
): StageCameraOrientationEntry | undefined {
  let first: StageCameraOrientationEntry | undefined
  let last: StageCameraOrientationEntry | undefined
  for (const entry of entries) {
    if (entry.objectId !== cameraId) continue
    if (time >= entry.startTime && time <= entry.endTime) return entry
    if (!first) first = entry
    last = entry
  }
  if (!first || !last) return undefined
  return time < first.startTime ? first : last
}

/**
 * 摄像机朝向的唯一求解点：采样位置之后、按同一帧里注视目标的采样位置求俯仰与水平角。
 *
 * - object 模式：注视对象是摄像机级设置，始终逐帧盯住该对象的实时位置；与导出相机、
 *   摄像机图标、属性面板的 resolveCameraRotation 同一公式。
 * - manual 模式：两端注视同一点的区间盯住该点；作者手动转过镜头的区间沿用旋转轨道。
 * roll 不属于注视点，始终取轨道或快照值。
 */
function resolveSampledCameraRotation(
  camera: StageCameraObject,
  objects: StageObject[],
  orientations: StageCameraOrientationEntry[],
  time: number,
): StageVec3 {
  const { position, rotation } = camera.transform
  let lookAt = camera.lookAt
  if (lookAt.mode === 'manual') {
    const entry = findOrientationEntry(orientations, camera.id, time)
    if (entry?.mode === 'authored') return rotation
    if (entry?.mode === 'aim') lookAt = entry.lookAt
  }
  const target = resolveCameraLookAtTarget({ ...camera, lookAt }, objects)
  // 目标点与机位重合时方向无定义，保持当前角度，避免镜头突然弹回正前方。
  if (Math.hypot(target.x - position.x, target.y - position.y, target.z - position.z) < 1e-6) return rotation
  return rotationFromPositionAndTarget(position, target, rotation.z)
}

function sameRotation(a: StageVec3, b: StageVec3): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.z - b.z) < 1e-9
}

/**
 * 单帧求值的唯一内核。
 *
 * scrub / 暂停 / 离屏导出消费 `objects`，实时播放消费同一批已求值对象并把分组值推给
 * Three.js applier。两条路径只保留“结果写到哪里”的差异，不再分别求值。
 * 顺序固定：轨道 → 空间路径（覆盖路径段内的位置）→ 摄像机朝向（依赖本帧全部位置）。
 */
export function sampleAnimationFrame(
  objects: StageObject[],
  animation: StageAnimationSampleSource,
  time: number,
): SampledAnimationFrame {
  const trackKeys = new Set<string>()
  const overrides = new Map<string, StageObject>()
  const current = (objectId: string): StageObject | undefined => (
    overrides.get(objectId) ?? objects.find((object) => object.id === objectId)
  )

  for (const track of animation.tracks) {
    trackKeys.add(trackKey(track.objectId, track.propertyPath))
    const descriptor = getAnimatablePropByPath(track.propertyPath)
    if (!descriptor) continue
    const object = current(track.objectId)
    if (!object) continue
    const value = sampleTrack(track, time, descriptor.valueType)
    if (value === undefined) continue
    overrides.set(track.objectId, descriptor.applyToObject(object, value))
  }

  for (const motion of animation.spatialMotions) {
    const position = sampleSpatialMotion(motion, time)
    const object = position ? current(motion.objectId) : undefined
    if (!position || !object) continue
    overrides.set(motion.objectId, { ...object, transform: { ...object.transform, position } })
  }

  const sampledObjects = overrides.size === 0
    ? objects
    : objects.map((object) => overrides.get(object.id) ?? object)
  let cameraChanged = false
  const resolvedObjects = sampledObjects.map((object) => {
    if (object.type !== 'camera') return object
    const rotation = resolveSampledCameraRotation(object, sampledObjects, animation.cameraOrientations, time)
    if (sameRotation(rotation, object.transform.rotation)) return object
    cameraChanged = true
    return { ...object, transform: { ...object.transform, rotation } }
  })

  return { objects: cameraChanged ? resolvedObjects : sampledObjects, trackKeys }
}

export function applyAnimationAtTime(
  objects: StageObject[],
  animation: StageSceneAnimation,
  time: number,
): StageObject[] {
  return sampleAnimationFrame(objects, animation, time).objects
}
