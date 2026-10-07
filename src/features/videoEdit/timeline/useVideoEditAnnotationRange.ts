import { useRef, useState } from 'react'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '@/core/videoEdit/time'
import { focusVideoEditPanel, setVideoEditTimelineView, type VideoEditInstance } from '../application/videoEditService'

/** Alt+Shift drag preserves Premiere's existing ruler gestures. The panel collects the note before creating a draft. */
export function useVideoEditAnnotationRange(instance: VideoEditInstance, pixels: number, headerWidth: number, onError: (error: unknown) => void) {
  const gesture = useRef<{ from: number; document: VideoEditInstance['document']; sequenceId: string }>()
  const [range, setRange] = useState<{ from: number; to: number }>()
  const at = (event: React.PointerEvent<HTMLElement>): number => Math.max(0, Math.min(VIDEO_EDIT_MAX_SEQUENCE_FRAMES - 1, Math.round((event.clientX - event.currentTarget.getBoundingClientRect().left - headerWidth) / pixels)))
  return {
    range,
    onPointerDownCapture: (event: React.PointerEvent<HTMLElement>): void => {
      if (!event.altKey || !event.shiftKey || event.button !== 0) return
      event.preventDefault(); event.stopPropagation(); const from = at(event)
      gesture.current = { from, document: instance.document, sequenceId: instance.activeSequenceId }; setRange({ from, to: from }); event.currentTarget.setPointerCapture(event.pointerId)
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>): void => { if (!gesture.current) return; event.stopPropagation(); setRange({ from: gesture.current.from, to: at(event) }) },
    onPointerUp: (event: React.PointerEvent<HTMLElement>): void => {
      const capture = gesture.current; if (!capture) return
      gesture.current = undefined; setRange(undefined); event.stopPropagation()
      if (capture.document !== instance.document || capture.sequenceId !== instance.activeSequenceId) return
      try { const to = at(event); setVideoEditTimelineView(instance.document.id, { inFrame: Math.min(capture.from, to), outFrame: Math.max(capture.from, to) + 1 }); focusVideoEditPanel(instance.document.id, 'annotations') } catch (error) { onError(error) }
    },
    onPointerCancel: (): void => { gesture.current = undefined; setRange(undefined) },
  }
}
