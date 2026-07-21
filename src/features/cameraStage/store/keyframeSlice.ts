import type { StoreApi } from 'zustand'
import { getAnimatableGroupByPath, getAnimatablePropByPath } from '../domain/animatableProps'
import {
  hasKeyframeAtTime,
  moveTrackKeyframe,
  removeTrack,
  removeTrackKeyframe,
  setTrackKeyframeEasing,
  setTrackKeyframeValue,
  upsertTrackKeyframe,
} from './animationActions'
import type { CameraStageState } from './cameraStageStore'

/**
 * 关键帧码表/轨道编辑动作 slice（tracked：随 objects/animation 一起进撤销历史）。
 * 从 cameraStageStore.ts 拆出，避免主文件继续膨胀（治理约束：修改即拆分）。
 */

export type KeyframeSliceActions = Pick<
  CameraStageState,
  | 'toggleKeyframeGroup'
  | 'toggleKeyframe'
  | 'keyframeAtCurrentTime'
  | 'removeKeyframe'
  | 'moveKeyframe'
  | 'setKeyframeValue'
  | 'setKeyframesEasing'
  | 'clearTrack'
  | 'setDuration'
  | 'setFps'
>

export function createKeyframeSlice(
  set: StoreApi<CameraStageState>['setState'],
): KeyframeSliceActions {
  return {
    toggleKeyframeGroup: (objectId, groupPath) =>
      set((state) => {
        const object = state.objects.find((item) => item.id === objectId)
        const group = getAnimatableGroupByPath(groupPath)
        if (!object || !group) return {}
        const time = state.playback.currentTime
        const allKeyed = group.children.every((child) =>
          hasKeyframeAtTime(state.animation, objectId, child.path, time),
        )
        let animation = state.animation
        if (allKeyed) {
          // 整组均已有点 → 删除各分量在当前时间的点
          for (const child of group.children) {
            animation = removeTrackKeyframe(animation, objectId, child.path, time)
          }
        } else {
          // 否则补齐各分量在当前时间的点（缺则建轨）
          for (const child of group.children) {
            animation = upsertTrackKeyframe(animation, objectId, child.path, time, child.getValue(object))
          }
        }
        return { animation }
      }),

    toggleKeyframe: (objectId, path) =>
      set((state) => {
        const object = state.objects.find((item) => item.id === objectId)
        const descriptor = getAnimatablePropByPath(path)
        if (!object || !descriptor) return {}
        const time = state.playback.currentTime
        if (hasKeyframeAtTime(state.animation, objectId, path, time)) {
          return { animation: removeTrackKeyframe(state.animation, objectId, path, time) }
        }
        return {
          animation: upsertTrackKeyframe(state.animation, objectId, path, time, descriptor.getValue(object)),
        }
      }),

    keyframeAtCurrentTime: (objectId, path) =>
      set((state) => {
        const object = state.objects.find((item) => item.id === objectId)
        const descriptor = getAnimatablePropByPath(path)
        if (!object || !descriptor) return {}
        return {
          animation: upsertTrackKeyframe(
            state.animation,
            objectId,
            path,
            state.playback.currentTime,
            descriptor.getValue(object),
          ),
        }
      }),

    removeKeyframe: (objectId, path, time) =>
      set((state) => ({ animation: removeTrackKeyframe(state.animation, objectId, path, time) })),

    moveKeyframe: (objectId, path, fromTime, toTime) =>
      set((state) => ({ animation: moveTrackKeyframe(state.animation, objectId, path, fromTime, toTime) })),

    setKeyframeValue: (objectId, path, time, value) =>
      set((state) => ({
        animation: setTrackKeyframeValue(state.animation, objectId, path, time, value),
      })),

    setKeyframesEasing: (targets, easing) =>
      set((state) => {
        let animation = state.animation
        for (const target of targets) {
          animation = setTrackKeyframeEasing(animation, target.objectId, target.path, target.time, easing)
        }
        return animation === state.animation ? {} : { animation }
      }),

    clearTrack: (objectId, path) =>
      set((state) => ({ animation: removeTrack(state.animation, objectId, path) })),

    setDuration: (duration) =>
      set((state) => ({
        animation: { ...state.animation, duration: Math.max(0.1, duration) },
      })),

    setFps: (fps) =>
      set((state) => ({ animation: { ...state.animation, fps: Math.max(1, Math.round(fps)) } })),
  }
}
