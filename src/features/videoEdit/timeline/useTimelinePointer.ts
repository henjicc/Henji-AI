import { useLayoutEffect, useRef, useState } from 'react'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'
import { expandVideoEditSelection, selectVideoEditRegion, selectVideoEditTrackFrom } from '@/core/videoEdit/timelineSelection'
import { videoEditMoveTrackMap } from '@/core/videoEdit/timelineEdits'
import { beginVideoEditTimelineDrag, finishVideoEditTimelineDrag, previewVideoEditTimelineDrag, updateVideoEditTrack, type VideoEditTimelineAdjustment, type VideoEditTimelineDrag } from '../application/videoEditTimeline'
import { captureVideoEditCommandContext, executeVideoEditCommand } from '../application/videoEditCommands'
import { requireVideoEditInstance, setVideoEditTimelineView, setVideoEditView, type VideoEditInstance } from '../application/videoEditService'
import { TIMELINE_HEADER_WIDTH, TIMELINE_RULER_HEIGHT, timelineEdgeVelocity, timelineTrackAt, type TimelineTrackRow } from './timelineGeometry'

interface Point { x: number; y: number }
export interface TimelineBox { from: Point; to: Point }
interface BaseGesture { owner: VideoEditInstance; baseline: VideoEditInstance['document']; sequenceId: string; pointerId: number; origin: Point; client: Point; tool: VideoEditInstance['tool']; zoom: number; pixels: number }
type PointerGesture = BaseGesture & (
  | { kind: 'clip'; handle: VideoEditTimelineDrag; ids: string[]; primary: string; mode: VideoEditTimelineAdjustment['mode']; moved: boolean; adjustment?: VideoEditTimelineAdjustment; error?: Error }
  | { kind: 'box'; initial: string[]; additive: boolean }
  | { kind: 'hand'; left: number; top: number }
  | { kind: 'seek' }
  | { kind: 'height'; trackId: string; height: number; next: number }
  | { kind: 'razor'; clipId: string }
)
interface Options { instance: VideoEditInstance; sequence: VideoEditSequence; rows: TimelineTrackRow[]; pixels: number; onError: (error: unknown) => void }

/** Pointer drafts are local and bounded; only release enters the shared edit history. */
export function useTimelinePointer(options: Options) {
  const current = useRef(options); current.current = options
  const viewport = useRef<HTMLDivElement>(null)
  const pointer = useRef<PointerGesture>()
  const animation = useRef<number>()
  const [preview, setPreview] = useState<VideoEditSequence | null>(null)
  const [box, setBox] = useState<TimelineBox | null>(null)
  const [resized, setResized] = useState<{ trackId: string; height: number } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const point = (client: Point): Point => {
    const host = viewport.current!; const rect = host.getBoundingClientRect()
    return { x: client.x - rect.left + host.scrollLeft - TIMELINE_HEADER_WIDTH, y: client.y - rect.top + host.scrollTop }
  }
  const valid = (gesture: PointerGesture): boolean => {
    try {
      return requireVideoEditInstance(gesture.owner.document.id) === gesture.owner && gesture.owner.document === gesture.baseline && gesture.owner.activeSequenceId === gesture.sequenceId && gesture.owner.tool === gesture.tool && gesture.owner.zoom === gesture.zoom && current.current.pixels === gesture.pixels && (gesture.kind !== 'clip' || JSON.stringify(gesture.owner.selectedClipIds) === JSON.stringify(gesture.ids))
    } catch { return false }
  }
  const detach = (): PointerGesture | undefined => {
    const previous = pointer.current; pointer.current = undefined
    if (animation.current !== undefined) cancelAnimationFrame(animation.current)
    animation.current = undefined
    if (previous && viewport.current?.hasPointerCapture?.(previous.pointerId)) viewport.current.releasePointerCapture(previous.pointerId)
    return previous
  }
  const clear = (): void => { setPreview(null); setBox(null); setResized(null); setFailure(null) }
  const cancel = (): void => {
    const previous = detach()
    if (previous?.kind === 'clip') finishVideoEditTimelineDrag(previous.handle)
    if (previous?.kind === 'seek' && valid(previous)) setVideoEditView(previous.owner.document.id, { scrubbing: false })
    clear()
  }
  const applyPointer = (gesture: PointerGesture): void => {
    if (!valid(gesture)) { cancel(); return }
    const { instance, sequence, rows, pixels } = current.current
    const at = point(gesture.client)
    if (gesture.kind === 'clip') {
      if (!gesture.moved && Math.hypot(at.x - gesture.origin.x, at.y - gesture.origin.y) < 3) return
      gesture.moved = true
      try {
        const row = timelineTrackAt(rows, at.y)
        if (!row) throw new Error('请将片段放在可用轨道内。')
        const adjustment: VideoEditTimelineAdjustment = { mode: gesture.mode, delta: Math.round((at.x - gesture.origin.x) / pixels), ...(gesture.mode === 'move' ? { trackMap: videoEditMoveTrackMap(sequence, gesture.ids, gesture.primary, row.track.index) } : {}), ...(instance.snapping ? { snapThreshold: 8 / pixels, snapFrames: [instance.frame] } : {}) }
        const next = previewVideoEditTimelineDrag(gesture.handle, adjustment)
        gesture.adjustment = adjustment; gesture.error = undefined; setFailure(null); setPreview(next)
      } catch (error) {
        gesture.adjustment = undefined; gesture.error = error instanceof Error ? error : new Error(String(error)); setFailure(gesture.error.message); setPreview(null)
      }
    } else if (gesture.kind === 'box') setBox({ from: gesture.origin, to: at })
    else if (gesture.kind === 'height') {
      gesture.next = Math.max(24, Math.min(160, Math.round(gesture.height + gesture.client.y - gesture.origin.y)))
      setResized({ trackId: gesture.trackId, height: gesture.next })
    } else if (gesture.kind === 'seek') {
      setVideoEditView(instance.document.id, { playing: false, frame: Math.max(0, Math.min(Math.floor(videoEditFps(sequence.frameRate) * 1800), Math.round(at.x / pixels))) })
    } else if (gesture.kind === 'hand' && viewport.current) {
      viewport.current.scrollLeft = gesture.left + gesture.origin.x - gesture.client.x
      viewport.current.scrollTop = gesture.top + gesture.origin.y - gesture.client.y
    }
  }
  const tick = (): void => {
    animation.current = undefined
    const gesture = pointer.current; const host = viewport.current
    if (!gesture || !host) { animation.current = undefined; return }
    if (gesture.kind === 'clip' || gesture.kind === 'box' || gesture.kind === 'seek') {
      const rect = host.getBoundingClientRect(); const beforeX = host.scrollLeft; const beforeY = host.scrollTop
      host.scrollLeft = Math.max(0, host.scrollLeft + timelineEdgeVelocity(gesture.client.x, rect.left + TIMELINE_HEADER_WIDTH, rect.right))
      if (gesture.kind !== 'seek') host.scrollTop = Math.max(0, host.scrollTop + timelineEdgeVelocity(gesture.client.y, rect.top + TIMELINE_RULER_HEIGHT, rect.bottom))
      if (host.scrollLeft !== beforeX || host.scrollTop !== beforeY) {
        applyPointer(gesture)
        if (pointer.current) animation.current = requestAnimationFrame(tick)
      }
    }
  }
  const animateEdge = (): void => {
    const gesture = pointer.current; const host = viewport.current
    if (animation.current !== undefined || !gesture || !host || !['clip', 'box', 'seek'].includes(gesture.kind)) return
    const rect = host.getBoundingClientRect()
    if (timelineEdgeVelocity(gesture.client.x, rect.left + TIMELINE_HEADER_WIDTH, rect.right) || (gesture.kind !== 'seek' && timelineEdgeVelocity(gesture.client.y, rect.top + TIMELINE_RULER_HEIGHT, rect.bottom))) animation.current = requestAnimationFrame(tick)
  }
  const capture = (gesture: PointerGesture): void => {
    cancel(); pointer.current = gesture
    viewport.current?.setPointerCapture?.(gesture.pointerId)
    viewport.current?.focus({ preventScroll: true })
    animateEdge()
  }
  const base = (event: React.PointerEvent): BaseGesture => {
    const { instance, sequence } = current.current
    const client = { x: event.clientX, y: event.clientY }
    return { owner: instance, baseline: instance.document, sequenceId: sequence.id, pointerId: event.pointerId, origin: point(client), client, tool: instance.tool, zoom: instance.zoom, pixels: current.current.pixels }
  }
  const select = (ids: string[], toggle: boolean, additive: boolean): void => {
    const { instance, sequence } = current.current
    const expanded = expandVideoEditSelection(sequence, ids)
    const selected = toggle && expanded.every(id => instance.selectedClipIds.includes(id)) ? instance.selectedClipIds.filter(id => !expanded.includes(id)) : additive || toggle ? [...new Set([...instance.selectedClipIds, ...expanded])] : expanded
    setVideoEditTimelineView(instance.document.id, { selectedClipIds: selected }, selected.includes(ids[0]) ? ids[0] : undefined)
  }
  const down = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    const { instance, sequence, rows, pixels, onError } = current.current
    if (event.target.closest('[data-video-edit-track-header]')) return
    event.preventDefault(); event.stopPropagation()
    viewport.current?.focus({ preventScroll: true })
    const at = point({ x: event.clientX, y: event.clientY }); const row = timelineTrackAt(rows, at.y)
    const clipId = event.target.closest('[data-video-edit-clip]')?.getAttribute('data-video-edit-clip')
    const clip = sequence.clips.find(value => value.id === clipId)
    try {
      if (instance.tool === 'hand') { const host = viewport.current!; capture({ ...base(event), kind: 'hand', origin: { x: event.clientX, y: event.clientY }, left: host.scrollLeft, top: host.scrollTop }); return }
      if (event.target.closest('[data-video-edit-ruler]')) { const gesture: PointerGesture = { ...base(event), kind: 'seek' }; capture(gesture); setVideoEditView(instance.document.id, { scrubbing: true }); applyPointer(gesture); return }
      if (instance.tool === 'track') { if (row) select(selectVideoEditTrackFrom(sequence, row.track.index, Math.max(0, Math.round(at.x / pixels)), event.shiftKey), false, event.ctrlKey || event.metaKey); return }
      if (instance.tool === 'razor') {
        if (clip) capture({ ...base(event), kind: 'razor', clipId: clip.id })
        return
      }
      if (!clip) { capture({ ...base(event), kind: 'box', initial: [...instance.selectedClipIds], additive: event.ctrlKey || event.metaKey || event.shiftKey }); setBox({ from: at, to: at }); return }
      if (event.ctrlKey || event.metaKey || event.shiftKey) { select([clip.id], event.ctrlKey || event.metaKey, event.shiftKey); return }
      if (!instance.selectedClipIds.includes(clip.id)) select([clip.id], false, false)
      else setVideoEditTimelineView(instance.document.id, { selectedClipIds: [...instance.selectedClipIds] }, clip.id)
      const ids = [...instance.selectedClipIds]
      const mode = event.target.closest('[data-video-edit-trim]')?.getAttribute('data-video-edit-trim') === 'in' ? 'in' : event.target.closest('[data-video-edit-trim]')?.getAttribute('data-video-edit-trim') === 'out' ? 'out' : 'move'
      // Validate even a stationary gesture so locked related clips cannot enter edit preview.
      const handle = beginVideoEditTimelineDrag(instance.document.id, sequence.id, ids)
      try { previewVideoEditTimelineDrag(handle, { mode, delta: 0 }) } catch (error) { finishVideoEditTimelineDrag(handle); throw error }
      capture({ ...base(event), kind: 'clip', handle, ids, primary: clip.id, mode, moved: false })
      setVideoEditView(instance.document.id, { playing: false })
    } catch (error) { onError(error) }
  }
  const move = (event: React.PointerEvent): void => {
    const gesture = pointer.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gesture.client = { x: event.clientX, y: event.clientY }; applyPointer(gesture); animateEdge()
  }
  const up = (event: React.PointerEvent): void => {
    const gesture = pointer.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gesture.client = { x: event.clientX, y: event.clientY }
    applyPointer(gesture)
    const previous = detach(); clear()
    if (!previous) return
    if (!valid(previous)) { if (previous.kind === 'clip') finishVideoEditTimelineDrag(previous.handle); return }
    const { instance, sequence, rows, pixels, onError } = current.current
    try {
      if (previous.kind === 'clip') {
        if (previous.error) { finishVideoEditTimelineDrag(previous.handle); throw previous.error }
        if (previous.adjustment && (previous.adjustment.delta || Object.entries(previous.adjustment.trackMap ?? {}).some(([from, to]) => Number(from) !== to))) finishVideoEditTimelineDrag(previous.handle, previous.adjustment)
        else finishVideoEditTimelineDrag(previous.handle)
      } else if (previous.kind === 'box') {
        const at = point(previous.client); const fromY = Math.min(previous.origin.y, at.y); const toY = Math.max(previous.origin.y, at.y)
        const ids = selectVideoEditRegion(sequence, { from: Math.max(0, previous.origin.x / pixels), to: Math.max(0, at.x / pixels), tracks: rows.filter(row => row.top < toY && row.top + row.height > fromY).map(row => row.track.index) })
        setVideoEditTimelineView(instance.document.id, { selectedClipIds: previous.additive ? [...new Set([...previous.initial, ...ids])] : ids })
      } else if (previous.kind === 'height' && previous.next !== previous.height) updateVideoEditTrack(instance.document.id, sequence.id, previous.trackId, { height: previous.next })
      else if (previous.kind === 'seek') setVideoEditView(instance.document.id, { scrubbing: false })
      else if (previous.kind === 'razor') {
        const context = captureVideoEditCommandContext(instance.document.id, 'timeline', { clipIds: [previous.clipId], frame: Math.max(0, Math.round(point(previous.client).x / pixels)) })
        void executeVideoEditCommand(context, 'split').catch(onError)
      }
    } catch (error) { if (previous.kind === 'clip') finishVideoEditTimelineDrag(previous.handle); onError(error) }
  }
  const resize = (event: React.PointerEvent<HTMLDivElement>, row: TimelineTrackRow): void => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    capture({ ...base(event), kind: 'height', origin: { x: event.clientX, y: event.clientY }, trackId: row.track.id, height: row.height, next: row.height })
  }
  useLayoutEffect(() => {
    if (pointer.current && !valid(pointer.current)) cancel()
  })
  useLayoutEffect(() => {
    const blur = (): void => cancel()
    const hidden = (): void => { if (document.hidden) cancel() }
    window.addEventListener('blur', blur); document.addEventListener('visibilitychange', hidden)
    return () => { const previous = detach(); if (previous?.kind === 'clip') finishVideoEditTimelineDrag(previous.handle); if (previous?.kind === 'seek' && valid(previous)) setVideoEditView(previous.owner.document.id, { scrubbing: false }); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden) }
    // All listeners read the fixed gesture/current refs, never a former selection closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { viewport, preview, box, resized, failure, down, move, up, resize, cancel, select }
}
