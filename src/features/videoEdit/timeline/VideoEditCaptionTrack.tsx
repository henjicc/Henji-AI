import { isVideoEditContentCurrent } from '../application/videoEditDocumentAlgorithm'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { Captions } from 'lucide-react'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import type { VideoEditCaption } from '@/core/videoEdit/timedContent'
import { retimeVideoEditCaption, type VideoEditCaptionGesture } from '@/core/videoEdit/captionTiming'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { focusVideoEditPanel, type VideoEditInstance } from '../application/videoEditService'
import { moveVideoEditCaption, updateVideoEditCaptionTrack } from '../application/videoEditTimedContent'
import { selectVideoEditSubtitle, selectedVideoEditSubtitleId, subscribeVideoEditSubtitleSelection, videoEditSubtitleSelectionRevision } from '../application/videoEditSubtitleSelection'
import { VideoEditTrackHeader } from './VideoEditTrackHeader'
import { TIMELINE_HEADER_WIDTH, timelineArmedEdgeVelocity, timelineEdgeAxis, type TimelineLayout, type TimelineViewport } from './timelineGeometry'
import { clearTimelineSnap, reportTimelineSnap, snapTimelineEdges, timelineSnapPoints, TIMELINE_SNAP_PIXELS } from './timelineSnap'

interface Props { instance: VideoEditInstance; sequence: VideoEditSequence; geometry: TimelineLayout['caption']; pixels: number; view: TimelineViewport; viewport: React.RefObject<HTMLDivElement>; onError: (error: unknown) => void }

/** 字幕和普通轨道共用轨道头、行几何、片段令牌及领域历史；手势中只预览，松手提交一次。 */
export function VideoEditCaptionTrack({ instance, sequence, geometry, pixels, view, viewport, onError }: Props): React.ReactElement {
  const { t } = useTranslation('ui')
  useSyncExternalStore(subscribeVideoEditSubtitleSelection, videoEditSubtitleSelectionRevision)
  const selected = selectedVideoEditSubtitleId(instance, sequence.id)
  const [preview, setPreview] = useState<VideoEditCaption | null>(null)
  const cancel = useRef<(() => void) | null>(null)
  const projectId = instance.document.id
  useEffect(() => () => cancel.current?.(), [instance, sequence.id])
  useEffect(() => { cancel.current?.() }, [sequence, pixels])
  const run = (action: () => void): void => { try { action() } catch (error) { onError(error) } }
  const select = (id: string): void => { selectVideoEditSubtitle(projectId, sequence.id, id); focusVideoEditPanel(projectId, 'content') }
  const down = (event: React.PointerEvent<HTMLDivElement>, caption: VideoEditCaption, mode: VideoEditCaptionGesture): void => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    cancel.current?.()
    event.currentTarget.focus({ preventScroll: true })
    run(() => select(caption.id))
    const clip = sequence.clips.find(value => value.id === caption.clipId)
    if (sequence.captionTrackLocked || clip && sequence.tracks.find(track => track.index === clip.track)?.locked) return
    const host = viewport.current
    if (!host) return
    const win = ownerWindowOf(host); const contentVersion = instance.contentVersion
    const origin = event.clientX; const scroll = host.scrollLeft
    const points = timelineSnapPoints(sequence, { playhead: instance.frame, extra: (sequence.captions ?? []).filter(value => value.id !== caption.id).flatMap(value => [value.start, value.start + value.duration]) })
    const axis = timelineEdgeAxis(origin)
    let x = origin; let delta = 0; let moved = false; let animation = 0
    const update = (): void => {
      if (!isVideoEditContentCurrent(instance, contentVersion) || instance.activeSequenceId !== sequence.id) { finish(false); return }
      moved ||= Math.abs(x - origin) >= 3
      if (!moved) return
      delta = Math.round((x - origin + host.scrollLeft - scroll) / pixels)
      const edges = mode === 'move' ? [caption.start + delta, caption.start + caption.duration + delta] : [mode === 'in' ? caption.start + delta : caption.start + caption.duration + delta]
      if (instance.snapping) delta += snapTimelineEdges(sequence.id, points, edges, TIMELINE_SNAP_PIXELS / pixels)
      else clearTimelineSnap()
      try {
        const next = retimeVideoEditCaption(sequence, caption.id, mode, delta)
        if (instance.snapping) reportTimelineSnap(sequence.id, points, mode === 'move' ? [next.start, next.start + next.duration] : [mode === 'in' ? next.start : next.start + next.duration])
        setPreview(next)
      } catch (error) { finish(false); onError(error) }
    }
    const tick = (): void => {
      if (moved) {
        const rect = host.getBoundingClientRect()
        const velocity = timelineArmedEdgeVelocity(axis, x, rect.left + TIMELINE_HEADER_WIDTH, rect.right)
        if (velocity) { host.scrollLeft += velocity; update() }
      }
      if (cancel.current) animation = win.requestAnimationFrame(tick)
    }
    const move = (next: PointerEvent): void => { if (next.pointerId === event.pointerId) { x = next.clientX; update() } }
    const up = (next: PointerEvent): void => { if (next.pointerId === event.pointerId) { x = next.clientX; update(); if (cancel.current) finish(true) } }
    const abort = (): void => finish(false)
    const key = (next: KeyboardEvent): void => { if (next.key === 'Escape') { next.preventDefault(); next.stopPropagation(); finish(false) } }
    const finish = (commit: boolean): void => {
      cancel.current = null; win.cancelAnimationFrame(animation)
      win.removeEventListener('pointermove', move); win.removeEventListener('pointerup', up); win.removeEventListener('pointercancel', abort); win.removeEventListener('blur', abort); win.removeEventListener('keydown', key, true)
      setPreview(null); clearTimelineSnap()
      if (commit && moved && isVideoEditContentCurrent(instance, contentVersion) && instance.activeSequenceId === sequence.id) run(() => moveVideoEditCaption(projectId, sequence.id, caption.id, mode, delta))
    }
    cancel.current = abort
    win.addEventListener('pointermove', move); win.addEventListener('pointerup', up); win.addEventListener('pointercancel', abort); win.addEventListener('blur', abort); win.addEventListener('keydown', key, true)
    animation = win.requestAnimationFrame(tick)
  }
  const row = { track: { id: `${sequence.id}:captions`, name: t('captionTrack.name'), index: -1, kind: 'video' as const, enabled: sequence.captionTrackEnabled !== false, locked: sequence.captionTrackLocked === true, muted: false, solo: false }, ...geometry, region: 'video' as const }
  return <div className="absolute left-0 right-0 z-sticky border-b border-gap bg-window" style={{ top: row.top - row.clipTop, height: row.height }} data-video-edit-caption-track data-track-kind="caption" onPointerDown={event => event.stopPropagation()}>
    <VideoEditTrackHeader caption row={row} code="C1" targeted={false} onTarget={() => focusVideoEditPanel(projectId, 'content')} onResize={() => {}} onPatch={patch => run(() => updateVideoEditCaptionTrack(projectId, sequence.id, { ...(patch.enabled === undefined ? {} : { captionTrackEnabled: patch.enabled }), ...(patch.locked === undefined ? {} : { captionTrackLocked: patch.locked }) }))} />
    {(sequence.captions ?? []).filter(caption => caption.id === preview?.id || (caption.start + caption.duration) * pixels >= view.left - 32 && caption.start * pixels <= view.left + view.width - TIMELINE_HEADER_WIDTH + 32).map(original => {
      const caption = preview?.id === original.id ? preview : original
      return <div key={caption.id} role="button" tabIndex={0} aria-label={t('captionTrack.select', { text: caption.text })} aria-pressed={selected === caption.id} aria-disabled={sequence.captionTrackLocked || undefined} title={caption.text}
        data-video-edit-caption-range={caption.id} data-caption-start={caption.start} data-caption-duration={caption.duration}
        className={`absolute top-0.5 flex items-center gap-1 overflow-hidden rounded-md border bg-clip-title px-1.5 text-2xs text-text1 outline-none focus-visible:ring-1 focus-visible:ring-accent-ring ${selected === caption.id ? 'border-accent-ring ring-1 ring-accent-ring' : 'border-clip-title-line'} ${sequence.captionTrackLocked ? 'cursor-default' : 'cursor-grab'}`}
        style={{ height: row.height - 4, left: TIMELINE_HEADER_WIDTH + caption.start * pixels, width: Math.max(3, caption.duration * pixels) }}
        onPointerDown={event => down(event, original, 'move')} onClick={event => { if (event.detail === 0) run(() => select(caption.id)) }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); run(() => select(caption.id)) } }}>
        <Captions className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{caption.text}</span>
        {!sequence.captionTrackLocked && (['in', 'out'] as const).map(edge => <div key={edge} data-caption-trim={edge} title={t(`captionTrack.${edge === 'in' ? 'trimStart' : 'trimEnd'}`)} className={`absolute inset-y-0 w-1 cursor-ew-resize ${edge === 'in' ? 'left-0' : 'right-0'}`} onPointerDown={event => down(event, original, edge)} />)}
      </div>
    })}
  </div>
}
