import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { videoEditVisibleTracks, type VideoEditClip } from '@/core/videoEdit/document'
import { evaluateVideoEditClip } from '@/core/videoEdit/keyframes'
import { videoEditClipToFrame } from '@/core/videoEdit/clipGeometry'
import { layoutVideoEditText, resizeVideoEditText, videoEditTextPoint, type VideoEditTextLayout } from '@/core/videoEdit/text'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { addVideoEditProgramText } from '../application/videoEditProgramText'
import { updateVideoEditClipProperties } from '../application/videoEditClipProperties'
import { beginVideoEditGesture, finishVideoEditGesture, getActiveVideoEditSequence, setVideoEditView, setVideoEditTimelineView, subscribeVideoEditDomain, subscribeVideoEditView, videoEditDomainRevision, videoEditViewRevision, videoEditProgramCommandIdentity, type VideoEditGesture, type VideoEditInstance } from '../application/videoEditService'
import { getVideoEditMaskEditing, setVideoEditMaskEditing, subscribeVideoEditMaskEditing, videoEditMaskEditingRevision } from '../application/videoEditMaskEditing'
import { getVideoEditTrackingEditing, setVideoEditTrackingEditing, subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision } from '../application/videoEditTrackingEditing'

interface TextSession { clipId: string; sequenceId: string; frame: number; tool: string; command: object; gesture: VideoEditGesture }
interface TextDrag { pointerId: number; start: { x: number; y: number }; clip?: VideoEditClip; corner?: number; layout?: VideoEditTextLayout; session?: TextSession; sequenceId: string; frame: number; document: object }

/** A native plaintext editor provides IME and caret handling; text truth and history stay in the clip domain. */
export function VideoEditTextOverlay({ instance, onError, enabled = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; enabled?: boolean }): React.ReactElement | null {
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  useSyncExternalStore(subscribeVideoEditMaskEditing, videoEditMaskEditingRevision)
  useSyncExternalStore(subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision)
  const root = useRef<HTMLDivElement>(null); const editor = useRef<HTMLDivElement>(null)
  const editing = useRef<TextSession>(); const dragging = useRef<TextDrag>()
  const [editingId, setEditingId] = useState<string>(); const [draftBox, setDraftBox] = useState<{ x: number; y: number; width: number; height: number }>()
  const layoutCache = useRef(new Map<string, { key: string; layout: VideoEditTextLayout }>())
  const sequence = getActiveVideoEditSequence(instance)
  const mask = getVideoEditMaskEditing(); const tracking = getVideoEditTrackingEditing()
  const blocked = [mask, tracking].some(target => target?.projectId === instance.document.id && target.sequenceId === sequence.id && sequence.clips.some(clip => clip.id === target.clipId && instance.frame >= clip.start && instance.frame < clip.start + clip.duration))
  const available = enabled && !blocked && (instance.tool === 'type' || instance.tool === 'select' && !instance.playing)
  const finish = (commit = true): void => {
    const session = editing.current; editing.current = undefined; setEditingId(undefined)
    if (session) finishVideoEditGesture(session.gesture, commit)
  }
  const cancelDrag = (): void => { const value = dragging.current; dragging.current = undefined; setDraftBox(undefined); if (value?.session) finishVideoEditGesture(value.session.gesture, false) }
  const valid = (session: TextSession): boolean => instance.activeSequenceId === session.sequenceId && instance.selection === session.clipId && instance.frame === session.frame && instance.tool === session.tool && !instance.playing && videoEditProgramCommandIdentity(instance.document.id) === session.command
  const session = (clipId: string): TextSession => ({ clipId, sequenceId: sequence.id, frame: instance.frame, tool: instance.tool, command: videoEditProgramCommandIdentity(instance.document.id), gesture: beginVideoEditGesture(instance.document.id) })
  const beginEditing = (clipId: string): void => {
    try {
      finish(); cancelDrag(); setVideoEditView(instance.document.id, { playing: false })
      setVideoEditTimelineView(instance.document.id, { selectedClipIds: [clipId] }, clipId)
      editing.current = session(clipId); setEditingId(clipId)
    } catch (error) { onError(error) }
  }
  useEffect(() => {
    // Choosing T claims the monitor; choosing a mask/tracker later suppresses this overlay immediately.
    if (enabled && instance.tool === 'type') { setVideoEditMaskEditing(null); setVideoEditTrackingEditing(null) }
  }, [instance, instance.tool, enabled])
  useLayoutEffect(() => {
    if (!editingId || !editor.current) return
    editor.current.textContent = getActiveVideoEditSequence(instance).clips.find(clip => clip.id === editingId)?.text ?? ''
    editor.current.focus()
    const range = editor.current.ownerDocument.createRange(); range.selectNodeContents(editor.current); range.collapse(false)
    const selection = ownerWindowOf(editor.current).getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
  }, [editingId, instance])
  useEffect(() => {
    const check = (): void => {
      const active = editing.current
      if (active && !valid(active)) finish(instance.activeSequenceId === active.sequenceId && instance.selection === active.clipId && instance.frame === active.frame && !instance.playing && videoEditProgramCommandIdentity(instance.document.id) === active.command)
      const drag = dragging.current
      if (drag && (instance.activeSequenceId !== drag.sequenceId || instance.frame !== drag.frame || instance.playing || drag.session && !valid(drag.session))) cancelDrag()
    }
    const unsubscribe = subscribeVideoEditView(check)
    return () => { unsubscribe(); finish(false); cancelDrag() }
    // Sessions read the stable owner; do not restart a gesture on each preview publication.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance])
  useEffect(() => {
    if (!available) { finish(); cancelDrag() }
  }, [available])
  useEffect(() => {
    const target = root.current && ownerWindowOf(root.current); if (!target) return
    const blur = (): void => { finish(); cancelDrag() }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.isComposing && (editing.current || dragging.current)) { event.preventDefault(); event.stopPropagation(); finish(); cancelDrag() }
    }
    target.addEventListener('blur', blur); target.addEventListener('keydown', key)
    return () => { target.removeEventListener('blur', blur); target.removeEventListener('keydown', key) }
  }, [available])
  const point = (event: PointerEvent): { x: number; y: number } => videoEditTextPoint({ x: event.clientX, y: event.clientY }, root.current!.getBoundingClientRect(), !dragging.current?.clip)
  const down = (event: PointerEvent<HTMLDivElement>, clip?: VideoEditClip, corner?: number, layout?: VideoEditTextLayout): void => {
    if (!available || event.button !== 0 || editing.current?.clipId === clip?.id && editing.current) return
    event.stopPropagation()
    try {
      const wasEditing = Boolean(editing.current)
      const active = root.current?.ownerDocument.activeElement
      // Finish an inspector field's blur transaction before the monitor takes its own gesture.
      if (active?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) (active as HTMLElement).blur()
      finish(); cancelDrag()
      if (!clip && (wasEditing || instance.tool !== 'type')) return
      if (instance.playing) setVideoEditView(instance.document.id, { playing: false })
      if (clip && instance.tool === 'type' && corner === undefined) { beginEditing(clip.id); return }
      if (clip) setVideoEditTimelineView(instance.document.id, { selectedClipIds: [clip.id] }, clip.id)
      dragging.current = { pointerId: event.pointerId, start: point(event), clip, corner, layout, ...(clip ? { session: session(clip.id) } : {}), sequenceId: sequence.id, frame: instance.frame, document: instance.document }
      root.current!.setPointerCapture(event.pointerId); event.preventDefault()
    } catch (error) { cancelDrag(); onError(error) }
  }
  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragging.current; if (!drag || event.pointerId !== drag.pointerId) return
    try {
      const current = point(event)
      if (drag.clip && drag.session) {
        if (!valid(drag.session)) { cancelDrag(); return }
        const patch = drag.corner !== undefined && drag.layout ? resizeVideoEditText(drag.clip, sequence, drag.layout, drag.corner, current) : { x: Math.max(-2, Math.min(2, drag.clip.x + current.x - drag.start.x)), y: Math.max(-2, Math.min(2, drag.clip.y + current.y - drag.start.y)) }
        updateVideoEditClipProperties(instance.document.id, drag.sequenceId, drag.clip.id, patch, drag.session.gesture)
      } else setDraftBox({ x: Math.min(current.x, drag.start.x), y: Math.min(current.y, drag.start.y), width: Math.abs(current.x - drag.start.x), height: Math.abs(current.y - drag.start.y) })
    } catch (error) { cancelDrag(); onError(error) }
  }
  const up = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragging.current; if (!drag || event.pointerId !== drag.pointerId) return
    move(event); if (!dragging.current) return
    dragging.current = undefined; setDraftBox(undefined)
    try {
      if (drag.session) { finishVideoEditGesture(drag.session.gesture); return }
      if (instance.document !== drag.document || instance.activeSequenceId !== drag.sequenceId || instance.frame !== drag.frame || instance.tool !== 'type') return
      const end = point(event); const rect = root.current!.getBoundingClientRect()
      const paragraph = Math.abs(end.x - drag.start.x) * rect.width > 4 && Math.abs(end.y - drag.start.y) * rect.height > 4
      const start = paragraph ? { x: Math.min(end.x, drag.start.x), y: Math.min(end.y, drag.start.y) } : drag.start
      beginEditing(addVideoEditProgramText(instance, start, paragraph ? Math.abs(end.x - drag.start.x) : 0))
    } catch (error) { onError(error) }
  }
  if (!available) return null
  const visibleTracks = videoEditVisibleTracks(sequence)
  const clips = sequence.clips.filter(clip => clip.kind === 'text' && instance.frame >= clip.start && instance.frame < clip.start + clip.duration && visibleTracks.has(clip.track) && sequence.tracks.some(track => track.index === clip.track && !track.locked)).sort((a, b) => a.track - b.track).map(clip => evaluateVideoEditClip(clip, instance.frame))
  const activeIds = new Set(clips.map(clip => clip.id))
  for (const id of layoutCache.current.keys()) if (!activeIds.has(id)) layoutCache.current.delete(id)
  let context: CanvasRenderingContext2D | null | undefined
  const measure = (text: string, font: string): number => {
    if (context === undefined) context = (root.current?.ownerDocument ?? window.document).createElement('canvas').getContext('2d')
    if (!context) return 0
    context.font = font; return context.measureText(text).width
  }
  return <div ref={root} className={`absolute inset-0 ${instance.tool === 'type' || editingId ? 'pointer-events-auto cursor-text' : 'pointer-events-none'}`} style={{ containerType: 'size' }} aria-label="节目文字工具" data-video-edit-text-overlay onPointerDown={event => down(event)} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
    {clips.map(clip => {
      const key = JSON.stringify([clip.text, clip.textStyle, sequence.width, sequence.height])
      const cached = layoutCache.current.get(clip.id)
      const layout = cached?.key === key ? cached.layout : layoutVideoEditText(clip, sequence, measure)
      layoutCache.current.set(clip.id, { key, layout })
      const selected = instance.selection === clip.id; const editable = editingId === clip.id
      const center = videoEditClipToFrame(clip, sequence, sequence, .5, .5)
      return <div key={clip.id} className="pointer-events-none absolute inset-0" style={{ transform: `translate(${(center.x - .5) * 100}%, ${(center.y - .5) * 100}%) rotate(${clip.rotation}deg) scale(${clip.scale})` }}>
        {/* ui-surface-allow: 文字内容的命中框与控制柄按序列像素换算，不是通用界面控件外观。 */}
        <div className={`pointer-events-auto absolute ${selected ? 'outline outline-1 outline-accent' : ''} ${editable ? 'cursor-text' : 'cursor-move'}`} data-video-edit-text-clip={clip.id} style={{ left: `${layout.left / sequence.width * 100}%`, top: `${layout.top / sequence.height * 100}%`, width: `${layout.width / sequence.width * 100}%`, height: `${layout.height / sequence.height * 100}%` }} onPointerDown={event => down(event, clip, undefined, layout)} onDoubleClick={event => { event.stopPropagation(); beginEditing(clip.id) }}>
          {editable && <div ref={editor} role="textbox" aria-label="就地编辑文字" aria-multiline contentEditable="plaintext-only" suppressContentEditableWarning className="h-full w-full break-all text-transparent outline-none" style={{ whiteSpace: layout.style.boxWidth ? 'pre-wrap' : 'pre', fontFamily: layout.style.fontFamily, fontSize: `calc(100cqw * ${layout.style.fontSize / sequence.width})`, lineHeight: `calc(100cqw * ${layout.lineHeight / sequence.width})`, textAlign: layout.style.align, caretColor: 'var(--on-media)' }} onPointerDown={event => event.stopPropagation()} onInput={event => {
            const active = editing.current; if (!active || !valid(active)) return
            try {
              const raw = event.currentTarget.innerText ?? event.currentTarget.textContent ?? ''; let text = raw.slice(0, 2000)
              if (raw.length > 2000) {
                if (/^[\uD800-\uDBFF]$/.test(text.at(-1) ?? '')) text = text.slice(0, -1)
                event.currentTarget.textContent = text
                const range = event.currentTarget.ownerDocument.createRange(); range.selectNodeContents(event.currentTarget); range.collapse(false)
                const selection = ownerWindowOf(event.currentTarget).getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
              }
              updateVideoEditClipProperties(instance.document.id, active.sequenceId, active.clipId, { text }, active.gesture)
            } catch (error) { finish(false); onError(error) }
          }} onBlur={() => finish()} onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); finish() } }} />}
          {selected && !editable && [0, 1, 2, 3].map(corner => <div key={corner} role="presentation" className="pointer-events-auto absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 border border-accent bg-on-media" data-video-edit-text-handle={corner} style={{ left: `${corner === 1 || corner === 2 ? 100 : 0}%`, top: `${corner >= 2 ? 100 : 0}%`, cursor: corner % 2 ? 'nesw-resize' : 'nwse-resize' }} onPointerDown={event => down(event, clip, corner, layout)} />)}
        </div>
      </div>
    })}
    {draftBox && <div className="pointer-events-none absolute border border-accent" style={{ left: `${draftBox.x * 100}%`, top: `${draftBox.y * 100}%`, width: `${draftBox.width * 100}%`, height: `${draftBox.height * 100}%` }} />}
  </div>
}
