import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { videoEditClipPictureSize, videoEditClipToFrame, videoEditFrameToClip } from '@/core/videoEdit/clipGeometry'
import { affineVideoEditMaskShape, editVideoEditMaskShape, insertVideoEditMaskPoint, isShapesMask, nearestVideoEditMaskSegment, removeVideoEditMaskPoint, toggleVideoEditMaskPoint, videoEditMaskShapeBounds, type VideoEditMaskDragKind, type VideoEditMaskPoint, type VideoEditMaskShape } from '@/core/videoEdit/effectMasks'
import { matchVideoEditShortcut } from '@/core/videoEdit/commands'
import { useSettingsStore } from '@/stores/settingsStore'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { createLogger } from '@/core/logging'
import { beginVideoEditGesture, finishVideoEditGesture, getActiveVideoEditSequence, subscribeVideoEditDomain, videoEditDomainRevision, type VideoEditGesture, type VideoEditInstance } from '../application/videoEditService'
import { updateVideoEditBuiltinEffect } from '../application/videoEditCompositing'
import { getVideoEditMaskEditing, setVideoEditMaskEditing, subscribeVideoEditMaskEditing, videoEditMaskEditingRevision } from '../application/videoEditMaskEditing'

const logger = createLogger('features.videoEdit.mask')
const HANDLE = 5
const BOX_HANDLES = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]] as const
interface Drag {
  pointerId: number; kind: VideoEditMaskDragKind | 'scale' | 'rotate'; index: number
  start: { u: number; v: number }; original: VideoEditMaskShape; gesture?: VideoEditGesture
  moved: boolean; alt: boolean; transform: boolean
}
interface Transform { gesture: VideoEditGesture; shapeId: string }

/** 路径共用钢笔编辑；指针更新按显示帧合并，松手刷新最后值，变换与助手共用文档撤销。 */
export function VideoEditMaskOverlay({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditMaskEditing, videoEditMaskEditingRevision)
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  const target = getVideoEditMaskEditing()
  const svg = useRef<SVGSVGElement>(null)
  const hovering = useRef(false)
  const drag = useRef<Drag>()
  const transform = useRef<Transform>()
  const raf = useRef<number>()
  const pending = useRef<VideoEditMaskShape>()
  const publish = useRef<(shape: VideoEditMaskShape, gesture?: VideoEditGesture) => void>(() => undefined)
  const [transforming, setTransforming] = useState(false)
  const [modifiers, setModifiers] = useState({ alt: false, ctrl: false, shift: false })
  const [pen, setPen] = useState<{ points: VideoEditMaskPoint[]; dragging: boolean } | null>(null)
  const sequence = getActiveVideoEditSequence(instance)
  const clip = target && target.projectId === instance.document.id && target.sequenceId === instance.activeSequenceId ? sequence.clips.find(entry => entry.id === target.clipId) : undefined
  const effect = clip?.effects?.find(entry => entry.id === target?.effectId)
  const visible = Boolean(target && clip && effect?.builtin && instance.frame >= clip.start && instance.frame < clip.start + clip.duration)
  const shapes = effect && isShapesMask(effect.mask) ? effect.mask.shapes : []
  const penActive = Boolean(visible && target?.pen)
  const scope = visible && target ? `${target.projectId}:${target.sequenceId}:${target.clipId}:${target.effectId}:${penActive}` : ''

  useEffect(() => {
    const element = svg.current
    if (!element) return
    const owner = ownerWindowOf(element)
    // 只监听光标修饰状态；编辑快捷键仍由有焦点的 SVG 独占处理。
    const modifier = (event: KeyboardEvent): void => {
      if (hovering.current || owner.document.activeElement === element) setModifiers({ alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey })
    }
    owner.addEventListener('keydown', modifier); owner.addEventListener('keyup', modifier)
    return () => { hovering.current = false; owner.removeEventListener('keydown', modifier); owner.removeEventListener('keyup', modifier) }
  }, [scope])
  useEffect(() => { if (!penActive) setPen(null) }, [penActive])
  useEffect(() => {
    setTransforming(false)
    const owner = svg.current && ownerWindowOf(svg.current)
    return () => {
      if (raf.current !== undefined) owner?.cancelAnimationFrame(raf.current)
      raf.current = undefined; pending.current = undefined
      const value = drag.current; drag.current = undefined
      const session = transform.current; transform.current = undefined
      if (value?.gesture && !value.transform) finishVideoEditGesture(value.gesture, false)
      if (session) finishVideoEditGesture(session.gesture, false)
    }
  }, [scope])
  useEffect(() => {
    const session = transform.current
    if (session && session.shapeId !== target?.shapeId) {
      transform.current = undefined; setTransforming(false); finishVideoEditGesture(session.gesture, false)
    }
  }, [target?.shapeId])

  if (!visible || !target || !clip || !effect) return null
  const frame = { width: sequence.width, height: sequence.height }
  const picture = videoEditClipPictureSize(sequence, clip)
  const toFrame = (u: number, v: number): [number, number] => {
    const point = videoEditClipToFrame(clip, picture, frame, u, v)
    return [point.x * frame.width, point.y * frame.height]
  }
  const pointerClip = (event: { clientX: number; clientY: number }): { u: number; v: number } => {
    const rect = svg.current!.getBoundingClientRect()
    return videoEditFrameToClip(clip, picture, frame, (event.clientX - rect.left) / Math.max(1, rect.width), (event.clientY - rect.top) / Math.max(1, rect.height))
  }
  const rect = svg.current?.getBoundingClientRect()
  const radius = HANDLE * frame.width / Math.max(1, rect?.width ?? frame.width)
  const stroke = Math.max(1, radius / 3)
  const selected = shapes.find(shape => shape.id === target.shapeId)
  const commitShapes = (next: VideoEditMaskShape[], gesture?: VideoEditGesture): void => updateVideoEditBuiltinEffect(target, effect.id, { mask: next.length ? { regionId: 'shapes', shapes: next } : null }, gesture)
  publish.current = (shape, gesture) => commitShapes(shapes.map(value => value.id === shape.id ? shape : value), gesture)
  const select = (shape: VideoEditMaskShape, pointIndex?: number): void => setVideoEditMaskEditing({ ...target, shapeId: shape.id, pointIndex })
  const atomic = (shape: VideoEditMaskShape): void => { try { publish.current(shape) } catch (error) { onError(error) } }
  const discardPending = (): void => {
    if (raf.current !== undefined) ownerWindowOf(svg.current!).cancelAnimationFrame(raf.current)
    raf.current = undefined; pending.current = undefined
  }
  const flush = (): void => {
    if (raf.current !== undefined) ownerWindowOf(svg.current!).cancelAnimationFrame(raf.current)
    raf.current = undefined
    const next = pending.current; pending.current = undefined
    const value = drag.current
    if (!next || !value) return
    try {
      value.gesture ??= beginVideoEditGesture(target.projectId)
      const start = performance.now(); publish.current(next, value.gesture)
      logger.debug('遮罩显示帧更新', { event: 'video_edit.mask.frame.completed', context: { durationMs: performance.now() - start, revision: instance.document.revision } })
    } catch (error) { if (transform.current) finishTransform(false); else endDrag(false); onError(error) }
  }
  const finishTransform = (commit: boolean): void => {
    if (commit) flush(); else discardPending()
    drag.current = undefined
    const value = transform.current; transform.current = undefined; setTransforming(false)
    if (value) { try { finishVideoEditGesture(value.gesture, commit) } catch (error) { finishVideoEditGesture(value.gesture, false); onError(error) } }
  }
  function endDrag(commit: boolean): void {
    if (commit) flush(); else discardPending()
    const value = drag.current; drag.current = undefined
    if (!value) return
    if (commit && !value.moved && value.alt && value.kind === 'symmetric') atomic(toggleVideoEditMaskPoint(value.original, value.index))
    if (value.gesture && !value.transform) {
      try { finishVideoEditGesture(value.gesture, commit) } catch (error) { finishVideoEditGesture(value.gesture, false); onError(error) }
    }
  }
  const beginDrag = (event: ReactPointerEvent<SVGElement>, kind: Drag['kind'], shape: VideoEditMaskShape, index: number): void => {
    if (event.button !== 0 || penActive) return
    event.stopPropagation(); event.preventDefault(); svg.current?.focus()
    if (transform.current && transform.current.shapeId !== shape.id) finishTransform(true)
    select(shape, kind === 'vertex' || kind === 'symmetric' || kind === 'in' || kind === 'out' ? index : undefined)
    if (!transform.current && event.ctrlKey && kind === 'vertex') {
      try { atomic(removeVideoEditMaskPoint(shape, index)); select(shape) } catch (error) { onError(error) }
      return
    }
    drag.current = { pointerId: event.pointerId, kind: kind === 'vertex' && event.altKey ? 'symmetric' : kind, index, start: pointerClip(event), original: shape, gesture: transform.current?.gesture, moved: false, alt: event.altKey, transform: Boolean(transform.current) }
    svg.current?.setPointerCapture?.(event.pointerId)
  }
  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>, immediate = false): void => {
    const value = drag.current
    if (!value || value.pointerId !== event.pointerId) return
    const point = pointerClip(event); const du = point.u - value.start.u; const dv = point.v - value.start.v
    const [sx, sy] = toFrame(value.start.u, value.start.v); const [px, py] = toFrame(point.u, point.v)
    if (!value.moved && Math.hypot(px - sx, py - sy) < radius / 2) return
    value.moved = true
    let next: VideoEditMaskShape
    if (value.kind === 'scale' || value.kind === 'rotate') {
      const [x, y, w, h] = videoEditMaskShapeBounds(value.original)
      if (value.kind === 'rotate') {
        const cx = x + w / 2; const cy = y + h / 2; const aspect = picture.width / picture.height
        const angle = Math.atan2(point.v - cy, (point.u - cx) * aspect) - Math.atan2(value.start.v - cy, (value.start.u - cx) * aspect)
        const c = Math.cos(angle); const s = Math.sin(angle)
        next = affineVideoEditMaskShape(value.original, [c, s * aspect, -s / aspect, c, cx - c * cx + s / aspect * cy, cy - s * aspect * cx - c * cy])
      } else {
        const [hx, hy] = BOX_HANDLES[value.index]; const ax = x + (1 - hx) * w; const ay = y + (1 - hy) * h
        let a = hx === 0.5 ? 1 : 1 + du / ((2 * hx - 1) * w); let d = hy === 0.5 ? 1 : 1 + dv / ((2 * hy - 1) * h)
        if (event.shiftKey) { const ratio = hx === 0.5 ? d : hy === 0.5 ? a : Math.abs(a - 1) > Math.abs(d - 1) ? a : d; a = ratio; d = ratio }
        next = affineVideoEditMaskShape(value.original, [a, 0, 0, d, ax * (1 - a), ay * (1 - d)])
      }
    } else next = editVideoEditMaskShape(value.original, value.kind, value.index, du, dv, point, event.altKey)
    pending.current = next
    if (immediate) flush()
    else if (raf.current === undefined) raf.current = ownerWindowOf(svg.current!).requestAnimationFrame(flush)
  }
  const closePen = (points: VideoEditMaskPoint[]): void => {
    if (points.length < 3) return
    const shape: VideoEditMaskShape = { id: crypto.randomUUID(), kind: 'path', points }
    try { commitShapes([...shapes, shape]); setVideoEditMaskEditing({ ...target, shapeId: shape.id, pointIndex: undefined, pen: false }); setPen(null) } catch (error) { onError(error) }
  }
  const pathOf = (points: readonly VideoEditMaskPoint[], closed: boolean): string => {
    if (!points.length) return ''
    const [x0, y0] = toFrame(points[0][0], points[0][1]); let d = `M${x0} ${y0}`
    for (let index = 0; index < (closed ? points.length : points.length - 1); index++) {
      const a = points[index]; const b = points[(index + 1) % points.length]
      const [c1x, c1y] = toFrame(a[0] + a[4], a[1] + a[5]); const [c2x, c2y] = toFrame(b[0] + b[2], b[1] + b[3]); const [ex, ey] = toFrame(b[0], b[1])
      d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`
    }
    return closed ? `${d} Z` : d
  }
  const modifierCursor = modifiers.alt ? 'cursor-crosshair' : modifiers.ctrl ? 'cursor-not-allowed' : modifiers.shift ? 'cursor-copy' : 'cursor-move'
  const box = selected && transforming ? videoEditMaskShapeBounds(selected) : undefined
  return <svg ref={svg} tabIndex={0} role="application" aria-label="遮罩路径编辑" className={`absolute inset-0 h-full w-full outline-none ${penActive ? 'cursor-crosshair' : modifierCursor}`} viewBox={`0 0 ${frame.width} ${frame.height}`} preserveAspectRatio="none"
    data-video-edit-mask-overlay={penActive ? 'pen' : 'edit'}
    onKeyDown={event => {
      setModifiers({ alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey })
      if (event.nativeEvent.isComposing) return
      const consume = (): void => { event.preventDefault(); event.stopPropagation() }
      if (matchVideoEditShortcut({ ...event, isComposing: false }, 'mask', shortcuts) === 'mask_transform' && selected && !penActive) {
        consume()
        if (!transform.current) { try { transform.current = { gesture: beginVideoEditGesture(target.projectId), shapeId: selected.id }; setTransforming(true) } catch (error) { onError(error) } }
      } else if (event.key === 'Escape') {
        consume()
        if (transform.current) finishTransform(false)
        else if (drag.current) endDrag(false)
        else if (penActive) { setPen(null); setVideoEditMaskEditing({ ...target, pen: false }) }
        else setVideoEditMaskEditing({ ...target, pointIndex: undefined })
      } else if (event.key === 'Enter' && (transform.current || penActive)) {
        consume(); if (transform.current) finishTransform(true); else if (pen) closePen(pen.points)
      } else if (selected && target.pointIndex !== undefined && selected.points[target.pointIndex] && !penActive && !transform.current && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const at = target.pointIndex
        if (event.key === 'Delete' || event.key === 'Backspace') {
          consume(); try { atomic(removeVideoEditMaskPoint(selected, at)); select(selected) } catch (error) { onError(error) }
        } else if (event.key.startsWith('Arrow')) {
          consume(); const step = event.shiftKey ? 10 : 1
          const [vx, vy] = toFrame(selected.points[at][0], selected.points[at][1])
          const next = videoEditFrameToClip(clip, picture, frame, (vx + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)) / frame.width, (vy + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)) / frame.height)
          atomic(editVideoEditMaskShape(selected, 'vertex', at, next.u - selected.points[at][0], next.v - selected.points[at][1], next))
        }
      }
    }}
    onKeyUp={event => setModifiers({ alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey })}
    onPointerEnter={event => { hovering.current = true; setModifiers({ alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey }) }}
    onPointerLeave={() => { hovering.current = false }}
    onBlur={() => setModifiers({ alt: false, ctrl: false, shift: false })}
    onPointerMove={event => {
      setModifiers(current => current.alt === event.altKey && current.ctrl === event.ctrlKey && current.shift === event.shiftKey ? current : { alt: event.altKey, ctrl: event.ctrlKey, shift: event.shiftKey })
      moveDrag(event)
      if (pen?.dragging) {
        const point = pointerClip(event)
        setPen(current => { if (!current) return current; const last = current.points[current.points.length - 1]; const dx = point.u - last[0]; const dy = point.v - last[1]; return { ...current, points: [...current.points.slice(0, -1), [last[0], last[1], -dx, -dy, dx, dy]] } })
      }
    }}
    onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) { moveDrag(event, true); endDrag(true) } if (pen?.dragging) setPen(current => current && { ...current, dragging: false }) }}
    onPointerCancel={() => { if (transform.current) finishTransform(false); else endDrag(false); setPen(current => current && { ...current, dragging: false }) }}
    onLostPointerCapture={() => { if (drag.current) endDrag(true) }}
    onPointerDown={event => {
      if (event.button !== 0) return
      svg.current?.focus(); event.stopPropagation()
      if (!penActive) {
        if (transform.current && selected && box) {
          const point = pointerClip(event)
          if (point.u >= box[0] && point.u <= box[0]+box[2] && point.v >= box[1] && point.v <= box[1]+box[3]) { beginDrag(event,'move',selected,0); return }
          finishTransform(true)
        }
        setVideoEditMaskEditing({ ...target, pointIndex: undefined }); return
      }
      event.preventDefault(); svg.current?.setPointerCapture?.(event.pointerId)
      const point = pointerClip(event); const points = pen?.points ?? []
      if (points.length >= 3) { const [fx, fy] = toFrame(points[0][0], points[0][1]); const [px, py] = toFrame(point.u, point.v); if (Math.hypot(px - fx, py - fy) <= radius * 2) { closePen(points); return } }
      setPen({ points: [...points, [point.u, point.v, 0, 0, 0, 0]], dragging: true })
    }}>
    {shapes.map(shape => <path key={shape.id} d={pathOf(shape.points, true)} data-video-edit-mask-shape={shape.id} data-selected={shape.id === target.shapeId}
      className={shape.id === target.shapeId ? 'fill-accent/10 stroke-accent' : 'fill-transparent stroke-on-media'} strokeWidth={shape.id === target.shapeId ? stroke : stroke / 2} vectorEffect="non-scaling-stroke"
      style={{ pointerEvents: penActive ? 'none' : 'all' }}
      onPointerDown={event => {
        if (event.button !== 0 || penActive) return
        if (event.shiftKey && !transform.current) {
          event.stopPropagation(); event.preventDefault(); svg.current?.focus()
          const point = pointerClip(event); const near = nearestVideoEditMaskSegment(shape, point, picture.width, picture.height)
          const [a, b] = toFrame(point.u, point.v); const [c, d] = toFrame(point.u + near.distance / picture.width, point.v)
          if (Math.hypot(c - a, d - b) <= radius * 2) { const next = insertVideoEditMaskPoint(shape, near.index, near.t); atomic(next); select(next, near.index + 1) }
          else select(shape)
        } else beginDrag(event, 'move', shape, 0)
      }} />)}
    {!penActive && selected && !transforming && selected.points.map((point, index) => {
      const [vx, vy] = toFrame(point[0], point[1]); const chosen = target.pointIndex === index; const r = radius * (chosen ? 1.3 : 1)
      const [ix, iy] = toFrame(point[0] + point[2], point[1] + point[3]); const [ox, oy] = toFrame(point[0] + point[4], point[1] + point[5])
      return <g key={index}>
        {chosen && point.slice(2).some(Boolean) && <>
          <line x1={ix} y1={iy} x2={ox} y2={oy} className="stroke-accent" strokeWidth={stroke} vectorEffect="non-scaling-stroke" />
          <circle cx={ix} cy={iy} r={radius * 0.8} className="fill-accent" data-video-edit-mask-handle={`in-${index}`} onPointerDown={event => beginDrag(event, 'in', selected, index)} />
          <circle cx={ox} cy={oy} r={radius * 0.8} className="fill-accent" data-video-edit-mask-handle={`out-${index}`} onPointerDown={event => beginDrag(event, 'out', selected, index)} />
        </>}
        <rect x={vx - r} y={vy - r} width={r * 2} height={r * 2} className={chosen ? 'fill-accent stroke-on-media' : 'fill-none stroke-accent'} strokeWidth={stroke} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'all' }}
          data-video-edit-mask-handle={`vertex-${index}`} data-selected={chosen} onPointerDown={event => beginDrag(event, 'vertex', selected, index)} />
      </g>
    })}
    {box && selected && <g data-video-edit-mask-transform>
      <path d={pathOf([[box[0], box[1], 0, 0, 0, 0], [box[0] + box[2], box[1], 0, 0, 0, 0], [box[0] + box[2], box[1] + box[3], 0, 0, 0, 0], [box[0], box[1] + box[3], 0, 0, 0, 0]], true)} className="fill-none stroke-accent" strokeWidth={stroke} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'none' }} />
      {BOX_HANDLES.map(([u, v], index) => { const [x, y] = toFrame(box[0] + u * box[2], box[1] + v * box[3]); return <rect key={index} x={x - radius} y={y - radius} width={radius * 2} height={radius * 2} className="cursor-crosshair fill-on-media stroke-accent" strokeWidth={stroke} vectorEffect="non-scaling-stroke" data-video-edit-mask-transform-handle={index} onPointerDown={event => beginDrag(event, 'scale', selected, index)} /> })}
      {(() => { const [x, y] = toFrame(box[0] + box[2] / 2, box[1] - box[3] / 4); return <circle cx={x} cy={y} r={radius} className="cursor-crosshair fill-accent" data-video-edit-mask-transform-handle="rotate" onPointerDown={event => beginDrag(event, 'rotate', selected, 0)} /> })()}
    </g>}
    {pen && <>
      <path d={pathOf(pen.points, false)} className="fill-none stroke-accent" strokeWidth={stroke} vectorEffect="non-scaling-stroke" />
      {pen.points.map((point, index) => { const [x, y] = toFrame(point[0], point[1]); return <rect key={index} x={x - radius} y={y - radius} width={radius * 2} height={radius * 2} className={index === 0 && pen.points.length >= 3 ? 'fill-accent stroke-on-media' : 'fill-on-media stroke-accent'} strokeWidth={stroke} vectorEffect="non-scaling-stroke" /> })}
    </>}
  </svg>
}
