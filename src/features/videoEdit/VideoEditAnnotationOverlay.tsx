import { useEffect, useRef, useState } from 'react'
import { PanelTrigger, UiButton, UiInput } from '@/components/ui'
import { videoEditAnnotationAt, type VideoEditAnnotationTarget } from '@/core/videoEdit/annotations'
import { createVideoEditAnnotation, jumpToVideoEditAnnotation, selectedVideoEditAnnotation } from './application/videoEditAnnotations'
import { getActiveVideoEditSequence, videoEditProgramCommandIdentity, type VideoEditInstance } from './application/videoEditService'
import { codeElementAnnotationTarget, resolveVideoEditElementAnnotation, selectVideoEditCodeElement } from './application/videoEditCodeElements'

export type VideoEditAnnotationMode = 'select' | 'move' | 'point' | 'region' | 'stroke'
interface Capture { document: VideoEditInstance['document']; sequenceId: string; clipId: string | null; frame: number; command: object; selection: string[]; elementTarget?: VideoEditAnnotationTarget }
interface Draft { capture: Capture; target: VideoEditAnnotationTarget; anchor: DOMRect }
const STATUS_STROKE = { draft: 'rgb(var(--on-media-rgb))', open: 'rgb(var(--accent-rgb))', addressed: 'rgb(var(--success-rgb))', resolved: 'rgb(var(--on-media-rgb))' }
function TargetShape({ target }: { target: VideoEditAnnotationTarget }): React.ReactElement | null {
  if (target.kind === 'point') return <circle cx={target.x * 1000} cy={target.y * 1000} r={8} />
  const region = target.kind === 'region' ? target : target.kind === 'element' ? target.region : undefined
  if (region) return <rect x={region.x * 1000} y={region.y * 1000} width={region.width * 1000} height={region.height * 1000} />
  if (target.kind === 'stroke') return <>{target.strokes.map((points, index) => <polyline key={index} points={points.map(point => `${point.x * 1000},${point.y * 1000}`).join(' ')} />)}</>
  return null
}
function labelPosition(target: VideoEditAnnotationTarget): { x: number; y: number } {
  if (target.kind === 'point' || target.kind === 'region') return target
  if (target.kind === 'stroke') return target.strokes[0][0]
  if (target.kind === 'element' && target.region) return target.region
  return { x: 0.02, y: 0.05 }
}
export function VideoEditAnnotationOverlay({ instance, mode, onError }: { instance: VideoEditInstance; mode: VideoEditAnnotationMode; onError: (error: unknown) => void }): React.ReactElement {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [inputOpen, setInputOpen] = useState(false)
  const [text, setText] = useState('')
  const [drawing, setDrawing] = useState<VideoEditAnnotationTarget | null>(null)
  const pointer = useRef<{ capture: Capture; points: Array<{ x: number; y: number }> } | null>(null)
  const sequence = getActiveVideoEditSequence(instance)
  const displayMarks = sequence.annotations.map(mark => resolveVideoEditElementAnnotation(instance, mark))
  const valid = (capture: Capture): boolean => instance.document === capture.document && instance.activeSequenceId === capture.sequenceId && instance.frame === capture.frame && instance.selection === capture.clipId && instance.selectedClipIds === capture.selection && videoEditProgramCommandIdentity(instance.document.id) === capture.command
  useEffect(() => { pointer.current = null; setDraft(null); setDrawing(null); setText('') }, [mode, instance.document, instance.frame, instance.activeSequenceId])
  const pointAt = (event: React.PointerEvent<HTMLElement>): { x: number; y: number } => { const rect = event.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))) } }
  const targetOf = (points: Array<{ x: number; y: number }>, capture?: Capture): VideoEditAnnotationTarget => {
    if (mode === 'point' && capture?.elementTarget) return capture.elementTarget
    if (mode === 'stroke') return { kind: 'stroke', strokes: [...(draft?.target.kind === 'stroke' ? draft.target.strokes : []), points] }
    if (mode !== 'region') return { kind: 'point', ...points[0] }
    const start = points[0]; const last = points.at(-1)!
    return { kind: 'region', x: Math.min(start.x, last.x), y: Math.min(start.y, last.y), width: Math.abs(start.x - last.x), height: Math.abs(start.y - last.y) }
  }
  const confirm = (): void => {
    if (!draft || !text.trim()) return
    try {
      if (!valid(draft.capture)) throw new Error('画面已改变，请在当前帧重新标注。')
      createVideoEditAnnotation(instance.document.id, draft.capture.sequenceId, { frame: draft.capture.frame, ...(draft.capture.clipId ? { clipId: draft.capture.clipId } : {}), target: draft.target, text })
      setDraft(null); setText(''); setDrawing(null)
    } catch (error) { onError(error) }
  }
  const active = mode === 'point' || mode === 'region' || mode === 'stroke'
  return <div className={`absolute inset-0 ${active ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'}`} aria-label="画面标注层"
    onPointerDown={event => {
      if (!active || event.button !== 0 || instance.playing) return
      try {
        const at = pointAt(event); const bound = mode === 'point' ? codeElementAnnotationTarget(instance, at) : undefined
        if (bound?.target.kind === 'element') selectVideoEditCodeElement(instance, bound.clipId, bound.target.elementId)
        const capture = { document: instance.document, sequenceId: instance.activeSequenceId, clipId: instance.selection, frame: instance.frame, command: videoEditProgramCommandIdentity(instance.document.id), selection: instance.selectedClipIds, elementTarget: bound?.target }
        pointer.current = { capture, points: [at] }; event.currentTarget.setPointerCapture(event.pointerId); event.stopPropagation()
      } catch (error) { onError(error) }
    }}
    onPointerMove={event => { const current = pointer.current; if (!current) return; const at = pointAt(event); if (mode === 'stroke') current.points.push(at); else current.points = [current.points[0], at]; setDrawing(targetOf(current.points, current.capture)) }}
    onPointerCancel={() => { pointer.current = null; setDrawing(null) }} onLostPointerCapture={() => { pointer.current = null; setDrawing(null) }}
    onPointerUp={event => {
      const current = pointer.current; pointer.current = null
      if (!current || !valid(current.capture)) { setDrawing(null); return }
      const target = targetOf([...current.points, pointAt(event)], current.capture)
      if (target.kind === 'region' && (!target.width || !target.height)) { setDrawing(null); return }
      setDraft({ capture: current.capture, target, anchor: new DOMRect(event.clientX, event.clientY, 1, 1) }); setInputOpen(true); setDrawing(null); event.stopPropagation()
    }}>
    {/* icon-token-allow: 标注坐标与笔迹来自用户归一化数据，属于画面图形而非图标。 */}
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none" fill="none" strokeWidth={3} aria-hidden>
      {displayMarks.filter(({ mark }) => mark.status !== 'resolved' && videoEditAnnotationAt(mark, instance.frame)).map(({ mark }) => <g key={mark.id} stroke={STATUS_STROKE[mark.status]} strokeDasharray={mark.status === 'draft' ? '10 6' : undefined}><TargetShape target={mark.target} /></g>)}
      {(drawing ?? draft?.target) && <g stroke={STATUS_STROKE.draft} strokeDasharray="10 6"><TargetShape target={(drawing ?? draft?.target)!} /></g>}
    </svg>
    {displayMarks.flatMap(({ mark, missing, label }, index) => {
      if (mark.status === 'resolved' || !videoEditAnnotationAt(mark, instance.frame)) return []
      const at = labelPosition(mark.target)
      return [<div key={mark.id} className={`pointer-events-auto absolute ui-glass rounded-control ${selectedVideoEditAnnotation(instance.document.id) === mark.id ? 'ring-2 ring-accent-ring' : ''}`} style={{ left: `${Math.min(.85, at.x) * 100}%`, top: `${Math.min(.9, at.y) * 100}%` }}>
        <UiButton variant="media" size="sm" onPointerDown={event => event.stopPropagation()} onClick={() => { try { jumpToVideoEditAnnotation(instance.document.id, mark.id) } catch (error) { onError(error) } }} title={mark.text}>{index + 1}{missing ? ' · 元素已不存在' : mark.status === 'addressed' ? ' · 待审查' : label ? ` · ${label}` : ''}</UiButton>
      </div>]
    })}
    {draft && <PanelTrigger surface="glass" anchor={draft.anchor} open={inputOpen} panelWidth={280} onOpenChange={open => { setInputOpen(open); if (!open && mode !== 'stroke') { setDraft(null); setText('') } }} renderPanel={() => <div className="space-y-2" onPointerDown={event => event.stopPropagation()}>
      <UiInput autoFocus aria-label="这里要改什么？" placeholder="这里要改什么？" value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); confirm() } }} />
      <div className="flex justify-end gap-2"><UiButton onClick={() => { setDraft(null); setText('') }}>取消</UiButton><UiButton variant="primary" disabled={!text.trim()} onClick={confirm}>加入待发送</UiButton></div>
    </div>} />}
  </div>
}
