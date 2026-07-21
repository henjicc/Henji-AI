/**
 * 场景动画状态的纯变换助手（不含 UI/store 依赖）：轨道增删改移、关键帧 upsert。
 * store 的动画动作全部委托到这里，保持 store 文件精简、逻辑可单测。
 */

import {
  indexOfKeyframeAtTime,
  upsertKeyframe,
} from '../domain/keyframeEngine'
import type {
  StageEasing,
  StageKeyframe,
  StageKeyframeValue,
  StageSceneAnimation,
  StageTrack,
} from '../domain/animationTypes'

/** 新关键帧默认缓动：线性（用户可在速度曲线编辑器改） */
export const DEFAULT_KEYFRAME_EASING: StageEasing = 'linear'

export function getTrack(
  animation: StageSceneAnimation,
  objectId: string,
  path: string,
): StageTrack | undefined {
  return animation.tracks.find((track) => track.objectId === objectId && track.propertyPath === path)
}

export function hasKeyframeAtTime(
  animation: StageSceneAnimation,
  objectId: string,
  path: string,
  time: number,
): boolean {
  const track = getTrack(animation, objectId, path)
  return !!track && indexOfKeyframeAtTime(track.keyframes, time) >= 0
}

/** 用新关键帧数组替换某轨道；数组为空则删除轨道；轨道不存在则新建 */
function replaceTrackKeyframes(
  animation: StageSceneAnimation,
  objectId: string,
  path: string,
  keyframes: StageKeyframe[],
): StageSceneAnimation {
  const index = animation.tracks.findIndex(
    (track) => track.objectId === objectId && track.propertyPath === path,
  )
  const tracks = animation.tracks.slice()
  if (keyframes.length === 0) {
    if (index >= 0) tracks.splice(index, 1)
    return { ...animation, tracks }
  }
  const nextTrack: StageTrack = { objectId, propertyPath: path, keyframes }
  if (index >= 0) tracks[index] = nextTrack
  else tracks.push(nextTrack)
  return { ...animation, tracks }
}

export function upsertTrackKeyframe(
  animation: StageSceneAnimation,
  objectId: string,
  path: string,
  time: number,
  value: StageKeyframeValue,
  easing: StageEasing = DEFAULT_KEYFRAME_EASING,
): StageSceneAnimation {
  const track = getTrack(animation, objectId, path)
  const base = track?.keyframes ?? []
  const keyframes = upsertKeyframe(base, { time, value, easing })
  return replaceTrackKeyframes(animation, objectId, path, keyframes)
}

export function removeTrackKeyframe(
  animation: StageSceneAnimation,
  objectId: string,
  path: string,
  time: number,
): StageSceneAnimation {
  const track = getTrack(animation, objectId, path)
  if (!track) return animation
  const index = indexOfKeyframeAtTime(track.keyframes, time)
  if (index < 0) return animation
  const keyframes = track.keyframes.slice()
  keyframes.splice(index, 1)
  return replaceTrackKeyframes(animation, objectId, path, keyframes)
}

export function moveTrackKeyframe(
  animation: StageSceneAnimation,
  objectId: string,
  path: string,
  fromTime: number,
  toTime: number,
): StageSceneAnimation {
  const track = getTrack(animation, objectId, path)
  if (!track) return animation
  const index = indexOfKeyframeAtTime(track.keyframes, fromTime)
  if (index < 0) return animation
  const moving = track.keyframes[index]
  // 先移除原点，再按新时间 upsert（同点合并语义交给 upsertKeyframe）
  const rest = track.keyframes.slice()
  rest.splice(index, 1)
  const keyframes = upsertKeyframe(rest, { ...moving, time: toTime })
  return replaceTrackKeyframes(animation, objectId, path, keyframes)
}

export function setTrackKeyframeValue(
  animation: StageSceneAnimation,
  objectId: string,
  path: string,
  time: number,
  value: StageKeyframeValue,
): StageSceneAnimation {
  const track = getTrack(animation, objectId, path)
  if (!track) return animation
  const index = indexOfKeyframeAtTime(track.keyframes, time)
  if (index < 0) return animation
  const keyframes = track.keyframes.slice()
  keyframes[index] = { ...keyframes[index], value }
  return replaceTrackKeyframes(animation, objectId, path, keyframes)
}

export function setTrackKeyframeEasing(
  animation: StageSceneAnimation,
  objectId: string,
  path: string,
  time: number,
  easing: StageEasing,
): StageSceneAnimation {
  const track = getTrack(animation, objectId, path)
  if (!track) return animation
  const index = indexOfKeyframeAtTime(track.keyframes, time)
  if (index < 0) return animation
  const keyframes = track.keyframes.slice()
  keyframes[index] = { ...keyframes[index], easing }
  return replaceTrackKeyframes(animation, objectId, path, keyframes)
}

export function removeTrack(
  animation: StageSceneAnimation,
  objectId: string,
  path: string,
): StageSceneAnimation {
  return replaceTrackKeyframes(animation, objectId, path, [])
}

/** 删除某对象的全部轨道（对象被删除时清理） */
export function removeObjectTracks(
  animation: StageSceneAnimation,
  objectId: string,
): StageSceneAnimation {
  const tracks = animation.tracks.filter((track) => track.objectId !== objectId)
  return tracks.length === animation.tracks.length ? animation : { ...animation, tracks }
}
