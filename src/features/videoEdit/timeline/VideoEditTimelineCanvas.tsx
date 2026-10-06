import { VideoEditTimelineKeyframes } from './VideoEditTimelineKeyframes'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { VideoEditDropPlacement } from '../application/videoEditDrop'
import { placeVideoEditDrop, readActiveVideoEditItemDrag } from '../application/videoEditDrop'
import { readVideoEditCodeMetadata } from '../application/videoEditCodeState'
import { Diamond, Captions } from 'lucide-react'
import { selectVideoEditSubtitle, selectedVideoEditSubtitleId, subscribeVideoEditSubtitleSelection, videoEditSubtitleSelectionRevision } from '../application/videoEditSubtitleSelection'
import ContextMenu from '@/components/ContextMenu'
import { UiButton } from '@/components/ui'
import { UI_DIVIDER_CLASS, UI_TEXT_NUMERIC_CLASS } from '@/components/ui/styleTokens'
import { VideoEditSequenceFrameRateRequired, type VideoEditSequenceSettings } from '@/core/videoEdit/projectItems'
import { videoEditDuration, videoEditClipMedia, type VideoEditClip, type VideoEditSequence } from '@/core/videoEdit/document'
import { rescaleVideoEditFrame, videoEditFps } from '@/core/videoEdit/time'
import { videoEditClipSourceSecondsAtTime } from '@/core/videoEdit/clipSpeed'
import { videoEditSyncOffsets } from '@/core/videoEdit/linkSync'
import { videoEditClipSpeedLabel } from '@/core/videoEdit/clipSpeedDisplay'
import { videoEditPickRelations } from '@/core/videoEdit/timelineSelection'
import type { WaveformSourceRef } from '@/hooks/useWaveformData'
import { VideoEditClipWaveform } from './VideoEditClipWaveform'
import { VideoEditClipFilmstrip } from './VideoEditClipFilmstrip'
import { videoEditAudioFormatLabel, videoEditClipAudioFormat } from '@/core/videoEdit/audioChannels'
import { acceptsVideoEditDrop, dropVideoEditInput, readVideoEditDrop, type VideoEditDropInput } from '../application/videoEditDrop'
import { listVideoEditInstances, requireVideoEditInstance, setVideoEditTimelineView, setVideoEditView, focusVideoEditPanel, type VideoEditInstance } from '../application/videoEditService'
import { setVideoEditTrackHeights, updateVideoEditTrack } from '../application/videoEditTimeline'
import { registerVideoEditTimelineViewport } from '../application/videoEditTimelineViewport'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from '../application/videoEditCommands'
import { clampVideoEditTrackHeight, clampVideoEditZoom, videoEditZoomToFit } from '@/core/videoEdit/timelineNavigation'
import { isDomNode, ownerWindowOf } from '@/utils/crossRealmDom'
import { VideoEditSequenceDialog } from '../panels/VideoEditSequenceDialog'
import { VideoEditAudioChannelsDialog, type VideoEditAudioChannelsTarget } from '../panels/VideoEditAudioChannelsDialog'
import { VideoEditTrackHeader } from './VideoEditTrackHeader'
import { VideoEditTimelinePlayhead, VideoEditTimelinePlayheadHead, VideoEditTimelinePosition } from './VideoEditTimelineTransport'
import { useTimelinePointer } from './useTimelinePointer'
import { clearTimelineSnap, snapTimelineFrame, timelineSnapPoints, TIMELINE_SNAP_PIXELS, useTimelineSnapIndicator } from './timelineSnap'
import { VideoEditTimelineInOut } from './VideoEditTimelineInOut'
import { useTimelineMenu } from './useTimelineMenu'
import { VideoEditSpeedDialog } from '../panels/VideoEditSpeedDialog'
import { VideoEditSceneDetectionDialog } from '../panels/VideoEditSceneDetectionDialog'
import type { VideoEditSceneTarget } from '../application/videoEditSceneDetection'
import { closeVideoEditSpeedDialog, useVideoEditSpeedDialogRequest } from '../application/videoEditSpeedDialog'
import { useVideoEditClipSource } from '../panels/useVideoEditClipSource'
import { elementOfEventTarget } from '@/utils/crossRealmDom'
import { TIMELINE_DEFAULT_SPLIT, TIMELINE_HEADER_WIDTH, TIMELINE_RULER_HEIGHT, TIMELINE_TRACK_SECTION_GAP, timelineLayout, timelineNewTrackZone, timelineRegionAt, timelineRulerScale, timelineTimecode, timelineTrackAt, timelineVisibleClips, timelineWheelAction, type TimelineRegion, type TimelineRegionKind, type TimelineViewport } from './timelineGeometry'
import { videoEditTrackCodes } from '@/core/videoEdit/tracks'
import { useTrackHeaderMenu } from './useTrackHeaderMenu'
import { VideoEditTimelineZoomBar } from './VideoEditTimelineZoomBar'
import { videoEditTimelineViewport } from '../application/videoEditTimelineViewport'
import { ICON_VIDEO_EDIT_TRANSITION } from '@/core/theme/icons'
import { videoEditTransitionEditPoints, videoEditTransitionFit, videoEditTransitionPairCut, videoEditTransitionMedium, videoEditTransitionPreset, videoEditTransitionWindow, type VideoEditTransitionAlignment, type VideoEditTransitionKind, type VideoEditTransitionPair, type VideoEditTransitionWindow } from '@/core/videoEdit/transitions'
import { placeVideoEditTransition, selectVideoEditTransition, selectedVideoEditTransitionId, subscribeVideoEditTransitionSelection, videoEditDefaultTransitionFrames, videoEditTransitionSelectionVersion } from '../application/videoEditTransitions'
import { readVideoEditTransitionDrag } from '../panels/videoEditTransitionDrag'
import { clearVideoEditEffectDropTarget, handleVideoEditEffectDragOver, handleVideoEditEffectDrop } from '../panels/videoEditEffectDrag'
import { VideoEditEffectDropTargets, VideoEditTransitionDropBlock } from './VideoEditTimelineDropFeedback'
import { useVideoEditInPlaceMenu } from './useVideoEditInPlaceMenu'
import { VideoEditInPlacePlaceholders } from './VideoEditInPlacePlaceholders'

interface Props { instance: VideoEditInstance; sequence: VideoEditSequence; pixels: number; onError: (error: unknown) => void; visible?: boolean }
/** 片段底色与描边（设计稿素材片段令牌）：画面、声音、文字/代码/图形/调整各一组；选中改强调描边。 */
const CLIP_SURFACE = { video: { fill: 'bg-clip-video', line: 'border-clip-video-line' }, audio: { fill: 'bg-clip-audio', line: 'border-clip-audio-line' }, title: { fill: 'bg-clip-title', line: 'border-clip-title-line' } } as const
const CLIP_SELECTED_LINE = 'border-accent-ring ring-1 ring-accent-ring'
/**
 * 缩略图条的可见范围按 64px 取整并限制在片段两侧各 64px 内：完全可见的片段滚动时属性不变、整段跳过重绘，
 * 部分可见的片段每滚过 64px 才重新铺格（铺格本身前后各多一格，取整不会露出空白）。
 */
const STRIP_EDGE_STEP = 64
const stripEdge = (value: number, clipWidth: number, round: (value: number) => number): number => Math.max(-STRIP_EDGE_STEP, Math.min(clipWidth + STRIP_EDGE_STEP, round(value / STRIP_EDGE_STEP) * STRIP_EDGE_STEP))
/** Shift+滚轮改轨道高度：滚动停下这么久后才写入一步编辑，连续滚动不刷撤销历史。 */
const WHEEL_HEIGHT_COMMIT_MS = 300
/** 缩放到整个序列时右侧留白，序列末尾不贴边。 */
const FIT_MARGIN = 16
/** 过渡预设拖到编辑点附近多远（像素）算落在这个编辑点上；切点两侧这么近算居中。 */
const TRANSITION_DROP_REACH = 40
const TRANSITION_DROP_CENTER = 8
/** 片段宽度够放淡化手柄（两角各一个）时才显示手柄。 */
const FADE_HANDLE_MIN_WIDTH = 28
interface TransitionDropHint { kind: VideoEditTransitionKind; pair: VideoEditTransitionPair; alignment: VideoEditTransitionAlignment; track: number; start: number; duration: number }
export function VideoEditTimelineCanvas({ instance, sequence, pixels, onError, visible = true }: Props): React.ReactElement {
  const projectId = instance.document.id
  const fps = videoEditFps(sequence.frameRate)
  const [view, setView] = useState<TimelineViewport>({ left: 0, top: 0, width: 900, height: 300 })
  const [hint, setHint] = useState<(VideoEditDropPlacement & { ghosts?: VideoEditClip[]; shifted?: VideoEditClip[] }) | null>(null)
  // 素材拖出时间线、松手或落点无效时收起落点的吸附提示线
  useEffect(() => { if (!hint) clearTimelineSnap() }, [hint])
  const [pendingSequence, setPendingSequence] = useState<{ owner: VideoEditInstance; input: VideoEditDropInput; placement: VideoEditDropPlacement; sequenceId: string; settings: VideoEditSequenceSettings } | null>(null)
  // PR：视频区与音频区各自纵向滚动，中间的分隔条可拖动调整两区比例（只是视图状态，不进文档）。
  const [split, setSplit] = useState(TIMELINE_DEFAULT_SPLIT)
  const [regionScroll, setRegionScroll] = useState<Record<TimelineRegionKind, number>>({ video: 0, audio: 0 })
  const [wheelHeights, setWheelHeights] = useState<ReadonlyMap<string, number> | null>(null)
  const heightsOf = (value: VideoEditSequence): VideoEditSequence => wheelHeights ? { ...value, tracks: value.tracks.map(track => wheelHeights.has(track.id) ? { ...track, height: wheelHeights.get(track.id)! } : track) } : value
  const layoutInput = { viewportHeight: view.height, split, scroll: regionScroll }
  const latestLayout = useRef(timelineLayout(sequence, layoutInput))
  /** 滚动一个区（dy > 0 显示更下面的内容）；视频区的滚动量从底部算起。返回是否滚动了。 */
  const scrollRegion = useCallback((kind: TimelineRegionKind, dy: number): boolean => {
    const region = latestLayout.current.regions[kind]
    const next = Math.max(0, Math.min(region.maxScroll, region.scroll + (kind === 'video' ? -dy : dy)))
    if (next === region.scroll) return false
    latestLayout.current = { ...latestLayout.current, regions: { ...latestLayout.current.regions, [kind]: { ...region, scroll: next } } }
    setRegionScroll(previous => ({ ...previous, [kind]: next }))
    return true
  }, [])
  const pointer = useTimelinePointer({ instance, sequence, layout: latestLayout, pixels, onError, scrollRegion })
  // 不能编辑的原因浮在时间线上方，不占位；消失时淡出（保留最后一条文字直到淡出结束）。
  const [failureText, setFailureText] = useState('')
  useEffect(() => { if (pointer.failure) setFailureText(pointer.failure) }, [pointer.failure])
  const [transitionHint, setTransitionHint] = useState<TransitionDropHint | null>(null)
  useSyncExternalStore(subscribeVideoEditTransitionSelection, videoEditTransitionSelectionVersion)
  useSyncExternalStore(subscribeVideoEditSubtitleSelection, videoEditSubtitleSelectionRevision)
  const selectedCaptionId = selectedVideoEditSubtitleId(instance, sequence.id)
  const selectedTransitionId = selectedVideoEditTransitionId(instance)
  // 吸附提示线（PR）：拖动吸上的那一帧在轨道上画一条竖线，各种拖动共用 timelineSnap 的同一份状态
  const snapFrame = useTimelineSnapIndicator(sequence.id)
  const [audioChannels, setAudioChannels] = useState<VideoEditAudioChannelsTarget | null>(null)
  const [sceneTarget, setSceneTarget] = useState<VideoEditSceneTarget | null>(null)
  const speedDialog = useVideoEditSpeedDialogRequest(instance.document.id)
  const clipSource = useVideoEditClipSource(onError)
  // 原地生成（4.12）：右键菜单项、生成面板与占位片段都在独立模块，这里只接线
  const inPlace = useVideoEditInPlaceMenu(instance, sequence, onError)
  const inPlaceFrameAt = (clientX: number): number | null => { const host = pointer.viewport.current; if (!host) return null; const x = clientX - host.getBoundingClientRect().left + host.scrollLeft - TIMELINE_HEADER_WIDTH; return x < 0 ? null : Math.floor(x / pixels) }
  const menu = useTimelineMenu(instance, onError, pointer.cancel, setAudioChannels, clipId => clipSource.open(instance.document.id, clipId), { items: inPlace.items, frameAt: inPlaceFrameAt }, setSceneTarget)
  const displayed = pointer.preview ?? sequence
  // 拖动预览里新建的轨道也要显示出来（PR：拖到轨道外即出现新轨道）。
  const layout = timelineLayout(heightsOf(displayed), layoutInput, pointer.resized)
  latestLayout.current = layout
  const rows = layout.rows
  const trackMenu = useTrackHeaderMenu(instance, sequence, onError)
  const duration = videoEditDuration(displayed)
  const width = Math.max(view.width, TIMELINE_HEADER_WIDTH + (duration + fps * 5) * pixels)
  const visibleClips = timelineVisibleClips(displayed.clips, rows, view, pixels)
  // Out-of-sync offsets follow the drag preview so an Alt move shows its drift before release.
  const syncOffsets = videoEditSyncOffsets(displayed)
  // Waveforms slice each source's whole multi-resolution peaks (task 2.3): scrolling and zooming only redraw the visible part.
  const waveRanges = visibleClips.flatMap((clip): Array<{ clipId: string; from: number; to: number; startSeconds: number; endSeconds: number; sources: WaveformSourceRef[] }> => {
    const media = videoEditClipMedia(instance.document, clip)
    if (!media || !(clip.kind === 'audio' || clip.kind === 'video' && clip.sourceComponent !== 'video' && media.hasAudio === true)) return []
    const from = Math.max(clip.start, Math.floor(Math.max(0, view.left) / pixels)); const to = Math.min(clip.start + clip.duration, Math.ceil((view.left + view.width - TIMELINE_HEADER_WIDTH) / pixels))
    if (to <= from) return []
    const head = videoEditClipSourceSecondsAtTime(clip, from / fps, fps); const tail = videoEditClipSourceSecondsAtTime(clip, to / fps, fps)
    const startSeconds = Math.max(0, Math.min(head, tail)); const endSeconds = Math.min(media.durationSeconds, Math.max(head, tail))
    if (endSeconds <= startSeconds) return []
    const source = { source: media.path, ...(media.sourceRevision ? { sourceRevision: media.sourceRevision } : {}) }
    // A mapped clip (task 2.6) draws one lane per clip channel from the source channel it reads.
    const sources = clip.audioMapping ? clip.audioMapping.sources.map(mapped => ({ ...source, channels: 1 as const, audioStream: mapped.stream, audioChannel: mapped.channel })) : [{ ...source, channels: 2 as const }]
    return [{ clipId: clip.id, from, to, startSeconds, endSeconds, sources }]
  })
  // Track headers hint the channel type of the clips on each audio track (task 2.6).
  const trackFormats = new Map<number, Set<'mono' | 'stereo'>>()
  for (const clip of displayed.clips) {
    const format = videoEditClipAudioFormat(clip, videoEditClipMedia(instance.document, clip))
    if (format) trackFormats.set(clip.track, (trackFormats.get(clip.track) ?? new Set()).add(format))
  }
  const channelFormatOf = (track: number): 'mono' | 'stereo' | 'mixed' | undefined => { const formats = trackFormats.get(track); return !formats ? undefined : formats.size > 1 ? 'mixed' : [...formats][0] }
  const rangesByClip = new Map(waveRanges.map(range => [range.clipId, range]))
  // V1/A1 numbering follows each kind's track order, as Premiere's track labels.
  const trackCodes = videoEditTrackCodes(displayed)
  const devicePixelRatio = ownerWindowOf(pointer.viewport.current).devicePixelRatio || 1
  // 标尺刻度随缩放变细（Premiere）：放得越大，主刻度间隔越小，最小到逐帧；主刻度标时间码，次刻度只画短线
  const ruler = timelineRulerScale(pixels, fps)
  const majorWidth = ruler.major * pixels
  const tickStart = Math.max(0, Math.floor(view.left / majorWidth) - 1)
  const tickEnd = Math.ceil((view.left + view.width) / majorWidth) + 1
  const minorPerMajor = ruler.minor ? Math.round(ruler.major / ruler.minor) : 0
  const readViewport = useCallback((): void => {
    const host = pointer.viewport.current
    if (!host) return
    const next = { left: host.scrollLeft, top: host.scrollTop, width: host.clientWidth || 900, height: host.clientHeight || 300 }
    setView(previous => Object.keys(next).every(key => previous[key as keyof TimelineViewport] === next[key as keyof TimelineViewport]) ? previous : next)
  }, [pointer.viewport])
  useLayoutEffect(() => {
    const host = pointer.viewport.current
    if (!host) return
    readViewport()
    // 用时间线实际所在窗口（可能是系统浮窗）的观察器。
    const Observer = ownerWindowOf(host).ResizeObserver
    const observer = typeof Observer === 'undefined' ? undefined : new Observer(readViewport)
    observer?.observe(host)
    return () => observer?.disconnect()
  }, [pointer.viewport, readViewport, visible])
  // 缩放保持一个时间点不动（Premiere）：Alt+滚轮保持光标处，其余缩放（=／-、滑块、助手）保持可见的播放头，否则保持左缘。
  const zoomAnchor = useRef<{ frame: number; x: number } | null>(null)
  const previousPixels = useRef(pixels)
  useLayoutEffect(() => {
    const host = pointer.viewport.current; const before = previousPixels.current; previousPixels.current = pixels
    const requested = zoomAnchor.current; zoomAnchor.current = null
    if (!host || before === pixels) return
    const playhead = instance.frame * before - host.scrollLeft
    const anchor = requested ?? (playhead >= 0 && playhead <= host.clientWidth - TIMELINE_HEADER_WIDTH ? { frame: instance.frame, x: playhead } : { frame: host.scrollLeft / before, x: 0 })
    host.scrollLeft = Math.max(0, anchor.frame * pixels - anchor.x)
    readViewport()
  }, [pixels, instance, pointer.viewport, readViewport])
  const latest = useRef({ instance, sequence, pixels, fps, duration }); latest.current = { instance, sequence, pixels, fps, duration }
  const pendingHeights = useRef<{ heights: Map<string, number>; timer: ReturnType<typeof setTimeout> } | null>(null)
  const commitHeights = useCallback((): void => {
    const pending = pendingHeights.current; pendingHeights.current = null
    if (!pending) return
    clearTimeout(pending.timer); setWheelHeights(null)
    const { instance: owner, sequence: current } = latest.current
    try { setVideoEditTrackHeights(owner.document.id, current.id, pending.heights) } catch (error) { onError(error) }
  }, [onError])
  useEffect(() => () => commitHeights(), [commitHeights])
  useLayoutEffect(() => {
    const host = pointer.viewport.current
    if (!host) return
    // 非被动监听：阻止浏览器默认的纵向滚动与 Ctrl+滚轮页面缩放。
    const onWheel = (event: WheelEvent): void => {
      const action = timelineWheelAction(event)
      if (!action) return
      event.preventDefault()
      const { instance: owner, pixels: scale } = latest.current
      const y = event.clientY - host.getBoundingClientRect().top
      // Ctrl+滚轮在光标所在的视频区或音频区内纵向滚动（PR）。
      if (action.kind === 'scroll') { host.scrollLeft += action.left; const region = timelineRegionAt(latestLayout.current, y); if (action.top && region) scrollRegion(region, action.top); return }
      if (action.kind === 'zoom') {
        const zoom = clampVideoEditZoom(owner.zoom * action.factor)
        if (zoom === owner.zoom) return
        const x = Math.max(0, event.clientX - host.getBoundingClientRect().left - TIMELINE_HEADER_WIDTH)
        zoomAnchor.current = { frame: (host.scrollLeft + x) / scale, x }
        try { setVideoEditTimelineView(owner.document.id, { zoom }) } catch (error) { zoomAnchor.current = null; onError(error) }
        return
      }
      // 纵向缩放光标所在的画面轨区或声音轨区（分隔条以上为画面轨）。
      const kind = timelineRegionAt(latestLayout.current, y) ?? 'video'
      const heights = pendingHeights.current?.heights ?? new Map<string, number>()
      for (const row of latestLayout.current.rows) if (row.track.kind === kind) heights.set(row.track.id, clampVideoEditTrackHeight((heights.get(row.track.id) ?? row.height) + action.delta))
      if (pendingHeights.current) clearTimeout(pendingHeights.current.timer)
      pendingHeights.current = { heights, timer: setTimeout(commitHeights, WHEEL_HEIGHT_COMMIT_MS) }
      setWheelHeights(new Map(heights))
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [pointer.viewport, scrollRegion, commitHeights, onError])
  useEffect(() => registerVideoEditTimelineViewport(projectId, {
    sequenceId: sequence.id,
    zoomToSequence: () => {
      const host = pointer.viewport.current; const { instance: owner, fps: rate, duration: frames } = latest.current
      if (!host) return
      const zoom = videoEditZoomToFit(frames, rate, host.clientWidth - TIMELINE_HEADER_WIDTH - FIT_MARGIN)
      if (zoom === owner.zoom) { host.scrollLeft = 0; return }
      zoomAnchor.current = { frame: 0, x: 0 }
      setVideoEditTimelineView(owner.document.id, { zoom })
    },
    showScreen: direction => {
      const host = pointer.viewport.current
      if (host) host.scrollLeft = Math.max(0, host.scrollLeft + direction * Math.max(1, host.clientWidth - TIMELINE_HEADER_WIDTH))
    },
    zoomAt: (frame, factor) => {
      const host = pointer.viewport.current; const { instance: owner, pixels: scale } = latest.current
      if (!host) return
      const zoom = clampVideoEditZoom(owner.zoom * factor)
      if (zoom === owner.zoom) return
      zoomAnchor.current = { frame, x: Math.max(0, Math.min(host.clientWidth - TIMELINE_HEADER_WIDTH, frame * scale - host.scrollLeft)) }
      setVideoEditTimelineView(owner.document.id, { zoom })
    },
    showRange: (from, to) => {
      const host = pointer.viewport.current; const { instance: owner, fps: rate, pixels: scale } = latest.current
      if (!host) return
      const zoom = videoEditZoomToFit(Math.max(1, to - from), rate, host.clientWidth - TIMELINE_HEADER_WIDTH)
      if (zoom === owner.zoom) { host.scrollLeft = Math.max(0, from * scale); return }
      zoomAnchor.current = { frame: from, x: 0 }
      setVideoEditTimelineView(owner.document.id, { zoom })
    },
  }), [projectId, sequence.id, pointer.viewport])
  /** 落点：命中的轨道；或视频区最上轨之上／音频区最下轨之下的空白——在那里放下会新建轨道（PR）。 */
  const placement = (event: React.DragEvent<HTMLDivElement>): VideoEditDropPlacement | undefined => {
    const host = pointer.viewport.current!; const rect = host.getBoundingClientRect()
    const x = event.clientX - rect.left + host.scrollLeft - TIMELINE_HEADER_WIDTH
    if (event.clientX < rect.left + TIMELINE_HEADER_WIDTH) return undefined
    const y = event.clientY - rect.top
    const raw = Math.max(0, Math.round(x / pixels))
    // 吸附开着时落点吸到片段边缘、序列开头、播放头与标记（8 像素内，吸上时显示提示线），拖动中的虚影与松手结果用同一个落点
    const frame = Math.max(0, snapTimelineFrame(sequence.id, instance.snapping ? timelineSnapPoints(sequence, { playhead: instance.frame }) : [], raw, TIMELINE_SNAP_PIXELS / pixels))
    const row = timelineTrackAt(rows, y)
    // 按住 Ctrl 拖入为插入（后面的片段后移），否则覆盖
    const mode = event.ctrlKey || event.metaKey ? 'insert' as const : 'overwrite' as const
    if (row) return { frame, track: row.track.index, mode }
    const zone = timelineNewTrackZone(layout, y)
    return zone && { frame, newTrack: zone, mode }
  }
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  /**
   * 过渡预设的落点（PR）：同类轨道上离光标最近的编辑点；落在切点上居中，左侧终点对齐切点，右侧起点对齐切点。
   * 片段一端旁边是空白时放单侧过渡，整段在片段内（4.4）。
   */
  const transitionDrop = (event: React.DragEvent<HTMLDivElement>, kind: VideoEditTransitionKind): TransitionDropHint | null => {
    const host = pointer.viewport.current!; const rect = host.getBoundingClientRect()
    if (event.clientX < rect.left + TIMELINE_HEADER_WIDTH) return null
    const row = timelineTrackAt(rows, event.clientY - rect.top)
    const medium = videoEditTransitionMedium(kind)
    if (!row || row.track.kind !== medium || row.track.locked) return null
    const x = (event.clientX - rect.left + host.scrollLeft - TIMELINE_HEADER_WIDTH) / pixels
    const cutOf = (pair: VideoEditTransitionPair): number => videoEditTransitionPairCut(sequence, pair)!
    const pair = videoEditTransitionEditPoints(sequence, medium, new Set([row.track.index])).sort((a, b) => Math.abs(cutOf(a) - x) - Math.abs(cutOf(b) - x))[0]
    if (!pair) return null
    const offset = (x - cutOf(pair)) * pixels
    if (Math.abs(offset) > TRANSITION_DROP_REACH) return null
    const alignment: VideoEditTransitionAlignment = !pair.leftClipId ? 'start' : !pair.rightClipId ? 'end' : Math.abs(offset) <= TRANSITION_DROP_CENTER ? 'center' : offset < 0 ? 'end' : 'start'
    const fit = videoEditTransitionFit(sequence, pair, videoEditDefaultTransitionFrames(sequence), alignment)
    return fit ? { kind, pair, alignment, track: row.track.index, start: cutOf(pair) - fit.framesBeforeCut, duration: fit.durationFrames } : null
  }
  // 时间线上的过渡块（PR）：盖在切点上，显示名称；拖左右缘改时长，拖中间平移。
  const transitionWindows = (displayed.transitions ?? []).flatMap((transition): VideoEditTransitionWindow[] => { try { return [videoEditTransitionWindow(displayed, transition)] } catch { return [] } })
    .filter(window => window.end * pixels >= view.left - 8 && window.start * pixels <= view.left + view.width)
  const renderTransition = (window: VideoEditTransitionWindow, region: TimelineRegion): React.ReactElement | null => {
    const row = rows.find(value => value.track.index === window.left.track)
    if (!row) return null
    const preset = videoEditTransitionPreset(window.transition.kind)
    const selected = window.transition.id === selectedTransitionId
    const width = Math.max(6, (window.end - window.start) * pixels)
    const Icon = ICON_VIDEO_EDIT_TRANSITION
    // 单侧过渡（4.4）贴着片段一端：只有离开那一端的边缘能拖。
    const fixed = window.side === 'in' ? 'in' : window.side === 'out' ? 'out' : undefined
    return <div key={window.transition.id} data-video-edit-transition={window.transition.id} data-video-edit-transition-side={window.side} data-selected={selected || undefined} title={window.side ? `${preset.name}：拖${window.side === 'in' ? '右' : '左'}缘改时长` : `${preset.name}：拖两端改时长，拖中间沿切点移动`}
      className={`absolute z-raised flex overflow-hidden rounded-md border bg-raised text-text1 ${selected ? CLIP_SELECTED_LINE : 'border-line-strong'}`}
      style={{ top: row.top - region.top + 2, height: Math.max(12, Math.min(row.height - 4, 28)), left: TIMELINE_HEADER_WIDTH + window.start * pixels, width }}>
      <div data-video-edit-transition-edge={fixed === 'in' ? undefined : 'in'} aria-hidden="true" className={`h-full w-1.5 shrink-0 ${fixed === 'in' ? '' : 'cursor-ew-resize'}`} />
      <div className={`flex min-w-0 flex-1 items-center gap-1 overflow-hidden ${fixed ? '' : 'cursor-grab'}`}>
        {width > 28 && <Icon size={12} aria-hidden="true" className="shrink-0 text-text3" />}
        {width > 56 && <span className="truncate text-2xs leading-4">{preset.name}</span>}
      </div>
      <div data-video-edit-transition-edge={fixed === 'out' ? undefined : 'out'} aria-hidden="true" className={`h-full w-1.5 shrink-0 ${fixed === 'out' ? '' : 'cursor-ew-resize'}`} />
    </div>
  }
  const renderClip = (clip: VideoEditSequence['clips'][number], region: TimelineRegion): React.ReactElement => {
        const row = rows.find(row => row.track.index === clip.track)!
        const range = rangesByClip.get(clip.id)
        const media = videoEditClipMedia(instance.document, clip)
        const channelType = videoEditClipAudioFormat(clip, media)
        const offset = syncOffsets.get(clip.id)
        const offsetLabel = offset === undefined ? undefined : `${offset > 0 ? '+' : ''}${offset}`
        const speedLabel = videoEditClipSpeedLabel(clip)
        const selected = instance.selectedClipIds.includes(clip.id)
        // Picture clips show a filmstrip of their media (task 2.4); sound clips their waveform (task 2.3).
        const sound = clip.kind === 'audio' || clip.kind === 'video' && clip.sourceComponent === 'audio'
        const picture = !sound && (clip.kind === 'video' && media?.kind === 'video' || clip.kind === 'image' && media?.kind === 'image')
        const surface = sound ? CLIP_SURFACE.audio : clip.kind === 'video' || clip.kind === 'image' ? CLIP_SURFACE.video : CLIP_SURFACE.title
        // Hidden picture tracks and muted sound tracks dim their clips (content only, see the overlay below), as in Premiere.
        const dimmed = !row.track.enabled || row.track.kind === 'audio' && row.track.muted
        const clipLeft = TIMELINE_HEADER_WIDTH + clip.start * pixels
        const clipWidth = Math.max(3, clip.duration * pixels)
        const fadeIn = (clip.fadeInFrames ?? 0) * pixels; const fadeOut = (clip.fadeOutFrames ?? 0) * pixels
        const fadable = clip.kind !== 'adjustment' && clipWidth >= FADE_HANDLE_MIN_WIDTH
        return <div key={clip.id} data-video-edit-clip={clip.id} data-clip-start={clip.start} data-clip-duration={clip.duration} className={`group absolute overflow-hidden rounded-md border ${surface.fill} ${selected ? CLIP_SELECTED_LINE : surface.line}`} data-clip-dimmed={dimmed || undefined} style={{ top: row.top - region.top + 2, height: row.height - 4, left: clipLeft, width: clipWidth }}>
          {picture && media && <VideoEditClipFilmstrip clipId={clip.id} source={media.path} sourceRevision={media.sourceRevision} still={media.kind === 'image'} aspect={media.width > 0 && media.height > 0 ? media.width / media.height : 16 / 9}
            mediaEndSeconds={media.durationSeconds} frameSeconds={media.frameRate ? media.frameRate.denominator / media.frameRate.numerator : 1 / 30} clip={clip} fps={fps} pixels={pixels} clipWidth={clipWidth} height={row.height - 6}
            visibleFrom={stripEdge(view.left + TIMELINE_HEADER_WIDTH - clipLeft, clipWidth, Math.floor)} visibleTo={stripEdge(view.left + view.width - clipLeft, clipWidth, Math.ceil)} devicePixelRatio={devicePixelRatio} active={visible} />}
          {range && <VideoEditClipWaveform clipId={clip.id} sources={range.sources} startSeconds={range.startSeconds} endSeconds={range.endSeconds} reverse={clip.reverse} left={(range.from - clip.start) * pixels} width={(range.to - range.from) * pixels} visible={visible} lane={picture ? 'lower' : 'full'} />}
          {/* 隐藏轨/静音轨只淡化画面与波形（盖一层半透明窗口底），片段名标签不跟着变淡：整片 opacity-50 时
              纸白下标签只剩 1.5:1（4.1 对比度审计） */}
          {dimmed && <div className="pointer-events-none absolute inset-0 bg-window/50" aria-hidden="true" />}
          <div className="absolute inset-0 flex">
            {/* ui-surface-allow 片段入点裁剪柄：命中区不是按钮档位，外观由片段容器的 clip 令牌给出 */}
            <UiButton data-video-edit-trim="in" aria-label={`裁剪${clip.name}入点`} className="!h-full !w-2 shrink-0 cursor-ew-resize !rounded-none !bg-transparent !p-0" tabIndex={-1} />
            {/* ui-surface-allow 片段体：整块是选择命中区，名称条压在缩略图/波形之上（设计稿 VideoEdit 片段名称条） */}
            <UiButton aria-label={`选择片段 ${clip.name}`} title={`${clip.name}${speedLabel ? ` ${speedLabel}` : ''}${channelType ? ` · ${videoEditAudioFormatLabel(channelType)}` : ''}${offset === undefined ? '' : `：与链接片段失步 ${Math.abs(offset)} 帧，右键可移入同步或滑入同步`}`} data-video-edit-audio-format={channelType} className="!h-full min-w-0 flex-1 !items-start !justify-start !rounded-none !bg-transparent !p-0" onClick={event => { if (event.detail === 0) run(() => pointer.select([clip.id], event.shiftKey || event.ctrlKey || event.metaKey, false, videoEditPickRelations(instance.linkedSelection !== false, event.altKey))) }}>
              <span data-user-content className={`max-w-full truncate rounded-br-sm px-1.5 text-2xs leading-4 ${picture || sound ? 'bg-media-scrim text-on-media' : 'text-text1'}`}>{clip.name}{speedLabel && <span className={UI_TEXT_NUMERIC_CLASS}> {speedLabel}</span>}</span>
            </UiButton>
            {/* ui-surface-allow 出点裁剪柄，同入点 */}
            <UiButton data-video-edit-trim="out" aria-label={`裁剪${clip.name}出点`} className="!h-full !w-2 shrink-0 cursor-ew-resize !rounded-none !bg-transparent !p-0" tabIndex={-1} />
          </div>
          {/* 淡化（PR 淡化手柄）：淡入／淡出区上方压一块三角暗影，斜边就是音量或不透明度的走向 */}
          {fadeIn > 0 && <div aria-hidden="true" data-video-edit-fade-shape="in" className="pointer-events-none absolute left-0 top-0 h-full bg-window/60" style={{ width: Math.min(clipWidth, fadeIn), clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />}
          {fadeOut > 0 && <div aria-hidden="true" data-video-edit-fade-shape="out" className="pointer-events-none absolute right-0 top-0 h-full bg-window/60" style={{ width: Math.min(clipWidth, fadeOut), clipPath: 'polygon(0 0, 100% 0, 100% 100%)' }} />}
          <VideoEditTimelineKeyframes projectId={projectId} sequenceId={sequence.id} clip={clip} pen={instance.tool === 'pen'} width={clipWidth} height={row.height - 4} pixels={pixels} onError={onError} />
          {fadable && instance.tool !== 'pen' && (['in', 'out'] as const).map(edge => {
            const length = edge === 'in' ? fadeIn : fadeOut
            const offset = Math.max(1, Math.min(clipWidth - 11, length - 5))
            return <div key={edge} data-video-edit-fade={edge} aria-label={edge === 'in' ? `拖动设置${clip.name}淡入` : `拖动设置${clip.name}淡出`} title={edge === 'in' ? '向右拖动淡入' : '向左拖动淡出'}
              className={`absolute top-0.5 z-raised h-2.5 w-2.5 cursor-ew-resize rounded-hairline border border-line-strong bg-control transition-opacity duration-120 ${length > 0 || selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
              style={edge === 'in' ? { left: offset } : { right: offset }} />
          })}
          {offsetLabel && <span className="pointer-events-none absolute right-2.5 top-0.5 rounded-sm bg-danger-solid px-1 text-2xs font-medium leading-4 tabular-nums text-on-danger" data-video-edit-sync-offset={offset}>{offsetLabel}</span>}
        </div>
  }
  /** 从素材面板拖来的素材项：按松手时同一套规则预演，得到将要落下的片段（虚影）；预演不了时只显示落点提示。 */
  const previewGhosts = (at: VideoEditDropPlacement): { ghosts?: VideoEditClip[]; shifted?: VideoEditClip[] } => {
    const drag = readActiveVideoEditItemDrag()
    if (!drag || drag.projectId !== projectId) return {}
    try {
      const result = placeVideoEditDrop(instance.document, drag.itemIds, sequence.id, at, { targetTrackIds: instance.targetTrackIds, matchEmptySequence: !sequence.clips.length, codeMetadata: readVideoEditCodeMetadata(instance, instance.document) })
      // 空序列会改成素材的帧率：虚影按当前时间线的帧率换算回来显示，位置与时长看上去和松手后一致
      const toView = (frame: number): number => rescaleVideoEditFrame(frame, result.frameRate, sequence.frameRate)
      const view = (clip: VideoEditClip): VideoEditClip => ({ ...clip, start: toView(clip.start), duration: Math.max(1, toView(clip.start + clip.duration) - toView(clip.start)) })
      // 插入时被推后的已有片段：在新位置画虚线框
      const before = new Map(sequence.clips.map(clip => [clip.id, clip.start]))
      const shifted = at.mode === 'insert' ? result.resultSequence.clips.filter(clip => before.has(clip.id) && before.get(clip.id) !== clip.start).map(view) : []
      return { ghosts: result.placedClips.map(view), shifted }
    } catch { return {} }
  }
  /** 落点提示的纵向位置：命中轨道上，或新建轨道的空白里贴着最外侧轨道。 */
  const hintTop = (at: VideoEditDropPlacement): number => {
    const { video, audio } = layout.regions
    if (at.newTrack === 'video') return Math.max(video.top, (rows.find(row => row.region === 'video')?.top ?? video.top + video.height) - 26)
    if (at.newTrack === 'audio') { const last = rows.filter(row => row.region === 'audio').at(-1); return Math.min(audio.top + audio.height - 26, last ? last.top + last.height + 2 : audio.top + 2) }
    return (rows.find(row => row.track.index === at.track)?.top ?? 0) + 2
  }
  return <>
    <div ref={pointer.viewport} tabIndex={0} role="region" aria-label="时间线编辑区域" data-video-edit-timeline-viewport data-video-edit-tool={instance.tool} className={`video-edit-timeline-viewport relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent ${pointer.failure ? 'cursor-not-allowed' : ''}`}
      onScroll={readViewport}
      onPointerDown={pointer.down} onPointerMove={pointer.move} onPointerUp={pointer.up} onPointerCancel={pointer.cancel} onLostPointerCapture={pointer.cancel} onContextMenu={menu.show}
      onDoubleClick={event => {
        // 双击记着来源的片段：回到来源继续编辑（图片文档片段打开图片编辑，4.1）；其余有源文件的片段按 Premiere 在源监视器打开。
        // 按下时视口捕获了指针，双击事件的目标是视口本身：按落点找片段
        const hit = elementOfEventTarget(event.target)?.closest('[data-video-edit-clip]') ?? document.elementFromPoint?.(event.clientX, event.clientY)?.closest('[data-video-edit-clip]')
        const clipId = hit?.getAttribute('data-video-edit-clip')
        if (!clipId) return
        if (sequence.clips.find(clip => clip.id === clipId)?.creativeSource) { event.preventDefault(); clipSource.open(projectId, clipId); return }
        const context = captureVideoEditCommandContext(projectId, 'timeline', { clipIds: [clipId] })
        if (videoEditCommandState(context, 'locate_source').enabled) { event.preventDefault(); void executeVideoEditCommand(context, 'locate_source').catch(onError) }
      }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); pointer.cancel() } }}
      onDragOver={event => {
        if (handleVideoEditEffectDragOver(event, projectId, { sequence, selectedClipIds: instance.selectedClipIds })) return
        const transitionKind = readVideoEditTransitionDrag(event.dataTransfer, projectId)
        if (transitionKind) {
          event.preventDefault()
          const at = transitionDrop(event, transitionKind); event.dataTransfer.dropEffect = at ? 'copy' : 'none'
          setTransitionHint(current => current && at && current.pair.leftClipId === at.pair.leftClipId && current.pair.rightClipId === at.pair.rightClipId && current.alignment === at.alignment && current.kind === at.kind ? current : at)
          return
        }
        if (!acceptsVideoEditDrop(event.dataTransfer)) return
        const at = placement(event); if (!at) { setHint(null); return }
        event.preventDefault(); event.dataTransfer.dropEffect = 'copy'
        setHint(current => current && current.frame === at.frame && current.track === at.track && current.newTrack === at.newTrack && current.mode === at.mode ? current : { ...at, ...previewGhosts(at) })
      }}
      onDragLeave={event => { if (!isDomNode(event.relatedTarget) || !event.currentTarget.contains(event.relatedTarget)) { setHint(null); setTransitionHint(null); clearVideoEditEffectDropTarget() } }}
      onDrop={event => {
        if (handleVideoEditEffectDrop(event, projectId, sequence.id, instance.selectedClipIds, onError)) return
        const transitionKind = readVideoEditTransitionDrag(event.dataTransfer, projectId)
        if (transitionKind) {
          event.preventDefault(); event.stopPropagation(); setTransitionHint(null)
          const at = transitionDrop(event, transitionKind)
          if (at) void placeVideoEditTransition(projectId, sequence.id, at.pair, at.kind, at.alignment).then(id => { focusVideoEditPanel(projectId, 'timeline'); selectVideoEditTransition(projectId, id) }).catch(onError)
          return
        }
        if (!acceptsVideoEditDrop(event.dataTransfer)) return
        event.preventDefault(); event.stopPropagation(); setHint(null)
        const at = placement(event); if (!at) return
        try {
          const input = readVideoEditDrop(event.dataTransfer); const owner = instance; const sequenceId = sequence.id
          void dropVideoEditInput(projectId, input, at, undefined, { sequenceId, createSequenceWhenEmpty: !sequence.clips.length }).catch(error => {
            if (error instanceof VideoEditSequenceFrameRateRequired && listVideoEditInstances().includes(owner)) setPendingSequence({ owner, input, placement: at, sequenceId, settings: error.settings })
            else onError(error)
          })
        } catch (error) { onError(error) }
      }}>
      <div className="relative" style={{ width, height: Math.max(view.height, TIMELINE_RULER_HEIGHT) }} data-video-edit-timeline-content>
        <div className="sticky top-0 z-sticky flex h-7 border-b border-line bg-panel" data-video-edit-ruler>
          <div className="sticky left-0 z-sticky flex shrink-0 items-center border-r border-gap bg-panel px-2.5 text-2xs text-text3" style={{ width: TIMELINE_HEADER_WIDTH }} data-video-edit-track-header>轨道</div>
          <VideoEditTimelinePosition instance={instance}>
            {Array.from({ length: Math.max(0, tickEnd - tickStart) }, (_, index) => index + tickStart).map(index => <span key={index} className="pointer-events-none absolute bottom-0 top-1 border-l border-line-strong pl-1 font-mono text-2xs tabular-nums text-text3" style={{ left: index * majorWidth }}>{timelineTimecode(index * ruler.major, fps)}</span>)}
            {minorPerMajor > 1 && Array.from({ length: Math.max(0, tickEnd - tickStart) * minorPerMajor }, (_, index) => tickStart * minorPerMajor + index).filter(index => index % minorPerMajor !== 0).map(index => <span key={`m${index}`} aria-hidden="true" className="pointer-events-none absolute bottom-0 h-1.5 border-l border-line" style={{ left: index * ruler.minor * pixels }} />)}
            <VideoEditTimelinePlayheadHead instance={instance} pixels={pixels} />
            {/* ui-surface-allow 标尺上的标记与字幕区间条是时间轴记号（12px 命中区 + 菱形图形），不是按钮档位（3.5 确认保留） */}
            {(sequence.markers ?? []).filter(mark => mark.frame * pixels >= view.left - 8 && mark.frame * pixels <= view.left + view.width - TIMELINE_HEADER_WIDTH + 8).map(mark => <UiButton key={mark.id} data-video-edit-marker={mark.id} aria-label={`定位标记 ${mark.name}`} className="absolute top-3 z-raised -ml-1.5 !h-3 !w-3 !p-0 text-accent-text" title={mark.name} style={{ left: mark.frame * pixels }} onPointerDown={event => event.stopPropagation()} onClick={() => run(() => { setVideoEditView(projectId, { frame: mark.frame, playing: false, selection: mark.clipId ?? null }); focusVideoEditPanel(projectId, 'content') })}><Diamond size={10} fill="currentColor" strokeWidth={1.5} aria-hidden="true" /></UiButton>)}
            {/* ui-surface-allow 字幕区间条：时间轴记号的命中区（区间色条由片段令牌给出），不是按钮档位 */}
            {(sequence.captions ?? []).filter(caption => (caption.start + caption.duration) * pixels >= view.left && caption.start * pixels <= view.left + view.width - TIMELINE_HEADER_WIDTH).map(caption => <UiButton key={caption.id} data-video-edit-caption-range={caption.id} aria-label={`定位字幕 ${caption.text}`} aria-pressed={selectedCaptionId === caption.id} className={`absolute top-0 !h-3 overflow-hidden !rounded-none !p-0 ${selectedCaptionId === caption.id ? 'bg-selected-accent text-accent-text ring-1 ring-accent-ring' : 'bg-clip-title text-text2'}`} style={{ left: caption.start * pixels, width: Math.max(2, caption.duration * pixels) }} title={caption.text} onPointerDown={event => event.stopPropagation()} onClick={() => run(() => { selectVideoEditSubtitle(projectId, sequence.id, caption.id); focusVideoEditPanel(projectId, 'content') })}><Captions size={12} aria-hidden="true" /><span className="truncate text-2xs">{caption.text}</span></UiButton>)}
            <VideoEditTimelineInOut instance={instance} sequence={sequence} fps={fps} duration={duration} pixels={pixels} onError={onError} />
          </VideoEditTimelinePosition>
        </div>
        {(['video', 'audio'] as const).map(kind => {
          const region = layout.regions[kind]
          // 每一区单独裁切：滚出本区的轨道与片段不显示（overflow-y: clip 不建立滚动容器，轨道头仍能横向吸附在左侧）。
          return <div key={kind} className="absolute left-0 right-0 overflow-y-clip" style={{ top: region.top, height: region.height }} data-video-edit-track-region={kind}>
            {rows.filter(row => row.region === kind).map(row => <div key={row.track.id} className="absolute left-0 right-0 border-b border-gap bg-window" style={{ top: row.top - region.top, height: row.height }} data-video-edit-track={row.track.id} data-track-index={row.track.index} data-track-kind={row.track.kind}>
              <VideoEditTrackHeader row={row} code={trackCodes.get(row.track.id) ?? ''} targeted={instance.targetTrackIds.includes(row.track.id)} renaming={trackMenu.renaming === row.track.id} onRename={name => trackMenu.rename(row.track.id, name)} onStartRename={() => trackMenu.startRename(row.track.id)}
                onContextMenu={event => trackMenu.show(event, row.track.id)}
                onTarget={() => run(() => setVideoEditTimelineView(projectId, { targetTrackIds: instance.targetTrackIds.includes(row.track.id) ? instance.targetTrackIds.filter(id => id !== row.track.id) : [...instance.targetTrackIds, row.track.id] }))}
                onPatch={patch => run(() => updateVideoEditTrack(projectId, sequence.id, row.track.id, patch))} onResize={event => pointer.resize(event, row)} channelFormat={row.track.kind === 'audio' ? channelFormatOf(row.track.index) : undefined} />
            </div>)}
            {visibleClips.filter(clip => rows.find(row => row.track.index === clip.track)?.region === kind).map(clip => renderClip(clip, region))}
            {transitionWindows.filter(window => rows.find(row => row.track.index === window.left.track)?.region === kind).map(window => renderTransition(window, region))}
            {transitionHint && rows.find(row => row.track.index === transitionHint.track)?.region === kind && <VideoEditTransitionDropBlock hint={transitionHint} row={rows.find(value => value.track.index === transitionHint.track)!} region={region} pixels={pixels} />}
            <VideoEditEffectDropTargets projectId={projectId} clips={visibleClips} rows={rows.filter(row => row.region === kind)} region={region} pixels={pixels} />
            <VideoEditInPlacePlaceholders projectId={projectId} sequence={displayed} rows={rows.filter(row => row.region === kind)} region={region} pixels={pixels} onReopen={inPlace.reopen} onError={onError} />
          </div>
        })}
        <div role="separator" aria-label="画面与声音轨道分界" aria-orientation="horizontal" aria-valuemin={10} aria-valuemax={90} aria-valuenow={Math.round(split * 100)} tabIndex={0} data-video-edit-track-divider data-video-edit-timeline-chrome
          className="absolute left-0 right-0 z-raised flex cursor-row-resize items-center outline-none focus-visible:bg-selected-accent" style={{ top: layout.regions.video.top + layout.regions.video.height, height: TIMELINE_TRACK_SECTION_GAP }}
          onPointerDown={event => {
            if (event.button !== 0) return
            event.preventDefault(); event.stopPropagation()
            const target = event.currentTarget; const area = layout.regions.video.height + layout.regions.audio.height; const startY = event.clientY; const startSplit = layout.regions.video.height / Math.max(1, area)
            target.setPointerCapture?.(event.pointerId)
            const move = (next: PointerEvent): void => setSplit(Math.max(0.1, Math.min(0.9, startSplit + (next.clientY - startY) / Math.max(1, area))))
            const end = (): void => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end) }
            target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end)
          }}
          onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); setSplit(value => Math.max(0.1, Math.min(0.9, value + (event.key === 'ArrowUp' ? -0.05 : 0.05)))) } }}>
          <div className={`pointer-events-none w-full ${UI_DIVIDER_CLASS}`} />
        </div>
        {(['video', 'audio'] as const).map(kind => <TimelineRegionScrollbar key={kind} region={layout.regions[kind]} left={view.left + view.width - 8} onScroll={dy => scrollRegion(kind, dy)} />)}
        {pointer.box && <div className="pointer-events-none absolute z-raised border border-accent-ring bg-accent-tint" style={{ left: TIMELINE_HEADER_WIDTH + Math.min(pointer.box.from.x, pointer.box.to.x), top: Math.min(pointer.box.from.y, pointer.box.to.y), width: Math.abs(pointer.box.to.x - pointer.box.from.x), height: Math.abs(pointer.box.to.y - pointer.box.from.y) }} data-video-edit-selection-box />}
        {hint?.ghosts?.length && hint.ghosts.every(ghost => rows.some(row => row.track.index === ghost.track))
          ? [...(hint.shifted ?? []).map(moved => { const row = rows.find(item => item.track.index === moved.track); return row ? <div key={`shift-${moved.id}`} aria-hidden="true" data-video-edit-drop-shifted className="pointer-events-none absolute z-raised rounded-md border border-dashed border-accent-ring" style={{ top: row.top + 2, height: row.height - 4, left: TIMELINE_HEADER_WIDTH + moved.start * pixels, width: Math.max(3, moved.duration * pixels) }} /> : null }), ...hint.ghosts.map(ghost => { const row = rows.find(item => item.track.index === ghost.track)!; return <div key={ghost.id} aria-hidden="true" data-video-edit-drop-ghost className="pointer-events-none absolute z-raised overflow-hidden rounded-md border-2 border-accent-ring bg-accent-tint px-1.5 text-2xs leading-4 text-text1" style={{ top: row.top + 2, height: row.height - 4, left: TIMELINE_HEADER_WIDTH + ghost.start * pixels, width: Math.max(3, ghost.duration * pixels) }}><span className="truncate">{ghost.name}</span></div> })]
          : hint && (hint.newTrack || rows.some(row => row.track.index === hint.track)) && <div className="pointer-events-none absolute z-raised flex h-6 w-40 items-center border-l-2 border-accent-ring bg-accent-tint px-2 text-2xs text-text1" style={{ top: hintTop(hint), left: TIMELINE_HEADER_WIDTH + hint.frame * pixels }}>{hint.newTrack ? '释放以新建轨道并添加' : '释放以添加素材'}</div>}
        {snapFrame !== null && <div aria-hidden="true" data-video-edit-snap-indicator={snapFrame} className="pointer-events-none absolute bottom-0 z-raised w-px bg-text1" style={{ top: TIMELINE_RULER_HEIGHT, left: TIMELINE_HEADER_WIDTH + snapFrame * pixels }} />}
        <VideoEditTimelinePlayhead instance={instance} pixels={pixels} />
        {/* 不能编辑的原因：浮在可见区域顶部居中，不占布局、不挡指针（4.3） */}
        <div role="status" aria-live="polite" data-video-edit-timeline-failure={pointer.failure ? '' : undefined}
          className={`pointer-events-none absolute z-dropdown max-w-sm -translate-x-1/2 truncate rounded-full bg-raised px-3 py-1 text-xs text-text1 shadow-panel transition-opacity duration-180 ${pointer.failure ? 'opacity-100' : 'opacity-0'}`}
          style={{ left: view.left + TIMELINE_HEADER_WIDTH + Math.max(0, view.width - TIMELINE_HEADER_WIDTH) / 2, top: TIMELINE_RULER_HEIGHT + 8 }}>{pointer.failure ?? failureText}</div>
      </div>
    </div>
    {/* PR 缩放滚动条取代原生横向滚动条：拖中间平移，拖两端缩放，滚轮缩放（4.6） */}
    <VideoEditTimelineZoomBar state={{ totalFrames: (width - TIMELINE_HEADER_WIDTH) / pixels, startFrame: view.left / pixels, visibleFrames: Math.max(1, view.width - TIMELINE_HEADER_WIDTH) / pixels }} width={Math.max(1, view.width - TIMELINE_HEADER_WIDTH - 8)}
      onScroll={frame => { const host = pointer.viewport.current; if (host) host.scrollLeft = Math.max(0, frame * pixels) }}
      onRange={(from, to) => videoEditTimelineViewport(projectId, sequence.id)?.showRange(from, to)}
      onZoom={(frame, factor) => videoEditTimelineViewport(projectId, sequence.id)?.zoomAt(frame, factor)} />
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    {trackMenu.elements}
    {clipSource.dialog}
    {inPlace.dialog}
    {speedDialog && <VideoEditSpeedDialog request={speedDialog} onClose={closeVideoEditSpeedDialog} />}
    {audioChannels && <VideoEditAudioChannelsDialog projectId={projectId} target={audioChannels} onClose={() => setAudioChannels(null)} />}
    {sceneTarget && <VideoEditSceneDetectionDialog target={sceneTarget} onClose={() => setSceneTarget(null)} />}
    {pendingSequence && <VideoEditSequenceDialog title="按素材新建序列" requireFrameRate initial={pendingSequence.settings} bins={pendingSequence.owner.document.bins} onClose={() => setPendingSequence(null)} onSubmit={async settings => {
      const { owner, input, placement: at, sequenceId } = pendingSequence
      if (requireVideoEditInstance(owner.document.id) !== owner) throw new Error('原剪辑已关闭，请重新拖入。')
      await dropVideoEditInput(owner.document.id, input, at, undefined, { sequenceId, createSequenceWhenEmpty: true, sequenceSettings: settings })
    }} />}
  </>
}

/** 一区的纵向滚动条（PR 的视频区、音频区各有一条）：贴在可见区域右缘，拖动滑块滚动这一区。 */
function TimelineRegionScrollbar({ region, left, onScroll }: { region: TimelineRegion; left: number; onScroll: (dy: number) => void }): React.ReactElement | null {
  if (region.maxScroll <= 0 || region.height <= 0) return null
  const thumb = Math.max(16, region.height * region.height / region.content)
  // 视频区的滚动从底部算起：没滚动时滑块在最下面。
  const progress = region.kind === 'video' ? 1 - region.scroll / region.maxScroll : region.scroll / region.maxScroll
  const ratio = region.maxScroll / Math.max(1, region.height - thumb)
  return <div className="absolute z-raised w-2" style={{ top: region.top, height: region.height, left }} data-video-edit-timeline-chrome data-video-edit-region-scrollbar={region.kind}>
    <div className="absolute left-0.5 w-1 rounded-full bg-text2/45 hover:bg-text2/70" style={{ top: (region.height - thumb) * progress, height: thumb }}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault(); event.stopPropagation()
        const target = event.currentTarget; let last = event.clientY
        target.setPointerCapture?.(event.pointerId)
        const move = (next: PointerEvent): void => { onScroll((next.clientY - last) * ratio); last = next.clientY }
        const end = (): void => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', end); target.removeEventListener('pointercancel', end) }
        target.addEventListener('pointermove', move); target.addEventListener('pointerup', end); target.addEventListener('pointercancel', end)
      }} />
  </div>
}
