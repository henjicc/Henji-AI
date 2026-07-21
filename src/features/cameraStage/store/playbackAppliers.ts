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
}
