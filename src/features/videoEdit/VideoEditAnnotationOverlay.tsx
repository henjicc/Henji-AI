import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUp, X } from 'lucide-react'
import { UiButton, UiIconButton, UiInput } from '@/components/ui'
import { VIDEO_EDIT_ANNOTATION_COLORS } from '@/core/theme/colorTokens'
import { VIDEO_EDIT_ANNOTATION_STATUS_LABELS, videoEditAnnotationAt, videoEditAnnotationColor, videoEditAnnotationStyle, videoEditAnnotationWeight, type VideoEditAnnotation, type VideoEditAnnotationColor, type VideoEditAnnotationTarget, type VideoEditAnnotationWeight } from '@/core/videoEdit/annotations'
import { createVideoEditAnnotation, deleteVideoEditAnnotation, jumpToVideoEditAnnotation, selectedVideoEditAnnotation, selectVideoEditAnnotation, subscribeVideoEditAnnotationBrush, subscribeVideoEditAnnotationSelection, updateVideoEditAnnotation, videoEditAnnotationSelectionRevision, videoEditAnnotationBrush, videoEditAnnotationBrushRevision, type VideoEditAnnotationShape } from './application/videoEditAnnotations'
import { getActiveVideoEditSequence, setVideoEditView, videoEditProgramCommandIdentity, type VideoEditInstance } from './application/videoEditService'
import { codeElementAnnotationTarget, resolveVideoEditElementAnnotation, selectVideoEditCodeElement } from './application/videoEditCodeElements'

type Point = { x: number; y: number }
type Size = { width: number; height: number }
interface Capture { document: VideoEditInstance['document']; sequenceId: string; clipId: string | null; frame: number; command: object; selection: string[]; elementTarget?: VideoEditAnnotationTarget }
/** 松手后等待输入的一笔：新建（capture）或改已有标注的文字（editingId）。 */
interface Draft { capture: Capture; target: VideoEditAnnotationTarget; color: VideoEditAnnotationColor; weight: VideoEditAnnotationWeight; anchor: DOMRect; editingId?: string }
type Handle = 'move' | 'from' | 'to' | 'nw' | 'ne' | 'sw' | 'se'
type Drag =
  | { kind: 'draw'; shape: VideoEditAnnotationShape; capture: Capture; points: Point[] }
  | { kind: 'edit'; id: string; handle: Handle; start: Point; original: VideoEditAnnotationTarget; target: VideoEditAnnotationTarget }
/** 编号与文字压在浅色上时用深色描边，其余用白色。 */
const contrastOf = (color: VideoEditAnnotationColor): string => ['white', 'yellow'].includes(color) ? VIDEO_EDIT_ANNOTATION_COLORS.black : VIDEO_EDIT_ANNOTATION_COLORS.white
const clamp = (value: number): number => Math.max(0, Math.min(1, value))
/** 线宽（屏幕像素）：细 / 中 / 粗。 */
const STROKE: Record<VideoEditAnnotationWeight, number> = { thin: 2, regular: 3, bold: 5 }
const HIT = 14

/** Shift：箭头按 45° 吸附，圈与框画成正圆、正方形（按屏幕像素算）。 */
function constrain(shape: VideoEditAnnotationShape, start: Point, end: Point, size: Size, shift: boolean): Point {
  if (!shift) return end
  const dx = (end.x - start.x) * size.width; const dy = (end.y - start.y) * size.height
  if (shape === 'arrow') {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4); const length = Math.hypot(dx, dy)
    return { x: clamp(start.x + Math.cos(angle) * length / size.width), y: clamp(start.y + Math.sin(angle) * length / size.height) }
  }
  if (shape === 'ellipse' || shape === 'region') {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    return { x: clamp(start.x + Math.sign(dx || 1) * side / size.width), y: clamp(start.y + Math.sign(dy || 1) * side / size.height) }
  }
  return end
}
const boxOf = (a: Point, b: Point) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) })
function nextMarkerNumber(marks: readonly VideoEditAnnotation[]): number { return marks.reduce((max, mark) => mark.target.kind === 'marker' ? Math.max(max, mark.target.number) : max, 0) + 1 }

/** 拖已有标注：整体移动（不出画幅），框和圈拖角改大小，箭头拖两端。 */
function editedTarget(original: VideoEditAnnotationTarget, handle: Handle, delta: Point): VideoEditAnnotationTarget {
  const move = (point: Point): Point => ({ x: clamp(point.x + delta.x), y: clamp(point.y + delta.y) })
  if (original.kind === 'arrow') return handle === 'from' ? { ...original, from: move(original.from) } : handle === 'to' ? { ...original, to: move(original.to) } : { ...original, from: move(original.from), to: move(original.to) }
  if (original.kind === 'region' || original.kind === 'ellipse') {
    if (handle === 'move') return { ...original, x: Math.max(0, Math.min(1 - original.width, original.x + delta.x)), y: Math.max(0, Math.min(1 - original.height, original.y + delta.y)) }
    const left = handle === 'nw' || handle === 'sw'; const top = handle === 'nw' || handle === 'ne'
    const fixed = { x: left ? original.x + original.width : original.x, y: top ? original.y + original.height : original.y }
    const moving = move({ x: left ? original.x : original.x + original.width, y: top ? original.y : original.y + original.height })
    return { ...original, ...boxOf(fixed, moving) }
  }
  if (original.kind === 'stroke') {
    const points = original.strokes.flat(); const dx = Math.max(-Math.min(...points.map(p => p.x)), Math.min(1 - Math.max(...points.map(p => p.x)), delta.x)); const dy = Math.max(-Math.min(...points.map(p => p.y)), Math.min(1 - Math.max(...points.map(p => p.y)), delta.y))
    return { ...original, strokes: original.strokes.map(stroke => stroke.map(p => ({ x: p.x + dx, y: p.y + dy }))) }
  }
  if (original.kind === 'point' || original.kind === 'text' || original.kind === 'marker') return { ...original, ...move(original) }
  return original
}

function Arrow({ from, to, color, size, stroke }: { from: Point; to: Point; color: string; size: Size; stroke: number }): React.ReactElement {
  const a = { x: from.x * size.width, y: from.y * size.height }; const b = { x: to.x * size.width, y: to.y * size.height }
  const angle = Math.atan2(b.y - a.y, b.x - a.x); const head = Math.min(18, Math.hypot(b.x - a.x, b.y - a.y) * .6); const base = { x: b.x - Math.cos(angle) * head * .8, y: b.y - Math.sin(angle) * head * .8 }
  const wing = (side: number) => `${b.x - Math.cos(angle) * head + Math.cos(angle + side * Math.PI / 2) * head * .5},${b.y - Math.sin(angle) * head + Math.sin(angle + side * Math.PI / 2) * head * .5}`
  return <><line x1={a.x} y1={a.y} x2={base.x} y2={base.y} stroke={color} strokeWidth={stroke + 1} strokeLinecap="round" /><polygon points={`${b.x},${b.y} ${wing(1)} ${wing(-1)}`} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" /></>
}

/** 一条标注的图形（像素坐标）；hit 时画一层透明粗线供点选。 */
function TargetShape({ target, text, color, weight = 'regular', size, hit }: { target: VideoEditAnnotationTarget; text?: string; color: VideoEditAnnotationColor; weight?: VideoEditAnnotationWeight; size: Size; hit?: boolean }): React.ReactElement | null {
  const fill = VIDEO_EDIT_ANNOTATION_COLORS[color]; const contrast = contrastOf(color)
  const X = (value: number): number => value * size.width; const Y = (value: number): number => value * size.height
  const line = hit ? { stroke: 'transparent', strokeWidth: HIT, fill: 'none' } : { stroke: fill, strokeWidth: STROKE[weight], fill: 'none' }
  if (target.kind === 'arrow') return hit ? <line x1={X(target.from.x)} y1={Y(target.from.y)} x2={X(target.to.x)} y2={Y(target.to.y)} {...line} /> : <Arrow from={target.from} to={target.to} color={fill} size={size} stroke={STROKE[weight]} />
  const region = target.kind === 'region' ? target : target.kind === 'element' ? target.region : undefined
  if (region) return <rect x={X(region.x)} y={Y(region.y)} width={X(region.width)} height={Y(region.height)} rx={4} {...line} {...(hit ? { fill: 'transparent' } : {})} />
  if (target.kind === 'ellipse') return <ellipse cx={X(target.x + target.width / 2)} cy={Y(target.y + target.height / 2)} rx={X(target.width / 2)} ry={Y(target.height / 2)} {...line} {...(hit ? { fill: 'transparent' } : {})} />
  if (target.kind === 'stroke') return <>{target.strokes.map((points, index) => <polyline key={index} points={points.map(point => `${X(point.x)},${Y(point.y)}`).join(' ')} strokeLinecap="round" strokeLinejoin="round" {...line} />)}</>
  if (target.kind === 'point') return hit ? <circle cx={X(target.x)} cy={Y(target.y)} r={HIT} fill="transparent" /> : <><circle cx={X(target.x)} cy={Y(target.y)} r={9} fill={fill} stroke={contrast} strokeWidth={2} /><circle cx={X(target.x)} cy={Y(target.y)} r={3} fill={contrast} /></>
  if (target.kind === 'marker') return hit ? <circle cx={X(target.x)} cy={Y(target.y)} r={HIT + 2} fill="transparent" /> : <><circle cx={X(target.x)} cy={Y(target.y)} r={14} fill={fill} /><text x={X(target.x)} y={Y(target.y)} dy=".35em" textAnchor="middle" fontSize={15} fontWeight={700} fill={contrast}>{target.number}</text></>
  if (target.kind === 'text') {
    const label = text || ' '
    return hit ? <rect x={X(target.x) - 4} y={Y(target.y) - 4} width={label.length * 20 + 8} height={30} fill="transparent" /> : <text x={X(target.x)} y={Y(target.y)} dy="1em" fontSize={20} fontWeight={700} fill={fill} stroke={contrast} strokeWidth={3} paintOrder="stroke" strokeLinejoin="round">{label}</text>
  }
  return null
}
function handlesOf(target: VideoEditAnnotationTarget): Array<{ handle: Handle; at: Point }> {
  if (target.kind === 'arrow') return [{ handle: 'from', at: target.from }, { handle: 'to', at: target.to }]
  if (target.kind === 'region' || target.kind === 'ellipse') return [{ handle: 'nw', at: { x: target.x, y: target.y } }, { handle: 'ne', at: { x: target.x + target.width, y: target.y } }, { handle: 'sw', at: { x: target.x, y: target.y + target.height } }, { handle: 'se', at: { x: target.x + target.width, y: target.y + target.height } }]
  return []
}
function labelPosition(target: VideoEditAnnotationTarget): Point {
  if (target.kind === 'point' || target.kind === 'region') return target
  // 圈的外接框左上角落在圈外很远，徽标放在圈顶部正中。
  if (target.kind === 'ellipse') return { x: target.x + target.width / 2, y: target.y }
  if (target.kind === 'arrow') return target.from
  if (target.kind === 'stroke') return target.strokes[0][0]
  if (target.kind === 'element' && target.region) return target.region
  if (target.kind === 'text' || target.kind === 'marker') return { x: target.x, y: Math.max(0, target.y - 0.06) }
  return { x: 0.02, y: 0.05 }
}

/**
 * 节目画面上的批注层（像截图标注）：批注工具下拖拽画箭头、圈、框、画笔，单击放文字、编号、评论钉；Shift 约束；
 * 松手在旁边弹出一个输入气泡问“这里要改什么？”，回车加入待发送、Esc 放弃。点已有标注可选中、拖动、拖角改大小，双击改文字，Delete 删除。
 * 形状与颜色在命令带的批注参数条里选（重要记录 019）；选中一条时在参数条换颜色也改它。状态看编号徽标，形状只用所选颜色。
 */
export function VideoEditAnnotationOverlay({ instance, active, onError }: { instance: VideoEditInstance; active: boolean; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditAnnotationBrush, videoEditAnnotationBrushRevision)
  useSyncExternalStore(subscribeVideoEditAnnotationSelection, videoEditAnnotationSelectionRevision)
  const brush = videoEditAnnotationBrush(instance.document.id)
  const root = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 1, height: 1 })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [inputOpen, setInputOpen] = useState(false)
  const [text, setText] = useState('')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const pointer = useRef<Drag | null>(null)
  /** 手势按按下时的实际尺寸算 Shift 约束与最小尺寸，不等尺寸观察回调。 */
  const gestureSize = useRef<Size>(size)
  const sequence = getActiveVideoEditSequence(instance)
  const displayMarks = sequence.annotations.map(mark => resolveVideoEditElementAnnotation(instance, mark))
  const visibleMarks = displayMarks.filter(({ mark }) => mark.status !== 'resolved' && videoEditAnnotationAt(mark, instance.frame))
  const selected = active ? visibleMarks.find(({ mark }) => mark.id === selectedId)?.mark : undefined
  const valid = (capture: Capture): boolean => instance.document === capture.document && instance.activeSequenceId === capture.sequenceId && instance.frame === capture.frame && instance.selection === capture.clipId && instance.selectedClipIds === capture.selection && videoEditProgramCommandIdentity(instance.document.id) === capture.command
  useEffect(() => {
    const element = root.current
    if (!element) return
    const update = (): void => { const rect = element.getBoundingClientRect(); setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) }) }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update); observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // 换帧、换序列、退出工具时没完成的一笔直接丢掉，不会落到别的画面上。
  useEffect(() => { pointer.current = null; setDraft(null); setDrag(null); setText(''); setSelectedId(null) }, [active, instance.document.id, instance.frame, instance.activeSequenceId])
  const pointAt = (event: React.PointerEvent<HTMLElement>): Point => { const rect = event.currentTarget.getBoundingClientRect(); return { x: clamp((event.clientX - rect.left) / Math.max(1, rect.width)), y: clamp((event.clientY - rect.top) / Math.max(1, rect.height)) } }
  const drawTarget = (shape: VideoEditAnnotationShape, points: Point[], capture: Capture, shift: boolean): VideoEditAnnotationTarget => {
    const start = points[0]; const end = constrain(shape, start, points.at(-1)!, gestureSize.current, shift)
    if (shape === 'point') return capture.elementTarget ?? { kind: 'point', ...start }
    if (shape === 'text') return { kind: 'text', ...start }
    if (shape === 'marker') return { kind: 'marker', ...start, number: nextMarkerNumber(sequence.annotations) }
    if (shape === 'arrow') return { kind: 'arrow', from: start, to: end }
    if (shape === 'stroke') return { kind: 'stroke', strokes: [...(draft?.target.kind === 'stroke' ? draft.target.strokes : []), points] }
    return { kind: shape, ...boxOf(start, end) }
  }
  const tooSmall = (target: VideoEditAnnotationTarget): boolean => { const { width, height } = gestureSize.current; return target.kind === 'arrow' ? Math.hypot((target.to.x - target.from.x) * width, (target.to.y - target.from.y) * height) < 8
    : (target.kind === 'region' || target.kind === 'ellipse') && (target.width * width < 6 || target.height * height < 6) }
  const discard = (): void => { setDraft(null); setText(''); setInputOpen(false) }
  const confirm = (): void => {
    if (!draft || !text.trim()) return
    try {
      if (draft.editingId) updateVideoEditAnnotation(instance.document.id, draft.editingId, mark => ({ ...mark, text: text.trim() }))
      else {
        if (!valid(draft.capture)) throw new Error('画面已改变，请在当前帧重新标注。')
        const id = createVideoEditAnnotation(instance.document.id, draft.capture.sequenceId, { frame: draft.capture.frame, ...(draft.capture.clipId ? { clipId: draft.capture.clipId } : {}), target: draft.target, text, style: videoEditAnnotationStyle(draft.color, draft.weight) })
        setSelectedId(id)
      }
      discard()
    } catch (error) { onError(error) }
  }
  const editText = (mark: VideoEditAnnotation, anchor: DOMRect): void => {
    setDraft({ capture: { document: instance.document, sequenceId: instance.activeSequenceId, clipId: instance.selection, frame: instance.frame, command: videoEditProgramCommandIdentity(instance.document.id), selection: instance.selectedClipIds }, target: mark.target, color: videoEditAnnotationColor(mark), weight: videoEditAnnotationWeight(mark), anchor, editingId: mark.id })
    setText(mark.text); setInputOpen(true)
  }
  // 参数条换颜色或粗细：选中的那条跟着改（只响应画笔的变化，选中别的批注不会反过来改它）。
  const brushStyle = useRef({ color: brush.color, weight: brush.weight })
  useEffect(() => {
    const previous = brushStyle.current
    if (previous.color === brush.color && previous.weight === brush.weight) return
    brushStyle.current = { color: brush.color, weight: brush.weight }
    if (!selected) return
    const color = previous.color !== brush.color ? brush.color : videoEditAnnotationColor(selected)
    const weight = previous.weight !== brush.weight ? brush.weight : videoEditAnnotationWeight(selected)
    if (color !== videoEditAnnotationColor(selected) || weight !== videoEditAnnotationWeight(selected)) try { updateVideoEditAnnotation(instance.document.id, selected.id, mark => ({ ...mark, style: videoEditAnnotationStyle(color, weight) })) } catch (error) { onError(error) }
  }, [brush.color, brush.weight, selected, instance.document.id, onError])
  /** 气泡贴着松手处，放在画面里面：右边不够就往左挪，下面不够就放到上方。 */
  const bubblePosition = (anchor: DOMRect): React.CSSProperties => {
    const rect = root.current?.getBoundingClientRect(); const width = 288; const height = 36
    const x = rect ? anchor.left - rect.left : 0; const y = rect ? anchor.top - rect.top : 0
    const left = Math.max(8, Math.min(size.width - width - 8, x + 12)); const top = y + 14 + height > size.height - 8 ? Math.max(8, y - height - 14) : y + 14
    return { left, top }
  }
  const editing = drag?.kind === 'edit' ? drag : undefined
  const targetOf = (mark: VideoEditAnnotation): VideoEditAnnotationTarget => editing?.id === mark.id ? editing.target : mark.target
  const placeholder = (draft?.target.kind === 'text') ? '输入要写在画面上的字' : '这里要改什么？'
  return <div ref={root} tabIndex={active ? -1 : undefined} className={`absolute inset-0 outline-none ${active ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'}`} aria-label="画面标注层"
    onKeyDown={event => {
      if (!active || !selected || (event.target as HTMLElement).closest('input,textarea')) return
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); try { deleteVideoEditAnnotation(instance.document.id, selected.id); setSelectedId(null) } catch (error) { onError(error) } }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSelectedId(null) }
    }}
    onDoubleClick={event => {
      const id = (event.target as Element).closest('[data-annotation-id]')?.getAttribute('data-annotation-id'); const mark = visibleMarks.find(item => item.mark.id === id)?.mark
      if (active && mark) { event.stopPropagation(); editText(mark, new DOMRect(event.clientX, event.clientY, 1, 1)) }
    }}
    onPointerDown={event => {
      if (!active || event.button !== 0) return
      try {
        const at = pointAt(event); const element = event.target as Element
        const rect = event.currentTarget.getBoundingClientRect(); gestureSize.current = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) }
        const handle = element.closest('[data-annotation-handle]')?.getAttribute('data-annotation-handle') as Handle | null
        const id = element.closest('[data-annotation-id]')?.getAttribute('data-annotation-id') ?? (handle ? selectedId : null)
        const mark = id ? visibleMarks.find(item => item.mark.id === id)?.mark : undefined
        root.current?.focus({ preventScroll: true })
        if (instance.playing) setVideoEditView(instance.document.id, { playing: false })
        // 气泡还开着时点画面：画笔接着画下一笔，其余形状先放弃没写完的那条
        if (draft && (draft.editingId || draft.target.kind !== 'stroke')) discard()
        if (mark) {
          setSelectedId(mark.id); selectVideoEditAnnotation(instance.document.id, mark.id)
          if (mark.target.kind !== 'element') { pointer.current = { kind: 'edit', id: mark.id, handle: handle ?? 'move', start: at, original: mark.target, target: mark.target }; event.currentTarget.setPointerCapture(event.pointerId) }
          event.stopPropagation(); return
        }
        setSelectedId(null)
        const shape = brush.shape; const bound = shape === 'point' ? codeElementAnnotationTarget(instance, at) : undefined
        if (bound?.target.kind === 'element') selectVideoEditCodeElement(instance, bound.clipId, bound.target.elementId)
        const capture = { document: instance.document, sequenceId: instance.activeSequenceId, clipId: instance.selection, frame: instance.frame, command: videoEditProgramCommandIdentity(instance.document.id), selection: instance.selectedClipIds, elementTarget: bound?.target }
        pointer.current = { kind: 'draw', shape, capture, points: [at] }; event.currentTarget.setPointerCapture(event.pointerId); event.stopPropagation()
      } catch (error) { onError(error) }
    }}
    onPointerMove={event => {
      const current = pointer.current; if (!current) return
      const at = pointAt(event)
      if (current.kind === 'edit') { current.target = editedTarget(current.original, current.handle, { x: at.x - current.start.x, y: at.y - current.start.y }); setDrag({ ...current }); return }
      if (current.shape === 'stroke') current.points.push(at); else current.points = [current.points[0], at]
      setDrag({ ...current, points: [...current.points] })
    }}
    onPointerCancel={() => { pointer.current = null; setDrag(null) }} onLostPointerCapture={() => { pointer.current = null; setDrag(null) }}
    onPointerUp={event => {
      const current = pointer.current; pointer.current = null; setDrag(null)
      if (!current) return
      event.stopPropagation()
      if (current.kind === 'edit') {
        if (JSON.stringify(current.target) !== JSON.stringify(current.original)) try { updateVideoEditAnnotation(instance.document.id, current.id, mark => ({ ...mark, target: current.target })) } catch (error) { onError(error) }
        return
      }
      if (!valid(current.capture)) return
      const points = current.shape === 'stroke' ? [...current.points, pointAt(event)] : [current.points[0], pointAt(event)]
      const target = drawTarget(current.shape, points, current.capture, event.shiftKey)
      if (tooSmall(target)) return
      setDraft({ capture: current.capture, target, color: brush.color, weight: brush.weight, anchor: new DOMRect(event.clientX, event.clientY, 1, 1) }); setText(''); setInputOpen(true)
    }}>
    {/* icon-token-allow: 标注坐标与笔迹来自用户归一化数据，属于画面图形而非图标。 */}
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden>
      {visibleMarks.map(({ mark }) => <g key={mark.id}><TargetShape target={targetOf(mark)} text={mark.text} color={videoEditAnnotationColor(mark)} weight={videoEditAnnotationWeight(mark)} size={size} />
        {active && <g data-annotation-id={mark.id} className="pointer-events-auto cursor-move"><TargetShape target={targetOf(mark)} text={mark.text} color={videoEditAnnotationColor(mark)} size={size} hit /></g>}</g>)}
      {drag?.kind === 'draw' && <TargetShape target={drawTarget(drag.shape, drag.points, drag.capture, false)} color={brush.color} weight={brush.weight} size={size} />}
      {draft && !draft.editingId && <TargetShape target={draft.target} text={draft.target.kind === 'text' ? text : undefined} color={draft.color} weight={draft.weight} size={size} />}
      {selected && <g>
        {(() => { const box = editing?.id === selected.id ? editing.target : selected.target; return handlesOf(box).map(({ handle, at }) => <rect key={handle} data-annotation-handle={handle} className="pointer-events-auto cursor-nwse-resize" x={at.x * size.width - 5} y={at.y * size.height - 5} width={10} height={10} rx={2} fill="rgb(var(--on-media-rgb))" stroke="rgb(var(--accent-rgb))" strokeWidth={2} />) })()}
      </g>}
    </svg>
    {visibleMarks.flatMap(({ mark, missing, label }) => {
      const index = sequence.annotations.findIndex(item => item.id === mark.id)
      if (mark.target.kind === 'marker') return []
      const at = labelPosition(targetOf(mark))
      return [<div key={mark.id} className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-full ui-glass rounded-control ${selectedVideoEditAnnotation(instance.document.id) === mark.id || selectedId === mark.id ? 'ring-2 ring-accent-ring' : ''}`} style={{ left: `${Math.max(.03, Math.min(.92, at.x)) * 100}%`, top: `${Math.max(.08, Math.min(.98, at.y)) * 100}%` }}>
        <UiButton variant="media" size="sm" onPointerDown={event => event.stopPropagation()} onClick={() => { try { jumpToVideoEditAnnotation(instance.document.id, mark.id) } catch (error) { onError(error) } }} tooltip={mark.text}>{index + 1}{missing ? ' · 元素已不存在' : mark.status === 'open' || mark.status === 'addressed' ? ` · ${VIDEO_EDIT_ANNOTATION_STATUS_LABELS[mark.status]}` : label ? ` · ${label}` : ''}</UiButton>
      </div>]
    })}
    {draft && inputOpen && <div role="dialog" aria-label="这里要改什么" className="pointer-events-auto absolute z-raised flex h-9 w-72 items-center gap-2 rounded-full pl-3 pr-1 shadow-panel ui-glass" style={bubblePosition(draft.anchor)} onPointerDown={event => event.stopPropagation()}>
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: VIDEO_EDIT_ANNOTATION_COLORS[draft.color] }} />
      <UiInput frame="inner" size="sm" autoFocus aria-label="这里要改什么？" placeholder={placeholder} className="min-w-0 flex-1" value={text} onChange={event => setText(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); confirm() }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); discard() }
      }} />
      <UiIconButton size="sm" shape="circle" aria-label="放弃（Esc）" tooltip="放弃（Esc）" onClick={discard}><X /></UiIconButton>
      <UiIconButton size="sm" tone="accent" aria-label={draft.editingId ? '保存（回车）' : '加入待发送（回车）'} tooltip={draft.editingId ? '保存（回车）' : '加入待发送（回车）'} disabled={!text.trim()} onClick={confirm}><ArrowUp /></UiIconButton>
    </div>}
  </div>
}
