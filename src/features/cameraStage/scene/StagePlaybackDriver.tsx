import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { applyAnimationToPlaybackAppliers } from '../store/playbackAppliers'
import { useCameraStageStore } from '../store/cameraStageStore'
import {
  advanceCameraStagePlaybackRuntime,
  claimCameraStagePlaybackDriver,
  readCameraStagePlaybackRuntime,
  releaseCameraStagePlaybackDriver,
  resumeCameraStagePlaybackDriver,
  seekCameraStagePlaybackRuntime,
} from './playbackRuntime'

/**
 * 播放采样驱动：播放态下每帧推进播放头，采样全部轨道并经命令式 appliers 直改 three 对象，
 * 不逐帧写 store（性能约束）；仅低频回写播放头供 UI 显示。非播放态不做任何事（scrub 走 store）。
 */

/** 播放头 UI 回写节流间隔（秒）：约 20fps，避免逐帧触发面板重渲染 */
const PLAYHEAD_PUSH_INTERVAL = 0.05
/** 单帧最大步进：防止切后台/卡顿后一次跳过大段动画 */
const MAX_FRAME_DELTA = 0.1

const StagePlaybackDriver: React.FC = () => {
  const currentProjectId = useCameraStageStore((state) => state.currentProjectId)
  const driverRef = useRef<symbol | null>(null)
  const pushElapsedRef = useRef(0)

  useEffect(() => {
    const playback = useCameraStageStore.getState().playback
    const token = claimCameraStagePlaybackDriver({
      sessionKey: currentProjectId,
      time: playback.currentTime,
      playing: playback.playing,
    })
    driverRef.current = token
    pushElapsedRef.current = 0
    return () => {
      releaseCameraStagePlaybackDriver(token)
      if (driverRef.current === token) driverRef.current = null
    }
  }, [currentProjectId])

  useFrame((_, rawDelta) => {
    const driver = driverRef.current
    if (!driver) return
    const state = useCameraStageStore.getState()
    const { playing, currentTime, loop } = state.playback
    if (!resumeCameraStagePlaybackDriver(driver, state.currentProjectId)) return
    const runtime = readCameraStagePlaybackRuntime()

    if (!playing) {
      pushElapsedRef.current = 0
      if (runtime.playing || runtime.time !== currentTime) {
        seekCameraStagePlaybackRuntime(currentTime, false)
      }
      return
    }
    // 兼容测试/宿主直接恢复 playback 的入口；正常 play/seek 已同步 runtime。
    if (!runtime.playing) {
      seekCameraStagePlaybackRuntime(currentTime, true)
    }

    const { tracks, duration } = state.animation
    const delta = Math.min(rawDelta, MAX_FRAME_DELTA)
    const advanced = advanceCameraStagePlaybackRuntime({ driver, delta, duration, loop })
    if (!advanced.accepted) return

    applyAnimationToPlaybackAppliers(state.objects, tracks, advanced.time)

    // 以累计帧间隔节流，循环回绕不会再因时间差为负而停止更新 UI。
    pushElapsedRef.current += delta
    if (advanced.wrapped || advanced.reachedEnd || pushElapsedRef.current >= PLAYHEAD_PUSH_INTERVAL) {
      pushElapsedRef.current = 0
      state.setPlaybackTime(advanced.time)
    }
    // 非循环播放到末尾：暂停并把末帧采样落回对象（保持画面停在末帧）
    if (advanced.reachedEnd) {
      useCameraStageStore.getState().pause()
    }
  }, -2)

  return null
}

export default StagePlaybackDriver
