import { useRef, useSyncExternalStore } from 'react'
import type { VideoEditSequence } from '@/core/videoEdit/document'
import { setVideoEditTimelineView, subscribeVideoEditView, videoEditViewRevision, type VideoEditInstance } from '../application/videoEditService'
import { clearTimelineSnap, snapTimelineEdges, timelineSnapPoints, TIMELINE_SNAP_PIXELS } from './timelineSnap'

type Handle = 'in' | 'out' | 'move'
interface Props { instance: VideoEditInstance; sequence: VideoEditSequence; fps: number; duration: number; pixels: number; onError: (error: unknown) => void }
/**
 * 标尺上的序列入出点区间（PR）：入点到出点之间一条浅色条，只设了一端时延到序列开头或结尾。
 * 拖两端改入点／出点，拖中间整体平移；吸附开着时吸到播放头、编辑点与标记。入出点是视图状态，和 I／O 键一样不进撤销。
 */
export function VideoEditTimelineInOut({ instance, sequence, fps, duration, pixels, onError }: Props): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const drag = useRef<{ handle: Handle; pointerId: number; x: number; inFrame: number | null; outFrame: number | null } | null>(null)
  if (instance.inFrame === null && instance.outFrame === null) return null
  const maxFrame = Math.floor(fps * 1800)
  const from = instance.inFrame ?? 0
  const to = instance.outFrame ?? Math.max(from + 1, duration)
  const start = (event: React.PointerEvent<HTMLElement>, handle: Handle): void => {
    if (event.button !== 0) return
    // 不让标尺把这次按下当成定位播放头
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { handle, pointerId: event.pointerId, x: event.clientX, inFrame: instance.inFrame, outFrame: instance.outFrame }
  }
  const move = (event: React.PointerEvent<HTMLElement>): void => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    event.stopPropagation()
    const raw = Math.round((event.clientX - state.x) / pixels)
    const baseIn = state.inFrame ?? 0; const baseOut = state.outFrame ?? Math.max(baseIn + 1, duration)
    const edges = state.handle === 'in' ? [baseIn + raw] : state.handle === 'out' ? [baseOut + raw] : [baseIn + raw, baseOut + raw]
    const points = instance.snapping ? timelineSnapPoints(sequence, { playhead: instance.frame }) : []
    const delta = raw + snapTimelineEdges(sequence.id, points, edges, TIMELINE_SNAP_PIXELS / pixels)
    let next: { inFrame?: number; outFrame?: number }
    if (state.handle === 'in') next = { inFrame: Math.max(0, Math.min(baseOut - 1, baseIn + delta)) }
    else if (state.handle === 'out') next = { outFrame: Math.max(baseIn + 1, Math.min(maxFrame, baseOut + delta)) }
    else {
      const shift = Math.max(-baseIn, Math.min(maxFrame - baseOut, delta))
      next = { ...(state.inFrame !== null ? { inFrame: baseIn + shift } : {}), ...(state.outFrame !== null ? { outFrame: baseOut + shift } : {}) }
    }
    try { setVideoEditTimelineView(instance.document.id, next) } catch (error) { onError(error) }
  }
  const end = (event: React.PointerEvent<HTMLElement>): void => {
    if (drag.current?.pointerId !== event.pointerId) return
    event.stopPropagation()
    drag.current = null; clearTimelineSnap()
  }
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end }
  return <div data-video-edit-in-out-range={`${from}-${to}`} title="序列入点到出点：拖两端调整，拖中间整体移动"
    className="absolute bottom-0 z-raised h-2 cursor-grab bg-text1/15 hover:bg-text1/25" style={{ left: from * pixels, width: Math.max(2, (to - from) * pixels) }}
    onPointerDown={event => start(event, 'move')} {...handlers}>
    <div data-video-edit-in-out-handle="in" aria-label="拖动调整序列入点" className="absolute -left-1 bottom-0 top-0 w-2 cursor-ew-resize" onPointerDown={event => start(event, 'in')} {...handlers} />
    <div data-video-edit-in-out-handle="out" aria-label="拖动调整序列出点" className="absolute -right-1 bottom-0 top-0 w-2 cursor-ew-resize" onPointerDown={event => start(event, 'out')} {...handlers} />
  </div>
}
