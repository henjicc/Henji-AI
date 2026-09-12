import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import { Paperclip, Send, Square, X } from 'lucide-react'

import { Dropdown, PromptEditor, UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS, UiButton, UiError, UiIconButton, UiInput } from '@/components/ui'
import { AGENT_ATTACHMENT_MAX_COUNT, AGENT_ATTACHMENT_FORMATS, type AgentAttachment } from '@/core/assistant/attachments'
import type { AgentApprovalMode } from '@/core/assistant/runtimeContracts'
import type { AgentQueuedMessagePayload } from '@/core/assistant/session'
import {
  toModelPromptText,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'
import { ALL_ATTACHMENT_MODALITIES, importAssistantAttachment, importDroppedAssistantAttachment, validateAssistantAttachmentFile, type AssistantAttachmentDraft } from './assistantAttachments'
import { readHenjiDragData, HENJI_DRAG_DATA_MIME, type HenjiDragTransferData } from '@/contexts/dragDataTransfer'
import { useDragDrop } from '@/contexts/DragDropContext'
import { createLogger } from '@/core/logging'
const logger = createLogger('features.assistant.attachments')

interface AssistantComposerProps {
  value: PromptDocumentV1
  onChange: (value: PromptDocumentV1) => void
  onSubmit: (goal: string, attachments: AgentAttachment[]) => void
  attachments: AssistantAttachmentDraft[]
  onAttachmentsChange: (attachments: AssistantAttachmentDraft[]) => void
  attachmentsDisabled: boolean
  disabled: boolean
  busy: boolean
  waitingForAnswer: boolean
  messageMode: AgentQueuedMessagePayload['mode']
  onMessageModeChange: (mode: AgentQueuedMessagePayload['mode']) => void
  submitting: boolean
  approvalMode: AgentApprovalMode
  onApprovalModeChange: (mode: AgentApprovalMode) => void
  inputModalities?: AgentAttachment['modality'][]
  controls?: ReactNode
  onCancel?: () => void
  onImportingChange?: (value: boolean) => void
}

const approvalModeOptions: Array<{ value: AgentApprovalMode; label: string }> = [
  { value: 'ask', label: '严格确认' },
  { value: 'assistant_decides', label: '助手判断' },
  { value: 'full_access', label: '充分访问' },
]

export function AssistantComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  waitingForAnswer,
  messageMode,
  onMessageModeChange,
  submitting,
  approvalMode,
  onApprovalModeChange,
  attachments,
  onAttachmentsChange,
  attachmentsDisabled,
  inputModalities = ALL_ATTACHMENT_MODALITIES,
  controls,
  onCancel,
  onImportingChange,
}: AssistantComposerProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const importingRef = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const { isDragging, dragData, endDrag } = useDragDrop()
  const unavailable = attachments.some((item) => !inputModalities.includes(item.attachment.modality))
  const attachmentLabel = `添加${inputModalities.map((type) => ({ image: '图片', video: '视频', audio: '音频' })[type]).join('、')}`

  const addSources = useCallback(async (sources: Array<File | HenjiDragTransferData>): Promise<void> => {
    if (attachmentsDisabled || importingRef.current || sources.length === 0) return
    const remaining = AGENT_ATTACHMENT_MAX_COUNT - attachments.length
    if (remaining <= 0) {
      setAttachmentError(`每条消息最多添加 ${AGENT_ATTACHMENT_MAX_COUNT} 个附件`)
      return
    }
    importingRef.current = true
    setImporting(true)
    onImportingChange?.(true)
    setAttachmentError(null)
    logger.info('开始添加聊天附件', { event: 'assistant.attachment.import.start', count: sources.length })
    const imported: AssistantAttachmentDraft[] = []
    const errors: string[] = []
    try {
      for (const source of sources.slice(0, remaining)) {
        try {
          if (source instanceof File) {
            validateAssistantAttachmentFile(source, inputModalities)
            imported.push(await importAssistantAttachment(source))
          } else {
            if (!inputModalities.includes(source.type)) throw new Error('当前模型不支持这种附件，请切换模型。')
            const draft = await importDroppedAssistantAttachment(source)
            validateAssistantAttachmentFile({ name: draft.attachment.displayName, type: draft.attachment.mimeType, size: draft.attachment.sizeBytes }, inputModalities)
            imported.push(draft)
          }
        } catch (error) {
          logger.error('聊天附件导入失败', error, { event: 'assistant.attachment.import.failed' })
          errors.push(error instanceof Error ? error.message : '附件导入失败')
        }
        if (!mounted.current) return
      }
      const byRef = new Map([...attachments, ...imported].map(item => [item.attachment.mediaRef, item]))
      onAttachmentsChange([...byRef.values()])
      if (sources.length > remaining) errors.push(`每条消息最多添加 ${AGENT_ATTACHMENT_MAX_COUNT} 个附件，其余未添加`)
      setAttachmentError(errors.join('；') || null)
      logger.info('聊天附件添加完成', { event: 'assistant.attachment.import.completed', count: imported.length })
    } finally {
      importingRef.current = false
      if (mounted.current) { setImporting(false); onImportingChange?.(false) }
    }
  }, [attachments, attachmentsDisabled, inputModalities, onAttachmentsChange, onImportingChange])

  const submit = useCallback((): void => {
    const text = toModelPromptText(value).trim()
    if ((!text && attachments.length === 0) || disabled || submitting || importingRef.current || unavailable) return
    onSubmit(text || '请分析我附加的媒体。', attachments.map(item => item.attachment))
  }, [attachments, disabled, onSubmit, submitting, unavailable, value])

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>): void => {
    const internal = readHenjiDragData(event.dataTransfer)
    if (!internal && event.dataTransfer.files.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    void addSources(internal ? [internal] : Array.from(event.dataTransfer.files))
    if (internal) endDrag()
  }, [addSources, endDrag])

  const onPaste = useCallback((event: ClipboardEvent<HTMLDivElement>): void => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    void addSources(files)
  }, [addSources])

  return (
    <div className={controls ? 'p-3' : 'border-t border-border-dark bg-panel p-3'} aria-label="聊天输入区" onDragOver={event => {
      if (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes(HENJI_DRAG_DATA_MIME)) { event.preventDefault(); event.stopPropagation() }
    }} onDropCapture={onDrop} onPasteCapture={onPaste} onMouseUpCapture={event => {
      if (isDragging && dragData) { event.preventDefault(); event.stopPropagation(); void addSources([dragData]); endDrag() }
    }}>
      {inputModalities.length > 0 ? <UiInput
        ref={inputRef}
        type="file"
        accept={inputModalities.map((type) => AGENT_ATTACHMENT_FORMATS[type]).join(',')}
        aria-label="聊天附件"
        disabled={attachmentsDisabled || importing || submitting}
        multiple
        className="hidden"
        onChange={event => {
          void addSources(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      /> : null}
      {attachments.length > 0 ? (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {attachments.map(item => (
            <div key={item.attachment.mediaRef} className="relative w-24 shrink-0 overflow-hidden rounded-lg border border-border-dark bg-surface-dark">
              {item.attachment.modality === 'image' ? (
                <img src={item.previewSrc} alt={item.attachment.displayName} className="h-16 w-full object-cover" />
              ) : item.attachment.modality === 'video' ? (
                <video src={item.previewSrc} aria-label={item.attachment.displayName} className="h-16 w-full object-cover" muted />
              ) : (
                <audio src={item.previewSrc} aria-label={item.attachment.displayName} className="h-16 w-full px-1" controls />
              )}
              <div className={`truncate px-1.5 py-1 ${UI_TEXT_META_CLASS}`}>{item.attachment.displayName}</div>
              <UiIconButton
                type="button"
                aria-label={`移除 ${item.attachment.displayName}`}
                title={`移除 ${item.attachment.displayName}`}
                appearance="glass"
                className="absolute right-1 top-1 !h-7 !w-7"
                disabled={attachmentsDisabled || importing}
                onClick={() => onAttachmentsChange(attachments.filter(entry => entry.attachment.mediaRef !== item.attachment.mediaRef))}
              ><X className="h-3.5 w-3.5" /></UiIconButton>
            </div>
          ))}
        </div>
      ) : null}
      {attachmentError ? <UiError size="xs" message={attachmentError} className="mb-2" /> : null}
      {unavailable ? <UiError size="xs" message="当前模型无法读取部分附件，请移除这些附件或切换模型。" className="mb-2" /> : null}
      <PromptEditor
        mode="edit"
        preset="plain"
        layout="fill-scroll"
        value={value}
        onChange={onChange}
        ariaLabel="向智能助手描述任务"
        placeholder={waitingForAnswer
          ? '回答助手刚才的问题…'
          : busy ? '可补充当前任务，或安排任务结束后继续…' : '描述目标，或粘贴错误信息…'}
        disabled={submitting}
        maxCharacters={32 * 1024}
        submitShortcut="enter"
        onSubmit={submit}
        editorShellClassName="!rounded-xl !border-border-dark bg-surface-dark"
        editorClassName={`max-h-32 min-h-[72px] px-3 py-2.5 ${UI_TEXT_BODY_CLASS}`}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {inputModalities.length > 0 ? <UiIconButton
            type="button"
            aria-label={attachmentLabel}
            title={attachmentLabel}
            appearance="hover-only"
            className="!h-7 !w-7"
            disabled={attachmentsDisabled || importing || submitting}
            onClick={() => inputRef.current?.click()}
          ><Paperclip className="h-4 w-4" /></UiIconButton> : null}
          {controls ?? <>{busy ? (
            <Dropdown<AgentQueuedMessagePayload['mode']>
              value={messageMode}
              options={[
                ...(waitingForAnswer
                  ? [{ value: 'clarification' as const, label: '回答当前问题' }]
                  : [
                      { value: 'current_task' as const, label: '补充当前任务' },
                      { value: 'after_task' as const, label: '任务结束后继续' },
                    ]),
              ]}
              onSelect={onMessageModeChange}
              minWidthStrategy="options"
              panelWidthStrategy="options"
              buttonClassName="!h-7 !rounded-lg !px-2 text-2xs"
            />
          ) : null}
          <Dropdown<AgentApprovalMode>
            value={approvalMode}
            options={approvalModeOptions}
            onSelect={onApprovalModeChange}
            minWidthStrategy="options"
            panelWidthStrategy="options"
            buttonClassName="!h-7 !rounded-lg !px-2 text-2xs"
          />
          </>}
        </div>
        {busy && onCancel ? <UiButton size="sm" onClick={onCancel}><Square className="mr-1 h-3 w-3" />停止</UiButton> : <UiButton
          type="button"
          size="sm"
          variant="primary"
          disabled={disabled || submitting || importing || unavailable || (!toModelPromptText(value).trim() && attachments.length === 0)}
          onClick={submit}
          className="gap-1.5"
        >
          {submitting ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {importing ? '导入中' : submitting ? '提交中' : '发送'}
        </UiButton>}
      </div>
    </div>
  )
}
