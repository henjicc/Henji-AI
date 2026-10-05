import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'

/** 轨道头宽：名称按钮 + 6 个 24 命中区的图标开关（5.8：原 20 的开关低于命中区下限 24，宽度随之 208 → 232） */
export const TIMELINE_HEADER_WIDTH = 232
export const TIMELINE_RULER_HEIGHT = 28
export const TIMELINE_TRACK_SECTION_GAP = 8
export interface TimelineTrackRow { track: VideoEditSequence['tracks'][number]; top: number; height: number }
export interface TimelineViewport { left: number; top: number; width: number; height: number }
export function timelineTrackRows(sequence: VideoEditSequence, resized?: { trackId: string; height: number } | null): TimelineTrackRow[] {
  let top = TIMELINE_RULER_HEIGHT
  let previousKind: TimelineTrackRow['track']['kind'] | undefined
  // Display the topmost composite layer first, retaining the actual track identity.
  const tracks = [...sequence.tracks].sort((a, b) => a.kind === b.kind ? a.kind === 'video' ? b.index - a.index : a.index - b.index : a.kind === 'video' ? -1 : 1)
  return tracks.map(track => {
    if (previousKind !== undefined && previousKind !== track.kind) top += TIMELINE_TRACK_SECTION_GAP
    const height = resized?.trackId === track.id ? resized.height : track.height ?? 32
    const row = { track, top, height }; top += height; previousKind = track.kind; return row
  })
}
export function timelineTrackDivider(rows: readonly TimelineTrackRow[]): number | undefined {
  const audioIndex = rows.findIndex(row => row.track.kind === 'audio')
  return audioIndex > 0 ? rows[audioIndex].top - TIMELINE_TRACK_SECTION_GAP / 2 : undefined
}
/** Show the lowest picture layer and first audio rows on the first measured view. */
export function timelineInitialScrollTop(rows: readonly TimelineTrackRow[], viewportHeight: number): number {
  const divider = timelineTrackDivider(rows)
  const last = rows.at(-1)
  const height = last ? last.top + last.height : TIMELINE_RULER_HEIGHT
  if (divider === undefined || height <= viewportHeight || viewportHeight <= TIMELINE_RULER_HEIGHT) return 0
  return Math.max(0, Math.min(height - viewportHeight, divider - (viewportHeight + TIMELINE_RULER_HEIGHT) / 2))
}
export function timelineTrackAt(rows: readonly TimelineTrackRow[], y: number): TimelineTrackRow | undefined {
  return rows.find(row => y >= row.top && y < row.top + row.height)
}
export function timelineVisibleClips(clips: readonly VideoEditClip[], rows: readonly TimelineTrackRow[], viewport: TimelineViewport, pixels: number): VideoEditClip[] {
  const tracks = new Set(rows.filter(row => row.top + row.height > viewport.top && row.top < viewport.top + viewport.height).map(row => row.track.index))
  const from = Math.max(0, (viewport.left - 32) / pixels)
  const to = Math.max(0, (viewport.left + viewport.width - TIMELINE_HEADER_WIDTH + 32) / pixels)
  return clips.filter(clip => tracks.has(clip.track) && clip.start < to && clip.start + clip.duration > from)
}
const TIMELINE_EDGE_ZONE = 32
/** Pointer travel toward an edge that counts as intent; matches the clip drag threshold. */
const TIMELINE_EDGE_ARM = 3
export function timelineEdgeVelocity(position: number, from: number, to: number): number {
  const edge = TIMELINE_EDGE_ZONE
  if (position < from + edge) return -Math.ceil(18 * Math.min(1, (from + edge - position) / edge))
  if (position > to - edge) return Math.ceil(18 * Math.min(1, (position - to + edge) / edge))
  return 0
}
/** Per-axis gate: `start`/`end` latch once the gesture has shown intent toward that edge. */
export interface TimelineEdgeAxis { origin: number; start: boolean; end: boolean }
export function timelineEdgeAxis(origin: number): TimelineEdgeAxis { return { origin, start: false, end: false } }
/**
 * Edge auto-scroll only after the pointer moved toward that edge (or was ever outside its zone),
 * so a press that lands inside a short panel's edge zone stays still (Premiere behaviour).
 */
export function timelineArmedEdgeVelocity(axis: TimelineEdgeAxis, position: number, from: number, to: number): number {
  if (position >= from + TIMELINE_EDGE_ZONE || position <= axis.origin - TIMELINE_EDGE_ARM) axis.start = true
  if (position <= to - TIMELINE_EDGE_ZONE || position >= axis.origin + TIMELINE_EDGE_ARM) axis.end = true
  const velocity = timelineEdgeVelocity(position, from, to)
  return (velocity < 0 && axis.start) || (velocity > 0 && axis.end) ? velocity : 0
}
/** Non-drop frame numbering; the underlying frame remains the authoritative integer. */
export function timelineTimecode(frame: number, fps: number): string {
  return videoEditFrameTimecode(frame, fps)
}
