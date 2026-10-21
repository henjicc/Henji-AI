import type { CaptureEvent } from '../captureLog/events'
import { CURSOR_LOOKAHEAD_US } from './recordingCursor'
import type { VideoEditTrackBox, VideoEditTrackPrompt, VideoEditTrackRecording } from './tracking'

/*
 * 录屏事件跟踪（任务：录屏素材专项跟踪）：录制时记下的光标与前台窗口事件直接就是跟踪结果，精确且零计算。
 * - 光标：取这一时刻的光标位置（相邻采样线性插值，不跨暂停与隐藏）；周围区域大小取提示的特征框；
 * - 窗口：取这一时刻目标窗口的边界；提示框是提示时刻窗口里的一块区域，随窗口一起移动、缩放。
 * 坐标：事件是录制画面的像素，换成片段画面的归一化坐标（与录制光标效果同一换算）。
 * 时间：素材时间 + 录制起点（recordingStartUs），与录制光标效果一致。
 */

export interface RecordingTrackFrame { width: number; height: number }
export interface RecordingWindowBounds { x: number; y: number; width: number; height: number }

function lastAt(events: readonly CaptureEvent[], time: number): number {
  let lo = 0; let hi = events.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (events[mid].recordingUs <= time) lo = mid + 1; else hi = mid }
  return lo - 1
}

/** 录制时间 timeUs 的光标位置（录制画面像素）；光标隐藏、被排除或这段没有采样时 null。 */
export function recordingCursorPointAt(events: readonly CaptureEvent[], timeUs: number): [number, number] | null {
  let index = lastAt(events, timeUs)
  while (index >= 0 && events[index].kind !== 'cursor') { if (events[index].kind === 'control') return null; index-- }
  if (index < 0) return null
  const cursor = events[index] as Extract<CaptureEvent, { kind: 'cursor' }>
  if (!cursor.point || cursor.shape === 'hidden' || timeUs - cursor.recordingUs > CURSOR_LOOKAHEAD_US) return null
  let next = index + 1
  while (next < events.length && events[next].kind !== 'cursor' && events[next].kind !== 'control') next++
  const following = events[next]
  const point: [number, number] = [cursor.point[0], cursor.point[1]]
  if (following?.kind === 'cursor' && following.point && following.shape !== 'hidden' && following.clockSegmentRef === cursor.clockSegmentRef && following.recordingUs - cursor.recordingUs <= CURSOR_LOOKAHEAD_US) {
    const t = Math.max(0, Math.min(1, (timeUs - cursor.recordingUs) / Math.max(1, following.recordingUs - cursor.recordingUs)))
    point[0] += (following.point[0] - point[0]) * t; point[1] += (following.point[1] - point[1]) * t
  }
  return point
}

/**
 * 录制时间 timeUs 的窗口边界（录制画面像素）：windowId 为 null 时是当时的前台窗口；指定窗口不在前台时沿用它最近一次的边界。
 * events 需要包含 timeUs 之前最近一次窗口事件。
 */
export function recordingWindowBoundsAt(events: readonly CaptureEvent[], timeUs: number, windowId: string | null): RecordingWindowBounds | null {
  for (let index = lastAt(events, timeUs); index >= 0; index--) {
    const event = events[index]
    if (event.kind !== 'window') continue
    if (windowId === null) return event.available && event.bounds ? { ...event.bounds } : null
    if (event.windowId === windowId && event.available && event.bounds) return { ...event.bounds }
  }
  return null
}

/** 提示时刻的前台窗口（建立窗口跟踪时用）。 */
export function recordingForegroundWindowAt(events: readonly CaptureEvent[], timeUs: number): { windowId: string; bounds: RecordingWindowBounds } | null {
  for (let index = lastAt(events, timeUs); index >= 0; index--) {
    const event = events[index]
    if (event.kind === 'window') return event.available && event.windowId && event.bounds ? { windowId: event.windowId, bounds: { ...event.bounds } } : null
  }
  return null
}

/** 光标周围区域的默认大小：画面高度的 6%。 */
export const RECORDING_CURSOR_REGION = 0.06

/**
 * 一帧的跟踪框（片段画面归一化，与普通跟踪结果同一形状）：
 * 光标以光标为中心、边长为提示特征框；窗口按窗口边界的移动与缩放变换提示框。
 */
export function recordingTrackBox(recording: VideoEditTrackRecording, prompt: Pick<VideoEditTrackPrompt, 'box' | 'window'>, frame: RecordingTrackFrame, current: { cursor?: [number, number] | null; window?: RecordingWindowBounds | null; reference?: RecordingWindowBounds | null }): VideoEditTrackBox | null {
  if (recording.kind === 'cursor') {
    if (!current.cursor) return null
    const size = prompt.window?.feature ?? RECORDING_CURSOR_REGION
    const width = size * frame.height / frame.width
    return [current.cursor[0] / frame.width - width / 2, current.cursor[1] / frame.height - size / 2, width, size, 1]
  }
  const window = current.window; const reference = current.reference
  if (!window) return null
  if (!prompt.box || !reference) return [window.x / frame.width, window.y / frame.height, window.width / frame.width, window.height / frame.height, 1]
  const sx = window.width / reference.width; const sy = window.height / reference.height
  const [x, y, w, h] = prompt.box
  return [(window.x + (x * frame.width - reference.x) * sx) / frame.width, (window.y + (y * frame.height - reference.y) * sy) / frame.height, w * sx, h * sy, 1]
}
