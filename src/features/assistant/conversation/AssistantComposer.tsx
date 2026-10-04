import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from 'react'
import { ArrowUp, AudioLines, LoaderCircle, Paperclip, Square, X } from 'lucide-react'

import { PromptEditor, UI_FIELD_FOCUS_WITHIN_CLASS, UI_FIELD_SURFACE_CLASS, UI_TEXT_META_CLASS, UiButton, UiError, UiIconButton, UiInput } from '@/components/ui'
import { AGENT_ATTACHMENT_MAX_COUNT, AGENT_ATTACHMENT_FORMATS, type AgentAttachment } from '@/core/assistant/attachments'
import {
  toModelPromptText,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'
import { ALL_ATTACHMENT_MODALITIES, importAssistantAttachment, importDroppedAssistantAttachment, validateAssistantAttachmentFile, type AssistantAttachmentDraft } from './assistantAttachments'
import { readHenjiDragData, HENJI_DRAG_DATA_MIME, type HenjiDragTransferData } from '@/contexts/dragDataTransfer'
import { useDragDrop } from '@/contexts/DragDropContext'
import { createLogger } from '@/core/logging'
import { useCanvasStore } from '@/stores/canvasStore'
import { useNavigationStore } from '@/stores/navigationStore'
import { getSelectedCanvasMediaTransfers } from '@/features/canvas/application/canvasMediaTransfer'
import { resolveImageDisplayUrl } from '@/services/imageSource'
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
  submitting: boolean
  inputModalities?: AgentAttachment['modality'][]
  controls?: ReactNode
  onCancel?: () => void
  onImportingChange?: (value: boolean) => void
  sendLabel?: string
}

export function AssistantComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  submitting,
  attachments,
  onAttachmentsChange,
  attachmentsDisabled,
  inputModalities = ALL_ATTACHMENT_MODALITIES,
  controls,
  onCancel,
  onImportingChange,
  sendLabel,
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

  const selectedMedia = () => useNavigationStore.getState().activeWorkspace === 'nodes'
    ? getSelectedCanvasMediaTransfers(useCanvasStore.getState().nodes, inputModalities) : []

  const changeDocument = (next: PromptDocumentV1): void => {
    const media = selectedMedia()
    const sources: HenjiDragTransferData[] = []
    // 此处的 @ 是添加附件的快捷入口；落下普通名称，附件仍由统一草稿管理。
    const content = next.content.map(paragraph => ({ ...paragraph, content: paragraph.content?.map(item => {
      if (item.type !== 'mediaReference') return item
      const source = media.find(candidate => candidate.id === item.attrs.resourceId)
      if (source) sources.push(source.data)
      return { type: 'text' as const, text: `@${item.attrs.fallbackLabel} ` }
    }) }))
    onChange({ ...next, content })
    if (sources.length) void addSources(sources)
  }

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

  const sendDisabled = disabled || submitting || importing || unavailable || (!toModelPromptText(value).trim() && attachments.length === 0)
  const sendTitle = importing ? '导入中' : submitting ? '提交中' : sendLabel ?? '发送'

  // 一整块输入字段（与生成页输入卡片同构）：附件、无框编辑器、底栏都在这块 raised 表面里，
  // 聚焦时整块一圈焦点环；外层只留与面板对齐的内边距，不再画分隔线或第二层底色。
  return (
    <div className="px-3 pb-3 pt-2" aria-label="聊天输入区" onDragOver={event => {
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
      {attachmentError ? <UiError size="xs" align="start" message={attachmentError} /> : null}
      {unavailable ? <UiError size="xs" align="start" title="当前模型无法读取部分附件" message="请移除这些附件或切换模型。" /> : null}
      <div data-assistant-composer-field className={`rounded-lg ${UI_FIELD_SURFACE_CLASS} ${UI_FIELD_FOCUS_WITHIN_CLASS} ${submitting ? 'opacity-70' : ''}`}>
        {attachments.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto px-2 pb-1 pt-2">
            {attachments.map(item => (
              <div key={item.attachment.mediaRef} className="relative w-20 shrink-0">
                {item.attachment.modality === 'image' ? (
                  <img src={item.previewSrc} alt={item.attachment.displayName} className="h-14 w-full rounded-md bg-media object-cover" />
                ) : item.attachment.modality === 'video' ? (
                  <video src={item.previewSrc} aria-label={item.attachment.displayName} className="h-14 w-full rounded-md bg-media object-cover" muted />
                ) : (
                  <div className="flex h-14 w-full items-center justify-center rounded-md bg-window text-text2" aria-label={item.attachment.displayName}>
                    <AudioLines aria-hidden="true" className="h-5 w-5" />
                  </div>
                )}
                <div className={`truncate pt-1 ${UI_TEXT_META_CLASS}`} title={item.attachment.displayName}>{item.attachment.displayName}</div>
                <UiIconButton tone="media" size="sm"
                  type="button"
                  aria-label={`移除 ${item.attachment.displayName}`}
                  title={`移除 ${item.attachment.displayName}`}
                  className="absolute right-1 top-1"
                  disabled={attachmentsDisabled || importing}
                  onClick={() => onAttachmentsChange(attachments.filter(entry => entry.attachment.mediaRef !== item.attachment.mediaRef))}
                ><X className="h-3.5 w-3.5" /></UiIconButton>
              </div>
            ))}
          </div>
        ) : null}
        <PromptEditor
          mode="edit"
          preset="media-references"
          frame="none"
          suggestionContainer={'[data-application-surface-id="overlay.assistant"]'}
          getReferenceSuggestions={query => attachmentsDisabled || importingRef.current ? [] : selectedMedia()
            .filter(item => item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
            .map(item => ({ resourceId: item.id, mediaType: item.data.type, label: item.label, sourceNodeId: item.nodeId,
              thumbnailSrc: item.data.type === 'image' ? resolveImageDisplayUrl(item.data.thumbnailUrl || item.data.imageUrl) : undefined }))}
          layout="fill-scroll"
          value={value}
          onChange={changeDocument}
          ariaLabel="向智能助手描述任务"
          // 占位文字不随“回复中”切换：编辑器只在内容变化时重算占位装饰，随状态切换会停在旧文案（回复结束后仍显示“可补充当前任务”）；
          // 回复中能做什么由发送按钮的名称（等待发送 / 打断发送）说明
          placeholder={inputModalities.length ? '描述目标，输入 @ 添加选中节点的素材…' : '描述目标，或粘贴错误信息…'}
          disabled={submitting}
          maxCharacters={32 * 1024}
          submitShortcut="enter"
          onSubmit={submit}
          // 内容基础类已有 px-3 py-2.5 text-sm：这里用 pt/pb 与 text-13（产物中排在其后）收紧，不与之抢同一属性的同名档
          editorClassName="max-h-32 min-h-16 pt-2 pb-1 text-13"
        />
        {/* 底栏始终单行：左侧附件与权限，右侧停止与唯一主动作“发送”（强调色实底圆钮，与生成页一致） */}
        <div className="flex flex-nowrap items-center gap-1 px-1.5 pb-1.5">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1">
            {inputModalities.length > 0 ? <UiIconButton
              type="button"
              aria-label={attachmentLabel}
              title={attachmentLabel}
              disabled={attachmentsDisabled || importing || submitting}
              onClick={() => inputRef.current?.click()}
            ><Paperclip className="h-4 w-4" /></UiIconButton> : null}
            {controls}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {busy && onCancel ? <UiButton size="sm" onClick={onCancel} title={sendLabel ? '停止当前回复，等待中的消息将继续发送' : '停止当前回复'}>
              <Square aria-hidden="true" className="mr-1 h-3 w-3" />停止
            </UiButton> : null}
            {(!busy || !onCancel || sendLabel) ? <UiIconButton
              type="button"
              tone="accent"
              disabled={sendDisabled}
              onClick={submit}
              aria-label={sendTitle}
              title={sendTitle}
            >
              {importing || submitting ? <LoaderCircle aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" /> : <ArrowUp aria-hidden="true" className="h-4 w-4" />}
            </UiIconButton> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
