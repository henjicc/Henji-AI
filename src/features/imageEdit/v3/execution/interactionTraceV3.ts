import { isUiInspectionReadOnly } from '@/platform/runtime'

export interface ImageEditorInteractionTraceV3 {
  sequence: number
  inputTimestamp: number
  inputType: string
}

const traces = new Map<string, ImageEditorInteractionTraceV3>()
let sequence = 0

/** 仅正式巡检启用；时间戳随请求传递，迟到帧不能归到较新的输入。 */
export function traceImageEditorStageV3(
  documentId: string,
  trace: ImageEditorInteractionTraceV3 | undefined,
  stage: string,
  metadata: Readonly<Record<string, unknown>> = {},
): void {
  if (!trace || typeof performance === 'undefined') return
  performance.measure('image-editor-interaction', {
    start: trace.inputTimestamp,
    end: performance.now(),
    detail: { documentId, ...trace, stage, ...metadata },
  })
}

export function currentImageEditorInteractionV3(documentId: string): ImageEditorInteractionTraceV3 | undefined {
  return traces.get(documentId)
}

export function attachImageEditorInteractionTraceV3(root: HTMLElement, documentId: string): () => void {
  if (!isUiInspectionReadOnly()) return () => undefined
  const input = (event: Event): void => {
    if (event instanceof PointerEvent && event.type === 'pointermove'
      && (!event.buttons || (event.target instanceof Element && event.target.closest('input[type="range"]')))) return
    const trace = { sequence: ++sequence, inputTimestamp: performance.now(), inputType: event.type }
    traces.set(documentId, trace)
    traceImageEditorStageV3(documentId, trace, 'input')
  }
  const events = ['pointermove', 'pointerup', 'input', 'wheel', 'keydown']
  events.forEach(type => root.addEventListener(type, input, { capture: true, passive: true }))
  return () => {
    events.forEach(type => root.removeEventListener(type, input, true))
    traces.delete(documentId)
  }
}
