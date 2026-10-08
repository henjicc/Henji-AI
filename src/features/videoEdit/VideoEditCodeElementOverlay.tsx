import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { codeElementFramePolygon, codeElementLabel } from '@/core/videoEdit/codeElementSelection'
import { hitVideoEditCodeElement, selectedVideoEditCodeElement, selectVideoEditCodeElement, videoEditCodeElementFrames, videoEditProgramClipAt } from './application/videoEditCodeElements'
import { getActiveVideoEditSequence, setVideoEditView, subscribeVideoEditView, videoEditViewRevision, subscribeVideoEditDomain, videoEditDomainRevision, type VideoEditInstance } from './application/videoEditService'
import { getVideoEditMaskEditing, subscribeVideoEditMaskEditing, videoEditMaskEditingRevision } from './application/videoEditMaskEditing'
import { getVideoEditTrackingEditing, subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision } from './application/videoEditTrackingEditing'
import { VideoEditCodeElementEditOverlay } from './VideoEditCodeElementEditOverlay'

export function VideoEditCodeElementOverlay({ instance, enabled, onError }: { instance: VideoEditInstance; enabled: boolean; onError: (error: unknown) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  useSyncExternalStore(subscribeVideoEditMaskEditing, videoEditMaskEditingRevision)
  useSyncExternalStore(subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision)
  const sequence = getActiveVideoEditSequence(instance)
  const blocked = [getVideoEditMaskEditing(), getVideoEditTrackingEditing()].some(target => target?.projectId === instance.document.id && target.sequenceId === sequence.id && sequence.clips.some(clip => clip.id === target.clipId && instance.frame >= clip.start && instance.frame < clip.start + clip.duration))
  const available = enabled && !blocked
  const root = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ clipId: string; elementId: string } | null>(null)
  const last = useRef<{ x: number; y: number; frame: number; sequenceId: string; document: object }>()
  let selected: ReturnType<typeof selectedVideoEditCodeElement>
  let entries: ReturnType<typeof videoEditCodeElementFrames> = new Map()
  let failure: unknown
  try { if (available && !instance.playing && (hover || instance.selectedCodeElement)) { entries = videoEditCodeElementFrames(instance); selected = selectedVideoEditCodeElement(instance) } } catch (error) { failure = error }
  const errorRef = useRef(onError); errorRef.current = onError
  useEffect(() => { if (failure) errorRef.current(failure) }, [failure])
  useEffect(() => {
    const host = root.current?.parentElement
    if (!host || !available) { setHover(null); return }
    const point = (event: PointerEvent): { x: number; y: number } => { const rect = host.getBoundingClientRect(); return { x: (event.clientX - rect.left) / Math.max(1, rect.width), y: (event.clientY - rect.top) / Math.max(1, rect.height) } }
    const down = (event: PointerEvent): void => {
      if (instance.playing || instance.tool !== 'select' || event.button !== 0) return
      const target = event.target as Element | null
      if (target?.closest?.('button,input,textarea,[role="textbox"],[data-code-element-edit]')) return
      try {
        const at = point(event); const old = last.current
        const repeated = Boolean(old && old.document === instance.document && old.frame === instance.frame && old.sequenceId === instance.activeSequenceId && Math.hypot(old.x - event.clientX, old.y - event.clientY) <= 4)
        const hit = hitVideoEditCodeElement(instance, at, event.altKey || repeated)
        last.current = { x: event.clientX, y: event.clientY, frame: instance.frame, sequenceId: instance.activeSequenceId, document: instance.document }
        if (!hit) {
          const clip = videoEditProgramClipAt(instance, at)?.clip
          if (clip?.kind === 'code') { selectVideoEditCodeElement(instance, clip.id, null); event.stopPropagation() }
          else if (clip?.kind !== 'text') setVideoEditView(instance.document.id, { selection: clip?.id ?? null, selectedCodeElement: null })
          return
        }
        const active = host.ownerDocument.activeElement as HTMLElement | null
        if (active?.matches('input,textarea,select,[contenteditable="true"]')) active.blur()
        selectVideoEditCodeElement(instance, hit.clipId, hit.element.elementId)
        event.stopPropagation(); event.preventDefault()
      } catch (error) { errorRef.current(error) }
    }
    const move = (event: PointerEvent): void => {
      if (instance.playing || instance.tool !== 'select' || event.buttons) { setHover(null); return }
      try {
        const hit = hitVideoEditCodeElement(instance, point(event))
        setHover(previous => previous?.clipId === hit?.clipId && previous?.elementId === hit?.element.elementId ? previous : hit ? { clipId: hit.clipId, elementId: hit.element.elementId } : null)
      } catch (error) { setHover(null); errorRef.current(error) }
    }
    const leave = (): void => setHover(null)
    host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true); host.addEventListener('pointerleave', leave)
    return () => { host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true); host.removeEventListener('pointerleave', leave) }
  }, [instance, available])
  const entry = hover ? entries.get(hover.clipId) : undefined; const hovered = entry?.index.byId.get(hover?.elementId ?? '')
  const shapes = entry && hovered && hovered !== selected?.element ? [{ entry, element: hovered }] : []
  return <div ref={root} aria-label="代码元素选择层" className="pointer-events-none absolute inset-0">
    {available && selected && !instance.playing && <VideoEditCodeElementEditOverlay key={`${selected.entry.clip.id}:${selected.element.elementId}`} instance={instance} selected={selected} onError={onError} />}
    {/* icon-token-allow: 元素选框是作者画布几何经片段变换后的轮廓，不是界面图标。 */}
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" fill="none" aria-hidden>
      {shapes.map(shape => <polygon key={`${shape.entry.clip.id}:${shape.element.elementId}`} data-code-element-hover points={codeElementFramePolygon(shape.element, shape.entry.clip, shape.entry.picture, sequence).map(point => `${point.x * 1000},${point.y * 1000}`).join(' ')} className="stroke-accent opacity-40" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
    </svg>
    {selected && (() => { const point = codeElementFramePolygon(selected.element, selected.entry.clip, selected.entry.picture, sequence)[0]; return <span data-code-element-label className="absolute max-w-full truncate rounded-control bg-media-scrim px-1.5 py-0.5 text-xs text-on-media" style={{ left: `${Math.max(0, Math.min(.85, point.x)) * 100}%`, top: `${Math.max(0, Math.min(.9, point.y)) * 100}%` }}>{codeElementLabel(selected.element)}</span> })()}
  </div>
}
