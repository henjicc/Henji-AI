import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildRenderCameraSchedule, resolveRenderCameraAt } from '../domain/renderCameraSchedule'
import { useCameraStageStore } from '../store/cameraStageStore'
import {
  readCameraStagePlaybackRuntime,
  subscribeCameraStagePlaybackRuntime,
} from './playbackRuntime'

/**
 * 当前渲染机位派生 hook（重要记录 005，3.2）：区分"编辑机位"（`activeCameraId`，用户显式选择，
 * 写 store）与"播放渲染机位"（本 hook 派生，只读，不写 store）。
 *
 * 按 `stateKeyframes` + `activeCameraId`（fallback）派生渲染机位时间表，随播放头查询当前机位；
 * 状态关键帧为空时（时间表为空）直接回落 `activeCameraId`。
 * `StageScene`/`StageAspectRatioOverlay` 统一消费本 hook，不在播放循环里写 store、不新增平行状态。
 */
export function useRenderCameraId(): string | null {
  const stateKeyframes = useCameraStageStore((state) => state.stateKeyframes)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)
  const playing = useCameraStageStore((state) => state.playback.playing)

  const schedule = useMemo(
    () => buildRenderCameraSchedule(stateKeyframes, activeCameraId),
    [stateKeyframes, activeCameraId],
  )

  const resolveAt = useCallback((time: number): string | null => (
    schedule.length === 0 ? activeCameraId : resolveRenderCameraAt(schedule, time) ?? activeCameraId
  ), [activeCameraId, schedule])
  const [runtimeCameraId, setRuntimeCameraId] = useState(() => resolveAt(currentTime))

  useEffect(() => {
    const sync = (time: number): void => {
      const next = resolveAt(time)
      setRuntimeCameraId((current) => current === next ? current : next)
    }
    sync(playing ? readCameraStagePlaybackRuntime().time : currentTime)
    if (!playing) return undefined
    return subscribeCameraStagePlaybackRuntime((runtime) => sync(runtime.time))
  }, [currentTime, playing, resolveAt])

  return runtimeCameraId
}
