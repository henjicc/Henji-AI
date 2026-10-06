import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Diamond } from 'lucide-react'
import ContextMenu from '@/components/ContextMenu'
import { UiButton, UiError } from '@/components/ui'
import { UI_DIVIDER_CLASS } from '@/components/ui/styleTokens'
import { VideoEditSequenceFrameRateRequired, type VideoEditSequenceSettings } from '@/core/videoEdit/projectItems'
import { videoEditDuration, videoEditClipMedia, type VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditFps, videoEditSourceSeconds } from '@/core/videoEdit/time'
import { videoEditSyncOffsets } from '@/core/videoEdit/linkSync'
import { videoEditPickRelations } from '@/core/videoEdit/timelineSelection'
import type { WaveformSourceRef } from '@/hooks/useWaveformData'
import { VideoEditClipWaveform } from './VideoEditClipWaveform'
import { VideoEditClipFilmstrip } from './VideoEditClipFilmstrip'
import { videoEditAudioFormatLabel, videoEditClipAudioFormat } from '@/core/videoEdit/audioChannels'
import { acceptsVideoEditDrop, dropVideoEditInput, readVideoEditDrop, type VideoEditDropInput } from '../application/videoEditDrop'
import { listVideoEditInstances, requireVideoEditInstance, setVideoEditTimelineView, setVideoEditView, focusVideoEditPanel, type VideoEditInstance } from '../application/videoEditService'
import { updateVideoEditTrack } from '../application/videoEditTimeline'
import { isDomNode, ownerWindowOf } from '@/utils/crossRealmDom'
import { VideoEditSequenceDialog } from '../panels/VideoEditSequenceDialog'
import { VideoEditAudioChannelsDialog, type VideoEditAudioChannelsTarget } from '../panels/VideoEditAudioChannelsDialog'
import { VideoEditTrackHeader } from './VideoEditTrackHeader'
import { VideoEditTimelinePlayhead, VideoEditTimelinePosition } from './VideoEditTimelineTransport'
import { useTimelinePointer } from './useTimelinePointer'
import { useTimelineMenu } from './useTimelineMenu'
import { useVideoEditClipSource } from '../panels/useVideoEditClipSource'
import { elementOfEventTarget } from '@/utils/crossRealmDom'
import { TIMELINE_HEADER_WIDTH, TIMELINE_RULER_HEIGHT, timelineInitialScrollTop, timelineTrackAt, timelineTrackDivider, timelineTrackRows, timelineVisibleClips, type TimelineViewport } from './timelineGeometry'

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
export function VideoEditTimelineCanvas({ instance, sequence, pixels, onError, visible = true }: Props): React.ReactElement {
  const projectId = instance.document.id
  const fps = videoEditFps(sequence.frameRate)
  const [view, setView] = useState<TimelineViewport>({ left: 0, top: 0, width: 900, height: 300 })
  const [hint, setHint] = useState<{ frame: number; track: number } | null>(null)
  const [pendingSequence, setPendingSequence] = useState<{ owner: VideoEditInstance; input: VideoEditDropInput; placement: { frame: number; track: number }; sequenceId: string; settings: VideoEditSequenceSettings } | null>(null)
  const pointer = useTimelinePointer({ instance, sequence, rows: timelineTrackRows(sequence), pixels, onError })
  const [audioChannels, setAudioChannels] = useState<VideoEditAudioChannelsTarget | null>(null)
  const clipSource = useVideoEditClipSource(onError)
  const menu = useTimelineMenu(instance, onError, pointer.cancel, setAudioChannels, clipId => clipSource.open(instance.document.id, clipId))
  const rows = timelineTrackRows(sequence, pointer.resized)
  const divider = timelineTrackDivider(rows)
  const initialViewport = useRef({ owner: instance, sequenceId: sequence.id, measured: false, settled: false, stableFrames: 0, frameCount: 0, width: 0, height: 0, visible, rows })
  const settlementFrame = useRef<number>()
  const programScroll = useRef<{ top: number; left: number }>()
  if (initialViewport.current.owner !== instance || initialViewport.current.sequenceId !== sequence.id) initialViewport.current = { owner: instance, sequenceId: sequence.id, measured: false, settled: false, stableFrames: 0, frameCount: 0, width: 0, height: 0, visible, rows }
  initialViewport.current.visible = visible
  initialViewport.current.rows = rows
  const displayed = pointer.preview ?? sequence
  const duration = videoEditDuration(displayed)
  const width = Math.max(view.width, TIMELINE_HEADER_WIDTH + (duration + fps * 5) * pixels)
  const height = rows.at(-1) ? rows.at(-1)!.top + rows.at(-1)!.height : TIMELINE_RULER_HEIGHT
  const visibleClips = timelineVisibleClips(displayed.clips, rows, view, pixels)
  // Out-of-sync offsets follow the drag preview so an Alt move shows its drift before release.
  const syncOffsets = videoEditSyncOffsets(displayed)
  // Waveforms slice each source's whole multi-resolution peaks (task 2.3): scrolling and zooming only redraw the visible part.
  const waveRanges = visibleClips.flatMap((clip): Array<{ clipId: string; from: number; to: number; startSeconds: number; endSeconds: number; sources: WaveformSourceRef[] }> => {
    const media = videoEditClipMedia(instance.document, clip)
    if (!media || !(clip.kind === 'audio' || clip.kind === 'video' && clip.sourceComponent !== 'video' && media.hasAudio === true)) return []
    const from = Math.max(clip.start, Math.floor(Math.max(0, view.left) / pixels)); const to = Math.min(clip.start + clip.duration, Math.ceil((view.left + view.width - TIMELINE_HEADER_WIDTH) / pixels))
    if (to <= from) return []
    const startSeconds = Math.max(0, videoEditSourceSeconds(clip) + (from - clip.start) / fps); const endSeconds = Math.min(media.durationSeconds, videoEditSourceSeconds(clip) + (to - clip.start) / fps)
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
  const trackCodes = new Map<string, string>()
  for (const kind of ['video', 'audio'] as const) displayed.tracks.filter(track => track.kind === kind).sort((a, b) => a.index - b.index).forEach((track, rank) => trackCodes.set(track.id, `${kind === 'video' ? 'V' : 'A'}${rank + 1}`))
  const devicePixelRatio = ownerWindowOf(pointer.viewport.current).devicePixelRatio || 1
  const tickSeconds = Math.max(1, Math.ceil(64 / (pixels * fps)))
  const tickWidth = tickSeconds * fps * pixels
  const tickStart = Math.max(0, Math.floor(view.left / tickWidth) - 1)
  const tickEnd = Math.ceil((view.left + view.width) / tickWidth) + 1
  const readViewport = useCallback((): void => {
    const host = pointer.viewport.current
    if (!host) return
    const next = { left: host.scrollLeft, top: host.scrollTop, width: host.clientWidth || 900, height: host.clientHeight || 300 }
    setView(previous => Object.keys(next).every(key => previous[key as keyof TimelineViewport] === next[key as keyof TimelineViewport]) ? previous : next)
  }, [pointer.viewport])
  const cancelInitialFrame = useCallback((): void => {
    if (settlementFrame.current !== undefined) ownerWindowOf(pointer.viewport.current).cancelAnimationFrame(settlementFrame.current)
    settlementFrame.current = undefined
  }, [pointer.viewport])
  const stopInitialPosition = useCallback((): void => {
    initialViewport.current.settled = true
    programScroll.current = undefined
    cancelInitialFrame()
  }, [cancelInitialFrame])
  const measureViewport = useCallback((): void => {
    const host = pointer.viewport.current
    const initial = initialViewport.current
    if (!host) return
    if (!initial.settled && initial.visible && host.clientHeight > TIMELINE_RULER_HEIGHT) {
      // Dock restoration can change the first valid size before its initial layout settles.
      if (!initial.measured && host.scrollTop !== 0) stopInitialPosition()
      else {
        const changed = !initial.measured || initial.height !== host.clientHeight || initial.width !== host.clientWidth
        if (changed) {
          initial.measured = true; initial.height = host.clientHeight; initial.width = host.clientWidth; initial.stableFrames = 0
          const top = timelineInitialScrollTop(initial.rows, host.clientHeight)
          if (host.scrollTop !== top) {
            host.scrollTop = top
            // Consume only the next scroll event at this exact programmatic target.
            programScroll.current = { top: host.scrollTop, left: host.scrollLeft }
          }
        }
        if (settlementFrame.current === undefined) settlementFrame.current = ownerWindowOf(host).requestAnimationFrame(() => {
          settlementFrame.current = undefined
          const current = initialViewport.current; const measuredHost = pointer.viewport.current
          if (!measuredHost || !current.visible || current.settled) return
          current.frameCount++
          current.stableFrames = current.height === measuredHost.clientHeight && current.width === measuredHost.clientWidth ? current.stableFrames + 1 : 0
          // Two stable layout samples, bounded to twelve frames even during animations.
          if (current.stableFrames >= 2 || current.frameCount >= 12) stopInitialPosition()
          measureViewport()
        })
      }
    }
    readViewport()
  }, [pointer.viewport, readViewport, stopInitialPosition])
  const onScroll = (): void => {
    const host = pointer.viewport.current
    const initial = initialViewport.current
    if (host && !initial.settled && initial.measured && (initial.height !== host.clientHeight || initial.width !== host.clientWidth)) { measureViewport(); return }
    const target = programScroll.current; programScroll.current = undefined
    if (!host || !target || host.scrollTop !== target.top || host.scrollLeft !== target.left) stopInitialPosition()
    readViewport()
  }
  useLayoutEffect(() => {
    const host = pointer.viewport.current
    if (!host) return
    // 用时间线实际所在窗口（可能是系统浮窗）的观察器与帧调度。
    const Observer = ownerWindowOf(host).ResizeObserver
    const observer = typeof Observer === 'undefined' ? undefined : new Observer(measureViewport)
    observer?.observe(host)
    return () => { observer?.disconnect(); cancelInitialFrame() }
  }, [pointer.viewport, measureViewport, cancelInitialFrame])
  useLayoutEffect(() => {
    cancelInitialFrame(); programScroll.current = undefined; initialViewport.current.stableFrames = 0
    measureViewport()
    return cancelInitialFrame
  }, [instance, sequence.id, visible, measureViewport, cancelInitialFrame])
  const placement = (event: React.DragEvent<HTMLDivElement>): { frame: number; track: number } | undefined => {
    const host = pointer.viewport.current!; const rect = host.getBoundingClientRect()
    const x = event.clientX - rect.left + host.scrollLeft - TIMELINE_HEADER_WIDTH
    if (event.clientX < rect.left + TIMELINE_HEADER_WIDTH) return undefined
    const row = timelineTrackAt(rows, event.clientY - rect.top + host.scrollTop)
    return row && { frame: Math.max(0, Math.round(x / pixels)), track: row.track.index }
  }
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  return <>
    <div ref={pointer.viewport} tabIndex={0} role="region" aria-label="时间线编辑区域" data-video-edit-timeline-viewport className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
      onScroll={onScroll} onWheelCapture={stopInitialPosition} onPointerDownCapture={stopInitialPosition} onKeyDownCapture={stopInitialPosition} onContextMenuCapture={stopInitialPosition}
      onPointerDown={pointer.down} onPointerMove={pointer.move} onPointerUp={pointer.up} onPointerCancel={pointer.cancel} onLostPointerCapture={pointer.cancel} onContextMenu={menu.show}
      onDoubleClick={event => {
        // 双击记着来源的片段：回到来源继续编辑（图片文档片段打开图片编辑，4.1）
        const clipId = elementOfEventTarget(event.target)?.closest('[data-video-edit-clip]')?.getAttribute('data-video-edit-clip')
        if (clipId && sequence.clips.find(clip => clip.id === clipId)?.creativeSource) { event.preventDefault(); clipSource.open(projectId, clipId) }
      }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); pointer.cancel() } }}
      onDragOver={event => { stopInitialPosition(); if (!acceptsVideoEditDrop(event.dataTransfer)) return; const at = placement(event); if (!at) { setHint(null); return } event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setHint(at) }}
      onDragLeave={event => { if (!isDomNode(event.relatedTarget) || !event.currentTarget.contains(event.relatedTarget)) setHint(null) }}
      onDrop={event => {
        stopInitialPosition()
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
      <div className="relative" style={{ width, height }} data-video-edit-timeline-content>
        <div className="sticky top-0 z-sticky flex h-7 border-b border-line bg-panel" data-video-edit-ruler>
          <div className="sticky left-0 z-sticky flex shrink-0 items-center border-r border-gap bg-panel px-2.5 text-2xs text-text3" style={{ width: TIMELINE_HEADER_WIDTH }} data-video-edit-track-header>轨道</div>
          <VideoEditTimelinePosition instance={instance}>
            {Array.from({ length: Math.max(0, tickEnd - tickStart) }, (_, index) => index + tickStart).map(index => <span key={index} className="pointer-events-none absolute bottom-0 top-1 border-l border-line pl-1 font-mono text-2xs tabular-nums text-text3" style={{ left: index * tickWidth }}>{index * tickSeconds}s</span>)}
            {/* ui-surface-allow 标尺上的标记与字幕区间条是时间轴记号（12px 命中区 + 菱形图形），不是按钮档位（3.5 确认保留） */}
            {(sequence.markers ?? []).filter(mark => mark.frame * pixels >= view.left - 8 && mark.frame * pixels <= view.left + view.width - TIMELINE_HEADER_WIDTH + 8).map(mark => <UiButton key={mark.id} data-video-edit-marker={mark.id} aria-label={`定位标记 ${mark.name}`} className="absolute top-3 z-raised -ml-1.5 !h-3 !w-3 !p-0 text-accent-text" title={mark.name} style={{ left: mark.frame * pixels }} onPointerDown={event => event.stopPropagation()} onClick={() => run(() => { setVideoEditView(projectId, { frame: mark.frame, playing: false, selection: mark.clipId ?? null }); focusVideoEditPanel(projectId, 'content') })}><Diamond size={10} fill="currentColor" strokeWidth={1.5} aria-hidden="true" /></UiButton>)}
            {/* ui-surface-allow 字幕区间条：时间轴记号的命中区（区间色条由片段令牌给出），不是按钮档位 */}
            {(sequence.captions ?? []).filter(caption => (caption.start + caption.duration) * pixels >= view.left && caption.start * pixels <= view.left + view.width - TIMELINE_HEADER_WIDTH).map(caption => <UiButton key={caption.id} data-video-edit-caption-range={caption.id} aria-label={`定位字幕 ${caption.text}`} className="absolute top-0 !h-1.5 overflow-hidden !rounded-none !p-0 bg-accent-tint" style={{ left: caption.start * pixels, width: Math.max(2, caption.duration * pixels) }} title={caption.text} onPointerDown={event => event.stopPropagation()} onClick={() => run(() => { setVideoEditView(projectId, { frame: caption.start, playing: false, selection: caption.clipId ?? null }); focusVideoEditPanel(projectId, 'content') })} />)}
          </VideoEditTimelinePosition>
        </div>
        {rows.map(row => <div key={row.track.id} className="absolute left-0 right-0 border-b border-gap bg-window" style={{ top: row.top, height: row.height }} data-video-edit-track={row.track.id} data-track-index={row.track.index} data-track-kind={row.track.kind}>
          <VideoEditTrackHeader row={row} code={trackCodes.get(row.track.id) ?? ''} targeted={instance.targetTrackIds.includes(row.track.id)} onTarget={() => run(() => setVideoEditTimelineView(projectId, { targetTrackIds: instance.targetTrackIds.includes(row.track.id) ? instance.targetTrackIds.filter(id => id !== row.track.id) : [...instance.targetTrackIds, row.track.id] }))}
            onPatch={patch => run(() => updateVideoEditTrack(projectId, sequence.id, row.track.id, patch))} onResize={event => pointer.resize(event, row)} channelFormat={row.track.kind === 'audio' ? channelFormatOf(row.track.index) : undefined} />
        </div>)}
        {divider !== undefined && <div role="separator" aria-label="画面与声音轨道分界" aria-orientation="horizontal" data-video-edit-track-divider className={`pointer-events-none absolute left-0 right-0 ${UI_DIVIDER_CLASS}`} style={{ top: divider }} />}
        {visibleClips.map(clip => {
          const row = rows.find(row => row.track.index === clip.track)!
          const range = rangesByClip.get(clip.id)
          const media = videoEditClipMedia(instance.document, clip)
          const channelType = videoEditClipAudioFormat(clip, media)
          const offset = syncOffsets.get(clip.id)
          const offsetLabel = offset === undefined ? undefined : `${offset > 0 ? '+' : ''}${offset}`
          const selected = instance.selectedClipIds.includes(clip.id)
          // Picture clips show a filmstrip of their media (task 2.4); sound clips their waveform (task 2.3).
          const sound = clip.kind === 'audio' || clip.kind === 'video' && clip.sourceComponent === 'audio'
          const picture = !sound && (clip.kind === 'video' && media?.kind === 'video' || clip.kind === 'image' && media?.kind === 'image')
          const surface = sound ? CLIP_SURFACE.audio : clip.kind === 'video' || clip.kind === 'image' ? CLIP_SURFACE.video : CLIP_SURFACE.title
          // Hidden picture tracks and muted sound tracks dim their clips (content only, see the overlay below), as in Premiere.
          const dimmed = !row.track.enabled || row.track.kind === 'audio' && row.track.muted
          const clipLeft = TIMELINE_HEADER_WIDTH + clip.start * pixels
          const clipWidth = Math.max(3, clip.duration * pixels)
          return <div key={clip.id} data-video-edit-clip={clip.id} data-clip-start={clip.start} data-clip-duration={clip.duration} className={`absolute overflow-hidden rounded-md border ${surface.fill} ${selected ? CLIP_SELECTED_LINE : surface.line}`} data-clip-dimmed={dimmed || undefined} style={{ top: row.top + 2, height: row.height - 4, left: clipLeft, width: clipWidth }}>
            {picture && media && <VideoEditClipFilmstrip clipId={clip.id} source={media.path} sourceRevision={media.sourceRevision} still={media.kind === 'image'} aspect={media.width > 0 && media.height > 0 ? media.width / media.height : 16 / 9}
              mediaEndSeconds={media.durationSeconds} frameSeconds={media.frameRate ? media.frameRate.denominator / media.frameRate.numerator : 1 / 30} sourceInSeconds={videoEditSourceSeconds(clip)} clipWidth={clipWidth} height={row.height - 6}
              secondsPerPixel={1 / (pixels * fps)} visibleFrom={stripEdge(view.left + TIMELINE_HEADER_WIDTH - clipLeft, clipWidth, Math.floor)} visibleTo={stripEdge(view.left + view.width - clipLeft, clipWidth, Math.ceil)} devicePixelRatio={devicePixelRatio} active={visible} />}
            {range && <VideoEditClipWaveform clipId={clip.id} sources={range.sources} startSeconds={range.startSeconds} endSeconds={range.endSeconds} left={(range.from - clip.start) * pixels} width={(range.to - range.from) * pixels} visible={visible} lane={picture ? 'lower' : 'full'} />}
            {/* 隐藏轨/静音轨只淡化画面与波形（盖一层半透明窗口底），片段名标签不跟着变淡：整片 opacity-50 时
                纸白下标签只剩 1.5:1（4.1 对比度审计） */}
            {dimmed && <div className="pointer-events-none absolute inset-0 bg-window/50" aria-hidden="true" />}
            <div className="absolute inset-0 flex">
              {/* ui-surface-allow 片段入点裁剪柄：命中区不是按钮档位，外观由片段容器的 clip 令牌给出 */}
              <UiButton data-video-edit-trim="in" aria-label={`裁剪${clip.name}入点`} className="!h-full !w-2 shrink-0 cursor-ew-resize !rounded-none !bg-transparent !p-0" tabIndex={-1} />
              {/* ui-surface-allow 片段体：整块是选择命中区，名称条压在缩略图/波形之上（设计稿 VideoEdit 片段名称条） */}
              <UiButton aria-label={`选择片段 ${clip.name}`} title={`${clip.name}${channelType ? ` · ${videoEditAudioFormatLabel(channelType)}` : ''}${offset === undefined ? '' : `：与链接片段失步 ${Math.abs(offset)} 帧，右键可移入同步或滑入同步`}`} data-video-edit-audio-format={channelType} className="!h-full min-w-0 flex-1 !items-start !justify-start !rounded-none !bg-transparent !p-0" onClick={event => { if (event.detail === 0) run(() => pointer.select([clip.id], event.ctrlKey || event.metaKey, event.shiftKey, videoEditPickRelations(instance.linkedSelection !== false, event.altKey))) }}>
                <span data-user-content className={`max-w-full truncate rounded-br-sm px-1.5 text-2xs leading-4 ${picture || sound ? 'bg-media-scrim text-on-media' : 'text-text1'}`}>{clip.name}</span>
              </UiButton>
              {/* ui-surface-allow 出点裁剪柄，同入点 */}
              <UiButton data-video-edit-trim="out" aria-label={`裁剪${clip.name}出点`} className="!h-full !w-2 shrink-0 cursor-ew-resize !rounded-none !bg-transparent !p-0" tabIndex={-1} />
            </div>
            {offsetLabel && <span className="pointer-events-none absolute right-2.5 top-0.5 rounded-sm bg-danger-solid px-1 text-2xs font-medium leading-4 tabular-nums text-on-danger" data-video-edit-sync-offset={offset}>{offsetLabel}</span>}
          </div>
        })}
        {pointer.box && <div className="pointer-events-none absolute z-raised border border-accent-ring bg-accent-tint" style={{ left: TIMELINE_HEADER_WIDTH + Math.min(pointer.box.from.x, pointer.box.to.x), top: Math.min(pointer.box.from.y, pointer.box.to.y), width: Math.abs(pointer.box.to.x - pointer.box.from.x), height: Math.abs(pointer.box.to.y - pointer.box.from.y) }} data-video-edit-selection-box />}
        {hint && rows.some(row => row.track.index === hint.track) && <div className="pointer-events-none absolute flex h-6 w-36 items-center border-l-2 border-accent-ring bg-accent-tint px-2 text-2xs text-text1" style={{ top: rows.find(row => row.track.index === hint.track)!.top + 2, left: TIMELINE_HEADER_WIDTH + hint.frame * pixels }}>释放以添加素材</div>}
        <VideoEditTimelinePlayhead instance={instance} pixels={pixels} />
      </div>
      {pointer.failure && <div className="sticky bottom-0 left-0 z-raised max-w-lg bg-panel px-2 py-1"><UiError title="当前位置不能编辑" message={pointer.failure} /></div>}
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    {clipSource.dialog}
    {audioChannels && <VideoEditAudioChannelsDialog projectId={projectId} target={audioChannels} onClose={() => setAudioChannels(null)} />}
    {pendingSequence && <VideoEditSequenceDialog title="按素材新建序列" requireFrameRate initial={pendingSequence.settings} bins={pendingSequence.owner.document.bins} onClose={() => setPendingSequence(null)} onSubmit={async settings => {
      const { owner, input, placement: at, sequenceId } = pendingSequence
      if (requireVideoEditInstance(owner.document.id) !== owner) throw new Error('原项目已关闭，请重新拖入。')
      await dropVideoEditInput(owner.document.id, input, at, undefined, { sequenceId, createSequenceWhenEmpty: true, sequenceSettings: settings })
    }} />}
  </>
}
