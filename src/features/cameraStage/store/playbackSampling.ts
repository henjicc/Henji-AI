/**
 * 把某时间点的动画采样值落回场景对象（scrub / 暂停 / 停止时用）。
 *
 * 播放中走命令式 appliers 直改 three 对象、不写 store；一旦不在播放态，
 * store 才是权威——此处按各轨道采样并用注册表 applyToObject 生成新对象列表。
 */

import { getAnimatablePropByPath } from '../domain/animatableProps'
import { createAimLagSampler, type AimLagSampler } from '../domain/cameraAimLag'
import { createCameraFollowSampler, findCameraFollowEntry, type CameraFollowSampler } from '../domain/cameraFollow'
import { heldCharacterMotionAt, sameCharacterMotion, sampleCharacterHeading } from '../domain/characterMotionTimeline'
import { resolveCameraAimLag } from '../domain/cameraRigs'
import { resolveCameraLookAtTarget, rotationFromPositionAndTarget } from '../domain/cameraUtils'
import { sampleTrack } from '../domain/keyframeEngine'
import { sampleSpatialMotion } from '../domain/spatialPath'
import type { StageAnimationSampleSource, StageCameraFollowEntry, StageCameraOrientationEntry, StageSceneAnimation } from '../domain/animationTypes'
import type { StageCameraObject, StageObject, StageVec3 } from '../domain/sceneTypes'

export interface SampledAnimationFrame {
  objects: StageObject[]
  trackKeys: ReadonlySet<string>
}

function trackKey(objectId: string, propertyPath: string): string {
  return `${objectId}::${propertyPath}`
}

/*
 * 上万个物体都带轨道时逐条 find 是平方级。播放期间对象数组不变（不写 store），
 * 索引按数组缓存，每帧不必重建。
 */
const objectIndexCache = new WeakMap<StageObject[], Map<string, StageObject>>()

function indexObjects(objects: StageObject[]): Map<string, StageObject> {
  let index = objectIndexCache.get(objects)
  if (!index) {
    index = new Map()
    for (const object of objects) if (!index.has(object.id)) index.set(object.id, object)
    objectIndexCache.set(objects, index)
  }
  return index
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

/** 不含注视跟随滞后的朝向：位置之后按同一帧里注视目标的采样位置求俯仰与水平角。 */
function resolveDirectCameraRotation(
  camera: StageCameraObject,
  objects: StageObject[],
  orientations: StageCameraOrientationEntry[],
  time: number,
  followAim?: StageVec3,
): StageVec3 {
  const { position, rotation } = camera.transform
  if (followAim) {
    if (Math.hypot(followAim.x - position.x, followAim.y - position.y, followAim.z - position.z) < 1e-6) return rotation
    return rotationFromPositionAndTarget(position, followAim, rotation.z)
  }
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

const DEG = Math.PI / 180

function forwardOf(rotation: StageVec3): StageVec3 {
  return {
    x: -Math.sin(rotation.y * DEG) * Math.cos(rotation.x * DEG),
    y: Math.sin(rotation.x * DEG),
    z: -Math.cos(rotation.y * DEG) * Math.cos(rotation.x * DEG),
  }
}

/** 只含该摄像机与它注视对象的编译产物：滞后预积分逐步采样时不必扫全场景的轨道。路径链保持原对象，共用运行时缓存。 */
function sourceFor(animation: StageAnimationSampleSource, objectIds: ReadonlySet<string>): StageAnimationSampleSource {
  return {
    tracks: animation.tracks.filter((track) => objectIds.has(track.objectId)),
    spatialMotions: animation.spatialMotions.filter((motion) => objectIds.has(motion.objectId)),
    cameraOrientations: animation.cameraOrientations.filter((entry) => objectIds.has(entry.objectId)),
    characterMotions: (animation.characterMotions ?? []).filter((timeline) => objectIds.has(timeline.objectId)),
    characterHeadings: (animation.characterHeadings ?? []).filter((entry) => objectIds.has(entry.objectId)),
    cameraFollows: (animation.cameraFollows ?? []).filter((entry) => objectIds.has(entry.cameraId) && objectIds.has(entry.follow.subjectId)),
  }
}

/** 最后一次变化的时刻；滞后积分到这里为止，之后输入不变、镜头继续收敛。 */
function animatedUntil(source: StageAnimationSampleSource): number {
  let end = 0
  for (const track of source.tracks) end = Math.max(end, track.keyframes[track.keyframes.length - 1]?.time ?? 0)
  for (const motion of source.spatialMotions) end = Math.max(end, motion.segments[motion.segments.length - 1]?.endTime ?? 0)
  for (const entry of source.cameraOrientations) end = Math.max(end, entry.endTime)
  for (const entry of source.cameraFollows ?? []) end = Math.max(end, entry.endTime)
  return end
}

/** 编译产物里被轨道或路径链驱动的分量（对象 id:属性路径）。 */
const drivenCache = new WeakMap<StageAnimationSampleSource, Set<string>>()

function drivenComponents(animation: StageAnimationSampleSource): Set<string> {
  let driven = drivenCache.get(animation)
  if (!driven) {
    driven = new Set(animation.tracks.map((track) => `${track.objectId}:${track.propertyPath}`))
    for (const motion of animation.spatialMotions) {
      for (const axis of ['x', 'y', 'z']) driven.add(`${motion.objectId}:transform.position.${axis}`)
    }
    drivenCache.set(animation, driven)
  }
  return driven
}

/**
 * 没有被动画驱动、采样时直接取对象当前值的位置与缩放分量；它们变了，滞后的输入也就变了。
 * 旋转不算输入：摄像机在注视区间的俯仰与水平角由注视点求出（拖动时间轴后对象上存的就是上一帧的结果），
 * 手动转镜头的区间由旋转轨道驱动；注视点只取目标的位置与缩放。
 */
function undrivenTransform(objects: StageObject[], driven: ReadonlySet<string>): number[] {
  const values: number[] = []
  for (const object of objects) {
    for (const group of ['position', 'scale'] as const) {
      for (const axis of ['x', 'y', 'z'] as const) {
        if (!driven.has(`${object.id}:transform.${group}.${axis}`)) values.push(object.transform[group][axis])
      }
    }
  }
  return values
}

/*
 * 滞后要从时间轴起点积分。先按编译产物对象查（播放、拖动时间轴每帧只做这一次查找），没有再按输入内容查：
 * 这台摄像机与注视对象的轨道、路径链、朝向区间，以及没被驱动的变换分量。编辑别的对象会重编译出新的产物，
 * 但这两个对象的输入没变，照样命中，不必重新积分。
 */
const aimLagByAnimation = new WeakMap<StageAnimationSampleSource, Map<string, AimLagSampler | null>>()
const aimLagByContent = new Map<string, AimLagSampler | null>()
const AIM_LAG_CACHE_SIZE = 16

function aimLagSamplerFor(
  camera: StageCameraObject,
  objects: StageObject[],
  animation: StageAnimationSampleSource,
  delay: number,
): AimLagSampler | null {
  const targetId = camera.lookAt.mode === 'object' ? camera.lookAt.objectId : null
  const followed = new Set((animation.cameraFollows ?? []).filter((entry) => entry.cameraId === camera.id).map((entry) => entry.follow.subjectId))
  const others = objects.filter((object) => object.id !== camera.id && (object.id === targetId || followed.has(object.id)))
  const target = targetId ? others.find((object) => object.id === targetId) : undefined
  const involved = [camera, ...others]
  const key = JSON.stringify([camera.id, delay, camera.lookAt, target?.type ?? null, others.map((object) => object.id), undrivenTransform(involved, drivenComponents(animation))])
  let byKey = aimLagByAnimation.get(animation)
  if (!byKey) {
    byKey = new Map()
    aimLagByAnimation.set(animation, byKey)
  }
  if (byKey.has(key)) return byKey.get(key) ?? null
  // 播放中拖动未被驱动的分量不会重编译，同一份产物下的键会不断变化：只留最近的若干个。
  if (byKey.size >= AIM_LAG_CACHE_SIZE) byKey.delete(byKey.keys().next().value as string)
  const source = sourceFor(animation, new Set(involved.map((object) => object.id)))
  const contentKey = JSON.stringify([key, source])
  let sampler = aimLagByContent.get(contentKey)
  if (sampler === undefined) {
    const end = animatedUntil(source)
    sampler = end > 0
      ? createAimLagSampler(delay, 0, end, (time) => {
        const frame = sampleAnimationFrame(involved, source, time, { aimLag: false }).objects
        const sampledCamera = frame[0] as StageCameraObject
        return forwardOf(sampledCamera.transform.rotation)
      })
      : null
    if (aimLagByContent.size >= AIM_LAG_CACHE_SIZE) aimLagByContent.delete(aimLagByContent.keys().next().value as string)
    aimLagByContent.set(contentKey, sampler)
  }
  byKey.set(key, sampler)
  return sampler
}

/*
 * 跟拍要从跟拍开始积分主体位置。与注视滞后同样先按编译产物对象、再按输入内容（这一段跟拍、主体的轨道与
 * 路径链、没被驱动的变换分量）缓存，编辑无关对象时不必重新积分。
 */
const followByAnimation = new WeakMap<StageAnimationSampleSource, Map<string, CameraFollowSampler>>()
const followByContent = new Map<string, CameraFollowSampler>()
const FOLLOW_CACHE_SIZE = 16

/** 跟拍开始时的行进方向：主体在这段时间里第一次走出 0.3 米的方向；一直没走动就取它的朝向。 */
export function initialTravelHeading(subjectAt: (time: number) => StageVec3, startTime: number, endTime: number, facing: number): number {
  const start = subjectAt(startTime)
  const step = Math.max(1 / 30, (endTime - startTime) / 120)
  for (let time = startTime + step; time <= endTime + 1e-9; time += step) {
    const point = subjectAt(time)
    if (Math.hypot(point.x - start.x, point.z - start.z) >= 0.3) return Math.atan2(point.x - start.x, point.z - start.z) * 180 / Math.PI
  }
  return facing
}

function followSamplerFor(entry: StageCameraFollowEntry, subject: StageObject, animation: StageAnimationSampleSource): CameraFollowSampler {
  const key = JSON.stringify([entry, undrivenTransform([subject], drivenComponents(animation))])
  let byKey = followByAnimation.get(animation)
  if (!byKey) {
    byKey = new Map()
    followByAnimation.set(animation, byKey)
  }
  const cached = byKey.get(key)
  if (cached) return cached
  if (byKey.size >= FOLLOW_CACHE_SIZE) byKey.delete(byKey.keys().next().value as string)
  const source = sourceFor(animation, new Set([subject.id]))
  const contentKey = JSON.stringify([key, source])
  let sampler = followByContent.get(contentKey)
  if (!sampler) {
    const subjectAt = (time: number): StageVec3 => sampleAnimationFrame([subject], source, time, { aimLag: false }).objects[0].transform.position
    const facing = sampleAnimationFrame([subject], source, entry.startTime, { aimLag: false }).objects[0].transform.rotation.y
    sampler = createCameraFollowSampler(entry, subjectAt, initialTravelHeading(subjectAt, entry.startTime, entry.endTime, facing))
    if (followByContent.size >= FOLLOW_CACHE_SIZE) followByContent.delete(followByContent.keys().next().value as string)
    followByContent.set(contentKey, sampler)
  }
  byKey.set(key, sampler)
  return sampler
}

/** 跟拍区间内的机位与注视点；不在跟拍区间或主体不在场景里返回 undefined。 */
function resolveCameraFollowPose(
  camera: StageCameraObject,
  objects: StageObject[],
  animation: StageAnimationSampleSource,
  time: number,
): { position: StageVec3; aimTarget: StageVec3 } | undefined {
  const entry = findCameraFollowEntry(animation.cameraFollows, camera.id, time)
  if (!entry) return undefined
  const subject = indexObjects(objects).get(entry.follow.subjectId)
  return subject ? followSamplerFor(entry, subject, animation)(time) : undefined
}

/**
 * 摄像机朝向的唯一求解点：采样位置之后、按同一帧里注视目标的采样位置求俯仰与水平角，再叠加注视跟随滞后。
 *
 * - object 模式：注视对象是摄像机级设置，始终逐帧盯住该对象的实时位置；与导出相机、
 *   摄像机图标、属性面板的 resolveCameraRotation 同一公式。
 * - manual 模式：两端注视同一点的区间盯住该点；作者手动转过镜头的区间沿用旋转轨道。
 * - 注视跟随滞后（设备默认或摄像机单独设置）对上面得到的朝向统一滤波，只在动画产物里有这台摄像机时生效。
 * roll 不属于注视点，始终取轨道或快照值。
 */
function resolveSampledCameraRotation(
  camera: StageCameraObject,
  objects: StageObject[],
  animation: StageAnimationSampleSource,
  time: number,
  options: { aimLag?: boolean } = {},
): StageVec3 {
  const direct = resolveDirectCameraRotation(camera, objects, animation.cameraOrientations, time, resolveCameraFollowPose(camera, objects, animation, time)?.aimTarget)
  const delay = options.aimLag === false ? 0 : resolveCameraAimLag(camera)
  if (delay <= 0 || !animation.cameraOrientations.some((entry) => entry.objectId === camera.id)) return direct
  const sampler = aimLagSamplerFor(camera, objects, animation, delay)
  if (!sampler) return direct
  const forward = sampler(time)
  const position = camera.transform.position
  return rotationFromPositionAndTarget(
    position,
    { x: position.x + forward.x, y: position.y + forward.y, z: position.z + forward.z },
    direct.z,
  )
}

/**
 * 摄像机视口实际看向的点：注视目标的实时位置，叠加注视跟随滞后后沿镜头方向取同样的距离。
 * 视口与摄像机图标在 object 模式下按“机位 + 这个点”求朝向，所以拖动时间轴、导出与播放看到的是同一个朝向。
 */
export function resolveCameraViewTarget(
  camera: StageCameraObject,
  objects: StageObject[],
  animation: StageAnimationSampleSource,
  time: number,
): StageVec3 {
  const target = resolveCameraFollowPose(camera, objects, animation, time)?.aimTarget ?? resolveCameraLookAtTarget(camera, objects)
  if (resolveCameraAimLag(camera) <= 0) return target
  const position = camera.transform.position
  const distance = Math.hypot(target.x - position.x, target.y - position.y, target.z - position.z)
  if (distance < 1e-6) return target
  const forward = forwardOf(resolveSampledCameraRotation(camera, objects, animation, time))
  return { x: position.x + forward.x * distance, y: position.y + forward.y * distance, z: position.z + forward.z * distance }
}

function sameRotation(a: StageVec3, b: StageVec3): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9 && Math.abs(a.z - b.z) < 1e-9
}

/**
 * 单帧求值的唯一内核。
 *
 * scrub / 暂停 / 离屏导出消费 `objects`，实时播放消费同一批已求值对象并把分组值推给
 * Three.js applier。两条路径只保留“结果写到哪里”的差异，不再分别求值。
 * 顺序固定：轨道 → 空间路径（覆盖路径段内的位置）→ 角色走跑朝向 → 跟拍机位（依赖主体位置）
 * → 摄像机朝向（依赖本帧全部位置）。
 */
export function sampleAnimationFrame(
  objects: StageObject[],
  animation: StageAnimationSampleSource,
  time: number,
  options: { aimLag?: boolean } = {},
): SampledAnimationFrame {
  const trackKeys = new Set<string>()
  const overrides = new Map<string, StageObject>()
  const current = (objectId: string): StageObject | undefined => (
    overrides.get(objectId) ?? indexObjects(objects).get(objectId)
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

  for (const entry of animation.characterHeadings ?? []) {
    if (time < entry.startTime || time > entry.endTime) continue
    const object = current(entry.objectId)
    const yaw = sampleCharacterHeading([entry], entry.objectId, time)
    if (!object || yaw === undefined) continue
    overrides.set(entry.objectId, { ...object, transform: { ...object.transform, rotation: { ...object.transform.rotation, y: yaw } } })
  }

  // 角色此刻的卡内动作写回对象：在这一刻插卡、读回、面板显示的都是时间线上正在做的动作，而不是对象的基础动作。
  for (const timeline of animation.characterMotions ?? []) {
    const object = current(timeline.objectId)
    const motion = object?.type === 'character' ? heldCharacterMotionAt(timeline, time) : undefined
    if (!object || object.type !== 'character' || !motion || sameCharacterMotion(object.motion, motion)) continue
    overrides.set(object.id, { ...object, motion })
  }

  if (animation.cameraFollows?.length) {
    const frameObjects = objects.map((object) => overrides.get(object.id) ?? object)
    for (const entry of animation.cameraFollows) {
      if (time < entry.startTime || time > entry.endTime) continue
      const camera = current(entry.cameraId)
      const subject = current(entry.follow.subjectId)
      if (camera?.type !== 'camera' || !subject) continue
      const pose = resolveCameraFollowPose(camera, frameObjects, animation, time)
      if (pose) overrides.set(camera.id, { ...camera, transform: { ...camera.transform, position: pose.position } })
    }
  }

  const sampledObjects = overrides.size === 0
    ? objects
    : objects.map((object) => overrides.get(object.id) ?? object)
  let cameraChanged = false
  const resolvedObjects = sampledObjects.map((object) => {
    if (object.type !== 'camera') return object
    const rotation = resolveSampledCameraRotation(object, sampledObjects, animation, time, options)
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

/** 只含这些对象的编译产物；摄像机朝向不影响位置，不参与。 */
export function animationForObjects(animation: StageSceneAnimation, objectIds: ReadonlySet<string>): StageAnimationSampleSource {
  return {
    tracks: animation.tracks.filter((track) => objectIds.has(track.objectId)),
    spatialMotions: animation.spatialMotions.filter((motion) => objectIds.has(motion.objectId)),
    cameraOrientations: [],
    characterHeadings: animation.characterHeadings.filter((entry) => objectIds.has(entry.objectId)),
    cameraFollows: animation.cameraFollows.filter((entry) => objectIds.has(entry.cameraId) && objectIds.has(entry.follow.subjectId)),
  }
}

/**
 * 一个对象在这些时刻的实际位置，与播放、拖播放头、导出走同一条采样链（平滑衔接的拐角融合、设备时间律、跟拍都算在内）。
 * 跟拍的摄像机连同主体一起采样，机位才是跟拍算出的位置；其余对象不参与，长轨迹取样也便宜。
 */
export function sampleObjectTrajectory(
  objects: readonly StageObject[],
  animation: StageSceneAnimation,
  objectId: string,
  times: readonly number[],
): StageVec3[] {
  const object = objects.find((item) => item.id === objectId)
  if (!object) return []
  const followed = new Set(animation.cameraFollows.filter((entry) => entry.cameraId === objectId).map((entry) => entry.follow.subjectId))
  const involved = [object, ...objects.filter((item) => followed.has(item.id))]
  const source = animationForObjects(animation, new Set(involved.map((item) => item.id)))
  return times.map((time) => sampleAnimationFrame(involved, source, time).objects[0].transform.position)
}
