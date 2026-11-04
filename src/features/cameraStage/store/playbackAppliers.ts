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

import type { StageAnimationSampleSource, StageKeyframeValue } from '../domain/animationTypes'
import { listAnimatableGroups } from '../domain/animatableProps'
import { resolveCameraEffectors } from '../domain/cameraRigs'
import type { StageObject } from '../domain/sceneTypes'
import { sampleAnimationFrame } from './playbackSampling'

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
 * 按指定时间采样动画并同步推送到 Three.js 命令式对象。
 * 播放预览与离屏导出共用同一条采样内核，导出因此无需等待隐藏窗口约 1fps 的 RAF。
 *
 * 摄像机朝向每帧都推送内核求出的结果：播放按性能约束不写 store，渲染组件不会重算朝向，
 * 若只在有旋转轨道时推送，环绕运镜会只有位置在动、镜头冻结在按下空格那一帧。
 */
export function applyAnimationToPlaybackAppliers(
  objects: StageObject[],
  animation: StageAnimationSampleSource,
  time: number,
): void {
  const frame = sampleAnimationFrame(objects, animation, time)
  // 城市群里绝大多数物体没有轨道；逐个展开属性组再查轨道键，上万个物体每帧就要几十毫秒
  const trackedObjectIds = new Set(animation.tracks.map((track) => track.objectId))

  for (const object of frame.objects) {
    if (object.type !== 'camera' && !trackedObjectIds.has(object.id)) continue
    for (const group of listAnimatableGroups(object)) {
      if (object.type === 'camera' && group.groupPath === 'transform.rotation') {
        runPlaybackAppliers(object.id, group.groupPath, group.getBaseValue(object), time)
        continue
      }
      const sampledTrack = group.children.some((child) => (
        frame.trackKeys.has(`${object.id}::${child.path}`)
      ))
      const drivesCameraEffectors = object.type === 'camera'
        && group.groupPath === 'transform.position'
        && resolveCameraEffectors(object).some((effector) => effector.enabled)
      if (sampledTrack || drivesCameraEffectors) {
        runPlaybackAppliers(object.id, group.groupPath, group.getBaseValue(object), time)
      }
    }
  }
}
