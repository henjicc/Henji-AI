import type { StoreApi } from 'zustand'
import { quantizeToFrame } from '../stateKeyframes/timeline/stateKeyframeClipGeometry'
import {
  pauseCameraStagePlaybackRuntime,
  readCameraStagePlaybackRuntime,
  seekCameraStagePlaybackRuntime,
} from '../scene/playbackRuntime'
import type { CameraStageState } from './cameraStageStore'

export type PlaybackSliceActions = Pick<
  CameraStageState,
  'play' | 'pause' | 'stop' | 'seek' | 'setPlaybackTime' | 'toggleLoop'
>

export function createPlaybackSlice(
  set: StoreApi<CameraStageState>['setState'],
  get: StoreApi<CameraStageState>['getState'],
  applySampledObjectsSilently: (time: number) => void,
  background = false,
): PlaybackSliceActions {
  return {
    play: () => {
      const state = get()
      const canPlay = state.stateKeyframes.length > 0 && state.animation.duration > 0
      if (!canPlay) return
      const time = state.playback.currentTime >= state.animation.duration
        ? 0
        : state.playback.currentTime
      if (!background) seekCameraStagePlaybackRuntime(time, true)
      set((current) => ({ playback: { ...current.playback, playing: true, currentTime: time } }))
    },

    pause: () => {
      const state = get()
      // 播放态以逐帧 runtime 为准；UI 播放头是低频投影，不能拿它作为暂停落点。
      const continuousTime = state.playback.playing && !background
        ? readCameraStagePlaybackRuntime().time
        : state.playback.currentTime
      const snapped = quantizeToFrame(continuousTime, state.animation.fps)
      applySampledObjectsSilently(snapped)
      if (!background) pauseCameraStagePlaybackRuntime(snapped)
      set((current) => ({ playback: { ...current.playback, playing: false, currentTime: snapped } }))
    },

    stop: () => {
      applySampledObjectsSilently(0)
      if (!background) pauseCameraStagePlaybackRuntime(0)
      set((state) => ({ playback: { ...state.playback, playing: false, currentTime: 0 } }))
    },

    seek: (time) => {
      const state = get()
      const clamped = Math.max(0, quantizeToFrame(time, state.animation.fps))
      if (!background) seekCameraStagePlaybackRuntime(clamped, state.playback.playing)
      if (!state.playback.playing) applySampledObjectsSilently(clamped)
      set((current) => ({ playback: { ...current.playback, currentTime: clamped } }))
    },

    // 仅供逐帧驱动低频投影 UI；runtime 已经在当前帧推进，禁止从这里反向改写它。
    setPlaybackTime: (time) => set((state) => (
      state.playback.currentTime === time
        ? state
        : { playback: { ...state.playback, currentTime: time } }
    )),

    toggleLoop: () => set((state) => ({ playback: { ...state.playback, loop: !state.playback.loop } })),
  }
}
