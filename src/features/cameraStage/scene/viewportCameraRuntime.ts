import {
  resolveRenderCameraAt,
  type RenderCameraScheduleEntry,
} from '../domain/renderCameraSchedule'

/** 在逐帧 runtime 时间上选择真实 draw camera；null 时间表表示用户绑死单台机位。 */
export function resolveStageViewportCameraId(
  renderCameraSchedule: RenderCameraScheduleEntry[] | null,
  fixedCameraId: string,
  fallbackCameraId: string | null,
  time: number,
): string | null {
  return renderCameraSchedule
    ? resolveRenderCameraAt(renderCameraSchedule, time) ?? fallbackCameraId
    : fixedCameraId
}
