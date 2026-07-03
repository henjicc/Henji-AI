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

import type { StageKeyframeValue } from '../domain/animationTypes'

export type PlaybackApplyFn = (value: StageKeyframeValue) => void

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
): void {
  const set = appliers.get(keyOf(objectId, path))
  if (!set) return
  for (const fn of set) fn(value)
}
