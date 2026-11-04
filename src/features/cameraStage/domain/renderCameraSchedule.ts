/**
 * 机位切换点与渲染机位时间表（纯函数，禁止 UI/three 依赖）。
 *
 * 切换点（StageCameraCut）是时间轴上独立的一条“机位”轨，与状态关键帧互不牵连：切机位只换渲染用的摄像机，
 * 场景里的人和物照常连续运动，所以能在动作中途切（动作剪辑点）而不切断任何一段运动。
 * 这与 Blender 的摄像机标记、Cinemachine 轨道的分工相同。
 * 播放、拖动时间轴与导出都只查询本表。
 */

import { v4 as uuidv4 } from 'uuid'

export interface StageCameraCut {
  id: string
  /** 从这一刻起由 cameraId 拍摄（秒，写入时按帧量化） */
  time: number
  /** null = 回到活动摄像机 */
  cameraId: string | null
}

export interface RenderCameraScheduleEntry {
  startTime: number
  /** 下一个切换点；最后一段为 Infinity */
  endTime: number
  /** 已应用 fallback 后的最终机位 */
  cameraId: string | null
}

export function createCameraCut(time: number, cameraId: string | null): StageCameraCut {
  return { id: uuidv4(), time: Math.max(0, time), cameraId }
}

/** 宽松解析切换点：结构不对的整条丢掉，同一时刻只留最后一条，按时间排好。 */
export function normalizeCameraCuts(raw: unknown): StageCameraCut[] {
  if (!Array.isArray(raw)) return []
  const byTime = new Map<number, StageCameraCut>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const time = Number(record.time)
    if (!Number.isFinite(time) || time < 0) continue
    // 保留不认识的字段：更新版本给切换点加的可选字段，保存时原样写回。
    byTime.set(time, {
      ...record,
      id: typeof record.id === 'string' && record.id ? record.id : uuidv4(),
      time,
      cameraId: typeof record.cameraId === 'string' && record.cameraId ? record.cameraId : null,
    })
  }
  return [...byTime.values()].sort((left, right) => left.time - right.time)
}

/**
 * 由切换点 + 兜底机位（通常传全局 activeCameraId）派生渲染机位时间表。
 * 第一个切换点之前、以及 cameraId 为 null 的段都用 fallbackCameraId；没有切换点返回空表（调用方直接用活动摄像机）。
 */
export function buildRenderCameraSchedule(
  cuts: readonly StageCameraCut[],
  fallbackCameraId: string | null,
): RenderCameraScheduleEntry[] {
  if (cuts.length === 0) return []
  const sorted = [...cuts].sort((left, right) => left.time - right.time)
  const entries: RenderCameraScheduleEntry[] = []
  if (sorted[0].time > 0) entries.push({ startTime: 0, endTime: sorted[0].time, cameraId: fallbackCameraId })
  sorted.forEach((cut, index) => {
    entries.push({ startTime: cut.time, endTime: sorted[index + 1]?.time ?? Infinity, cameraId: cut.cameraId ?? fallbackCameraId })
  })
  return entries
}

/** 按时间查询渲染机位（边界时间归属后一段）；负数钳到首段，空表回退 null。 */
export function resolveRenderCameraAt(schedule: RenderCameraScheduleEntry[], time: number): string | null {
  if (schedule.length === 0) return null
  const safeTime = Math.max(0, time)
  const entry = schedule.find((item) => safeTime < item.endTime) ?? schedule[schedule.length - 1]
  return entry.cameraId
}
