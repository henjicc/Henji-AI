import { useEffect, useRef, useState } from 'react'
import { ZoomIn } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import type { VideoEditClip, VideoEditSequence } from '@/core/videoEdit/document'
import { RECORDING_ZOOM_EFFECT, recordingZoomRegionFrames, recordingZoomRegionsIssue, recordingZoomSourceUsAtFrame, sortRecordingZoomRegions, type RecordingZoomRegion } from '@/core/videoEdit/recordingZoom'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { isVideoEditContentCurrent } from '../application/videoEditDocumentAlgorithm'
import { focusVideoEditPanel, setVideoEditView, type VideoEditInstance } from '../application/videoEditService'
import { RECORDING_ZOOM_DEPTH_LABELS, recordingClipEffect, setRecordingZoomRegions } from '../application/videoEditRecordingClip'
import { TIMELINE_HEADER_WIDTH, type TimelineLayout, type TimelineViewport } from './timelineGeometry'
import { VideoEditTimelinePlayhead } from './VideoEditTimelineTransport'

type Mode = 'move' | 'in' | 'out'
interface Props { instance: VideoEditInstance; sequence: VideoEditSequence; geometry: NonNullable<TimelineLayout['zoom']>; pixels: number; view: TimelineViewport; viewport: React.RefObject<HTMLDivElement>; onError: (error: unknown) => void }

function zoomRegions(clip: VideoEditClip): readonly RecordingZoomRegion[] { return recordingClipEffect(clip, RECORDING_ZOOM_EFFECT)?.builtin?.regions ?? [] }

/**
 * Z1, the zoom lane: every zoom stretch of every recording clip, where it plays on the timeline. Drag a block to move
 * it, drag its edges to change its length; it previews during the drag and commits once on release. Clicking one puts
 * the playhead on it, so the effect controls show that stretch.
 */
export function VideoEditZoomTrack({ instance, sequence, geometry, pixels, view, viewport, onError }: Props): React.ReactElement {
  const [preview, setPreview] = useState<{ clipId: string; region: RecordingZoomRegion } | null>(null)
  const cancel = useRef<(() => void) | null>(null)
  const projectId = instance.document.id
  useEffect(() => () => cancel.current?.(), [instance, sequence.id])
  useEffect(() => { cancel.current?.() }, [sequence, pixels])
  const run = (action: () => void): void => { try { action() } catch (error) { onError(error) } }
  const locked = (clip: VideoEditClip): boolean => sequence.tracks.find(track => track.index === clip.track)?.locked === true
  const focus = (clip: VideoEditClip, startFrame: number): void => run(() => { setVideoEditView(projectId, { selection: clip.id, frame: startFrame, playing: false }); focusVideoEditPanel(projectId, 'effects') })
  const down = (event: React.PointerEvent<HTMLElement>, clip: VideoEditClip, region: RecordingZoomRegion, frames: { startFrame: number; endFrame: number }, mode: Mode): void => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    cancel.current?.()
    event.currentTarget.focus({ preventScroll: true })
    if (locked(clip)) { focus(clip, frames.startFrame); return }
    const host = viewport.current
    if (!host) return
    const win = ownerWindowOf(host); const contentVersion = instance.contentVersion
    const origin = event.clientX; const scroll = host.scrollLeft
    const others = zoomRegions(clip).filter(value => value.id !== region.id)
    let next: RecordingZoomRegion | null = null; let moved = false
    const at = (frame: number): number => recordingZoomSourceUsAtFrame(instance.document, sequence.id, clip, Math.max(clip.start, Math.min(clip.start + clip.duration, frame)))
    const move = (pointer: PointerEvent): void => {
      if (pointer.pointerId !== event.pointerId) return
      if (!isVideoEditContentCurrent(instance, contentVersion)) { finish(false); return }
      moved ||= Math.abs(pointer.clientX - origin) >= 3
      if (!moved) return
      const delta = Math.round((pointer.clientX - origin + host.scrollLeft - scroll) / pixels)
      const start = mode === 'out' ? frames.startFrame : frames.startFrame + delta, end = mode === 'in' ? frames.endFrame : frames.endFrame + delta
      if (end - start < 2) return
      // Reversed clips run source time backwards: keep the region's own start before its end.
      const [a, b] = [at(start), at(end)].sort((x, y) => x - y)
      const candidate = { ...region, startUs: a, endUs: b, origin: 'manual' as const }
      if (recordingZoomRegionsIssue(sortRecordingZoomRegions([...others, candidate]))) return
      next = candidate; setPreview({ clipId: clip.id, region: candidate })
    }
    const up = (pointer: PointerEvent): void => { if (pointer.pointerId === event.pointerId) finish(true) }
    const abort = (): void => finish(false)
    const key = (pointer: KeyboardEvent): void => { if (pointer.key === 'Escape') { pointer.preventDefault(); pointer.stopPropagation(); finish(false) } }
    const finish = (commit: boolean): void => {
      cancel.current = null
      win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', up); win.removeEventListener('pointercancel', abort); win.removeEventListener('blur', abort); win.removeEventListener('keydown', key, true)
      setPreview(null)
      const target = { projectId, sequenceId: sequence.id, clipId: clip.id }
      if (!commit) return
      if (!moved) { focus(clip, frames.startFrame); return }
      if (next && isVideoEditContentCurrent(instance, contentVersion)) run(() => setRecordingZoomRegions(target, [...others, next!]))
    }
    cancel.current = abort
    win.addEventListener('pointermove', move); win.addEventListener('pointerup', up); win.addEventListener('pointercancel', abort); win.addEventListener('blur', abort); win.addEventListener('keydown', key, true)
  }
  const left = view.left - 32, right = view.left + view.width - TIMELINE_HEADER_WIDTH + 32
  const blocks = sequence.clips.flatMap(clip => zoomRegions(clip).flatMap(original => {
    const region = preview?.clipId === clip.id && preview.region.id === original.id ? preview.region : original
    const frames = recordingZoomRegionFrames(instance.document, sequence.id, clip, region)
    return frames && frames.endFrame * pixels >= left && frames.startFrame * pixels <= right ? [{ clip, original, region, frames }] : []
  }))
  const playhead = instance.frame
  return <div className="absolute left-0 right-0 z-sticky border-b border-gap bg-window" style={{ top: geometry.top - geometry.clipTop, height: geometry.height }} data-video-edit-zoom-track data-layout-pinned onPointerDown={event => { if (event.button === 0) event.stopPropagation() }}>
    <div className="sticky left-0 z-sticky flex h-full items-center border-r border-gap bg-panel pl-1 pr-1.5" style={{ width: TIMELINE_HEADER_WIDTH }}>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1"><span className="w-5 shrink-0 text-left font-mono text-2xs font-semibold">Z1</span><span className="truncate text-2xs">缩放</span></div>
    </div>
    <VideoEditTimelinePlayhead instance={instance} pixels={pixels} />
    {blocks.map(({ clip, original, region, frames }) => {
      const label = `${RECORDING_ZOOM_DEPTH_LABELS[region.depth - 1]}${region.focus === 'cursor' ? ' · 跟随鼠标' : ' · 固定位置'}`
      const current = clip.id === instance.selection && playhead >= frames.startFrame && playhead < frames.endFrame
      return <UiIconButton key={`${clip.id}:${original.id}`} type="button" tone="bare" aria-label={`缩放 ${label}`} aria-pressed={current} tooltip={label}
        data-ui-timeline-item data-video-edit-zoom-region={original.id} data-zoom-start={frames.startFrame} data-zoom-end={frames.endFrame}
        className={`absolute top-0.5 ${locked(clip) ? 'cursor-default' : 'cursor-grab'}`}
        style={{ height: geometry.height - 4, left: TIMELINE_HEADER_WIDTH + frames.startFrame * pixels, width: Math.max(3, (frames.endFrame - frames.startFrame) * pixels) }}
        onPointerDown={event => down(event, clip, original, frames, 'move')} onClick={event => { if (event.detail === 0) focus(clip, frames.startFrame) }}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); focus(clip, frames.startFrame) } }}>
        <span className={`flex h-full w-full items-center gap-1 overflow-hidden rounded-md border bg-clip-video px-1.5 text-2xs text-text1 ${current ? 'border-accent-ring ring-1 ring-accent-ring' : 'border-clip-video-line'}`}>
          <ZoomIn className="shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{label}</span>
          {!locked(clip) && (['in', 'out'] as const).map(edge => <span key={edge} title={edge === 'in' ? '拖动调整开始' : '拖动调整结束'} className={`absolute inset-y-0 w-1 cursor-ew-resize ${edge === 'in' ? 'left-0' : 'right-0'}`} onPointerDown={event => down(event, clip, original, frames, edge)} />)}
        </span>
      </UiIconButton>
    })}
  </div>
}
