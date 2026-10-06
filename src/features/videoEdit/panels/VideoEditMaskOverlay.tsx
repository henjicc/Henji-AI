import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import { videoEditClipPictureSize, videoEditClipToFrame, videoEditFrameToClip, type VideoEditSize } from '@/core/videoEdit/clipGeometry'
import { editVideoEditMaskShape, isShapesMask, videoEditMaskShapePoints, type VideoEditMaskDragKind, type VideoEditMaskPoint, type VideoEditMaskShape } from '@/core/videoEdit/effectMasks'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { beginVideoEditGesture, finishVideoEditGesture, getActiveVideoEditSequence, subscribeVideoEditDomain, videoEditDomainRevision, type VideoEditGesture, type VideoEditInstance } from '../application/videoEditService'
import { updateVideoEditBuiltinEffect } from '../application/videoEditCompositing'
import { getVideoEditMaskEditing, setVideoEditMaskEditing, subscribeVideoEditMaskEditing, videoEditMaskEditingRevision } from '../application/videoEditMaskEditing'

/*
 * 节目监视器上的遮罩编辑叠层（任务 4.10，PR 效果遮罩的路径编辑）：
 * - 显示正在编辑的效果的全部遮罩路径，选中的遮罩带控制柄；
 * - 矩形、椭圆：拖四个角改大小，拖内部移动；钢笔路径：拖顶点、拖控制柄，双击顶点切换尖角 / 平滑，拖内部移动；
 * - 钢笔：点一下加尖角顶点，按住拖出控制柄，点回第一个顶点或按 Enter 闭合，Esc 取消。
 * 坐标存成片段画面的归一化坐标，这里按片段几何（与合成器同一套）换算到序列画面；每次拖动是一步撤销。
 */

interface Drag {
  pointerId: number
  kind: VideoEditMaskDragKind
  shapeId: string
  index: number
  start: { u: number; v: number }
  original: VideoEditMaskShape
  gesture: VideoEditGesture
}

const HANDLE = 5

export function VideoEditMaskOverlay({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditMaskEditing, videoEditMaskEditingRevision)
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  const target = getVideoEditMaskEditing()
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag>()
  const [dragging, setDragging] = useState(false)
  const [pen, setPen] = useState<{ points: VideoEditMaskPoint[]; dragging: boolean } | null>(null)
  const sequence = getActiveVideoEditSequence(instance)
  const clip = target && target.projectId === instance.document.id && target.sequenceId === instance.activeSequenceId ? sequence.clips.find(entry => entry.id === target.clipId) : undefined
  const effect = clip?.effects?.find(entry => entry.id === target?.effectId)
  const visible = Boolean(target && clip && effect?.builtin && instance.frame >= clip.start && instance.frame < clip.start + clip.duration)
  const shapes = effect && isShapesMask(effect.mask) ? effect.mask.shapes : []
  const penActive = Boolean(visible && target?.pen)

  useEffect(() => { if (!penActive) setPen(null) }, [penActive])
  useEffect(() => () => { const value = drag.current; drag.current = undefined; if (value) finishVideoEditGesture(value.gesture, false) }, [])
  // 钢笔：Enter 闭合，Esc 取消（只在画面所在窗口监听，可能是系统浮窗）。
  useEffect(() => {
    if (!penActive || !svg.current) return
    const owner = ownerWindowOf(svg.current)
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); setPen(null); if (target) setVideoEditMaskEditing({ ...target, pen: false }) }
      else if (event.key === 'Enter' && pen && pen.points.length >= 3) { event.preventDefault(); closePen(pen.points) }
    }
    owner.addEventListener('keydown', key)
    return () => owner.removeEventListener('keydown', key)
  })

  if (!visible || !target || !clip || !effect) return null
  const frame: VideoEditSize = { width: sequence.width, height: sequence.height }
  const picture = videoEditClipPictureSize(sequence, clip)
  const toFrame = (u: number, v: number): [number, number] => { const point = videoEditClipToFrame(clip, picture, frame, u, v); return [point.x * frame.width, point.y * frame.height] }
  const pointerClip = (event: { clientX: number; clientY: number }): { u: number; v: number } => {
    const rect = svg.current!.getBoundingClientRect()
    return videoEditFrameToClip(clip, picture, frame, (event.clientX - rect.left) / Math.max(1, rect.width), (event.clientY - rect.top) / Math.max(1, rect.height))
  }
  const handleRadius = (): number => { const rect = svg.current?.getBoundingClientRect(); return HANDLE * frame.width / Math.max(1, rect?.width ?? frame.width) }
  const commitShapes = (next: VideoEditMaskShape[], gesture?: VideoEditGesture): void => {
    updateVideoEditBuiltinEffect(target, effect.id, { mask: next.length ? { regionId: 'shapes', shapes: next } : null }, gesture)
  }
  function closePen(points: VideoEditMaskPoint[]): void {
    if (!target || !effect || points.length < 3) return
    const shape: VideoEditMaskShape = { id: crypto.randomUUID(), kind: 'path', points }
    try { commitShapes([...shapes, shape]); setVideoEditMaskEditing({ ...target, shapeId: shape.id, pen: false }) } catch (error) { onError(error) }
    setPen(null)
  }

  const beginDrag = (event: ReactPointerEvent<SVGElement>, kind: Drag['kind'], shape: VideoEditMaskShape, index: number): void => {
    if (event.button !== 0) return
    event.stopPropagation(); event.preventDefault()
    if (target.shapeId !== shape.id) setVideoEditMaskEditing({ ...target, shapeId: shape.id })
    try {
      const gesture = beginVideoEditGesture(target.projectId)
      drag.current = { pointerId: event.pointerId, kind, shapeId: shape.id, index, start: pointerClip(event), original: shape, gesture }
      setDragging(true); svg.current?.setPointerCapture(event.pointerId)
    } catch (error) { onError(error) }
  }
  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>): void => {
    const value = drag.current
    if (!value || value.pointerId !== event.pointerId) return
    const point = pointerClip(event); const du = point.u - value.start.u; const dv = point.v - value.start.v
    const next = editVideoEditMaskShape(value.original, value.kind, value.index, du, dv, point)
    try { commitShapes(shapes.map(entry => entry.id === value.shapeId ? next : entry), value.gesture) } catch (error) { endDrag(false); onError(error) }
  }
  function endDrag(commit: boolean): void {
    const value = drag.current; drag.current = undefined; setDragging(false)
    if (!value) return
    try { finishVideoEditGesture(value.gesture, commit) } catch (error) { finishVideoEditGesture(value.gesture, false); onError(error) }
  }

  const pathOf = (points: readonly VideoEditMaskPoint[], closed: boolean): string => {
    if (!points.length) return ''
    const [x0, y0] = toFrame(points[0][0], points[0][1])
    let d = `M${x0} ${y0}`
    const count = closed ? points.length : points.length - 1
    for (let index = 0; index < count; index++) {
      const a = points[index]; const b = points[(index + 1) % points.length]
      const [c1x, c1y] = toFrame(a[0] + a[4], a[1] + a[5]); const [c2x, c2y] = toFrame(b[0] + b[2], b[1] + b[3]); const [ex, ey] = toFrame(b[0], b[1])
      d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`
    }
    return closed ? `${d} Z` : d
  }
  const radius = handleRadius()
  const selected = shapes.find(shape => shape.id === target.shapeId)
  const stroke = Math.max(1, radius / 3)

  return <svg ref={svg} className={`absolute inset-0 h-full w-full ${penActive ? 'cursor-crosshair' : ''}`} viewBox={`0 0 ${frame.width} ${frame.height}`} preserveAspectRatio="none"
    style={{ pointerEvents: penActive || dragging ? 'auto' : 'none' }} data-video-edit-mask-overlay={penActive ? 'pen' : 'edit'}
    onPointerMove={event => {
      moveDrag(event)
      if (pen?.dragging) {
        const point = pointerClip(event)
        setPen(current => {
          if (!current) return current
          const last = current.points[current.points.length - 1]
          const dx = point.u - last[0]; const dy = point.v - last[1]
          return { ...current, points: [...current.points.slice(0, -1), [last[0], last[1], -dx, -dy, dx, dy]] }
        })
      }
    }}
    onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) endDrag(true); if (pen?.dragging) setPen(current => current && { ...current, dragging: false }) }}
    onPointerCancel={() => { endDrag(false); setPen(current => current && { ...current, dragging: false }) }}
    onLostPointerCapture={() => { if (drag.current) endDrag(true) }}
    onPointerDown={event => {
      if (!penActive || event.button !== 0) return
      event.preventDefault(); svg.current?.setPointerCapture(event.pointerId)
      const point = pointerClip(event)
      const points = pen?.points ?? []
      // 点回第一个顶点：闭合
      if (points.length >= 3) {
        const [fx, fy] = toFrame(points[0][0], points[0][1]); const rect = svg.current!.getBoundingClientRect()
        const px = (event.clientX - rect.left) / rect.width * frame.width; const py = (event.clientY - rect.top) / rect.height * frame.height
        if (Math.hypot(px - fx, py - fy) <= radius * 2) { closePen(points); return }
      }
      setPen({ points: [...points, [point.u, point.v, 0, 0, 0, 0]], dragging: true })
    }}>
    {shapes.map(shape => {
      const active = shape.id === target.shapeId
      return <path key={shape.id} d={pathOf(videoEditMaskShapePoints(shape), true)} data-video-edit-mask-shape={shape.id}
        className={`${active ? 'fill-accent/10 stroke-accent' : 'fill-transparent stroke-on-media'} ${penActive ? '' : 'cursor-move'}`} strokeWidth={stroke} vectorEffect="non-scaling-stroke"
        style={{ pointerEvents: penActive ? 'none' : 'all' }}
        onPointerDown={event => beginDrag(event, 'move', shape, 0)} />
    })}
    {!penActive && selected && <Handles shape={selected} toFrame={toFrame} radius={radius} onDown={(event, kind, index) => beginDrag(event, kind, selected, index)}
      onToggle={index => {
        if (selected.kind !== 'path') return
        const points = selected.points!.map((point, at): VideoEditMaskPoint => {
          if (at !== index) return point
          if (point[2] || point[3] || point[4] || point[5]) return [point[0], point[1], 0, 0, 0, 0]
          const before = selected.points![(at - 1 + selected.points!.length) % selected.points!.length]; const after = selected.points![(at + 1) % selected.points!.length]
          const dx = (after[0] - before[0]) / 6; const dy = (after[1] - before[1]) / 6
          return [point[0], point[1], -dx, -dy, dx, dy]
        })
        try { commitShapes(shapes.map(entry => entry.id === selected.id ? { ...entry, points } : entry)) } catch (error) { onError(error) }
      }} />}
    {pen && pen.points.length > 0 && <>
      <path d={pathOf(pen.points, false)} className="fill-none stroke-accent" strokeWidth={stroke} vectorEffect="non-scaling-stroke" />
      {pen.points.map((point, index) => { const [x, y] = toFrame(point[0], point[1]); return <rect key={index} x={x - radius} y={y - radius} width={radius * 2} height={radius * 2} className={index === 0 && pen.points.length >= 3 ? 'fill-accent stroke-on-media' : 'fill-on-media stroke-accent'} strokeWidth={stroke} vectorEffect="non-scaling-stroke" /> })}
    </>}
  </svg>
}

function Handles({ shape, toFrame, radius, onDown, onToggle }: { shape: VideoEditMaskShape; toFrame: (u: number, v: number) => [number, number]; radius: number; onDown: (event: ReactPointerEvent<SVGElement>, kind: Drag['kind'], index: number) => void; onToggle: (index: number) => void }): React.ReactElement {
  const stroke = Math.max(1, radius / 3)
  if (shape.kind !== 'path') {
    const [x, y, width, height] = shape.box!
    const corners: Array<[number, number]> = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
    return <>{corners.map(([u, v], index) => { const [cx, cy] = toFrame(u, v); return <rect key={index} x={cx - radius} y={cy - radius} width={radius * 2} height={radius * 2} className="cursor-pointer fill-on-media stroke-accent" strokeWidth={stroke} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'all' }} data-video-edit-mask-handle={`corner-${index}`} onPointerDown={event => onDown(event, 'corner', index)} /> })}</>
  }
  return <>{shape.points!.map((point, index) => {
    const [vx, vy] = toFrame(point[0], point[1])
    const smooth = Boolean(point[2] || point[3] || point[4] || point[5])
    const [ix, iy] = toFrame(point[0] + point[2], point[1] + point[3]); const [ox, oy] = toFrame(point[0] + point[4], point[1] + point[5])
    return <g key={index}>
      {smooth && <>
        <line x1={ix} y1={iy} x2={ox} y2={oy} className="stroke-accent" strokeWidth={stroke} vectorEffect="non-scaling-stroke" />
        <circle cx={ix} cy={iy} r={radius * 0.8} className="cursor-pointer fill-accent" style={{ pointerEvents: 'all' }} data-video-edit-mask-handle={`in-${index}`} onPointerDown={event => onDown(event, 'in', index)} />
        <circle cx={ox} cy={oy} r={radius * 0.8} className="cursor-pointer fill-accent" style={{ pointerEvents: 'all' }} data-video-edit-mask-handle={`out-${index}`} onPointerDown={event => onDown(event, 'out', index)} />
      </>}
      <rect x={vx - radius} y={vy - radius} width={radius * 2} height={radius * 2} className="cursor-pointer fill-on-media stroke-accent" strokeWidth={stroke} vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'all' }}
        data-video-edit-mask-handle={`vertex-${index}`} onPointerDown={event => onDown(event, 'vertex', index)} onDoubleClick={() => onToggle(index)} />
    </g>
  })}</>
}
