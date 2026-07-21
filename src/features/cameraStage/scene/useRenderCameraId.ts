import { useMemo } from 'react'
import { buildRenderCameraSchedule, resolveRenderCameraAt } from '../domain/renderCameraSchedule'
import { useCameraStageStore } from '../store/cameraStageStore'

/**
 * 当前渲染机位派生 hook（重要记录 005，3.2）：区分"编辑机位"（`activeCameraId`，用户显式选择，
 * 写 store）与"播放渲染机位"（本 hook 派生，只读，不写 store）。
 *
 * 简易模式下按 `shots` + `activeCameraId`（fallback）派生渲染机位时间表，随播放头查询当前机位；
 * 专业模式或镜头卡为空时（时间表为空）直接回落 `activeCameraId`，与改动前行为完全一致。
 * `StageScene`/`StageAspectRatioOverlay` 统一消费本 hook，不在播放循环里写 store、不新增平行状态。
 */
export function useRenderCameraId(): string | null {
  const editorMode = useCameraStageStore((state) => state.editorMode)
  const shots = useCameraStageStore((state) => state.shots)
  const activeCameraId = useCameraStageStore((state) => state.activeCameraId)
  const currentTime = useCameraStageStore((state) => state.playback.currentTime)

  const schedule = useMemo(
    () => (editorMode === 'simple' ? buildRenderCameraSchedule(shots, activeCameraId) : []),
    [editorMode, shots, activeCameraId],
  )

  if (schedule.length === 0) return activeCameraId
  return resolveRenderCameraAt(schedule, currentTime) ?? activeCameraId
}
