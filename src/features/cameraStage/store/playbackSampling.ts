/**
 * 把某时间点的动画采样值落回场景对象（scrub / 暂停 / 停止时用）。
 *
 * 播放中走命令式 appliers 直改 three 对象、不写 store；一旦不在播放态，
 * store 才是权威——此处按各轨道采样并用注册表 applyToObject 生成新对象列表。
 */

import { getAnimatablePropByPath } from '../domain/animatableProps'
import { sampleTrack } from '../domain/keyframeEngine'
import type { StageSceneAnimation, StageTrack } from '../domain/animationTypes'
import type { StageObject } from '../domain/sceneTypes'

export interface SampledAnimationFrame {
  objects: StageObject[]
  trackKeys: ReadonlySet<string>
}

function trackKey(objectId: string, propertyPath: string): string {
  return `${objectId}::${propertyPath}`
}

/**
 * 单帧轨道求值的唯一内核。
 *
 * scrub / 暂停 / 离屏导出消费 `objects`，实时播放消费同一批已求值对象并把分组值推给
 * Three.js applier。两条路径只保留“结果写到哪里”的差异，不再分别调用 `sampleTrack`。
 */
export function sampleAnimationFrame(
  objects: StageObject[],
  tracks: StageTrack[],
  time: number,
): SampledAnimationFrame {
  const trackKeys = new Set<string>()
  if (tracks.length === 0) return { objects, trackKeys }

  const overrides = new Map<string, StageObject>()
  for (const track of tracks) {
    trackKeys.add(trackKey(track.objectId, track.propertyPath))
    const descriptor = getAnimatablePropByPath(track.propertyPath)
    if (!descriptor) continue
    const current = overrides.get(track.objectId) ?? objects.find((object) => object.id === track.objectId)
    if (!current) continue
    const value = sampleTrack(track, time, descriptor.valueType)
    if (value === undefined) continue
    overrides.set(track.objectId, descriptor.applyToObject(current, value))
  }

  return {
    objects: overrides.size === 0
      ? objects
      : objects.map((object) => overrides.get(object.id) ?? object),
    trackKeys,
  }
}

export function applyAnimationAtTime(
  objects: StageObject[],
  animation: StageSceneAnimation,
  time: number,
): StageObject[] {
  return sampleAnimationFrame(objects, animation.tracks, time).objects
}
