import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { VIDEO_EDIT_TRACK_HEIGHT_DEFAULT } from '@/core/videoEdit/timelineNavigation'
import { createContext, useContext } from 'react'

/** 轨道头宽：名称按钮 + 6 个 24 命中区的图标开关（5.8：原 20 的开关低于命中区下限 24，宽度随之 208 → 232） */
export const TIMELINE_HEADER_WIDTH = 232
/**
 * 轨道头宽度随时间线可见宽度收缩：够宽时是完整宽度，窄面板里按比例让给轨道区；最窄放得下展开三角、编号与轨道头上的全部开关
 * （按钮编辑器里选了几个就留几个的位置），名称收起。
 */
export function timelineHeaderWidth(viewportWidth: number, buttons: number): number {
  return Math.round(Math.max(68 + buttons * 24, TIMELINE_CORNER_MIN_WIDTH, Math.min(TIMELINE_HEADER_WIDTH, viewportWidth * 0.3)))
}
/** 角落格的五个开关（24 命中区、间距 2）加左右内边距；轨道头再窄，时间线开关就会被挤出角落格。 */
const TIMELINE_CORNER_MIN_WIDTH = 140
/** 轨道头窄于这个宽度时，角落格的时间码与开关放不进一行，改成时间码在上、开关在下两行。 */
export const TIMELINE_CORNER_STACKED_BELOW = 200
/** 时间线把这次绘制用的轨道头宽度写在视口上，指针换算与播放跟随读同一个值；还没绘制时是完整宽度。 */
export const TIMELINE_HEADER_WIDTH_ATTRIBUTE = 'data-timeline-header-width'
export function timelineHeaderWidthOf(host: HTMLElement): number { return Number(host.getAttribute(TIMELINE_HEADER_WIDTH_ATTRIBUTE)) || TIMELINE_HEADER_WIDTH }
/** 时间线里的轨道、片段与播放头读同一个轨道头宽度。 */
export const TimelineHeaderWidthContext = createContext(TIMELINE_HEADER_WIDTH)
export function useTimelineHeaderWidth(): number { return useContext(TimelineHeaderWidthContext) }
/** 播放头在标尺上的“头”（Premiere 的蓝色指示器）的形状：时间线与节目标尺共用。 */
export const TIMELINE_PLAYHEAD_HEAD_SHAPE = { clipPath: 'polygon(0 0, 100% 0, 100% 55%, 50% 100%, 0 55%)' }
/** 标尺两行（参照 Premiere）：上面一窄行放标记与批注，下面一行是时间刻度，标记不压时间数字；角落格的时间码与开关并在同一行里。 */
export const TIMELINE_RULER_HEIGHT = 44
export const TIMELINE_MARK_LANE_HEIGHT = 20
/** 字幕轨只有一行字，比画面、声音轨矮。 */
export const TIMELINE_CAPTION_HEIGHT = 28
/** 缩放轨 Z1：序列里有录屏片段开启自动缩放时，钉在字幕轨下面。 */
const TIMELINE_ZOOM_HEIGHT = 24
/**
 * 普通轨道行与展开行的轨道头格子高度：比所在行多出 1px 盖住行的下边线，再用自己的 border-b 画回这条线。
 * 这些行的下边线画在轨道头整列底色之下，格子不画就会在轨道头栏里缺掉分隔线。
 */
export const TIMELINE_HEADER_CELL_HEIGHT = 'calc(100% + 1px)'
/** 视频区与音频区之间的分隔条高度（可拖动调整两区比例）。 */
export const TIMELINE_TRACK_SECTION_GAP = 8
/** 视频区最上轨之上、音频区最下轨之下始终留出的空白：把片段拖到这里新建轨道（PR）。 */
export const TIMELINE_NEW_TRACK_ZONE = 32
/** 每个区至少保留的高度，拖动分隔条不能把一区压没。 */
const TIMELINE_REGION_MIN = 40
export type TimelineRegionKind = 'video' | 'audio'
/**
 * 一行轨道：`top` 是在时间线内容里的位置；轨道所在区（视频区或音频区）各自纵向滚动，`clipTop`／`clipBottom`
 * 是这一区的可见范围，滚出可见范围的部分不显示也不命中。
 */
/** `lane`：轨道展开后片段行下方的关键帧区高度（重要记录 019）；`height` 仍只是片段行，命中与片段都只认它。 */
export interface TimelineTrackRow { track: VideoEditSequence['tracks'][number]; top: number; height: number; region: TimelineRegionKind; clipTop: number; clipBottom: number; lane?: number }
/** 一个区：可见范围、内容高度与滚动量。视频区的滚动从底部（V1 贴着分隔条）往上算，音频区从顶部（A1 贴着分隔条）往下算。 */
export interface TimelineRegion { kind: TimelineRegionKind; top: number; height: number; content: number; scroll: number; maxScroll: number }
export interface TimelineLayoutInput { viewportHeight: number; split: number; scroll: Record<TimelineRegionKind, number>; zoomRow?: boolean; lanes?: ReadonlyMap<string, number> }
export interface TimelineLayout { rows: TimelineTrackRow[]; caption: Pick<TimelineTrackRow, 'top' | 'height' | 'clipTop' | 'clipBottom'>; zoom: Pick<TimelineTrackRow, 'top' | 'height' | 'clipTop' | 'clipBottom'> | null; regions: Record<TimelineRegionKind, TimelineRegion>; divider: number }
export interface TimelineViewport { left: number; top: number; width: number; height: number }
export const TIMELINE_DEFAULT_SPLIT = 0.5
/** 序列末尾滚到可见区右缘时留的空隙，末尾不贴边。 */
export const TIMELINE_END_MARGIN = 16
/**
 * 播放跟随时的滚动位置（PR 平滑滚动）：播放头没走到可见区中间不滚，走到了就保持在中间；序列结尾滚到头后播放头继续走到底，不滚进尾部留白。
 * 倒放镜像。播放头不在可见区（换了位置才开始播放、循环跳回）时直接滚到让它居中的位置。
 */
export function timelineFollowScrollLeft({ frame, pixels, durationFrames, scrollLeft, trackWidth, direction }: { frame: number; pixels: number; durationFrames: number; scrollLeft: number; trackWidth: number; direction: 1 | -1 }): number {
  const x = frame * pixels; const center = trackWidth / 2
  const target = Math.max(0, Math.min(durationFrames * pixels + TIMELINE_END_MARGIN - trackWidth, x - center))
  const at = x - scrollLeft
  if (at < 0 || at > trackWidth) return target
  if (direction > 0) return at < center ? scrollLeft : Math.max(scrollLeft, target)
  return at > center ? scrollLeft : target
}
/**
 * PR 的时间线：视频区在上、音频区在下，中间一条分隔条，两区各自纵向滚动；V1 贴在分隔条上方，A1 贴在下方，
 * 轨道少时视频轨靠下、音频轨靠上，整体居中。字幕轨 C1 同 PR 置顶在视频区最上方（标尺下），不随视频区滚动；
 * 视频轨滚到它下面时被它盖住、也不再接收命中。
 */
export function timelineLayout(sequence: Pick<VideoEditSequence, 'tracks'>, input: TimelineLayoutInput, resized?: { trackId: string; height: number } | null): TimelineLayout {
  const trackTop = TIMELINE_RULER_HEIGHT
  // Rows pinned to the top of the video area: captions, then the zoom lane when there is one.
  const sticky = TIMELINE_CAPTION_HEIGHT + (input.zoomRow ? TIMELINE_ZOOM_HEIGHT : 0)
  const area = Math.max(0, input.viewportHeight - trackTop - TIMELINE_TRACK_SECTION_GAP)
  const height = (track: VideoEditSequence['tracks'][number]): number => resized?.trackId === track.id ? resized.height : track.height ?? VIDEO_EDIT_TRACK_HEIGHT_DEFAULT
  const lane = (track: VideoEditSequence['tracks'][number]): number => input.lanes?.get(track.id) ?? 0
  const extra = (track: VideoEditSequence['tracks'][number]): { lane?: number } => lane(track) > 0 ? { lane: lane(track) } : {}
  const tracks = { video: sequence.tracks.filter(track => track.kind === 'video').sort((a, b) => a.index - b.index), audio: sequence.tracks.filter(track => track.kind === 'audio').sort((a, b) => a.index - b.index) }
  // 固定行不属于视频轨的可见区（PR、达芬奇：固定区域不压在轨道上，轨道区自己滚动）。每个区至少放得下贴着分隔条的那条轨
  // （视频区再加上固定行），轨道才能完整露出；视频区里其余的轨靠滚动露出，滚动范围已按“区高减固定行”算（content 含固定行）。
  // 展开的关键帧区排在 V1 片段行与分隔条之间、A1 片段行下方，也要算进去，否则 V1 片段行被顶到固定行下面。
  // 面板矮到连这两条都放不下时按比例分（时间线面板的最小高度保证正常不会到这一步）。
  const edge = (track: VideoEditSequence['tracks'][number] | undefined): number => track ? height(track) + lane(track) : VIDEO_EDIT_TRACK_HEIGHT_DEFAULT
  const videoMin = Math.max(TIMELINE_REGION_MIN, sticky + edge(tracks.video[0]))
  const audioMin = Math.max(TIMELINE_REGION_MIN, edge(tracks.audio[0]))
  const videoHeight = area >= videoMin + audioMin
    ? Math.round(Math.max(videoMin, Math.min(area - audioMin, area * input.split)))
    : Math.round(area * videoMin / (videoMin + audioMin))
  const region = (kind: TimelineRegionKind, top: number, regionHeight: number): TimelineRegion => {
    const content = tracks[kind].reduce((sum, track) => sum + height(track) + lane(track), 0) + TIMELINE_NEW_TRACK_ZONE + (kind === 'video' ? sticky : 0)
    const maxScroll = Math.max(0, content - regionHeight)
    return { kind, top, height: regionHeight, content, scroll: Math.max(0, Math.min(maxScroll, input.scroll[kind] || 0)), maxScroll }
  }
  const video = region('video', trackTop, videoHeight)
  const audio = region('audio', trackTop + videoHeight + TIMELINE_TRACK_SECTION_GAP, area - videoHeight)
  const rows: TimelineTrackRow[] = []
  let bottom = video.top + video.height + video.scroll
  const videoClipTop = Math.min(video.top + video.height, video.top + sticky)
  // V1 在最下：从 V1 往上排，显示时最上面的合成层在前。
  for (const track of tracks.video) { const value = height(track); bottom -= value + lane(track); rows.push({ track, top: bottom, height: value, region: 'video', clipTop: videoClipTop, clipBottom: video.top + video.height, ...extra(track) }) }
  rows.reverse()
  const caption = { top: video.top, height: TIMELINE_CAPTION_HEIGHT, clipTop: video.top, clipBottom: video.top + video.height }
  const zoom = input.zoomRow ? { top: video.top + TIMELINE_CAPTION_HEIGHT, height: TIMELINE_ZOOM_HEIGHT, clipTop: video.top, clipBottom: video.top + video.height } : null
  let top = audio.top - audio.scroll
  for (const track of tracks.audio) { const value = height(track); rows.push({ track, top, height: value, region: 'audio', clipTop: audio.top, clipBottom: audio.top + audio.height, ...extra(track) }); top += value + lane(track) }
  return { rows, caption, zoom, regions: { video, audio }, divider: video.top + video.height + TIMELINE_TRACK_SECTION_GAP / 2 }
}
/** Bottom edge of the rows pinned above the video tracks (captions, and the zoom lane when shown). */
export function timelineStickyBottom(layout: TimelineLayout): number { return layout.zoom ? layout.zoom.top + layout.zoom.height : layout.caption.top + layout.caption.height }
/** 光标所在的区（分隔条上半归视频区）；标尺上不属于任何区。 */
export function timelineRegionAt(layout: TimelineLayout, y: number): TimelineRegionKind | undefined {
  if (y < layout.regions.video.top) return undefined
  return y < layout.divider ? 'video' : 'audio'
}
/** 落在字幕轨与最上视频轨之间、或音频区最下轨之下的空白里：在那里放下片段会新建一条该类轨道。 */
export function timelineNewTrackZone(layout: TimelineLayout, y: number): TimelineRegionKind | undefined {
  const { video, audio } = layout.regions
  const audioRows = layout.rows.filter(row => row.region === 'audio')
  const firstVideo = layout.rows.find(row => row.region === 'video')
  const videoTracksTop = firstVideo ? firstVideo.top : video.top + video.height
  if (y >= timelineStickyBottom(layout) && y < video.top + video.height && y < videoTracksTop) return 'video'
  const last = audioRows.at(-1)
  if (y >= audio.top && y < audio.top + audio.height && y >= (last ? last.top + last.height + (last.lane ?? 0) : audio.top)) return 'audio'
  return undefined
}
export function timelineTrackAt(rows: readonly TimelineTrackRow[], y: number): TimelineTrackRow | undefined {
  return rows.find(row => y >= Math.max(row.top, row.clipTop) && y < Math.min(row.top + row.height, row.clipBottom))
}
/** 轨道头与片段共用几何；上下各缓冲约两条默认轨道，正在编辑或聚焦的轨道保留挂载。 */
export function timelineVisibleTrackRows(rows: readonly TimelineTrackRow[], retained: readonly (string | null | undefined)[] = [], overscan = 64): TimelineTrackRow[] {
  return rows.filter(row => retained.includes(row.track.id) || row.top + row.height + (row.lane ?? 0) > row.clipTop - overscan && row.top < row.clipBottom + overscan)
}
/**
 * 片段块的外观层（只有底色，不描边）：右端让出 1 像素，前后相连的片段之间露一道缝（PR、达芬奇）；
 * 块本身仍铺满到下一个片段，点在缝上还是点中这个片段。
 */
export const TIMELINE_BLOCK_FACE_CLASS = 'absolute inset-y-0 left-0 right-px rounded-check'
/** 片段顶上的名条高度：轨道够高时名字独占这一条，缩略图与波形从它下面开始。 */
export const TIMELINE_CLIP_TITLE_HEIGHT = 16
/** 片段内高不到这个值时不画名条，名字垂直居中压在内容上。 */
export const TIMELINE_CLIP_TITLE_MIN_HEIGHT = 36
/**
 * 片段块（片段、字幕、拖入虚影）的横向范围：两端落在整像素上，相连的片段首尾相接。缝不在这里让：
 * 让出来的那 1 像素不属于任何片段，点切点就落空了；缝由块里的外观层留出（TIMELINE_BLOCK_FACE_CLASS）。
 * 块上的名称用 `position: sticky` 贴在可见部分左端，吸附点是轨道头右缘；块自身用 `overflow-clip`，不用会建立滚动容器的 `overflow-hidden`。
 */
export function timelineBlockSpan(start: number, duration: number, pixels: number, header: number): { left: number; width: number } {
  const left = Math.round(start * pixels)
  return { left: header + left, width: Math.max(3, Math.round((start + duration) * pixels) - left) }
}
export function timelineVisibleClips(clips: readonly VideoEditClip[], rows: readonly TimelineTrackRow[], viewport: Pick<TimelineViewport, 'left' | 'width'>, pixels: number, header: number): VideoEditClip[] {
  const tracks = new Set(timelineVisibleTrackRows(rows, [], 0).map(row => row.track.index))
  const from = Math.max(0, (viewport.left - 32) / pixels)
  const to = Math.max(0, (viewport.left + viewport.width - header + 32) / pixels)
  return clips.filter(clip => tracks.has(clip.track) && clip.start < to && clip.start + clip.duration > from)
}
const TIMELINE_EDGE_ZONE = 32
/** Pointer travel toward an edge that counts as intent; matches the clip drag threshold. */
const TIMELINE_EDGE_ARM = 3
function timelineEdgeVelocity(position: number, from: number, to: number): number {
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
const TIMELINE_WHEEL_TRACK_STEP = 8
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

/**
 * 标尺刻度上的时间：主刻度落在整秒上时只写到秒（“00:15”“01:30”，序列满一小时才带小时），窄窗口里多放几格；
 * 放大到逐帧时写完整时间码，免得“分:秒:帧”被读成“时:分:秒”。
 */
export function timelineRulerLabel(frame: number, fps: number, major: number, durationFrames: number): string {
  const nominal = Math.max(1, Math.round(fps))
  if (major % nominal) return videoEditFrameTimecode(frame, fps)
  const seconds = Math.floor(frame / nominal)
  const pad = (value: number): string => String(value).padStart(2, '0')
  // 不带小时时分钟不取模：缩小后标尺画过一小时也不会绕回 00:00
  return (durationFrames >= nominal * 3600 ? [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60] : [Math.floor(seconds / 60), seconds % 60]).map(pad).join(':')
}

/**
 * 标尺刻度（Premiere：放得越大越细）：主刻度从“逐帧 → 若干帧 → 半秒 → 秒 → 分”的候选里取第一个放得下刻度时间的：
 * 整秒刻度只写到秒，间距不小于 64 像素；不足一秒的刻度写完整时间码，间距不小于 96 像素。
 * 次刻度取能整除主刻度、间距不小于 8 像素的最大候选（没有就不画）。单位为帧（按名义整数帧率）。
 */
export function timelineRulerScale(pixelsPerFrame: number, fps: number): { major: number; minor: number } {
  const nominal = Math.max(1, Math.round(fps))
  const candidates = [...new Set([1, 2, 5, 10, ...(nominal % 2 === 0 ? [nominal / 2] : []), ...[1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].map(seconds => seconds * nominal)])].sort((a, b) => a - b)
  const major = candidates.find(frames => frames * pixelsPerFrame >= (frames % nominal ? 96 : 64)) ?? candidates.at(-1)!
  const minor = candidates.filter(frames => frames < major && major % frames === 0 && frames * pixelsPerFrame >= 8).at(-1) ?? 0
  return { major, minor }
}
