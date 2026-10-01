import { useLayoutEffect, useState } from 'react'
import ContextMenu from '@/components/ContextMenu'
import { UiButton, UiError } from '@/components/ui'
import { VideoEditSequenceFrameRateRequired, type VideoEditSequenceSettings } from '@/core/videoEdit/projectItems'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'
import { acceptsVideoEditDrop, dropVideoEditInput, readVideoEditDrop, type VideoEditDropInput } from '../application/videoEditDrop'
import { listVideoEditInstances, requireVideoEditInstance, setVideoEditTimelineView, type VideoEditInstance } from '../application/videoEditService'
import { updateVideoEditTrack } from '../application/videoEditTimeline'
import { VideoEditSequenceDialog } from '../panels/VideoEditSequenceDialog'
import { VideoEditTrackHeader } from './VideoEditTrackHeader'
import { VideoEditTimelinePlayhead, VideoEditTimelinePosition } from './VideoEditTimelineTransport'
import { useTimelinePointer } from './useTimelinePointer'
import { useTimelineMenu } from './useTimelineMenu'
import { TIMELINE_HEADER_WIDTH, TIMELINE_RULER_HEIGHT, timelineTrackAt, timelineTrackRows, timelineVisibleClips, type TimelineViewport } from './timelineGeometry'

interface Props { instance: VideoEditInstance; sequence: VideoEditSequence; pixels: number; onError: (error: unknown) => void }
export function VideoEditTimelineCanvas({ instance, sequence, pixels, onError }: Props): React.ReactElement {
  const projectId = instance.document.id
  const fps = videoEditFps(sequence.frameRate)
  const [view, setView] = useState<TimelineViewport>({ left: 0, top: 0, width: 900, height: 300 })
  const [hint, setHint] = useState<{ frame: number; track: number } | null>(null)
  const [pendingSequence, setPendingSequence] = useState<{ owner: VideoEditInstance; input: VideoEditDropInput; placement: { frame: number; track: number }; sequenceId: string; settings: VideoEditSequenceSettings } | null>(null)
  const pointer = useTimelinePointer({ instance, sequence, rows: timelineTrackRows(sequence), pixels, onError })
  const menu = useTimelineMenu(instance, onError, pointer.cancel)
  const rows = timelineTrackRows(sequence, pointer.resized)
  const displayed = pointer.preview ?? sequence
  const duration = Math.max(1, ...displayed.clips.map(clip => clip.start + clip.duration))
  const width = Math.max(view.width, TIMELINE_HEADER_WIDTH + (duration + fps * 5) * pixels)
  const height = rows.at(-1) ? rows.at(-1)!.top + rows.at(-1)!.height : TIMELINE_RULER_HEIGHT
  const visibleClips = timelineVisibleClips(displayed.clips, rows, view, pixels)
  const tickSeconds = Math.max(1, Math.ceil(64 / (pixels * fps)))
  const tickWidth = tickSeconds * fps * pixels
  const tickStart = Math.max(0, Math.floor(view.left / tickWidth) - 1)
  const tickEnd = Math.ceil((view.left + view.width) / tickWidth) + 1
  const readViewport = (): void => {
    const host = pointer.viewport.current
    if (!host) return
    const next = { left: host.scrollLeft, top: host.scrollTop, width: host.clientWidth || 900, height: host.clientHeight || 300 }
    setView(previous => Object.keys(next).every(key => previous[key as keyof TimelineViewport] === next[key as keyof TimelineViewport]) ? previous : next)
  }
  useLayoutEffect(() => {
    const host = pointer.viewport.current
    if (!host) return
    readViewport()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(readViewport)
    observer?.observe(host)
    return () => observer?.disconnect()
    // The reader only accesses the stable viewport ref and state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
      onScroll={readViewport} onPointerDown={pointer.down} onPointerMove={pointer.move} onPointerUp={pointer.up} onPointerCancel={pointer.cancel} onLostPointerCapture={pointer.cancel} onContextMenu={menu.show}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); pointer.cancel() } }}
      onDragOver={event => { if (!acceptsVideoEditDrop(event.dataTransfer)) return; const at = placement(event); if (!at) { setHint(null); return } event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setHint(at) }}
      onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setHint(null) }}
      onDrop={event => {
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
            {sequence.annotations.filter(mark => mark.frame * pixels >= view.left - 8 && mark.frame * pixels <= view.left + view.width - TIMELINE_HEADER_WIDTH + 8).map(mark => <span key={mark.id} data-video-edit-marker={mark.id} className="pointer-events-none absolute top-3 z-raised text-2xs text-text-muted" title={mark.text || '标记'} style={{ left: mark.frame * pixels }}>◆</span>)}
          </VideoEditTimelinePosition>
        </div>
        {rows.map(row => <div key={row.track.id} className="absolute left-0 right-0 border-b border-border-dark" style={{ top: row.top, height: row.height }} data-video-edit-track={row.track.id} data-track-index={row.track.index} data-track-kind={row.track.kind}>
          <VideoEditTrackHeader row={row} targeted={instance.targetTrackIds.includes(row.track.id)} onTarget={() => run(() => setVideoEditTimelineView(projectId, { targetTrackIds: instance.targetTrackIds.includes(row.track.id) ? instance.targetTrackIds.filter(id => id !== row.track.id) : [...instance.targetTrackIds, row.track.id] }))}
            onPatch={patch => run(() => updateVideoEditTrack(projectId, sequence.id, row.track.id, patch))} onResize={event => pointer.resize(event, row)} />
        </div>)}
        {visibleClips.map(clip => {
          const row = rows.find(row => row.track.index === clip.track)!
          return <div key={clip.id} data-video-edit-clip={clip.id} data-clip-start={clip.start} data-clip-duration={clip.duration} className={`absolute flex items-center overflow-hidden rounded-lg ${instance.selectedClipIds.includes(clip.id) ? 'bg-accent/30 ring-1 ring-accent' : clip.kind === 'audio' ? 'bg-accent/10' : 'bg-app'}`} style={{ top: row.top + 2, height: row.height - 4, left: TIMELINE_HEADER_WIDTH + clip.start * pixels, width: Math.max(3, clip.duration * pixels) }}>
            <UiButton variant="plain" data-video-edit-trim="in" aria-label={`裁剪${clip.name}入点`} className="!h-full !w-2 shrink-0 cursor-ew-resize !rounded-none !p-0" tabIndex={-1}>│</UiButton>
            <UiButton variant="plain" aria-label={`选择片段 ${clip.name}`} title={clip.name} className="!h-full min-w-0 flex-1 truncate !rounded-none !px-1 !py-0 text-2xs" onClick={event => { if (event.detail === 0) run(() => pointer.select([clip.id], event.ctrlKey || event.metaKey, event.shiftKey)) }}>{clip.name}</UiButton>
            <UiButton variant="plain" data-video-edit-trim="out" aria-label={`裁剪${clip.name}出点`} className="!h-full !w-2 shrink-0 cursor-ew-resize !rounded-none !p-0" tabIndex={-1}>│</UiButton>
          </div>
        })}
        {pointer.box && <div className="pointer-events-none absolute z-raised border border-accent bg-accent/10" style={{ left: TIMELINE_HEADER_WIDTH + Math.min(pointer.box.from.x, pointer.box.to.x), top: Math.min(pointer.box.from.y, pointer.box.to.y), width: Math.abs(pointer.box.to.x - pointer.box.from.x), height: Math.abs(pointer.box.to.y - pointer.box.from.y) }} data-video-edit-selection-box />}
        {hint && rows.some(row => row.track.index === hint.track) && <div className="pointer-events-none absolute h-6 w-36 border-l-2 border-accent bg-accent/20 px-2 text-2xs text-text-dark" style={{ top: rows.find(row => row.track.index === hint.track)!.top + 2, left: TIMELINE_HEADER_WIDTH + hint.frame * pixels }}>释放以添加素材</div>}
        <VideoEditTimelinePlayhead instance={instance} pixels={pixels} />
      </div>
      {pointer.failure && <div className="sticky bottom-0 left-0 z-raised max-w-lg bg-panel px-2 py-1"><UiError title="当前位置不能编辑" message={pointer.failure} /></div>}
    </div>
    <ContextMenu items={menu.menuItems} position={menu.menuPosition} visible={menu.menuVisible} onClose={menu.hideMenu} />
    {pendingSequence && <VideoEditSequenceDialog title="按素材新建序列" requireFrameRate initial={pendingSequence.settings} bins={pendingSequence.owner.document.bins} onClose={() => setPendingSequence(null)} onSubmit={async settings => {
      const { owner, input, placement: at, sequenceId } = pendingSequence
      if (requireVideoEditInstance(owner.document.id) !== owner) throw new Error('原工程已关闭，请重新拖入。')
      await dropVideoEditInput(owner.document.id, input, at, undefined, { sequenceId, createSequenceWhenEmpty: true, sequenceSettings: settings })
    }} />}
  </>
}
