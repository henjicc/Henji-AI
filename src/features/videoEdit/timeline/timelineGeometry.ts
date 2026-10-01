import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'

export const TIMELINE_HEADER_WIDTH = 208
export const TIMELINE_RULER_HEIGHT = 28
export interface TimelineTrackRow { track: VideoEditSequence['tracks'][number]; top: number; height: number }
export interface TimelineViewport { left: number; top: number; width: number; height: number }
export function timelineTrackRows(sequence: VideoEditSequence, resized?: { trackId: string; height: number } | null): TimelineTrackRow[] {
  let top = TIMELINE_RULER_HEIGHT
  return [...sequence.tracks].sort((a, b) => a.index - b.index).map(track => {
    const height = resized?.trackId === track.id ? resized.height : track.height ?? 32
    const row = { track, top, height }; top += height; return row
  })
}
export function timelineTrackAt(rows: readonly TimelineTrackRow[], y: number): TimelineTrackRow | undefined {
  return rows.find(row => y >= row.top && y < row.top + row.height)
}
export function timelineVisibleClips(clips: readonly VideoEditClip[], rows: readonly TimelineTrackRow[], viewport: TimelineViewport, pixels: number): VideoEditClip[] {
  const tracks = new Set(rows.filter(row => row.top + row.height >= viewport.top && row.top <= viewport.top + viewport.height).map(row => row.track.index))
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
  const nominal = Math.round(fps); const seconds = Math.floor(frame / nominal)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60, frame % nominal].map(value => String(value).padStart(2, '0')).join(':')
}
