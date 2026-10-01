import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'

export const TIMELINE_HEADER_WIDTH = 208
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
export function timelineEdgeVelocity(position: number, from: number, to: number): number {
  const edge = 32
  if (position < from + edge) return -Math.ceil(18 * Math.min(1, (from + edge - position) / edge))
  if (position > to - edge) return Math.ceil(18 * Math.min(1, (position - to + edge) / edge))
  return 0
}
/** Non-drop frame numbering; the underlying frame remains the authoritative integer. */
export function timelineTimecode(frame: number, fps: number): string {
  return videoEditFrameTimecode(frame, fps)
}
