import { useCallback, useLayoutEffect, useRef, useState } from 'react'
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
import { TIMELINE_HEADER_WIDTH, TIMELINE_RULER_HEIGHT, timelineInitialScrollTop, timelineTrackAt, timelineTrackDivider, timelineTrackRows, timelineVisibleClips, type TimelineViewport } from './timelineGeometry'

interface Props { instance: VideoEditInstance; sequence: VideoEditSequence; pixels: number; onError: (error: unknown) => void; visible?: boolean }
export function VideoEditTimelineCanvas({ instance, sequence, pixels, onError, visible = true }: Props): React.ReactElement {
  const projectId = instance.document.id
  const fps = videoEditFps(sequence.frameRate)
  const [view, setView] = useState<TimelineViewport>({ left: 0, top: 0, width: 900, height: 300 })
  const [hint, setHint] = useState<{ frame: number; track: number } | null>(null)
  const [pendingSequence, setPendingSequence] = useState<{ owner: VideoEditInstance; input: VideoEditDropInput; placement: { frame: number; track: number }; sequenceId: string; settings: VideoEditSequenceSettings } | null>(null)
  const pointer = useTimelinePointer({ instance, sequence, rows: timelineTrackRows(sequence), pixels, onError })
  const [audioChannels, setAudioChannels] = useState<VideoEditAudioChannelsTarget | null>(null)
  const menu = useTimelineMenu(instance, onError, pointer.cancel, setAudioChannels)
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
        <div className="sticky top-0 z-sticky flex h-7 bg-app" data-video-edit-ruler>
          <div className="sticky left-0 z-sticky flex shrink-0 items-center bg-panel px-2 text-2xs text-text-muted" style={{ width: TIMELINE_HEADER_WIDTH }} data-video-edit-track-header>轨道</div>
          <VideoEditTimelinePosition instance={instance}>
            {Array.from({ length: Math.max(0, tickEnd - tickStart) }, (_, index) => index + tickStart).map(index => <span key={index} className="pointer-events-none absolute border-l border-border-dark pl-1 text-2xs tabular-nums text-text-muted" style={{ left: index * tickWidth }}>{index * tickSeconds}s</span>)}
            {/* ui-surface-allow 标尺上的标记 ◆ 与字幕区间条是时间轴记号，不是按钮档位；交 2.4/3.5 */}
            {(sequence.markers ?? []).filter(mark => mark.frame * pixels >= view.left - 8 && mark.frame * pixels <= view.left + view.width - TIMELINE_HEADER_WIDTH + 8).map(mark => <UiButton key={mark.id} data-video-edit-marker={mark.id} aria-label={`定位标记 ${mark.name}`} className="absolute top-3 z-raised !h-3 !p-0 text-accent" title={mark.name} style={{ left: mark.frame * pixels }} onPointerDown={event => event.stopPropagation()} onClick={() => run(() => { setVideoEditView(projectId, { frame: mark.frame, playing: false, selection: mark.clipId ?? null }); focusVideoEditPanel(projectId, 'content') })}>◆</UiButton>)}
            {/* ui-surface-allow 同上：字幕区间条 */}
            {(sequence.captions ?? []).filter(caption => (caption.start + caption.duration) * pixels >= view.left && caption.start * pixels <= view.left + view.width - TIMELINE_HEADER_WIDTH).map(caption => <UiButton key={caption.id} data-video-edit-caption-range={caption.id} aria-label={`定位字幕 ${caption.text}`} className="absolute top-0 !h-2 overflow-hidden !rounded-none !p-0 bg-accent/30" style={{ left: caption.start * pixels, width: Math.max(2, caption.duration * pixels) }} title={caption.text} onPointerDown={event => event.stopPropagation()} onClick={() => run(() => { setVideoEditView(projectId, { frame: caption.start, playing: false, selection: caption.clipId ?? null }); focusVideoEditPanel(projectId, 'content') })} />)}
          </VideoEditTimelinePosition>
        </div>
        {rows.map(row => <div key={row.track.id} className="absolute left-0 right-0 border-b border-border-dark" style={{ top: row.top, height: row.height }} data-video-edit-track={row.track.id} data-track-index={row.track.index} data-track-kind={row.track.kind}>
          <VideoEditTrackHeader row={row} targeted={instance.targetTrackIds.includes(row.track.id)} onTarget={() => run(() => setVideoEditTimelineView(projectId, { targetTrackIds: instance.targetTrackIds.includes(row.track.id) ? instance.targetTrackIds.filter(id => id !== row.track.id) : [...instance.targetTrackIds, row.track.id] }))}
            onPatch={patch => run(() => updateVideoEditTrack(projectId, sequence.id, row.track.id, patch))} onResize={event => pointer.resize(event, row)} channelFormat={row.track.kind === 'audio' ? channelFormatOf(row.track.index) : undefined} />
        </div>)}
        {divider !== undefined && <div role="separator" aria-label="画面与声音轨道分界" aria-orientation="horizontal" data-video-edit-track-divider className={`pointer-events-none absolute left-0 right-0 ${UI_DIVIDER_CLASS}`} style={{ top: divider }} />}
        {visibleClips.map(clip => {
          const row = rows.find(row => row.track.index === clip.track)!
          const range = rangesByClip.get(clip.id)
          const channelType = videoEditClipAudioFormat(clip, videoEditClipMedia(instance.document, clip))
          const offset = syncOffsets.get(clip.id)
          const offsetLabel = offset === undefined ? undefined : `${offset > 0 ? '+' : ''}${offset}`
          return <div key={clip.id} data-video-edit-clip={clip.id} data-clip-start={clip.start} data-clip-duration={clip.duration} className={`absolute flex items-center overflow-hidden rounded-lg ${instance.selectedClipIds.includes(clip.id) ? 'bg-accent/30 ring-1 ring-accent' : clip.kind === 'audio' ? 'bg-accent/10' : 'bg-app'}`} style={{ top: row.top + 2, height: row.height - 4, left: TIMELINE_HEADER_WIDTH + clip.start * pixels, width: Math.max(3, clip.duration * pixels) }}>
            {range && <VideoEditClipWaveform clipId={clip.id} sources={range.sources} startSeconds={range.startSeconds} endSeconds={range.endSeconds} left={(range.from - clip.start) * pixels} width={(range.to - range.from) * pixels} visible={visible} />}
            {/* ui-surface-allow 片段入点裁剪柄、片段体、出点裁剪柄：片段外观由 2.4 片段组件接管（素材片段令牌、缩略图与波形） */}
            <UiButton data-video-edit-trim="in" aria-label={`裁剪${clip.name}入点`} className="!h-full !w-2 shrink-0 cursor-ew-resize !rounded-none !p-0" tabIndex={-1}>│</UiButton>
            {/* ui-surface-allow 片段体，同上 */}
            <UiButton aria-label={`选择片段 ${clip.name}`} title={`${clip.name}${channelType ? ` · ${videoEditAudioFormatLabel(channelType)}` : ''}${offset === undefined ? '' : `：与链接片段失步 ${Math.abs(offset)} 帧，右键可移入同步或滑入同步`}`} data-video-edit-audio-format={channelType} className="!h-full min-w-0 flex-1 truncate !rounded-none !px-1 !py-0" onClick={event => { if (event.detail === 0) run(() => pointer.select([clip.id], event.ctrlKey || event.metaKey, event.shiftKey, videoEditPickRelations(instance.linkedSelection !== false, event.altKey))) }}>
              {/* 名称压在波形上：媒体叠层底 + 叠层文字（设计稿 VideoEdit 片段名称条），两套主题下都可读；定位使其绘制在绝对定位的波形之上 */}
              <span className="relative min-w-0 truncate rounded-sm bg-media-scrim px-1 text-on-media">{clip.name}</span>
            </UiButton>
            {offsetLabel && <span className="pointer-events-none shrink-0 px-1 text-2xs font-medium tabular-nums text-danger" data-video-edit-sync-offset={offset}>{offsetLabel}</span>}
            {/* ui-surface-allow 出点裁剪柄，同上 */}
            <UiButton data-video-edit-trim="out" aria-label={`裁剪${clip.name}出点`} className="!h-full !w-2 shrink-0 cursor-ew-resize !rounded-none !p-0" tabIndex={-1}>│</UiButton>
          </div>
        })}
        {pointer.box && <div className="pointer-events-none absolute z-raised border border-accent bg-accent/10" style={{ left: TIMELINE_HEADER_WIDTH + Math.min(pointer.box.from.x, pointer.box.to.x), top: Math.min(pointer.box.from.y, pointer.box.to.y), width: Math.abs(pointer.box.to.x - pointer.box.from.x), height: Math.abs(pointer.box.to.y - pointer.box.from.y) }} data-video-edit-selection-box />}
        {hint && rows.some(row => row.track.index === hint.track) && <div className="pointer-events-none absolute h-6 w-36 border-l-2 border-accent bg-accent/20 px-2 text-2xs text-text-dark" style={{ top: rows.find(row => row.track.index === hint.track)!.top + 2, left: TIMELINE_HEADER_WIDTH + hint.frame * pixels }}>释放以添加素材</div>}
        <VideoEditTimelinePlayhead instance={instance} pixels={pixels} />
      </div>
      {pointer.failure && <div className="sticky bottom-0 left-0 z-raised max-w-lg bg-panel px-2 py-1"><UiError title="当前位置不能编辑" message={pointer.failure} /></div>}
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    {audioChannels && <VideoEditAudioChannelsDialog projectId={projectId} target={audioChannels} onClose={() => setAudioChannels(null)} />}
    {pendingSequence && <VideoEditSequenceDialog title="按素材新建序列" requireFrameRate initial={pendingSequence.settings} bins={pendingSequence.owner.document.bins} onClose={() => setPendingSequence(null)} onSubmit={async settings => {
      const { owner, input, placement: at, sequenceId } = pendingSequence
      if (requireVideoEditInstance(owner.document.id) !== owner) throw new Error('原工程已关闭，请重新拖入。')
      await dropVideoEditInput(owner.document.id, input, at, undefined, { sequenceId, createSequenceWhenEmpty: true, sequenceSettings: settings })
    }} />}
  </>
}
