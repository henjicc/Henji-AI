import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'

/** 轨道头宽：名称按钮 + 6 个 24 命中区的图标开关（5.8：原 20 的开关低于命中区下限 24，宽度随之 208 → 232） */
export const TIMELINE_HEADER_WIDTH = 232
export const TIMELINE_RULER_HEIGHT = 28
/** 视频区与音频区之间的分隔条高度（可拖动调整两区比例）。 */
export const TIMELINE_TRACK_SECTION_GAP = 8
/** 视频区最上轨之上、音频区最下轨之下始终留出的空白：把片段拖到这里新建轨道（PR）。 */
export const TIMELINE_NEW_TRACK_ZONE = 32
/** 每个区至少保留的高度，拖动分隔条不能把一区压没。 */
export const TIMELINE_REGION_MIN = 40
export type TimelineRegionKind = 'video' | 'audio'
/**
 * 一行轨道：`top` 是在时间线内容里的位置；轨道所在区（视频区或音频区）各自纵向滚动，`clipTop`／`clipBottom`
 * 是这一区的可见范围，滚出可见范围的部分不显示也不命中。
 */
export interface TimelineTrackRow { track: VideoEditSequence['tracks'][number]; top: number; height: number; region: TimelineRegionKind; clipTop: number; clipBottom: number }
/** 一个区：可见范围、内容高度与滚动量。视频区的滚动从底部（V1 贴着分隔条）往上算，音频区从顶部（A1 贴着分隔条）往下算。 */
export interface TimelineRegion { kind: TimelineRegionKind; top: number; height: number; content: number; scroll: number; maxScroll: number }
export interface TimelineLayoutInput { viewportHeight: number; split: number; scroll: Record<TimelineRegionKind, number> }
export interface TimelineLayout { rows: TimelineTrackRow[]; regions: Record<TimelineRegionKind, TimelineRegion>; divider: number }
export interface TimelineViewport { left: number; top: number; width: number; height: number }
export const TIMELINE_DEFAULT_SPLIT = 0.5
/**
 * PR 的时间线：视频区在上、音频区在下，中间一条分隔条，两区各自纵向滚动；V1 贴在分隔条上方，A1 贴在下方，
 * 轨道少时视频轨靠下、音频轨靠上，整体居中。
 */
export function timelineLayout(sequence: Pick<VideoEditSequence, 'tracks'>, input: TimelineLayoutInput, resized?: { trackId: string; height: number } | null): TimelineLayout {
  const area = Math.max(0, input.viewportHeight - TIMELINE_RULER_HEIGHT - TIMELINE_TRACK_SECTION_GAP)
  const min = Math.min(TIMELINE_REGION_MIN, area / 2)
  const videoHeight = Math.round(Math.max(min, Math.min(area - min, area * input.split)))
  const height = (track: VideoEditSequence['tracks'][number]): number => resized?.trackId === track.id ? resized.height : track.height ?? 32
  const tracks = { video: sequence.tracks.filter(track => track.kind === 'video').sort((a, b) => a.index - b.index), audio: sequence.tracks.filter(track => track.kind === 'audio').sort((a, b) => a.index - b.index) }
  const region = (kind: TimelineRegionKind, top: number, regionHeight: number): TimelineRegion => {
    const content = tracks[kind].reduce((sum, track) => sum + height(track), 0) + TIMELINE_NEW_TRACK_ZONE
    const maxScroll = Math.max(0, content - regionHeight)
    return { kind, top, height: regionHeight, content, scroll: Math.max(0, Math.min(maxScroll, input.scroll[kind] || 0)), maxScroll }
  }
  const video = region('video', TIMELINE_RULER_HEIGHT, videoHeight)
  const audio = region('audio', TIMELINE_RULER_HEIGHT + videoHeight + TIMELINE_TRACK_SECTION_GAP, area - videoHeight)
  const rows: TimelineTrackRow[] = []
  let bottom = video.top + video.height + video.scroll
  // V1 在最下：从 V1 往上排，显示时最上面的合成层在前。
  for (const track of tracks.video) { const value = height(track); bottom -= value; rows.unshift({ track, top: bottom, height: value, region: 'video', clipTop: video.top, clipBottom: video.top + video.height }) }
  let top = audio.top - audio.scroll
  for (const track of tracks.audio) { const value = height(track); rows.push({ track, top, height: value, region: 'audio', clipTop: audio.top, clipBottom: audio.top + audio.height }); top += value }
  return { rows, regions: { video, audio }, divider: video.top + video.height + TIMELINE_TRACK_SECTION_GAP / 2 }
}
/** 光标所在的区（分隔条上半归视频区）；标尺上不属于任何区。 */
export function timelineRegionAt(layout: TimelineLayout, y: number): TimelineRegionKind | undefined {
  if (y < TIMELINE_RULER_HEIGHT) return undefined
  return y < layout.divider ? 'video' : 'audio'
}
/** 落在视频区最上轨之上或音频区最下轨之下的空白里：在那里放下片段会新建一条该类轨道。 */
export function timelineNewTrackZone(layout: TimelineLayout, y: number): TimelineRegionKind | undefined {
  const { video, audio } = layout.regions
  const videoRows = layout.rows.filter(row => row.region === 'video'); const audioRows = layout.rows.filter(row => row.region === 'audio')
  if (y >= video.top && y < video.top + video.height && y < (videoRows[0]?.top ?? video.top + video.height)) return 'video'
  const last = audioRows.at(-1)
  if (y >= audio.top && y < audio.top + audio.height && y >= (last ? last.top + last.height : audio.top)) return 'audio'
  return undefined
}
export function timelineTrackAt(rows: readonly TimelineTrackRow[], y: number): TimelineTrackRow | undefined {
  return rows.find(row => y >= Math.max(row.top, row.clipTop) && y < Math.min(row.top + row.height, row.clipBottom))
}
export function timelineVisibleClips(clips: readonly VideoEditClip[], rows: readonly TimelineTrackRow[], viewport: Pick<TimelineViewport, 'left' | 'width'>, pixels: number): VideoEditClip[] {
  const tracks = new Set(rows.filter(row => row.top + row.height > row.clipTop && row.top < row.clipBottom).map(row => row.track.index))
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
export interface TimelineWheelInput { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }
export type TimelineWheelAction = { kind: 'scroll'; left: number; top: number } | { kind: 'zoom'; factor: number } | { kind: 'track-height'; delta: number }
/** 一格滚轮（Windows 100px）改变的轨道高度。 */
export const TIMELINE_WHEEL_TRACK_STEP = 8
/**
 * Premiere（Windows 默认，用户实机确认）的时间线滚轮：滚轮横向滚动；Alt+滚轮以光标为中心横向缩放；
 * Shift+滚轮调整光标所在区域（画面轨或声音轨）的轨道高度，即纵向缩放；Ctrl+滚轮在光标所在的视频区或音频区内纵向滚动。
 * 向上滚放大／变高，与 `=` 同一倍率（每格 1.25 倍）。Windows 下 Shift+滚轮由系统转成横向增量，两个方向都读。
 */
export function timelineWheelAction(input: TimelineWheelInput): TimelineWheelAction | undefined {
  const unit = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? 400 : 1
  const x = input.deltaX * unit; const y = input.deltaY * unit
  const delta = y || x
  if (input.altKey) return delta ? { kind: 'zoom', factor: Math.pow(1.25, -delta / 100) } : undefined
  if (input.shiftKey) return delta ? { kind: 'track-height', delta: -Math.sign(delta) * TIMELINE_WHEEL_TRACK_STEP * Math.max(1, Math.round(Math.abs(delta) / 100)) } : undefined
  if (input.ctrlKey || input.metaKey) return delta ? { kind: 'scroll', left: 0, top: delta } : undefined
  if (!x && !y) return undefined
  return { kind: 'scroll', left: y + x, top: 0 }
}
/** Non-drop frame numbering; the underlying frame remains the authoritative integer. */
export function timelineTimecode(frame: number, fps: number): string {
  return videoEditFrameTimecode(frame, fps)
}
