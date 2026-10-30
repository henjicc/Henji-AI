import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { videoEditPictureFilter, type VideoEditClip } from '@/core/videoEdit/document'
import { evaluateVideoEditClip } from '@/core/videoEdit/keyframes'
import { videoEditClipToFrame } from '@/core/videoEdit/clipGeometry'
import { layoutVideoEditText, videoEditTextWidth, resizeVideoEditText, videoEditTextPoint, type VideoEditTextLayout } from '@/core/videoEdit/text'
import { useTranslation } from 'react-i18next'
import { videoEditCaptionTextTargets, captionTextLocked, type CaptionTextTarget } from './videoEditCaptionTextTargets'
import { selectVideoEditSubtitle, selectedVideoEditSubtitleId, subscribeVideoEditSubtitleSelection, videoEditSubtitleSelectionRevision } from '../application/videoEditSubtitleSelection'
import { updateVideoEditTimedContent } from '../application/videoEditTimedContent'
import { ownerWindowOf } from '@/utils/crossRealmDom'
import { addVideoEditProgramText } from '../application/videoEditProgramText'
import { updateVideoEditClipProperties } from '../application/videoEditClipProperties'
import { beginVideoEditGesture, finishVideoEditGesture, getActiveVideoEditSequence, setVideoEditView, setVideoEditTimelineView, subscribeVideoEditDomain, subscribeVideoEditView, videoEditDomainRevision, videoEditProgramCommandIdentity, videoEditRevision, type VideoEditGesture, type VideoEditInstance } from '../application/videoEditService'
import { getVideoEditMaskEditing, setVideoEditMaskEditing, subscribeVideoEditMaskEditing, videoEditMaskEditingRevision } from '../application/videoEditMaskEditing'
import { getVideoEditTrackingEditing, setVideoEditTrackingEditing, subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision } from '../application/videoEditTrackingEditing'
import { sameVideoEditViewFields, useVideoEditViewSelector } from '../application/useVideoEditViewSelector'

interface TextSession { caption?: Pick<CaptionTextTarget, 'captionId' | 'field'>; clipId: string; sequenceId: string; frame: number; tool: string; command: object; gesture: VideoEditGesture }
interface TextDrag { pointerId: number; start: { x: number; y: number }; clip?: VideoEditClip; corner?: number; layout?: VideoEditTextLayout; session?: TextSession; sequenceId: string; frame: number; document: object }

/** A native plaintext editor provides IME and caret handling; text truth and history stay in the clip domain. */
export function VideoEditTextOverlay({ instance, onError, enabled = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; enabled?: boolean }): React.ReactElement | null {
  const { t } = useTranslation('ui')
  useSyncExternalStore(subscribeVideoEditSubtitleSelection, videoEditSubtitleSelectionRevision)
  useSyncExternalStore(subscribeVideoEditDomain, videoEditDomainRevision)
  // 拖动播放头时不逐帧排版：拖动中不放命中目标，松手（scrubbing 变回 false）时按最终帧补一次。
  // 播放中仍逐帧计算字幕命中，以便播放中点选字幕。
  useVideoEditViewSelector(() => [videoEditRevision(), instance.scrubbing ? null : instance.frame, instance.playing, Boolean(instance.scrubbing)], sameVideoEditViewFields)
  useSyncExternalStore(subscribeVideoEditMaskEditing, videoEditMaskEditingRevision)
  useSyncExternalStore(subscribeVideoEditTrackingEditing, videoEditTrackingEditingRevision)
  const root = useRef<HTMLDivElement>(null); const editor = useRef<HTMLDivElement>(null)
  const errors = useRef(onError); errors.current = onError
  const caret = useRef<{ x: number; y: number }>();
  const editing = useRef<TextSession>(); const dragging = useRef<TextDrag>()
  const [editingId, setEditingId] = useState<string>(); const [draftBox, setDraftBox] = useState<{ x: number; y: number; width: number; height: number }>()
  const layoutCache = useRef(new Map<string, { key: string; layout: VideoEditTextLayout }>())
  const sequence = getActiveVideoEditSequence(instance)
  const mask = getVideoEditMaskEditing(); const tracking = getVideoEditTrackingEditing()
  const blocked = [mask, tracking].some(target => target?.projectId === instance.document.id && target.sequenceId === sequence.id && sequence.clips.some(clip => clip.id === target.clipId && instance.frame >= clip.start && instance.frame < clip.start + clip.duration))
  const available = enabled && !blocked && (instance.tool === 'type' || instance.tool === 'select')
  const finish = useCallback((commit = true): void => {
    const session = editing.current; editing.current = undefined; setEditingId(undefined)
    if (session) { try {
      if (commit && session.caption && editor.current) {
        const text = editor.current.innerText ?? editor.current.textContent ?? ''
        if (session.caption.field === 'text' && !text.trim()) commit = false
        else updateVideoEditTimedContent(instance.document.id, session.sequenceId, 'caption', session.caption.captionId, { [session.caption.field]: text }, session.gesture)
      }
      finishVideoEditGesture(session.gesture, commit) } catch (error) { finishVideoEditGesture(session.gesture, false); errors.current(error) } }
  }, [instance])
  const cancelDrag = (): void => { const value = dragging.current; dragging.current = undefined; setDraftBox(undefined); if (value?.session) finishVideoEditGesture(value.session.gesture, false) }
  const valid = (session: TextSession): boolean => instance.activeSequenceId === session.sequenceId && (session.caption ? selectedVideoEditSubtitleId(instance) === session.caption.captionId && Boolean(getActiveVideoEditSequence(instance).captions?.some(value => value.id === session.caption?.captionId && !captionTextLocked(value))) : instance.selection === session.clipId) && instance.frame === session.frame && instance.tool === session.tool && !instance.playing && videoEditProgramCommandIdentity(instance.document.id) === session.command
  const session = (clipId: string): TextSession => ({ clipId, sequenceId: sequence.id, frame: instance.frame, tool: instance.tool, command: videoEditProgramCommandIdentity(instance.document.id), gesture: beginVideoEditGesture(instance.document.id) })
  const beginEditing = (clipId: string, caption?: CaptionTextTarget, position?: { x: number; y: number }): void => {
    try {
      finish(); cancelDrag(); setVideoEditView(instance.document.id, { playing: false })
      if (caption) selectVideoEditSubtitle(instance.document.id, sequence.id, caption.captionId)
      else setVideoEditTimelineView(instance.document.id, { selectedClipIds: [clipId] }, clipId)
      caret.current = position
      editing.current = { ...session(clipId), caption }; setEditingId(clipId)
    } catch (error) { onError(error) }
  }
  useEffect(() => {
    // Choosing T claims the monitor; choosing a mask/tracker later suppresses this overlay immediately.
    if (enabled && instance.tool === 'type') { setVideoEditMaskEditing(null); setVideoEditTrackingEditing(null) }
  }, [instance, instance.tool, enabled])
  useLayoutEffect(() => {
    if (!editingId || !editor.current) return
    const target = editing.current?.caption
    editor.current.textContent = target ? getActiveVideoEditSequence(instance).captions?.find(value => value.id === target.captionId)?.[target.field] ?? '' : getActiveVideoEditSequence(instance).clips.find(clip => clip.id === editingId)?.text ?? ''
    editor.current.focus()
    const doc = editor.current.ownerDocument
    const atPoint = caret.current && doc.caretRangeFromPoint?.(caret.current.x, caret.current.y)
    const range = atPoint && editor.current.contains(atPoint.startContainer) ? atPoint : doc.createRange()
    if (range !== atPoint) { range.selectNodeContents(editor.current); range.collapse(false) }
    caret.current = undefined
    const selection = ownerWindowOf(editor.current).getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
  }, [editingId, instance])
  useEffect(() => {
    const check = (): void => {
      const active = editing.current
      if (active && !valid(active)) finish(instance.activeSequenceId === active.sequenceId && (active.caption ? selectedVideoEditSubtitleId(instance) === active.caption.captionId : instance.selection === active.clipId) && instance.frame === active.frame && !instance.playing && videoEditProgramCommandIdentity(instance.document.id) === active.command)
      const drag = dragging.current
      if (drag && (instance.activeSequenceId !== drag.sequenceId || instance.frame !== drag.frame || instance.playing || drag.session && !valid(drag.session))) cancelDrag()
    }
    const unsubscribe = subscribeVideoEditView(check); const unsubscribeCaption = subscribeVideoEditSubtitleSelection(check)
    return () => { unsubscribe(); unsubscribeCaption(); finish(false); cancelDrag() }
    // Sessions read the stable owner; do not restart a gesture on each preview publication.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance])
  useEffect(() => {
    if (!available) { finish(); cancelDrag() }
  }, [available, finish])
  useEffect(() => {
    const target = root.current && ownerWindowOf(root.current); if (!target) return
    const blur = (): void => { finish(); cancelDrag() }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.isComposing && (editing.current || dragging.current)) { event.preventDefault(); event.stopPropagation(); finish(!editing.current?.caption); cancelDrag() }
    }
    target.addEventListener('blur', blur); target.addEventListener('keydown', key)
    return () => { target.removeEventListener('blur', blur); target.removeEventListener('keydown', key) }
  }, [available, finish])
  const point = (event: PointerEvent): { x: number; y: number } => videoEditTextPoint({ x: event.clientX, y: event.clientY }, root.current!.getBoundingClientRect(), !dragging.current?.clip)
  const down = (event: PointerEvent<HTMLDivElement>, clip?: VideoEditClip, corner?: number, layout?: VideoEditTextLayout, caption?: CaptionTextTarget): void => {
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
      if (caption) { selectVideoEditSubtitle(instance.document.id, sequence.id, caption.captionId); event.currentTarget.focus(); event.preventDefault(); return }
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
  const scrubbing = Boolean(instance.scrubbing)
  const picture = videoEditPictureFilter(sequence)
  const clips = sequence.clips.filter(clip => !instance.playing && !scrubbing && clip.kind === 'text' && instance.frame >= clip.start && instance.frame < clip.start + clip.duration && picture.has(clip) && sequence.tracks.some(track => track.index === clip.track && !track.locked)).sort((a, b) => a.track - b.track).map(clip => evaluateVideoEditClip(clip, instance.frame))
  const activeIds = new Set(clips.map(clip => clip.id))
  for (const id of layoutCache.current.keys()) if (!activeIds.has(id)) layoutCache.current.delete(id)
  let context: CanvasRenderingContext2D | null | undefined
  const measure = (text: string, font: string): number => {
    if (context === undefined) context = (root.current?.ownerDocument ?? window.document).createElement('canvas').getContext('2d')
    if (!context) return 0
    context.font = font; return context.measureText(text).width
  }
  const captions = scrubbing ? [] : videoEditCaptionTextTargets(sequence, instance.frame, measure)
  const targets = [...clips.map(clip => ({ clip, caption: undefined as CaptionTextTarget | undefined })), ...captions.map(caption => ({ clip: caption.clip, caption }))]
  return <div ref={root} className={`absolute inset-0 ${instance.tool === 'type' || editingId ? 'pointer-events-auto cursor-text' : 'pointer-events-none'}`} style={{ containerType: 'size' }} aria-label="节目文字工具" data-video-edit-text-overlay onPointerDown={event => down(event)} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
    {targets.map(({ clip, caption }) => {
      const key = JSON.stringify([clip.text, clip.textStyle, sequence.width, sequence.height])
      const cached = layoutCache.current.get(clip.id)
      const layout = caption?.layout ?? (cached?.key === key ? cached.layout : layoutVideoEditText(clip, sequence, measure))
      layoutCache.current.set(clip.id, { key, layout })
      const selected = caption ? selectedVideoEditSubtitleId(instance) === caption.captionId : instance.selection === clip.id; const editable = editingId === clip.id
      const center = videoEditClipToFrame(clip, sequence, sequence, .5, .5)
      return <div key={clip.id} className="pointer-events-none absolute inset-0" style={{ transform: `translate(${(center.x - .5) * 100}%, ${(center.y - .5) * 100}%) rotate(${clip.rotation}deg) scale(${clip.scale})` }}>
        <div className={`${caption && !editable ? 'pointer-events-none' : 'pointer-events-auto'} absolute ${editable || caption ? 'cursor-text' : 'cursor-move'}`} data-video-edit-text-clip={clip.id} data-video-edit-caption={caption?.captionId} data-caption-field={caption?.field} tabIndex={0} style={{ left: `${layout.left / sequence.width * 100}%`, top: `${layout.top / sequence.height * 100}%`, width: `${layout.width / sequence.width * 100}%`, height: `${layout.height / sequence.height * 100}%` }} onPointerDown={event => down(event, clip, undefined, layout, caption)} onDoubleClick={event => { event.stopPropagation(); beginEditing(clip.id, caption, { x: event.clientX, y: event.clientY }) }} onKeyDown={event => { if (event.key === 'Enter' && selected && !editing.current && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); beginEditing(clip.id, caption) } }}>
          {selected && <div className="pointer-events-none absolute inset-0 outline outline-1 outline-accent" data-video-edit-text-selection />}
          {caption && !editable && layout.lines.map((line, row) => {
            const width = layout.style.align.startsWith('justify') ? layout.width : videoEditTextWidth(line, layout.style, measure)
            const left = layout.style.align.includes('center') ? (layout.width - width) / 2 : layout.style.align.includes('right') ? layout.width - width : 0
            return <div key={row} className="pointer-events-auto absolute" style={{ left: `${left / layout.width * 100}%`, top: `${row * layout.lineHeight / layout.height * 100}%`, width: `${width / layout.width * 100}%`, height: `${layout.lineHeight / layout.height * 100}%` }} />
          })}
          {editable && <div ref={editor} role="textbox" aria-label={caption ? t('videoEdit.inlineCaption', { defaultValue: '就地编辑字幕' }) : '就地编辑文字'} aria-multiline contentEditable="plaintext-only" suppressContentEditableWarning className="h-full w-full break-all text-transparent outline-none" style={{ whiteSpace: layout.style.boxWidth ? 'pre-wrap' : 'pre', fontFamily: layout.style.fontFamily, fontSize: `calc(100cqw * ${layout.style.fontSize / sequence.width})`, lineHeight: `calc(100cqw * ${layout.lineHeight / sequence.width})`, textAlign: layout.style.align.startsWith('justify') ? 'justify' : layout.style.align as 'left' | 'center' | 'right', fontWeight: layout.style.fontWeight, fontStyle: layout.style.fontStyle, letterSpacing: `calc(100cqw * ${layout.style.fontSize * layout.style.tracking / 1000 / sequence.width})`, textTransform: layout.style.allCaps ? 'uppercase' : undefined, fontVariantCaps: layout.style.smallCaps ? 'small-caps' : undefined, caretColor: 'var(--on-media)' }} onPointerDown={event => event.stopPropagation()} onInput={event => {
            const active = editing.current; if (!active || !valid(active)) return
            try {
              const raw = event.currentTarget.innerText ?? event.currentTarget.textContent ?? ''; let text = raw.slice(0, 2000)
              if (raw.length > 2000) {
                if (/^[\uD800-\uDBFF]$/.test(text.at(-1) ?? '')) text = text.slice(0, -1)
                event.currentTarget.textContent = text
                const range = event.currentTarget.ownerDocument.createRange(); range.selectNodeContents(event.currentTarget); range.collapse(false)
                const selection = ownerWindowOf(event.currentTarget).getSelection(); selection?.removeAllRanges(); selection?.addRange(range)
              }
              if (active.caption) {
                // Keep the existing non-empty source-caption contract while IME/replace-all is in progress.
                if (text.trim()) updateVideoEditTimedContent(instance.document.id, active.sequenceId, 'caption', active.caption.captionId, { [active.caption.field]: text }, active.gesture)
              } else updateVideoEditClipProperties(instance.document.id, active.sequenceId, active.clipId, { text }, active.gesture)
            } catch (error) { finish(false); onError(error) }
          }} onBlur={() => finish()} onKeyDown={event => { event.stopPropagation(); if (event.nativeEvent.isComposing) return; if (event.key === 'Escape') { event.preventDefault(); finish(!caption) } else if (caption && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish() } }} />}
          {selected && !editable && !caption && [0, 1, 2, 3].map(corner => <div key={corner} role="presentation" className="pointer-events-auto absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 border border-accent bg-on-media" data-video-edit-text-handle={corner} style={{ left: `${corner === 1 || corner === 2 ? 100 : 0}%`, top: `${corner >= 2 ? 100 : 0}%`, cursor: corner % 2 ? 'nesw-resize' : 'nwse-resize' }} onPointerDown={event => down(event, clip, corner, layout)} />)}
        </div>
      </div>
    })}
    {draftBox && <div className="pointer-events-none absolute border border-accent" style={{ left: `${draftBox.x * 100}%`, top: `${draftBox.y * 100}%`, width: `${draftBox.width * 100}%`, height: `${draftBox.height * 100}%` }} />}
  </div>
}
