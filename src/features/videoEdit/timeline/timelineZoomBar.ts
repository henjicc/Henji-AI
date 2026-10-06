/**
 * PR 时间线底部的缩放滚动条（剪辑对齐 PR 4.6）：整条代表整段可滚动的时间，滑块是当前看得见的那一段。
 * 拖滑块中间平移，拖两端改看得见的范围（即缩放），在滚动条上滚滚轮缩放。全部按帧计算，界面只做像素换算。
 */
export interface TimelineZoomBarState {
  /** 可滚动的总帧数（序列长度加尾部留白，或放得下时等于可见帧数）。 */
  totalFrames: number
  /** 可见范围的起始帧（可带小数）。 */
  startFrame: number
  /** 可见的帧数。 */
  visibleFrames: number
}
export type TimelineZoomBarPart = 'move' | 'start' | 'end'
/** 滑块最短的像素宽度，保证两端手柄都抓得到。 */
export const TIMELINE_ZOOM_BAR_MIN_THUMB = 24
/** 拖两端时可见范围至少保留的帧数。 */
const MIN_VISIBLE_FRAMES = 1

export function timelineZoomBarThumb(state: TimelineZoomBarState, barWidth: number): { left: number; width: number } {
  const total = Math.max(state.totalFrames, state.visibleFrames, 1)
  const width = Math.min(barWidth, Math.max(TIMELINE_ZOOM_BAR_MIN_THUMB, state.visibleFrames / total * barWidth))
  const left = Math.max(0, Math.min(barWidth - width, state.startFrame / total * barWidth))
  return { left, width }
}

/**
 * 从拖动开始时的状态拖动 `dx` 像素后的可见范围 `[from, to)`（帧）。`move` 只平移，范围长度不变；
 * `start`／`end` 固定另一端，最短 1 帧，不越过总范围。
 */
export function timelineZoomBarDrag(start: TimelineZoomBarState, part: TimelineZoomBarPart, dx: number, barWidth: number): { from: number; to: number } {
  const total = Math.max(start.totalFrames, start.visibleFrames, 1)
  const frames = dx / Math.max(1, barWidth) * total
  const from = start.startFrame; const to = start.startFrame + start.visibleFrames
  if (part === 'move') {
    const next = Math.max(0, Math.min(total - start.visibleFrames, from + frames))
    return { from: next, to: next + start.visibleFrames }
  }
  if (part === 'start') return { from: Math.max(0, Math.min(to - MIN_VISIBLE_FRAMES, from + frames)), to }
  return { from, to: Math.min(total, Math.max(from + MIN_VISIBLE_FRAMES, to + frames)) }
}

/** 在滚动条空白处单击：让可见范围以单击位置为中心。 */
export function timelineZoomBarCenterAt(state: TimelineZoomBarState, x: number, barWidth: number): number {
  const total = Math.max(state.totalFrames, state.visibleFrames, 1)
  return Math.max(0, Math.min(total - state.visibleFrames, x / Math.max(1, barWidth) * total - state.visibleFrames / 2))
}
