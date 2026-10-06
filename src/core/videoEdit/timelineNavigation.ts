import type { VideoEditSequence } from './document'

/**
 * Premiere 的“编辑点”：片段的起点与终点（不含 0 以前）。`tracks` 给出时只看这些轨道（目标轨道），否则看全部轨道。
 * 结果升序去重，供上／下方向键跳转、Q/W 波纹修剪与 Shift 拖动播放头吸附共用。
 */
export function videoEditEditPoints(sequence: Pick<VideoEditSequence, 'clips'>, tracks?: readonly number[]): number[] {
  const points = new Set<number>()
  for (const clip of sequence.clips) {
    if (tracks && !tracks.includes(clip.track)) continue
    points.add(clip.start); points.add(clip.start + clip.duration)
  }
  return [...points].filter(frame => frame >= 0).sort((a, b) => a - b)
}
/** 严格早于／晚于 `frame` 的最近一个点；没有时返回 undefined。 */
export function videoEditAdjacentPoint(points: readonly number[], frame: number, direction: -1 | 1): number | undefined {
  if (direction < 0) { for (let index = points.length - 1; index >= 0; index--) if (points[index] < frame) return points[index]; return undefined }
  return points.find(point => point > frame)
}
/** 吸附：距离不超过 `threshold` 帧的最近点，否则原值。 */
export function videoEditSnapFrame(points: readonly number[], frame: number, threshold: number): number {
  let best = frame; let distance = threshold
  for (const point of points) { const gap = Math.abs(point - frame); if (gap <= distance) { best = point; distance = gap } }
  return best
}
/** 播放头所在、位于给定轨道上的片段（起点 ≤ 播放头 < 终点）。 */
export function videoEditClipsAtFrame<T extends { track: number; start: number; duration: number }>(clips: readonly T[], frame: number, tracks: readonly number[]): T[] {
  return clips.filter(clip => tracks.includes(clip.track) && clip.start <= frame && frame < clip.start + clip.duration)
}

/** 轨道高度档位：与轨道头拖动同一范围。 */
export const VIDEO_EDIT_TRACK_HEIGHT_MIN = 24
export const VIDEO_EDIT_TRACK_HEIGHT_MAX = 160
export const VIDEO_EDIT_TRACK_HEIGHT_DEFAULT = 32
export function clampVideoEditTrackHeight(height: number): number { return Math.max(VIDEO_EDIT_TRACK_HEIGHT_MIN, Math.min(VIDEO_EDIT_TRACK_HEIGHT_MAX, Math.round(height))) }

/** 时间线缩放范围（每秒 60 × zoom 像素），与时间线视图校验一致。 */
export const VIDEO_EDIT_ZOOM_MIN = 0.1
export const VIDEO_EDIT_ZOOM_MAX = 20
export function clampVideoEditZoom(zoom: number): number { return Math.max(VIDEO_EDIT_ZOOM_MIN, Math.min(VIDEO_EDIT_ZOOM_MAX, zoom)) }
/** 让 `frames` 帧刚好铺满 `width` 像素的缩放（Premiere `\` 缩放到整个序列）。 */
export function videoEditZoomToFit(frames: number, fps: number, width: number): number {
  return clampVideoEditZoom(Math.max(1, width) / (Math.max(1, frames) / fps * 60))
}
