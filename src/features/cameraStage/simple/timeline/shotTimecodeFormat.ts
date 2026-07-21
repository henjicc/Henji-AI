/**
 * 简易模式时间轴时间码格式化（纯函数，禁止 UI 依赖）。
 *
 * 重要记录 008（已定稿）：时间码支持纯秒 / 纯帧 / 秒:帧（SMPTE 风格 hh:mm:ss:ff）三种显示格式，
 * 交互方式为「按住 Ctrl 键点击时间码文本」循环切换；本文件只负责格式化与循环顺序，
 * 交互由 ShotTimecodeText.tsx 承载。
 */

export type ShotTimecodeMode = 'seconds' | 'frames' | 'secondsFrames'

const MODE_CYCLE: ShotTimecodeMode[] = ['seconds', 'frames', 'secondsFrames']

/** Ctrl+点击循环切换到下一个显示模式 */
export function nextShotTimecodeMode(mode: ShotTimecodeMode): ShotTimecodeMode {
  const index = MODE_CYCLE.indexOf(mode)
  return MODE_CYCLE[(index + 1) % MODE_CYCLE.length]
}

function pad2(value: number): string {
  return String(Math.max(0, value)).padStart(2, '0')
}

/** 秒 → { 时, 分, 秒, 帧 } 四段，供秒:帧 SMPTE 风格格式化使用 */
function toTimecodeParts(seconds: number, fps: number): { hours: number; minutes: number; secs: number; frames: number } {
  const safeFps = Math.max(1, Math.round(fps))
  const totalFrames = Math.round(Math.max(0, seconds) * safeFps)
  const frames = totalFrames % safeFps
  const totalSeconds = Math.floor(totalFrames / safeFps)
  const secs = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  return { hours, minutes, secs, frames }
}

/** 按显示模式格式化秒数：纯秒（X.XXs）/ 纯帧（Nf）/ 秒:帧（hh:mm:ss:ff） */
export function formatShotTimecode(seconds: number, mode: ShotTimecodeMode, fps: number): string {
  const safeSeconds = Math.max(0, seconds)
  if (mode === 'frames') return `${Math.round(safeSeconds * Math.max(1, fps))}f`
  if (mode === 'secondsFrames') {
    const { hours, minutes, secs, frames } = toTimecodeParts(safeSeconds, fps)
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}:${pad2(frames)}`
  }
  return `${safeSeconds.toFixed(2)}s`
}

/**
 * 时间轴内的紧凑时间码：显示模式与工具栏一致，但省略值为 0 的高位时间单位。
 * 例如 2 秒显示为 02:00，65 秒显示为 01:05:00。
 */
export function formatCompactShotTimecode(seconds: number, mode: ShotTimecodeMode, fps: number): string {
  if (mode !== 'secondsFrames') return formatShotTimecode(seconds, mode, fps)
  const { hours, minutes, secs, frames } = toTimecodeParts(Math.max(0, seconds), fps)
  if (hours > 0) return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}:${pad2(frames)}`
  if (minutes > 0) return `${pad2(minutes)}:${pad2(secs)}:${pad2(frames)}`
  return `${pad2(secs)}:${pad2(frames)}`
}
