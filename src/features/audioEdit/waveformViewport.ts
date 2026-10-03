export interface WaveformViewport { start: number; end: number }

/** 最小可见区间（采样帧）：放大到能看清每个采样并按采样精确定位（任务 2.3）。 */
export const AUDIO_EDIT_MIN_VIEW_FRAMES = 128

export function clampViewport(start: number, length: number, duration: number): WaveformViewport {
  const size = Math.min(duration, Math.max(1, length))
  const left = Math.max(0, Math.min(duration - size, start))
  return { start: left, end: left + size }
}

export function zoomViewport(view: WaveformViewport, anchor: number, factor: number, duration: number, minimum: number): WaveformViewport {
  const ratio = Math.max(0, Math.min(1, anchor))
  const length = view.end - view.start
  const next = Math.min(duration, Math.max(minimum, length * factor))
  return clampViewport(view.start + ratio * (length - next), next, duration)
}
