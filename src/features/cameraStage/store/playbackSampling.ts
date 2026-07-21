/**
 * 把某时间点的动画采样值落回场景对象（scrub / 暂停 / 停止时用）。
 *
 * 播放中走命令式 appliers 直改 three 对象、不写 store；一旦不在播放态，
 * store 才是权威——此处按各轨道采样并用注册表 applyToObject 生成新对象列表。
 */

import { getAnimatablePropByPath } from '../domain/animatableProps'
import { sampleTrack } from '../domain/keyframeEngine'
import type { StageSceneAnimation } from '../domain/animationTypes'
import type { StageObject } from '../domain/sceneTypes'

export function applyAnimationAtTime(
  objects: StageObject[],
  animation: StageSceneAnimation,
  time: number,
): StageObject[] {
  if (animation.tracks.length === 0) return objects

  const overrides = new Map<string, StageObject>()
  for (const track of animation.tracks) {
    const descriptor = getAnimatablePropByPath(track.propertyPath)
    if (!descriptor) continue
    const current = overrides.get(track.objectId) ?? objects.find((o) => o.id === track.objectId)
    if (!current) continue
    const value = sampleTrack(track, time, descriptor.valueType)
    if (value === undefined) continue
    overrides.set(track.objectId, descriptor.applyToObject(current, value))
  }

  if (overrides.size === 0) return objects
  return objects.map((object) => overrides.get(object.id) ?? object)
}
