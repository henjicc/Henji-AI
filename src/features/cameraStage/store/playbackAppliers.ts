/**
 * 播放期命令式采样应用注册表（非响应式，不进 zustand / 撤销历史）。
 *
 * 播放时逐帧直改 three 对象而不写 store（性能约束，见 3.1 方案）：渲染组件把
 * 「某对象某属性路径 → 如何把采样值写进 three 对象」的应用函数注册进来，播放驱动
 * 逐帧采样后按 objectId + path 调用全部应用函数直接写入。暂停/停止时再由 store 落回数据。
 *
 * 同一 objectId+path 允许多个应用函数并存（如相机位置既驱动自由视角下的摄像机图标 group、
 * 又驱动摄像机视角下的真实渲染相机），逐个调用互不覆盖。
 */

import type { StageKeyframeValue, StageTrack } from '../domain/animationTypes'
import { listAnimatableGroups } from '../domain/animatableProps'
import { sampleTrack } from '../domain/keyframeEngine'
import { rotationFromPositionAndTarget } from '../domain/cameraUtils'
import type { StageObject, StageVec3 } from '../domain/sceneTypes'

export type PlaybackApplyFn = (value: StageKeyframeValue, time: number) => void

function keyOf(objectId: string, path: string): string {
  return `${objectId}::${path}`
}

const appliers = new Map<string, Set<PlaybackApplyFn>>()

/** 注册应用函数，返回注销函数（渲染组件挂载时注册、卸载时注销） */
export function registerPlaybackApplier(
  objectId: string,
  path: string,
  fn: PlaybackApplyFn,
): () => void {
  const key = keyOf(objectId, path)
  let set = appliers.get(key)
  if (!set) {
    set = new Set()
    appliers.set(key, set)
  }
  set.add(fn)
  return () => {
    const current = appliers.get(key)
    if (!current) return
    current.delete(fn)
    if (current.size === 0) appliers.delete(key)
  }
}

/** 调用某 objectId+path 上注册的全部应用函数 */
export function runPlaybackAppliers(
  objectId: string,
  path: string,
  value: StageKeyframeValue,
  time: number,
): void {
  const set = appliers.get(keyOf(objectId, path))
  if (!set) return
  for (const fn of set) fn(value, time)
}

/** 按当前时间采样得到的位置；没有位置轨道的对象退回自身静态位置。 */
function sampledPositions(
  objects: StageObject[],
  trackByKey: Map<string, StageTrack>,
  time: number,
): Map<string, StageVec3> {
  const positions = new Map<string, StageVec3>()
  for (const object of objects) {
    const position = { ...object.transform.position }
    for (const axis of ['x', 'y', 'z'] as const) {
      const track = trackByKey.get(`${object.id}::transform.position.${axis}`)
      if (!track) continue
      const sampled = sampleTrack(track, time, 'scalar')
      if (typeof sampled === 'number') position[axis] = sampled
    }
    positions.set(object.id, position)
  }
  return positions
}

/**
 * 播放期重算摄像机朝向。
 *
 * 摄像机的朝向不是动画轨道，而是由 `lookAt` 在渲染时解算的——scrub 时 store 一变，组件重算
 * `staticRotation` 并同步进采样引用，所以拖时间指针看到的朝向是对的。但**播放时按性能约束
 * 不写 store**，那个 layout effect 一次都不会跑，朝向就冻结在按下空格那一帧：环绕运镜只写了
 * 三条 `transform.position` 轨道，没有旋转轨道，于是摄像机绕着飞、镜头始终朝前。
 *
 * 这里按采样后的位置重算朝向，走已有的 `transform.rotation` applier 通道，不新增第二条路径。
 * 注视目标本身也用采样位置，所以目标物体在动（比如上下漂浮）时镜头会跟着它。
 */
function applyCameraLookAtRotation(
  objects: StageObject[],
  trackByKey: Map<string, StageTrack>,
  positions: Map<string, StageVec3>,
  time: number,
): void {
  for (const object of objects) {
    if (object.type !== 'camera') continue
    // 作者显式打了旋转关键帧时以作者为准，不要用 lookAt 覆盖
    const hasAuthoredRotation = (['x', 'y', 'z'] as const)
      .some((axis) => trackByKey.has(`${object.id}::transform.rotation.${axis}`))
    if (hasAuthoredRotation) continue

    const cameraPosition = positions.get(object.id) ?? object.transform.position
    const lookAt = object.lookAt
    let target: StageVec3
    if (lookAt.mode === 'manual') {
      target = lookAt.target
    } else {
      const targetObject = objects.find((candidate) => candidate.id === lookAt.objectId)
      const targetPosition = positions.get(lookAt.objectId)
      if (!targetObject || !targetPosition) {
        target = lookAt.fallbackTarget
      } else {
        // 与 getObjectLookAtPoint 同一套规则：角色看胸口，其余看自身原点
        target = targetObject.type === 'character'
          ? { ...targetPosition, y: targetPosition.y + targetObject.transform.scale.y }
          : targetPosition
      }
    }
    runPlaybackAppliers(
      object.id,
      'transform.rotation',
      rotationFromPositionAndTarget(cameraPosition, target, object.transform.rotation.z),
      time,
    )
  }
}

/**
 * 按指定时间采样动画轨道并同步推送到 Three.js 命令式对象。
 * 播放预览与离屏导出共用同一条采样路径，导出因此无需等待隐藏窗口约 1fps 的 RAF。
 */
export function applyAnimationToPlaybackAppliers(
  objects: StageObject[],
  tracks: StageTrack[],
  time: number,
): void {
  const trackByKey = new Map<string, StageTrack>()
  for (const track of tracks) trackByKey.set(`${track.objectId}::${track.propertyPath}`, track)

  for (const object of objects) {
    for (const group of listAnimatableGroups(object)) {
      if (group.valueType === 'vec3') {
        const output: StageVec3 = { ...(group.getBaseValue(object) as StageVec3) }
        let sampledTrack = false
        for (const child of group.children) {
          const track = trackByKey.get(`${object.id}::${child.path}`)
          if (!track || !child.axis) continue
          const sampled = sampleTrack(track, time, 'scalar')
          if (sampled === undefined) continue
          output[child.axis] = sampled as number
          sampledTrack = true
        }
        const drivesCameraEffectors = object.type === 'camera'
          && group.groupPath === 'transform.position'
          && object.effectors.some((effector) => effector.enabled)
        if (sampledTrack || drivesCameraEffectors) {
          runPlaybackAppliers(object.id, group.groupPath, output, time)
        }
        continue
      }

      const child = group.children[0]
      const track = trackByKey.get(`${object.id}::${child.path}`)
      if (!track) continue
      const sampled = sampleTrack(track, time, group.valueType)
      if (sampled !== undefined) runPlaybackAppliers(object.id, group.groupPath, sampled, time)
    }
  }

  // 位置全部推送完之后再定朝向：注视目标可能自己也在动，必须用它这一帧的采样位置
  applyCameraLookAtRotation(objects, trackByKey, sampledPositions(objects, trackByKey, time), time)
}
