import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildRenderCameraSchedule, resolveRenderCameraAt } from '../domain/renderCameraSchedule'
import { useCameraStageStore } from '../store/cameraStageStore'
import {
  readCameraStagePlaybackRuntime,
  subscribeCameraStagePlaybackRuntime,
} from './playbackRuntime'

/**
 * 当前渲染机位派生 hook：区分"编辑机位"（`activeCameraId`，用户显式选择，
 * 写 store）与"播放渲染机位"（本 hook 派生，只读，不写 store）。
 *
 * 按机位切换点 `cameraCuts` + `activeCameraId`（fallback）派生渲染机位时间表，随播放头查询当前机位；
 * 没有切换点时（时间表为空）直接回落 `activeCameraId`。
 * `StageScene`/`StageAspectRatioOverlay` 统一消费本 hook，不在播放循环里写 store、不新增平行状态。
 */
export function useRenderCameraId(): string | null {
  const cameraCuts = useCameraStageStore((state) => state.cameraCuts)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const playing = useCameraStageStore((state) => state.playback.playing)

  const schedule = useMemo(
    () => buildRenderCameraSchedule(cameraCuts, activeCameraId),
    [cameraCuts, activeCameraId],
  )

  const resolveAt = useCallback((time: number): string | null => (
    schedule.length === 0 ? activeCameraId : resolveRenderCameraAt(schedule, time) ?? activeCameraId
  ), [activeCameraId, schedule])
  // 只订阅换算后的机位 id：直接订阅播放头会让每个窗格连同整棵三维场景随播放头重渲染
  const pausedCameraId = useCameraStageStore((state) => resolveAt(state.playback.currentTime))
  const [runtimeCameraId, setRuntimeCameraId] = useState(() => resolveAt(readCameraStagePlaybackRuntime().time))

  useEffect(() => {
    // 暂停时跟着播放头同步：开始播放的第一次提交用的就是起点机位，不先按上次播放终点的机位画一帧。
    if (!playing) { setRuntimeCameraId((current) => current === pausedCameraId ? current : pausedCameraId); return undefined }
    const sync = (time: number): void => {
      const next = resolveAt(time)
      setRuntimeCameraId((current) => current === next ? current : next)
    }
    sync(readCameraStagePlaybackRuntime().time)
    return subscribeCameraStagePlaybackRuntime((runtime) => sync(runtime.time))
  }, [playing, resolveAt, pausedCameraId])

  return playing ? runtimeCameraId : pausedCameraId
}
