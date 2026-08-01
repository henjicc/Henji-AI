import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Paperclip, Send, Square, X } from 'lucide-react'

import { Dropdown, PromptEditor, UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS, UiButton, UiError, UiIconButton, UiInput } from '@/components/ui'
import { AGENT_ATTACHMENT_MAX_COUNT, type AgentAttachment } from '@/core/assistant/attachments'
import type { AgentApprovalMode } from '@/core/assistant/runtimeContracts'
import type { AgentQueuedMessagePayload } from '@/core/assistant/session'
import {
  toModelPromptText,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'
import { importAssistantAttachment, type AssistantAttachmentDraft } from './assistantAttachments'

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
}: AssistantComposerProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const addFiles = useCallback(async (files: File[]): Promise<void> => {
    if (attachmentsDisabled || importing || files.length === 0) return
    const remaining = AGENT_ATTACHMENT_MAX_COUNT - attachments.length
    if (remaining <= 0) {
      setAttachmentError(`每条消息最多添加 ${AGENT_ATTACHMENT_MAX_COUNT} 个附件`)
      return
    }
    setImporting(true)
    setAttachmentError(null)
    try {
      const imported: AssistantAttachmentDraft[] = []
      for (const file of files.slice(0, remaining)) imported.push(await importAssistantAttachment(file))
      const byRef = new Map([...attachments, ...imported].map(item => [item.attachment.mediaRef, item]))
      onAttachmentsChange([...byRef.values()])
      if (files.length > remaining) setAttachmentError(`已保留前 ${remaining} 个附件，其余未添加`)
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : '附件导入失败')
    } finally {
      setImporting(false)
    }
  }, [attachments, attachmentsDisabled, importing, onAttachmentsChange])

  const submit = useCallback((): void => {
    const text = toModelPromptText(value).trim()
    if ((!text && attachments.length === 0) || disabled || submitting || importing) return
    onSubmit(text || '请分析我附加的媒体。', attachments.map(item => item.attachment))
  }, [attachments, disabled, importing, onSubmit, submitting, value])

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>): void => {
    if (event.dataTransfer.files.length === 0) return
    event.preventDefault()
    void addFiles(Array.from(event.dataTransfer.files))
  }, [addFiles])

  const onPaste = useCallback((event: ClipboardEvent<HTMLDivElement>): void => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    void addFiles(files)
  }, [addFiles])

  return (
    <div className="border-t border-border-dark bg-panel p-3" onDragOver={event => event.preventDefault()} onDrop={onDrop} onPaste={onPaste}>
      <UiInput
        ref={inputRef}
        type="file"
        accept="image/*,video/*,audio/*"
        multiple
        className="hidden"
        onChange={event => {
          void addFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
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
                onClick={() => onAttachmentsChange(attachments.filter(entry => entry.attachment.mediaRef !== item.attachment.mediaRef))}
              ><X className="h-3.5 w-3.5" /></UiIconButton>
            </div>
          ))}
        </div>
      ) : null}
      {attachmentError ? <UiError size="xs" message={attachmentError} className="mb-2" /> : null}
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
          <UiIconButton
            type="button"
            aria-label={attachmentsDisabled ? '运行期间暂不支持添加附件' : '添加图片、视频或音频'}
            title={attachmentsDisabled ? '运行期间暂不支持添加附件' : '添加图片、视频或音频'}
            appearance="hover-only"
            className="!h-7 !w-7"
            disabled={attachmentsDisabled || importing || submitting}
            onClick={() => inputRef.current?.click()}
          ><Paperclip className="h-4 w-4" /></UiIconButton>
          {busy ? (
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
        </div>
        <UiButton
          type="button"
          size="sm"
          variant="primary"
          disabled={submitting || importing || (!toModelPromptText(value).trim() && attachments.length === 0)}
          onClick={submit}
          className="gap-1.5"
        >
          {submitting ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          {importing ? '导入中' : submitting ? '提交中' : '发送'}
        </UiButton>
      </div>
    </div>
  )
}
