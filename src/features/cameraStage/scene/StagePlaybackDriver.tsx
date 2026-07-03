import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { getAnimatablePropByPath } from '../domain/animatableProps'
import { sampleTrack } from '../domain/keyframeEngine'
import { runPlaybackAppliers } from '../store/playbackAppliers'
import { useCameraStageStore } from '../store/cameraStageStore'

/**
 * 播放采样驱动：播放态下每帧推进播放头，采样全部轨道并经命令式 appliers 直改 three 对象，
 * 不逐帧写 store（性能约束）；仅低频回写播放头供 UI 显示。非播放态不做任何事（scrub 走 store）。
 */

/** 播放头 UI 回写节流间隔（秒）：约 20fps，避免逐帧触发面板重渲染 */
const PLAYHEAD_PUSH_INTERVAL = 0.05
/** 单帧最大步进：防止切后台/卡顿后一次跳过大段动画 */
const MAX_FRAME_DELTA = 0.1

const StagePlaybackDriver: React.FC = () => {
  const timeRef = useRef(0)
  const lastPushRef = useRef(0)
  const wasPlayingRef = useRef(false)

  useFrame((_, rawDelta) => {
    const state = useCameraStageStore.getState()
    const { playing, currentTime, loop } = state.playback

    if (!playing) {
      wasPlayingRef.current = false
      timeRef.current = currentTime
      lastPushRef.current = currentTime
      return
    }
    // 刚进入播放：以 store 播放头为起点
    if (!wasPlayingRef.current) {
      wasPlayingRef.current = true
      timeRef.current = currentTime
      lastPushRef.current = currentTime
    }

    const { tracks, duration } = state.animation
    let t = timeRef.current + Math.min(rawDelta, MAX_FRAME_DELTA)
    let reachedEnd = false
    if (t >= duration) {
      if (loop) {
        t = duration <= 0 ? 0 : t % duration
      } else {
        t = duration
        reachedEnd = true
      }
    }
    timeRef.current = t

    for (const track of tracks) {
      const descriptor = getAnimatablePropByPath(track.propertyPath)
      if (!descriptor) continue
      const value = sampleTrack(track, t, descriptor.valueType)
      if (value === undefined) continue
      runPlaybackAppliers(track.objectId, track.propertyPath, value)
    }

    if (reachedEnd || t - lastPushRef.current >= PLAYHEAD_PUSH_INTERVAL) {
      lastPushRef.current = t
      state.setPlaybackTime(t)
    }
    // 非循环播放到末尾：暂停并把末帧采样落回对象（保持画面停在末帧）
    if (reachedEnd) {
      useCameraStageStore.getState().pause()
    }
  })

  return null
}

export default StagePlaybackDriver
