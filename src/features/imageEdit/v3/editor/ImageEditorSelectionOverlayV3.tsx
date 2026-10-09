import { useImageEditorSubjectV3 } from './ImageEditorSubjectContextV3'
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { UiError } from '@/components/ui'
import { useThemeTokens } from '@/hooks/useThemeTokens'
import { appendImageEditSelectionV3, type ImageEditSelectionIntentShapeV3 } from '@/core/imageEdit/v3/selection/session'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { ImageEditSelectionRasterClientV3 } from '../execution/selectionRasterClientV3'
import { useImageEditorSessionStoreV3 } from '../store'
import { mapAnnotationPointV3, invertAnnotationMatrixV3, multiplyAnnotationMatricesV3, resolveAnnotationOutputGeometryV3 } from './annotationGeometryV3'
import { captureEditorPointerV3, releaseEditorPointerV3, type CapturedEditorPointerV3 } from './pointerCaptureV3'
import type { ImageEditorV3Controller } from './types'
import { useImageEditorRepairV3 } from './ImageEditorRepairContextV3'

export function ImageEditorSelectionOverlayV3({ bus, controller }: { bus: ImageEditCommandBusV3; controller: ImageEditorV3Controller }): JSX.Element {
  const { t } = useTranslation('ui')
  const repair = useImageEditorRepairV3()
  const subject = useImageEditorSubjectV3()
  const theme = useThemeTokens()
  const canvas = useRef<HTMLCanvasElement>(null)
  const sourceCanvas = useRef<HTMLCanvasElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const session = useImageEditorSessionStoreV3(s => s.sessions[controller.sessionId])
  const tool = session?.activeTool ?? 'move'
  const geometry = useMemo(() => resolveAnnotationOutputGeometryV3(controller.document), [controller.document])
  const [draft, setDraft] = useState<readonly (readonly [number, number])[]>([])
  const [error, setError] = useState<string | null>(null)
  const gesture = useRef<{ tool: string; points: (readonly [number, number])[]; pointer?: CapturedEditorPointerV3; revision: number; selectionRevision: number } | null>(null)
  const draftFrame = useRef<number | null>(null)
  const snapshot = bus.getSnapshot()
  const active = (tool.startsWith('select-') && !subject?.busy) || ((tool === 'remove' || tool === 'repair') && !repair?.busy)
  const cancel = () => { const current = gesture.current; gesture.current = null; if (current?.pointer) releaseEditorPointerV3(current.pointer); if (draftFrame.current !== null) cancelAnimationFrame(draftFrame.current); draftFrame.current = null; setDraft([]) }
  useEffect(() => {
    cancel()
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target || !svg.current?.closest('[data-image-editor-v3]')?.contains(target) || target.closest('input,textarea,select,[contenteditable="true"]')) return
      if (event.key === 'Escape') cancel()
      if (event.key === 'Enter' && gesture.current?.tool === 'select-polygon') finish()
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); const current = gesture.current; gesture.current = null; if (current?.pointer) releaseEditorPointerV3(current.pointer); if (draftFrame.current !== null) cancelAnimationFrame(draftFrame.current); draftFrame.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在切换工具/作品或权威选区时取消当前手势。
  }, [tool, controller.document.revision, snapshot.selectionRevision])
  useEffect(() => {
    if (!canvas.current) return
    canvas.current.width = 0
    if (!snapshot.selection) return
    const ctx = canvas.current.getContext('2d')
    if (!ctx) return
    const abort = new AbortController(), client = new ImageEditSelectionRasterClientV3()
    const scale = Math.min(1, 512 / Math.max(geometry.width, geometry.height))
    const width = Math.max(1, Math.ceil(geometry.width * scale)), height = Math.max(1, Math.ceil(geometry.height * scale))
    canvas.current.width = width; canvas.current.height = height
    const previewSize = { width: Math.max(1, Math.round(controller.document.geometry.width * scale)), height: Math.max(1, Math.round(controller.document.geometry.height * scale)) }
    const matrix = multiplyAnnotationMatricesV3([previewSize.width / controller.document.geometry.width, 0, 0, previewSize.height / controller.document.geometry.height, 0, 0], multiplyAnnotationMatricesV3(invertAnnotationMatrixV3(geometry.sourceToOutput), [geometry.width / width, 0, 0, geometry.height / height, 0, 0]))
    void client.rasterize({ selection: snapshot.selection, size: previewSize, region: { x: 0, y: 0, width, height }, matrix }, abort.signal).then(data => {
      if (abort.signal.aborted) return
      const pixels = ctx.createImageData(width, height)
      for (let i = 0; i < data.length; i++) pixels.data[i * 4 + 3] = Math.round(data[i] * 255)
      ctx.putImageData(pixels, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = theme.colors.accent; ctx.fillRect(0, 0, width, height); ctx.globalCompositeOperation = 'source-over'
      if (sourceCanvas.current && canvas.current) { sourceCanvas.current.width = width; sourceCanvas.current.height = height; sourceCanvas.current.getContext('2d')?.drawImage(canvas.current, 0, 0) }
    }).catch((cause: unknown) => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)) }).finally(() => client.dispose())
    return () => { abort.abort(); client.dispose() }
  }, [snapshot.selection, geometry, controller.document, theme])
  function point(event: PointerEvent<SVGSVGElement>): readonly [number, number] {
    const rect = event.currentTarget.getBoundingClientRect()
    return [(event.clientX - rect.left) / rect.width * geometry.width, (event.clientY - rect.top) / rect.height * geometry.height]
  }
  function finish() {
    const current = gesture.current
    if (!current || current.revision !== bus.getSnapshot().document.revision || current.selectionRevision !== bus.getSnapshot().selectionRevision) { cancel(); return }
    const inverse = invertAnnotationMatrixV3(geometry.sourceToOutput)
    const normalized = current.points.map(p => { const source = mapAnnotationPointV3(inverse, p); return { x: Math.max(0, Math.min(1, source[0] / controller.document.geometry.width)), y: Math.max(0, Math.min(1, source[1] / controller.document.geometry.height)) } })
    if (current.tool === 'select-subject' || current.tool === 'select-subject-box') {
      const a = normalized[0], b = normalized.at(-1)!
      if (current.tool === 'select-subject') void subject?.run({ kind: 'point', points: [{ ...a, foreground: true }] })
      else if (Math.abs(a.x - b.x) > 0 && Math.abs(a.y - b.y) > 0) void subject?.run({ kind: 'box', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) })
      cancel(); return
    }
    if (current.tool === 'repair') {
      if (!bus.getSnapshot().selection) { setError(t('imageEditor.v3.repair.select-first')); cancel(); return }
      const a = normalized[0], b = normalized.at(-1)!
      void repair?.run({ action: 'repair', sourceOffset: { x: b.x - a.x, y: b.y - a.y } })
      cancel(); return
    }
    let shape: ImageEditSelectionIntentShapeV3
    if (current.tool === 'select-brush' || current.tool === 'remove') shape = { type: 'brush', points: normalized, radius: Math.min(1, (session?.toolSettings.brushSize ?? 32) / 2 / Math.min(controller.document.geometry.width, controller.document.geometry.height)) }
    else if (current.tool === 'select-lasso' || current.tool === 'select-polygon') {
      if (normalized.length < 3) { cancel(); return }
      shape = { type: 'lasso', points: normalized }
    } else {
      const a = normalized[0], b = normalized.at(-1)!
      if (Math.abs(a.x - b.x) * geometry.width < 0.5 || Math.abs(a.y - b.y) * geometry.height < 0.5) { cancel(); return }
      // 输出矩形经旋转/镜像后仍是源轴对齐矩形；旋转仅支持正交文档方向。
      shape = { type: current.tool === 'select-ellipse' ? 'ellipse' : 'rectangle', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
    }
    if (current.tool === 'remove') void repair?.run({ action: 'remove', selection: appendImageEditSelectionV3(null, shape, 'replace') })
    else bus.setSelection(appendImageEditSelectionV3(bus.getSnapshot().selection, shape, session?.toolSettings.selectionCombineMode ?? 'replace'))
    cancel()
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    if (!active || event.button !== 0) return
    setError(null)
    if (tool === 'repair') {
      if (!snapshot.selection) { setError(t('imageEditor.v3.repair.select-first')); return }
      const context = canvas.current?.getContext('2d'), p = point(event)
      if (context && canvas.current && !context.getImageData(Math.min(canvas.current.width - 1, Math.max(0, Math.floor(p[0] / geometry.width * canvas.current.width))), Math.min(canvas.current.height - 1, Math.max(0, Math.floor(p[1] / geometry.height * canvas.current.height))), 1, 1).data[3]) return
    }
    if (tool === 'select-polygon' && gesture.current) { gesture.current.points.push(point(event)); setDraft([...gesture.current.points]); return }
    gesture.current = { tool, points: [point(event)], revision: controller.document.revision, selectionRevision: snapshot.selectionRevision,
      ...(tool !== 'select-polygon' ? { pointer: captureEditorPointerV3(event.currentTarget, event.pointerId) } : {}) }
    setDraft([...gesture.current.points]); event.preventDefault()
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current
    if (!current?.pointer || current.pointer.pointerId !== event.pointerId) return
    const p = point(event)
    if (tool === 'select-rect' || tool === 'select-ellipse' || tool === 'select-subject-box' || tool === 'repair') current.points = [current.points[0], p]
    else {
      const rect = event.currentTarget.getBoundingClientRect()
      const samples = event.nativeEvent.getCoalescedEvents?.() ?? []
      for (const sample of [...samples, event.nativeEvent]) {
        const next = [(sample.clientX - rect.left) / rect.width * geometry.width, (sample.clientY - rect.top) / rect.height * geometry.height] as const
        if (Math.hypot(next[0] - current.points.at(-1)![0], next[1] - current.points.at(-1)![1]) * rect.width / geometry.width >= 1.5) current.points.push(next)
      }
    }
    if (draftFrame.current === null) draftFrame.current = requestAnimationFrame(() => { draftFrame.current = null; if (gesture.current) setDraft([...gesture.current.points]) })
  }
  const first = draft[0], last = draft.at(-1)
  return <>
    <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full opacity-30" data-independent-selection />
    <canvas ref={sourceCanvas} className={`pointer-events-none absolute inset-0 h-full w-full opacity-30 ${tool === 'repair' && first && last ? '' : 'hidden'}`}
      style={{ transform: first && last ? `translate(${(last[0] - first[0]) / geometry.width * 100}%, ${(last[1] - first[1]) / geometry.height * 100}%)` : undefined }} data-repair-source />
    {/* icon-token-allow: 数据驱动的选区几何预览，不是图标。 */}
    <svg ref={svg} viewBox={`0 0 ${geometry.width} ${geometry.height}`} preserveAspectRatio="none" aria-label={t('imageEditor.v3.selection.overlay')}
      className={`absolute inset-0 h-full w-full touch-none ${active ? 'pointer-events-auto' : 'pointer-events-none'}`}
      onPointerDown={down} onPointerMove={move} onPointerUp={e => { if (tool !== 'select-polygon' && gesture.current?.pointer?.pointerId === e.pointerId) { move(e); finish() } }}
      onDoubleClick={() => { if (tool === 'select-polygon') finish() }} onPointerCancel={cancel} onLostPointerCapture={cancel}>
      {subject?.candidates.map((candidate, index) => {
        const b = candidate.bounds
        const points = [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]].map(([x, y]) => mapAnnotationPointV3(geometry.sourceToOutput, [x * controller.document.geometry.width, y * controller.document.geometry.height]))
        return <g key={candidate.id} className="pointer-events-none"><polygon points={points.map(p => p.join(',')).join(' ')} className="fill-none stroke-accent-text" /><text x={points[0][0]} y={points[0][1]} className="fill-accent-text text-xs">{index + 1}</text></g>
      })}
      {first && last ? tool === 'select-rect' || tool === 'select-subject-box' ? <rect x={Math.min(first[0], last[0])} y={Math.min(first[1], last[1])} width={Math.abs(first[0] - last[0])} height={Math.abs(first[1] - last[1])} className="fill-accent/10 stroke-accent-text" />
        : tool === 'select-ellipse' ? <ellipse cx={(first[0] + last[0]) / 2} cy={(first[1] + last[1]) / 2} rx={Math.abs(first[0] - last[0]) / 2} ry={Math.abs(first[1] - last[1]) / 2} className="fill-accent/10 stroke-accent-text" />
          : <polyline points={draft.map(p => p.join(',')).join(' ')} className="fill-none stroke-accent-text" strokeWidth={tool === 'select-brush' || tool === 'remove' ? session?.toolSettings.brushSize : 1.5} strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
    {error ? <div className="absolute left-3 top-3"><UiError message={error} /></div> : null}
  </>
}
