/**
 * 渲染机位时间表（纯函数，禁止 UI/three 依赖）。
 *
 * 由镜头卡序列派生"某一时刻应由哪台摄像机渲染"的阶跃函数（重要记录 005）。复用
 * `buildShotTimeline`（shotCompiler.ts）算出的静止/过渡时间点：每张卡的静止段 + 其后过渡段
 * 都由该卡自己的机位拍摄，下一次切换发生在下一卡静止段起点——这与布点层"机位不同强制硬切"
 * 的切换点天然重合，播放/scrub/导出三处只要都查询本表即可保持一致（3.2/3.3 消费）。
 */

import { buildShotTimeline } from './shotCompiler'
import type { StageShot } from './shotTypes'

export interface RenderCameraScheduleEntry {
  startTime: number
  endTime: number
  /** 已应用 fallback 后的最终机位；未指定机位的卡在这里已回退为 fallbackCameraId */
  cameraId: string | null
}

/**
 * 由镜头卡序列 + 兜底机位（通常传全局 activeCameraId）派生渲染机位时间表。
 * 卡自身未指定机位（cameraId 为 null）时沿用 fallbackCameraId，覆盖旧工程（无 cameraId）
 * 与"未特意设置机位"的场景，行为与改动前一致（始终渲染同一台机位）。空数组返回空表。
 */
export function buildRenderCameraSchedule(
  shots: StageShot[],
  fallbackCameraId: string | null,
): RenderCameraScheduleEntry[] {
  if (shots.length === 0) return []
  const timeline = buildShotTimeline(shots)
  return shots.map((shot, index) => ({
    startTime: timeline[index].holdStart,
    endTime: timeline[index].transitionEnd,
    cameraId: shot.cameraId ?? fallbackCameraId,
  }))
}

/**
 * 按时间查询渲染机位（边界时间归属"后一段"，与 shotClipGeometry 的 findClipAtTime 语义一致）；
 * 越界（负数/超出总时长）分别钳制到首段/尾段；空时间表回退 null（调用方自行决定是否再兜底）。
 */
export function resolveRenderCameraAt(schedule: RenderCameraScheduleEntry[], time: number): string | null {
  if (schedule.length === 0) return null
  const safeTime = Math.max(0, time)
  const entry = schedule.find((item) => safeTime < item.endTime) ?? schedule[schedule.length - 1]
  return entry.cameraId
}
