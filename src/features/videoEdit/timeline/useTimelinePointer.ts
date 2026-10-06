import { useLayoutEffect, useRef, useState } from 'react'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'
import { expandVideoEditSelection, selectVideoEditRegion, selectVideoEditTrackFrom, videoEditPickRelations, type VideoEditRelations } from '@/core/videoEdit/timelineSelection'
import { videoEditMoveTrackMap } from '@/core/videoEdit/timelineEdits'
import { videoEditEditPoints, videoEditSnapFrame } from '@/core/videoEdit/timelineNavigation'
import { beginVideoEditTimelineDrag, finishVideoEditTimelineDrag, finishVideoEditTimelineRearrange, previewVideoEditTimelineDrag, previewVideoEditTimelineRearrange, updateVideoEditTrack, type VideoEditTimelineAdjustment, type VideoEditTimelineDrag, type VideoEditTimelineRearrange } from '../application/videoEditTimeline'
import { captureVideoEditCommandContext, executeVideoEditCommand } from '../application/videoEditCommands'
import { requireVideoEditInstance, setVideoEditTimelineView, setVideoEditView, type VideoEditInstance } from '../application/videoEditService'
import { elementOfEventTarget, ownerDocumentOf, ownerWindowOf } from '@/utils/crossRealmDom'
import { videoEditEdgeTracks } from '@/core/videoEdit/tracks'
import { videoEditTransitionWindow } from '@/core/videoEdit/transitions'
import { beginVideoEditFadeDrag, beginVideoEditTransitionDrag, finishVideoEditTimelineHandleDrag, previewVideoEditFadeDrag, previewVideoEditTransitionDrag, selectVideoEditTransition, type VideoEditTimelineHandleDrag } from '../application/videoEditTransitions'
import { TIMELINE_HEADER_WIDTH, timelineArmedEdgeVelocity, timelineEdgeAxis, timelineNewTrackZone, timelineRegionAt, timelineTrackAt, type TimelineEdgeAxis, type TimelineLayout, type TimelineRegionKind, type TimelineTrackRow } from './timelineGeometry'

interface Point { x: number; y: number }
export interface TimelineBox { from: Point; to: Point }
interface BaseGesture { owner: VideoEditInstance; baseline: VideoEditInstance['document']; sequenceId: string; pointerId: number; origin: Point; client: Point; edge: { x: TimelineEdgeAxis; y: TimelineEdgeAxis }; tool: VideoEditInstance['tool']; zoom: number; pixels: number }
type PointerGesture = BaseGesture & (
  /** `variant`: Premiere modifier drag of a clip body, read from the keys held on every move (Alt copy, Ctrl insert, both: copy and insert). */
  /** `newTracks`: tracks this drag creates above the top video track / below the bottom audio track, kept stable across moves. */
  | { kind: 'clip'; handle: VideoEditTimelineDrag; ids: string[]; primary: string; mode: VideoEditTimelineAdjustment['mode']; variant: ClipDragVariant; moved: boolean; adjustment?: VideoEditTimelineAdjustment; rearrange?: VideoEditTimelineRearrange; error?: Error; newTracks: VideoEditSequence['tracks'] }
  | { kind: 'box'; initial: string[]; additive: boolean; linked: VideoEditRelations }
  | { kind: 'hand'; left: number; last: number; region?: TimelineRegionKind }
  /** `snap`: Shift held — the playhead snaps to edit points, markers and the sequence in/out (Premiere). */
  | { kind: 'seek'; snap: boolean }
  | { kind: 'height'; trackId: string; height: number; next: number }
  | { kind: 'razor'; clipId: string; linked: VideoEditRelations }
  /** 过渡块（PR）：拖左右缘改时长、拖中间平移；淡化手柄：拖到的长度就是淡入／淡出。都是一次手势，文档实时预览、松手一步撤销。 */
  | { kind: 'transition'; drag: VideoEditTimelineHandleDrag; transitionId: string; mode: 'in' | 'out' | 'move'; moved: boolean }
  | { kind: 'fade'; drag: VideoEditTimelineHandleDrag; clipId: string; fade: 'in' | 'out'; frames: number; moved: boolean }
)
type ClipDragVariant = 'move' | VideoEditTimelineRearrange['mode']
function clipDragVariant(event: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): ClipDragVariant {
  return event.ctrlKey || event.metaKey ? event.altKey ? 'copy_insert' : 'insert' : event.altKey ? 'copy' : 'move'
}
/** `scrollRegion(kind, dy)`: scrolls one region (dy > 0 shows lower content), returns whether it moved. */
interface Options { instance: VideoEditInstance; sequence: VideoEditSequence; layout: { readonly current: TimelineLayout }; pixels: number; onError: (error: unknown) => void; scrollRegion: (kind: TimelineRegionKind, dy: number) => boolean }
/**
 * PR：把片段拖到最上面的视频轨之上（或最下面的音频轨之下）会新建轨道。按需要的条数逐条加，直到整个选区放得下。
 * 返回新轨道与按候选序列算出的轨道映射；放不下（如轨道已满）时抛出原因。
 */
function edgeTrackMove(sequence: VideoEditSequence, ids: string[], primary: string, kind: TimelineRegionKind, reuse: VideoEditSequence['tracks']): { newTracks: VideoEditSequence['tracks']; trackMap: Record<number, number> } {
  let failure: unknown
  for (let count = 1; count <= 32 - sequence.tracks.length; count++) {
    const newTracks = reuse.length >= count && reuse.slice(0, count).every(track => track.kind === kind) ? reuse.slice(0, count) : videoEditEdgeTracks(sequence, kind, count)
    const candidate = { ...sequence, tracks: [...sequence.tracks, ...newTracks] }
    try { return { newTracks, trackMap: videoEditMoveTrackMap(candidate, ids, primary, newTracks[0].index) } } catch (error) { failure = error }
  }
  throw failure ?? new Error('序列最多 32 条轨道，请先删除不用的轨道。')
}

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
      if (gesture.kind === 'transition' || gesture.kind === 'fade') return requireVideoEditInstance(gesture.owner.document.id) === gesture.owner && gesture.owner.activeSequenceId === gesture.sequenceId && current.current.pixels === gesture.pixels
      return requireVideoEditInstance(gesture.owner.document.id) === gesture.owner && gesture.owner.document === gesture.baseline && gesture.owner.activeSequenceId === gesture.sequenceId && gesture.owner.tool === gesture.tool && gesture.owner.zoom === gesture.zoom && current.current.pixels === gesture.pixels && (gesture.kind !== 'clip' || JSON.stringify(gesture.owner.selectedClipIds) === JSON.stringify(gesture.ids))
    } catch { return false }
  }
  const detach = (): PointerGesture | undefined => {
    const previous = pointer.current; pointer.current = undefined
    if (animation.current !== undefined) ownerWindowOf(viewport.current).cancelAnimationFrame(animation.current)
    animation.current = undefined
    if (previous && viewport.current?.hasPointerCapture?.(previous.pointerId)) viewport.current.releasePointerCapture(previous.pointerId)
    return previous
  }
  const clear = (): void => { setPreview(null); setBox(null); setResized(null); setFailure(null) }
  const cancel = (): void => {
    const previous = detach()
    if (previous?.kind === 'clip') finishVideoEditTimelineDrag(previous.handle)
    if (previous?.kind === 'transition' || previous?.kind === 'fade') finishVideoEditTimelineHandleDrag(previous.drag, false)
    if (previous?.kind === 'seek' && valid(previous)) setVideoEditView(previous.owner.document.id, { scrubbing: false })
    clear()
  }
  /** 拖动中的边缘吸附（吸附开着时）：吸到播放头、编辑点与标记，8 像素内。 */
  const snapEdge = (frame: number): number => {
    const { instance, sequence, pixels } = current.current
    if (!instance.snapping) return frame
    return videoEditSnapFrame([instance.frame, ...videoEditEditPoints(sequence), ...(sequence.markers ?? []).map(mark => mark.frame)], frame, 8 / pixels)
  }
  const applyPointer = (gesture: PointerGesture): void => {
    if (!valid(gesture)) { cancel(); return }
    const { instance, sequence, pixels } = current.current; const layout = current.current.layout.current
    const at = point(gesture.client)
    if (gesture.kind === 'clip') {
      if (!gesture.moved && Math.hypot(at.x - gesture.origin.x, at.y - gesture.origin.y) < 3) return
      gesture.moved = true
      try {
        const row = timelineTrackAt(layout.rows, at.y)
        // 预览里已出现的新轨道仍按“拖到轨道外”处理（新轨道不在原序列里）。
        const fresh = row && !sequence.tracks.some(track => track.id === row.track.id) ? row.track.kind : undefined
        const zone = gesture.mode !== 'move' ? undefined : fresh ?? (row ? undefined : timelineNewTrackZone(layout, at.y))
        if (!row && !zone) throw new Error('请将片段放在可用轨道内。')
        const delta = Math.round((at.x - gesture.origin.x) / pixels)
        const edge = zone ? edgeTrackMove(sequence, gesture.ids, gesture.primary, zone, gesture.newTracks) : undefined
        if (edge) gesture.newTracks = edge.newTracks
        const newTracks = edge ? { newTracks: edge.newTracks } : {}
        const trackMap = gesture.mode === 'move' ? edge?.trackMap ?? videoEditMoveTrackMap(sequence, gesture.ids, gesture.primary, row!.track.index) : undefined
        const snap = instance.snapping ? { snapThreshold: 8 / pixels, snapFrames: [instance.frame] } : {}
        if (gesture.mode === 'move' && gesture.variant !== 'move') {
          const rearrange: VideoEditTimelineRearrange = { mode: gesture.variant, delta, ...(trackMap ? { trackMap } : {}), ...snap, ...newTracks }
          const next = previewVideoEditTimelineRearrange(gesture.handle, rearrange)
          gesture.rearrange = rearrange; gesture.adjustment = undefined; gesture.error = undefined; setFailure(null); setPreview(next)
          return
        }
        const adjustment: VideoEditTimelineAdjustment = { mode: gesture.mode, delta, ...(trackMap ? { trackMap } : {}), ...snap, ...newTracks }
        const next = previewVideoEditTimelineDrag(gesture.handle, adjustment)
        gesture.adjustment = adjustment; gesture.rearrange = undefined; gesture.error = undefined; setFailure(null); setPreview(next)
      } catch (error) {
        gesture.adjustment = undefined; gesture.rearrange = undefined; gesture.error = error instanceof Error ? error : new Error(String(error)); setFailure(gesture.error.message); setPreview(null)
      }
    } else if (gesture.kind === 'transition' || gesture.kind === 'fade') {
      if (!gesture.moved && Math.abs(at.x - gesture.origin.x) < 3) return
      gesture.moved = true
      const raw = Math.round((at.x - gesture.origin.x) / pixels)
      try {
        if (gesture.kind === 'transition') {
          const transition = gesture.drag.baseline.transitions?.find(value => value.id === gesture.transitionId)
          if (!transition) throw new Error('原过渡已移除。')
          const window = videoEditTransitionWindow(gesture.drag.baseline, transition)
          // 吸附：拖左缘吸起点、拖右缘吸终点，平移时两缘谁先靠近就吸谁。
          const edge = gesture.mode === 'out' ? window.end : window.start
          let delta = snapEdge(edge + raw) - edge
          if (gesture.mode === 'move' && delta === raw) delta = snapEdge(window.end + raw) - window.end
          previewVideoEditTransitionDrag(gesture.drag, gesture.transitionId, gesture.mode, delta)
        } else {
          const clip = gesture.drag.baseline.clips.find(value => value.id === gesture.clipId)
          if (!clip) throw new Error('原片段已移除。')
          const end = gesture.fade === 'in' ? clip.start + gesture.frames + raw : clip.start + clip.duration - gesture.frames + raw
          const snapped = snapEdge(end)
          previewVideoEditFadeDrag(gesture.drag, gesture.clipId, gesture.fade, gesture.fade === 'in' ? snapped - clip.start : clip.start + clip.duration - snapped)
        }
        setFailure(null)
      } catch (error) { setFailure(error instanceof Error ? error.message : String(error)) }
    } else if (gesture.kind === 'box') setBox({ from: gesture.origin, to: at })
    else if (gesture.kind === 'height') {
      gesture.next = Math.max(24, Math.min(160, Math.round(gesture.height + gesture.client.y - gesture.origin.y)))
      setResized({ trackId: gesture.trackId, height: gesture.next })
    } else if (gesture.kind === 'seek') {
      const raw = Math.max(0, Math.min(Math.floor(videoEditFps(sequence.frameRate) * 1800), Math.round(at.x / pixels)))
      const frame = gesture.snap ? videoEditSnapFrame([...videoEditEditPoints(sequence), ...(sequence.markers ?? []).map(mark => mark.frame), ...[instance.inFrame, instance.outFrame].filter((value): value is number => value !== null)], raw, 8 / pixels) : raw
      setVideoEditView(instance.document.id, { playing: false, frame })
    } else if (gesture.kind === 'hand' && viewport.current) {
      viewport.current.scrollLeft = gesture.left + gesture.origin.x - gesture.client.x
      if (gesture.region) current.current.scrollRegion(gesture.region, gesture.last - gesture.client.y)
      gesture.last = gesture.client.y
    }
  }
  /**
   * Clip/box/seek drags scroll at the edges only after the pointer actually moved toward them. Vertically the region the
   * gesture started in scrolls at its own edges (PR: picture and sound tracks scroll separately).
   */
  const edgeVelocity = (gesture: PointerGesture, host: HTMLDivElement): Point & { region?: TimelineRegionKind } => {
    if ((gesture.kind !== 'clip' && gesture.kind !== 'box' && gesture.kind !== 'seek' && gesture.kind !== 'transition' && gesture.kind !== 'fade') || ((gesture.kind === 'clip' || gesture.kind === 'transition' || gesture.kind === 'fade') && !gesture.moved)) return { x: 0, y: 0 }
    const rect = host.getBoundingClientRect()
    const x = timelineArmedEdgeVelocity(gesture.edge.x, gesture.client.x, rect.left + TIMELINE_HEADER_WIDTH, rect.right)
    const region = gesture.kind === 'seek' || gesture.kind === 'transition' || gesture.kind === 'fade' ? undefined : timelineRegionAt(current.current.layout.current, gesture.origin.y)
    if (!region) return { x, y: 0 }
    const bounds = current.current.layout.current.regions[region]
    return { x, y: timelineArmedEdgeVelocity(gesture.edge.y, gesture.client.y, rect.top + bounds.top, rect.top + bounds.top + bounds.height), region }
  }
  const tick = (): void => {
    animation.current = undefined
    const gesture = pointer.current; const host = viewport.current
    if (!gesture || !host) return
    const velocity = edgeVelocity(gesture, host); const beforeX = host.scrollLeft
    if (velocity.x) host.scrollLeft = Math.max(0, host.scrollLeft + velocity.x)
    const scrolledY = velocity.y && velocity.region ? current.current.scrollRegion(velocity.region, velocity.y) : false
    if (host.scrollLeft !== beforeX || scrolledY) {
      applyPointer(gesture)
      if (pointer.current) animation.current = ownerWindowOf(host).requestAnimationFrame(tick)
    }
  }
  const animateEdge = (): void => {
    const gesture = pointer.current; const host = viewport.current
    if (animation.current !== undefined || !gesture || !host) return
    const velocity = edgeVelocity(gesture, host)
    if (velocity.x || velocity.y) animation.current = ownerWindowOf(host).requestAnimationFrame(tick)
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
    return { owner: instance, baseline: instance.document, sequenceId: sequence.id, pointerId: event.pointerId, origin: point(client), client, edge: { x: timelineEdgeAxis(client.x), y: timelineEdgeAxis(client.y) }, tool: instance.tool, zoom: instance.zoom, pixels: current.current.pixels }
  }
  /** `linked`: links follow Linked Selection, groups always; Alt inverts the former and singles out of groups (Premiere). */
  const select = (ids: string[], toggle: boolean, additive: boolean, linked: VideoEditRelations = videoEditPickRelations(current.current.instance.linkedSelection !== false)): void => {
    const { instance, sequence } = current.current
    const expanded = expandVideoEditSelection(sequence, ids, linked)
    const selected = toggle && expanded.every(id => instance.selectedClipIds.includes(id)) ? instance.selectedClipIds.filter(id => !expanded.includes(id)) : additive || toggle ? [...new Set([...instance.selectedClipIds, ...expanded])] : expanded
    setVideoEditTimelineView(instance.document.id, { selectedClipIds: selected }, selected.includes(ids[0]) ? ids[0] : undefined)
  }
  const down = (event: React.PointerEvent<HTMLDivElement>): void => {
    // 浮窗中的目标属于子窗口 realm，不能用 instanceof Element 判定。
    const target = elementOfEventTarget(event.target)
    if (event.button !== 0 || !target) return
    const { instance, sequence, pixels, onError } = current.current; const layout = current.current.layout.current
    const rows = layout.rows
    if (target.closest('[data-video-edit-track-header]') || target.closest('[data-video-edit-timeline-chrome]')) return
    event.preventDefault(); event.stopPropagation()
    viewport.current?.focus({ preventScroll: true })
    const at = point({ x: event.clientX, y: event.clientY }); const row = timelineTrackAt(rows, at.y)
    const clipId = target.closest('[data-video-edit-clip]')?.getAttribute('data-video-edit-clip')
    const clip = sequence.clips.find(value => value.id === clipId)
    const linked = videoEditPickRelations(instance.linkedSelection !== false, event.altKey)
    try {
      if (instance.tool === 'hand') { const host = viewport.current!; const region = timelineRegionAt(layout, at.y); capture({ ...base(event), kind: 'hand', origin: { x: event.clientX, y: event.clientY }, left: host.scrollLeft, last: event.clientY, ...(region ? { region } : {}) }); return }
      if (target.closest('[data-video-edit-ruler]')) { const gesture: PointerGesture = { ...base(event), kind: 'seek', snap: event.shiftKey }; capture(gesture); setVideoEditView(instance.document.id, { scrubbing: true }); applyPointer(gesture); return }
      if (instance.tool === 'track') { if (row) select(selectVideoEditTrackFrom(sequence, row.track.index, Math.max(0, Math.round(at.x / pixels)), event.shiftKey, linked), false, event.ctrlKey || event.metaKey, linked); return }
      if (instance.tool === 'razor') {
        // Alt-razor cuts only the clicked portion; its link to the uncut partner is kept.
        if (clip) capture({ ...base(event), kind: 'razor', clipId: clip.id, linked })
        return
      }
      // 过渡块与淡化手柄（选择工具）：按下即选中过渡／开始调淡化，拖动时实时预览。
      const transitionId = instance.tool === 'select' ? target.closest('[data-video-edit-transition]')?.getAttribute('data-video-edit-transition') : undefined
      if (transitionId) {
        const edge = target.closest('[data-video-edit-transition-edge]')?.getAttribute('data-video-edit-transition-edge')
        selectVideoEditTransition(instance.document.id, transitionId)
        capture({ ...base(event), kind: 'transition', drag: beginVideoEditTransitionDrag(instance.document.id, sequence.id, transitionId), transitionId, mode: edge === 'in' || edge === 'out' ? edge : 'move', moved: false })
        setVideoEditView(instance.document.id, { playing: false })
        return
      }
      selectVideoEditTransition(instance.document.id, null)
      const fadeEdge = instance.tool === 'select' && clip ? target.closest('[data-video-edit-fade]')?.getAttribute('data-video-edit-fade') : undefined
      if (clip && (fadeEdge === 'in' || fadeEdge === 'out')) {
        capture({ ...base(event), kind: 'fade', drag: beginVideoEditFadeDrag(instance.document.id, sequence.id, clip.id), clipId: clip.id, fade: fadeEdge, frames: (fadeEdge === 'in' ? clip.fadeInFrames : clip.fadeOutFrames) ?? 0, moved: false })
        setVideoEditView(instance.document.id, { playing: false })
        return
      }
      if (!clip) { capture({ ...base(event), kind: 'box', initial: [...instance.selectedClipIds], additive: event.ctrlKey || event.metaKey || event.shiftKey, linked }); setBox({ from: at, to: at }); return }
      // Shift+click adds or removes the clip (Premiere); Ctrl and Alt press on to modifier drags below.
      if (event.shiftKey) { select([clip.id], true, false, linked); return }
      // Alt on an already selected linked clip narrows the selection to that single portion.
      if (event.altKey || !instance.selectedClipIds.includes(clip.id)) select([clip.id], false, false, linked)
      else setVideoEditTimelineView(instance.document.id, { selectedClipIds: [...instance.selectedClipIds] }, clip.id)
      const ids = [...instance.selectedClipIds]
      const mode = target.closest('[data-video-edit-trim]')?.getAttribute('data-video-edit-trim') === 'in' ? 'in' : target.closest('[data-video-edit-trim]')?.getAttribute('data-video-edit-trim') === 'out' ? 'out' : 'move'
      // Validate even a stationary gesture so locked related clips cannot enter edit preview.
      const handle = beginVideoEditTimelineDrag(instance.document.id, sequence.id, ids)
      try { previewVideoEditTimelineDrag(handle, { mode, delta: 0 }) } catch (error) { finishVideoEditTimelineDrag(handle); throw error }
      capture({ ...base(event), kind: 'clip', handle, ids, primary: clip.id, mode, variant: clipDragVariant(event), moved: false, newTracks: [] })
      setVideoEditView(instance.document.id, { playing: false })
    } catch (error) { onError(error) }
  }
  const move = (event: React.PointerEvent): void => {
    const gesture = pointer.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gesture.client = { x: event.clientX, y: event.clientY }
    if (gesture.kind === 'seek') gesture.snap = event.shiftKey
    if (gesture.kind === 'clip') gesture.variant = clipDragVariant(event)
    applyPointer(gesture); animateEdge()
  }
  const up = (event: React.PointerEvent): void => {
    const gesture = pointer.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gesture.client = { x: event.clientX, y: event.clientY }
    applyPointer(gesture)
    const previous = detach(); clear()
    if (!previous) return
    if (!valid(previous)) { if (previous.kind === 'clip') finishVideoEditTimelineDrag(previous.handle); if (previous.kind === 'transition' || previous.kind === 'fade') finishVideoEditTimelineHandleDrag(previous.drag, false); return }
    const { instance, sequence, pixels, onError } = current.current; const layout = current.current.layout.current
    const rows = layout.rows
    try {
      if (previous.kind === 'clip') {
        if (previous.error) { finishVideoEditTimelineDrag(previous.handle); throw previous.error }
        const rearrange = previous.rearrange
        if (rearrange && (rearrange.delta || rearrange.newTracks?.length || Object.entries(rearrange.trackMap ?? {}).some(([from, to]) => Number(from) !== to))) finishVideoEditTimelineRearrange(previous.handle, rearrange)
        else if (rearrange) finishVideoEditTimelineDrag(previous.handle)
        else if (previous.adjustment && (previous.adjustment.delta || previous.adjustment.newTracks?.length || Object.entries(previous.adjustment.trackMap ?? {}).some(([from, to]) => Number(from) !== to))) finishVideoEditTimelineDrag(previous.handle, previous.adjustment)
        else finishVideoEditTimelineDrag(previous.handle)
      } else if (previous.kind === 'transition' || previous.kind === 'fade') finishVideoEditTimelineHandleDrag(previous.drag, previous.moved)
      else if (previous.kind === 'box') {
        const at = point(previous.client); const fromY = Math.min(previous.origin.y, at.y); const toY = Math.max(previous.origin.y, at.y)
        const ids = selectVideoEditRegion(sequence, { from: Math.max(0, previous.origin.x / pixels), to: Math.max(0, at.x / pixels), tracks: rows.filter(row => Math.max(row.top, row.clipTop) < toY && Math.min(row.top + row.height, row.clipBottom) > fromY).map(row => row.track.index) }, previous.linked)
        setVideoEditTimelineView(instance.document.id, { selectedClipIds: previous.additive ? [...new Set([...previous.initial, ...ids])] : ids })
      } else if (previous.kind === 'height' && previous.next !== previous.height) updateVideoEditTrack(instance.document.id, sequence.id, previous.trackId, { height: previous.next })
      else if (previous.kind === 'seek') setVideoEditView(instance.document.id, { scrubbing: false })
      else if (previous.kind === 'razor') {
        const context = captureVideoEditCommandContext(instance.document.id, 'timeline', { clipIds: [previous.clipId], linked: previous.linked, frame: Math.max(0, Math.round(point(previous.client).x / pixels)) })
        void executeVideoEditCommand(context, 'split').catch(onError)
      }
    } catch (error) { if (previous.kind === 'clip') finishVideoEditTimelineDrag(previous.handle); if (previous.kind === 'transition' || previous.kind === 'fade') finishVideoEditTimelineHandleDrag(previous.drag, false); onError(error) }
  }
  const resize = (event: React.PointerEvent<HTMLElement>, row: TimelineTrackRow): void => {
    if (event.button !== 0) return
    event.preventDefault(); event.stopPropagation()
    capture({ ...base(event), kind: 'height', origin: { x: event.clientX, y: event.clientY }, trackId: row.track.id, height: row.height, next: row.height })
  }
  useLayoutEffect(() => {
    if (pointer.current && !valid(pointer.current)) cancel()
  })
  useLayoutEffect(() => {
    // 时间线可能挂在系统浮窗里：失焦与隐藏按它实际所在的窗口判断。
    const ownerDocument = ownerDocumentOf(viewport.current); const ownerWindow = ownerWindowOf(viewport.current)
    const blur = (): void => cancel()
    const hidden = (): void => { if (ownerDocument.hidden) cancel() }
    ownerWindow.addEventListener('blur', blur); ownerDocument.addEventListener('visibilitychange', hidden)
    return () => { const previous = detach(); if (previous?.kind === 'clip') finishVideoEditTimelineDrag(previous.handle); if (previous?.kind === 'transition' || previous?.kind === 'fade') finishVideoEditTimelineHandleDrag(previous.drag, false); if (previous?.kind === 'seek' && valid(previous)) setVideoEditView(previous.owner.document.id, { scrubbing: false }); ownerWindow.removeEventListener('blur', blur); ownerDocument.removeEventListener('visibilitychange', hidden) }
    // All listeners read the fixed gesture/current refs, never a former selection closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { viewport, preview, box, resized, failure, down, move, up, resize, cancel, select }
}
