import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { UiInput } from '@/components/ui'
import { UI_FLOATING_EDGE_CLASS } from '@/components/ui/styleTokens'
import { videoEditAnnotationAt, videoEditAnnotationStyle, videoEditAnnotationWeight, type VideoEditAnnotation, type VideoEditAnnotationTarget, type VideoEditAnnotationWeight } from '@/core/videoEdit/annotations'
import { createVideoEditAnnotation, deleteVideoEditAnnotation, finishVideoEditAnnotationEdit, hoveredVideoEditAnnotation, jumpToVideoEditAnnotation, selectedVideoEditAnnotation, selectVideoEditAnnotation, setHoveredVideoEditAnnotation, setVideoEditAnnotationEditText, subscribeVideoEditAnnotationBrush, subscribeVideoEditAnnotationSelection, updateVideoEditAnnotation, videoEditAnnotationEdit, videoEditAnnotationSelectionRevision, videoEditAnnotationBrush, videoEditAnnotationBrushRevision, type VideoEditAnnotationShape } from './application/videoEditAnnotations'
import { getActiveVideoEditSequence, setVideoEditView, videoEditProgramCommandIdentity, videoEditRevision, type VideoEditInstance } from './application/videoEditService'
import { sameVideoEditViewFields, useVideoEditViewSelector } from './application/useVideoEditViewSelector'
import { codeElementAnnotationTarget, resolveVideoEditElementAnnotation, selectVideoEditCodeElement } from './application/videoEditCodeElements'
import { VideoEditAnnotationBadge } from './VideoEditAnnotationBadge'
import { videoEditAnnotationColor } from './videoEditAnnotationPalette'
import { placeVideoEditAnnotationTag, videoEditAnnotationTagAnchor } from './videoEditAnnotationTagPlacement'

type Point = { x: number; y: number }
type Size = { width: number; height: number }
interface Capture { document: VideoEditInstance['document']; sequenceId: string; clipId: string | null; frame: number; command: object; selection: string[]; elementTarget?: VideoEditAnnotationTarget }
/** 松手后等待输入的一笔：标签本身变成输入框；number 是它落成后的序号（决定颜色）。 */
interface Draft { capture: Capture; target: VideoEditAnnotationTarget; number: number; weight: VideoEditAnnotationWeight }
type Handle = 'move' | 'from' | 'to' | 'nw' | 'ne' | 'sw' | 'se'
type Drag =
  | { kind: 'draw'; shape: VideoEditAnnotationShape; capture: Capture; points: Point[] }
  | { kind: 'edit'; id: string; handle: Handle; start: Point; original: VideoEditAnnotationTarget; target: VideoEditAnnotationTarget }
/** 轮换色都是中高亮度：编号圆点上的字与文字批注的描边一律用深色。 */
const INK = 'rgb(var(--annotation-ink-rgb))'
const clamp = (value: number): number => Math.max(0, Math.min(1, value))
/** 线宽（屏幕像素）：细 / 中 / 粗。 */
const STROKE: Record<VideoEditAnnotationWeight, number> = { thin: 2, regular: 3, bold: 5 }
/** 箭头比框和圈细一档：它只负责从说明标签指到那个位置，不该比说明更抢眼。 */
const ARROW_STROKE: Record<VideoEditAnnotationWeight, number> = { thin: 1.5, regular: 2, bold: 3 }
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
  const angle = Math.atan2(b.y - a.y, b.x - a.x); const head = Math.min(6 + stroke * 2, Math.hypot(b.x - a.x, b.y - a.y) * .6); const base = { x: b.x - Math.cos(angle) * head * .7, y: b.y - Math.sin(angle) * head * .7 }
  const wing = (side: number) => `${b.x - Math.cos(angle) * head + Math.cos(angle + side * Math.PI / 2) * head * .45},${b.y - Math.sin(angle) * head + Math.sin(angle + side * Math.PI / 2) * head * .45}`
  return <><line x1={a.x} y1={a.y} x2={base.x} y2={base.y} stroke={color} strokeWidth={stroke} strokeLinecap="round" /><polygon points={`${b.x},${b.y} ${wing(1)} ${wing(-1)}`} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" /></>
}

/** 一条标注的图形（像素坐标）；hit 时画一层透明粗线供点选。 */
function TargetShape({ target, text, color, weight = 'regular', size, hit }: { target: VideoEditAnnotationTarget; text?: string; color: string; weight?: VideoEditAnnotationWeight; size: Size; hit?: boolean }): React.ReactElement | null {
  const fill = color; const contrast = INK
  const X = (value: number): number => value * size.width; const Y = (value: number): number => value * size.height
  const line = hit ? { stroke: 'transparent', strokeWidth: HIT, fill: 'none' } : { stroke: fill, strokeWidth: STROKE[weight], fill: 'none' }
  if (target.kind === 'arrow') return hit ? <line x1={X(target.from.x)} y1={Y(target.from.y)} x2={X(target.to.x)} y2={Y(target.to.y)} {...line} /> : <Arrow from={target.from} to={target.to} color={fill} size={size} stroke={ARROW_STROKE[weight]} />
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
/**
 * 画面上一条批注的说明标签：浮起表面（实底 + 浮层描边、不加投影），同色序号 + 最多两行文字；按挂点放，放不下就换边、推回画面内。
 * 折行后按最长一行收窄，不在右边留一块空白。
 */
function AnnotationTag({ target, size, text, children, className = '', editing, ...props }: { target: VideoEditAnnotationTarget; size: Size; text: string; children: React.ReactNode; className?: string; editing?: boolean } & React.HTMLAttributes<HTMLDivElement>): React.ReactElement | null {
  const ref = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<{ left: number; top: number; width?: number } | null>(null)
  const anchor = videoEditAnnotationTagAnchor(target, size)
  const anchorKey = JSON.stringify(anchor)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !anchor) return
    element.style.width = ''
    const text = element.querySelector<HTMLElement>('[data-annotation-tag-text]')
    let width: number | undefined
    if (text && !editing) {
      const range = element.ownerDocument.createRange(); range.selectNodeContents(text)
      // jsdom 没有 Range.getClientRects：拿不到行框时按原宽度放
      const lines = typeof range.getClientRects === 'function' ? [...range.getClientRects()] : []
      if (lines.length > 1) width = Math.ceil(element.offsetWidth - text.offsetWidth + Math.max(...lines.map(line => line.right)) - Math.min(...lines.map(line => line.left)) + 1)
    }
    if (width) element.style.width = `${width}px`
    const at = placeVideoEditAnnotationTag(anchor, { width: element.offsetWidth, height: element.offsetHeight }, size)
    setLayout(current => current && current.left === at.x && current.top === at.y && current.width === width ? current : { left: at.x, top: at.y, width })
    // anchor 由 anchorKey 代表：每次渲染都是新对象，按内容比较
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey, size.width, size.height, editing, text])
  if (!anchor) return null
  return <div ref={ref} {...props} className={`pointer-events-auto absolute z-raised flex items-start gap-1.5 rounded-control bg-overlay py-1 pl-1 pr-2 text-xs text-text1 transition-opacity duration-120 ${UI_FLOATING_EDGE_CLASS} ${editing ? 'w-52' : 'w-max max-w-52'} ${layout ? '' : 'opacity-0'} ${className}`} style={layout ? { left: layout.left, top: layout.top, ...(layout.width ? { width: layout.width } : {}) } : undefined}>
    {children}
  </div>
}

/**
 * 节目画面上的批注层（像截图标注）：批注工具下拖拽画箭头、圈、框、画笔，单击放文字、编号、评论钉；Shift 约束。
 * 松手后这条批注的说明标签直接变成输入框，回车加入待发送、Esc 放弃。点已有标注可选中、拖动、拖角改大小，双击标签改文字，Delete 删除。
 * 每条批注挂一个说明标签（同色序号 + 文字），颜色按序号轮换；指针停在列表、标签或时间线序号上时只亮那一条。
 * 标记只对应某一帧，播放时一闪而过，所以播放中整层不画，暂停、拖动播放头、逐帧跳转时才出现。
 */
export function VideoEditAnnotationOverlay({ instance, active, onError }: { instance: VideoEditInstance; active: boolean; onError: (error: unknown) => void }): React.ReactElement {
  useVideoEditViewSelector(() => [videoEditRevision(), instance.playing, !instance.playing && (active || instance.document.sequences.find(sequence => sequence.id === instance.activeSequenceId)?.annotations.length) ? instance.frame : null], sameVideoEditViewFields)
  useSyncExternalStore(subscribeVideoEditAnnotationBrush, videoEditAnnotationBrushRevision)
  useSyncExternalStore(subscribeVideoEditAnnotationSelection, videoEditAnnotationSelectionRevision)
  const projectId = instance.document.id
  const brush = videoEditAnnotationBrush(projectId)
  const root = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 1, height: 1 })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [text, setText] = useState('')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** 在画面标签里就地改字的那条（文字本身放在共享的编辑状态里，列表展开态同步显示）。 */
  const [tagEditingId, setTagEditingId] = useState<string | null>(null)
  const pointer = useRef<Drag | null>(null)
  /** 手势按按下时的实际尺寸算 Shift 约束与最小尺寸，不等尺寸观察回调。 */
  const gestureSize = useRef<Size>(size)
  const sequence = getActiveVideoEditSequence(instance)
  const numberOf = (id: string): number => sequence.annotations.findIndex(item => item.id === id) + 1
  const displayMarks = sequence.annotations.map(mark => resolveVideoEditElementAnnotation(instance, mark))
  // 已改完、已确认的不再画在画面上；在面板里选中已改完的那条（准备看看要不要驳回）时才显示它
  const reviewing = selectedVideoEditAnnotation(projectId)
  const visibleMarks = instance.playing ? [] : displayMarks.filter(({ mark }) => (mark.status === 'draft' || mark.status === 'open' || (mark.status === 'addressed' && mark.id === reviewing)) && videoEditAnnotationAt(mark, instance.frame))
  const selected = active ? visibleMarks.find(({ mark }) => mark.id === selectedId)?.mark : undefined
  const hovered = hoveredVideoEditAnnotation(projectId)
  const edit = videoEditAnnotationEdit(projectId)
  const valid = (capture: Capture): boolean => instance.document === capture.document && instance.activeSequenceId === capture.sequenceId && instance.frame === capture.frame && instance.selection === capture.clipId && instance.selectedClipIds === capture.selection && videoEditProgramCommandIdentity(projectId) === capture.command
  useEffect(() => {
    const element = root.current
    if (!element) return
    const update = (): void => { const rect = element.getBoundingClientRect(); setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) }) }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update); observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // 换帧、换序列、开始播放、退出工具时没完成的一笔直接丢掉，不会落到别的画面上；标签里改了一半的文字照常保存。
  // 只在“开始播放”时重置：播放中按下画面会先暂停再开画，暂停不能把刚开始的这一笔清掉。
  const tagEditing = useRef(tagEditingId); tagEditing.current = tagEditingId
  const reset = useRef<() => void>(() => undefined)
  reset.current = (): void => {
    // 播放中按下画面会先暂停：播放中这一层不随帧刷新，暂停后第一次刷新看到的是新帧，但这一笔正是在新帧上开始的，不能清掉
    if (pointer.current?.kind === 'draw' && pointer.current.capture.frame === instance.frame) return
    pointer.current = null; setDraft(null); setDrag(null); setText(''); setSelectedId(null); setTagEditingId(null)
    if (tagEditing.current) { try { finishVideoEditAnnotationEdit(projectId, tagEditing.current, true) } catch (error) { onError(error) } }
  }
  useEffect(() => { reset.current() }, [active, projectId, instance.frame, instance.activeSequenceId])
  useEffect(() => { if (instance.playing) { reset.current(); setHoveredVideoEditAnnotation(projectId, null) } }, [instance.playing, projectId])
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
  const discard = (): void => { setDraft(null); setText('') }
  const confirm = (): void => {
    if (!draft || !text.trim()) return
    try {
      if (!valid(draft.capture)) throw new Error('画面已改变，请在当前帧重新标注。')
      const style = videoEditAnnotationStyle(draft.weight)
      const id = createVideoEditAnnotation(projectId, draft.capture.sequenceId, { frame: draft.capture.frame, ...(draft.capture.clipId ? { clipId: draft.capture.clipId } : {}), target: draft.target, text, ...(style ? { style } : {}) })
      setSelectedId(id)
      discard()
    } catch (error) { onError(error) }
  }
  const run = (operation: () => void): void => { try { operation() } catch (error) { onError(error) } }
  const beginTagEdit = (mark: VideoEditAnnotation): void => { setVideoEditAnnotationEditText(projectId, mark.id, edit?.id === mark.id ? edit.text : mark.text); setTagEditingId(mark.id) }
  const endTagEdit = (id: string, keep: boolean): void => { setTagEditingId(null); run(() => finishVideoEditAnnotationEdit(projectId, id, keep)) }
  // 参数条换粗细：选中的那条跟着改（只响应画笔的变化，选中别的批注不会反过来改它）。
  const brushWeight = useRef(brush.weight)
  useEffect(() => {
    if (brushWeight.current === brush.weight) return
    brushWeight.current = brush.weight
    if (!selected || videoEditAnnotationWeight(selected) === brush.weight) return
    const style = videoEditAnnotationStyle(brush.weight)
    try { updateVideoEditAnnotation(projectId, selected.id, ({ style: _style, ...mark }) => style ? { ...mark, style } : mark) } catch (error) { onError(error) }
  }, [brush.weight, selected, projectId, onError])
  const editing = drag?.kind === 'edit' ? drag : undefined
  const targetOf = (mark: VideoEditAnnotation): VideoEditAnnotationTarget => editing?.id === mark.id ? editing.target : mark.target
  const placeholder = draft?.target.kind === 'text' ? '输入要写在画面上的字' : '这里要改什么？'
  const dimmed = (id: string): boolean => Boolean(hovered && hovered !== id)
  return <div ref={root} tabIndex={active ? -1 : undefined} className={`absolute inset-0 outline-none ${active ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'}`} aria-label="画面标注层"
    onKeyDown={event => {
      if (!active || !selected || (event.target as HTMLElement).closest('input,textarea')) return
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); run(() => { deleteVideoEditAnnotation(projectId, selected.id); setSelectedId(null) }) }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSelectedId(null) }
    }}
    onDoubleClick={event => {
      const id = (event.target as Element).closest('[data-annotation-id]')?.getAttribute('data-annotation-id'); const mark = visibleMarks.find(item => item.mark.id === id)?.mark
      if (active && mark && (mark.status === 'draft' || mark.status === 'open')) { event.stopPropagation(); beginTagEdit(mark) }
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
        if (instance.playing) setVideoEditView(projectId, { playing: false })
        // 输入框还开着时点画面：画笔接着画下一笔，其余形状先放弃没写完的那条
        if (draft && draft.target.kind !== 'stroke') discard()
        if (mark) {
          setSelectedId(mark.id); selectVideoEditAnnotation(projectId, mark.id)
          if (mark.target.kind !== 'element') { pointer.current = { kind: 'edit', id: mark.id, handle: handle ?? 'move', start: at, original: mark.target, target: mark.target }; event.currentTarget.setPointerCapture(event.pointerId) }
          event.stopPropagation(); return
        }
        setSelectedId(null)
        const shape = brush.shape; const bound = shape === 'point' ? codeElementAnnotationTarget(instance, at) : undefined
        if (bound?.target.kind === 'element') selectVideoEditCodeElement(instance, bound.clipId, bound.target.elementId)
        const capture = { document: instance.document, sequenceId: instance.activeSequenceId, clipId: instance.selection, frame: instance.frame, command: videoEditProgramCommandIdentity(projectId), selection: instance.selectedClipIds, elementTarget: bound?.target }
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
        if (JSON.stringify(current.target) !== JSON.stringify(current.original)) run(() => updateVideoEditAnnotation(projectId, current.id, mark => ({ ...mark, target: current.target })))
        return
      }
      if (!valid(current.capture)) return
      const points = current.shape === 'stroke' ? [...current.points, pointAt(event)] : [current.points[0], pointAt(event)]
      const target = drawTarget(current.shape, points, current.capture, event.shiftKey)
      if (tooSmall(target)) return
      setDraft({ capture: current.capture, target, number: sequence.annotations.length + 1, weight: brush.weight }); if (draft?.target.kind !== 'stroke') setText('')
    }}>
    {/* icon-token-allow: 标注坐标与笔迹来自用户归一化数据，属于画面图形而非图标。 */}
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${size.width} ${size.height}`} aria-hidden>
      {visibleMarks.map(({ mark }) => { const color = videoEditAnnotationColor(numberOf(mark.id)); return <g key={mark.id} className="transition-opacity duration-120" opacity={dimmed(mark.id) ? .4 : 1}><TargetShape target={targetOf(mark)} text={mark.text} color={color} weight={videoEditAnnotationWeight(mark)} size={size} />
        {active && <g data-annotation-id={mark.id} className="pointer-events-auto cursor-move"><TargetShape target={targetOf(mark)} text={mark.text} color={color} size={size} hit /></g>}</g> })}
      {drag?.kind === 'draw' && <TargetShape target={drawTarget(drag.shape, drag.points, drag.capture, false)} color={videoEditAnnotationColor(sequence.annotations.length + 1)} weight={brush.weight} size={size} />}
      {draft && <TargetShape target={draft.target} text={draft.target.kind === 'text' ? text : undefined} color={videoEditAnnotationColor(draft.number)} weight={draft.weight} size={size} />}
      {selected && <g>
        {(() => { const box = editing?.id === selected.id ? editing.target : selected.target; return handlesOf(box).map(({ handle, at }) => <rect key={handle} data-annotation-handle={handle} className="pointer-events-auto cursor-nwse-resize" x={at.x * size.width - 5} y={at.y * size.height - 5} width={10} height={10} rx={2} fill="rgb(var(--on-media-rgb))" stroke="rgb(var(--accent-rgb))" strokeWidth={2} />) })()}
      </g>}
    </svg>
    {visibleMarks.map(({ mark, missing, label }) => {
      const number = numberOf(mark.id); const isSelected = reviewing === mark.id || selectedId === mark.id; const editable = mark.status === 'draft' || mark.status === 'open'
      const suffix = missing ? ' · 元素已不存在' : label ? ` · ${label}` : ''
      const inTag = tagEditingId === mark.id; const mirrored = !inTag && edit?.id === mark.id
      const target = targetOf(mark); const tagTarget: VideoEditAnnotationTarget = target.kind === 'text' ? { kind: 'point', x: target.x, y: target.y } : target
      if (target.kind === 'text' && !inTag) return null
      return <AnnotationTag key={mark.id} target={tagTarget} size={size} text={`${mirrored ? edit.text : mark.text}${suffix}`} editing={inTag} data-video-edit-annotation-tag={mark.id}
        className={`${mirrored ? 'ring-1 ring-accent-ring' : isSelected ? 'ring-1 ring-text1' : ''} ${dimmed(mark.id) ? 'opacity-40' : ''} ${inTag ? '' : 'cursor-pointer'}`}
        onPointerDown={event => event.stopPropagation()} onPointerEnter={() => setHoveredVideoEditAnnotation(projectId, mark.id)} onPointerLeave={() => setHoveredVideoEditAnnotation(projectId, null)}
        onClick={() => { if (!inTag) run(() => jumpToVideoEditAnnotation(projectId, mark.id)) }} onDoubleClick={event => { event.stopPropagation(); if (!inTag && editable) beginTagEdit(mark) }}>
        <VideoEditAnnotationBadge number={number} size="sm" />
        {inTag ? <UiInput frame="inner" size="sm" autoFocus aria-label={`改批注 ${number}`} className="-my-1 min-w-0 flex-1" value={edit?.id === mark.id ? edit.text : mark.text}
          onChange={event => setVideoEditAnnotationEditText(projectId, mark.id, event.target.value)} onBlur={() => endTagEdit(mark.id, true)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); endTagEdit(mark.id, true) }
            else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); endTagEdit(mark.id, false) }
          }} />
          : <span data-annotation-tag-text className="line-clamp-2 min-w-0 whitespace-normal break-words text-balance">{mirrored ? edit.text : mark.text}{suffix}</span>}
      </AnnotationTag>
    })}
    {draft && <AnnotationTag target={draft.target.kind === 'text' ? { kind: 'point', x: draft.target.x, y: draft.target.y } : draft.target} size={size} text={text} editing role="dialog" aria-label="这里要改什么" onPointerDown={event => event.stopPropagation()}>
      <VideoEditAnnotationBadge number={draft.number} size="sm" />
      <UiInput frame="inner" size="sm" autoFocus aria-label="这里要改什么？" placeholder={placeholder} className="-my-1 min-w-0 flex-1" value={text} onChange={event => setText(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); confirm() }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); discard() }
      }} />
    </AnnotationTag>}
  </div>
}
