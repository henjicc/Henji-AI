import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { UiTextArea } from '@/components/ui'
import { currentImageEditorInteractionV3, traceImageEditorStageV3, type ImageEditorInteractionTraceV3 } from '../../execution/interactionTraceV3'

/** 停顿合并预算，不限制输入长度；组合输入不进入正式命令或撤销历史。 */
const TEXT_INPUT_IDLE_MS = 400

export function RunTextInputV3({ value, onCommit, documentId }: {
  value: string
  onCommit: (text: string) => boolean
  documentId?: string
}): JSX.Element {
  const [draft, setDraft] = useState(value)
  const latest = useRef(value)
  const acknowledged = useRef(value)
  const submitted = useRef<string | null>(null)
  const composing = useRef(false)
  const blurredDuringComposition = useRef(false)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputTrace = useRef<ImageEditorInteractionTraceV3>()
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  const cancelTimer = (): void => {
    if (pending.current !== null) clearTimeout(pending.current)
    pending.current = null
  }
  const commit = (): void => {
    cancelTimer()
    if (composing.current || latest.current === acknowledged.current || latest.current === submitted.current) return
    // 失败保留草稿，下一次失焦或确认可重试；不把失败当作提交成功。
    if (commitRef.current(latest.current)) submitted.current = latest.current
  }
  const schedule = (): void => {
    cancelTimer()
    if (!composing.current) pending.current = setTimeout(commit, TEXT_INPUT_IDLE_MS)
  }
  useLayoutEffect(() => {
    acknowledged.current = value
    if (value === submitted.current) submitted.current = null
    else {
      cancelTimer()
      submitted.current = null
      latest.current = value
      setDraft(value)
    }
  }, [value])
  useEffect(() => () => cancelTimer(), [])
  useLayoutEffect(() => {
    if (documentId) traceImageEditorStageV3(documentId, inputTrace.current, 'text-dom-ready')
    inputTrace.current = undefined
  }, [documentId, draft])
  return <UiTextArea aria-label="图层文字内容" rows={3} value={draft}
    onChange={event => {
      if (documentId) {
        inputTrace.current = currentImageEditorInteractionV3(documentId)
        traceImageEditorStageV3(documentId, inputTrace.current, 'text-handler')
      }
      latest.current = event.currentTarget.value; setDraft(latest.current); schedule()
    }}
    onCompositionStart={() => { composing.current = true; cancelTimer() }}
    onCompositionEnd={event => {
      composing.current = false
      latest.current = event.currentTarget.value
      setDraft(latest.current)
      if (blurredDuringComposition.current) { blurredDuringComposition.current = false; commit() }
      else schedule()
    }}
    onBlur={() => { if (composing.current) blurredDuringComposition.current = true; else commit() }}
    onKeyDown={event => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !composing.current && !event.nativeEvent.isComposing) {
        event.preventDefault(); commit()
      }
    }} />
}
