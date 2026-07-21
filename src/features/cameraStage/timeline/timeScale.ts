/**
 * 时间轴时间↔像素换算与刻度生成（纯函数，便于复用与单测）。
 * 内部时间单位统一为秒；刻度显示支持秒 / 帧两种模式。
 */

export type TimeRulerMode = 'seconds' | 'frames'

export const TIMELINE_MIN_PX_PER_SECOND = 40
export const TIMELINE_MAX_PX_PER_SECOND = 600

export function clampPxPerSecond(value: number): number {
  return Math.max(TIMELINE_MIN_PX_PER_SECOND, Math.min(TIMELINE_MAX_PX_PER_SECOND, value))
}

export function timeToX(time: number, pxPerSecond: number): number {
  return time * pxPerSecond
}

export function xToTime(x: number, pxPerSecond: number): number {
  return pxPerSecond <= 0 ? 0 : x / pxPerSecond
}

export interface TimelineTick {
  time: number
  x: number
  label: string
  /** 主刻度（带标签、较粗），次刻度只画短线 */
  major: boolean
}

/** 秒模式候选刻度间隔（秒）：挑选使间距 ≥ 目标像素的最小档 */
const SECOND_STEPS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60]
/** 每档主刻度对应的次刻度细分数 */
const MINOR_DIVISIONS = 5
/** 主刻度最小像素间距，低于则升档避免标签重叠 */
const MIN_MAJOR_GAP_PX = 56

function pickSecondStep(pxPerSecond: number): number {
  for (const step of SECOND_STEPS) {
    if (step * pxPerSecond >= MIN_MAJOR_GAP_PX) return step
  }
  return SECOND_STEPS[SECOND_STEPS.length - 1]
}

function formatSeconds(time: number, step: number): string {
  const decimals = step < 1 ? (step < 0.1 ? 2 : 1) : 0
  return `${time.toFixed(decimals)}s`
}

/** 生成 [0, duration] 区间的刻度（含主/次），供 TimeRuler 渲染 */
export function generateTicks(
  duration: number,
  pxPerSecond: number,
  mode: TimeRulerMode,
  fps: number,
): TimelineTick[] {
  const ticks: TimelineTick[] = []
  if (duration <= 0) return ticks

  if (mode === 'frames') {
    const frameStep = pickFrameStep(pxPerSecond, fps)
    const totalFrames = Math.ceil(duration * fps)
    for (let frame = 0; frame <= totalFrames; frame += 1) {
      const time = frame / fps
      if (time > duration + 1e-6) break
      const major = frame % frameStep === 0
      ticks.push({ time, x: timeToX(time, pxPerSecond), label: major ? `${frame}f` : '', major })
    }
    return ticks
  }

  const step = pickSecondStep(pxPerSecond)
  const minor = step / MINOR_DIVISIONS
  const count = Math.ceil(duration / minor)
  for (let i = 0; i <= count; i += 1) {
    const time = i * minor
    if (time > duration + 1e-6) break
    const major = Math.abs(time / step - Math.round(time / step)) < 1e-6
    ticks.push({
      time,
      x: timeToX(time, pxPerSecond),
      label: major ? formatSeconds(time, step) : '',
      major,
    })
  }
  return ticks
}

/** 帧模式：挑选使主刻度间距 ≥ 目标像素的帧步长（1/2/5/10/…帧） */
function pickFrameStep(pxPerSecond: number, fps: number): number {
  const pxPerFrame = pxPerSecond / Math.max(1, fps)
  const steps = [1, 2, 5, 10, 15, 30, 60]
  for (const step of steps) {
    if (step * pxPerFrame >= MIN_MAJOR_GAP_PX) return step
  }
  return steps[steps.length - 1]
}

/** 秒 → 「秒 / 帧」显示串（播放控制条时间展示用） */
export function formatTimecode(time: number, mode: TimeRulerMode, fps: number): string {
  if (mode === 'frames') return `${Math.round(time * fps)}f`
  return `${time.toFixed(2)}s`
}
