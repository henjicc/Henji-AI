import { assistantErrorMessage } from '@/core/assistant/assistantErrorPresentation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, RotateCcw, Sparkles } from 'lucide-react'
import { Dropdown, UiButton, UiEmpty, UiError } from '@/components/ui'
import { createEmptyPromptDocument, createPlainTextPromptDocument } from '@/core/inputs/promptDocument'
import type { EmbeddedAgentModel, EmbeddedAgentPrompt } from '@/core/assistant/embeddedAgent'
import { getPlatform } from '@/platform/runtime'
import { useUiStore } from '@/stores/uiStore'
import { useAssistantUiStore } from '../store/assistantUiStore'
import { createHostContextSnapshot } from '../../application-control/hostContext/hostContext'
import { EmbeddedTranscript, EmbeddedUserMessage } from './EmbeddedTranscript'
import { useConversationAutoScroll } from '../conversation/useConversationAutoScroll'
import { reportEmbeddedAgentError, useEmbeddedAgent } from './controller'
import type { AgentAttachment } from '@/core/assistant/attachments'
import { AssistantComposer } from '../conversation/AssistantComposer'
import type { AssistantAttachmentDraft } from '../conversation/assistantAttachments'
import { AudioEditAssistantAction } from '@/features/audioEdit/AudioEditAssistantAction'

const accessOptions: Array<{ value: EmbeddedAgentPrompt['access']; label: string }> = [
  { value: 'read', label: '只读访问' }, { value: 'write', label: '允许修改' }, { value: 'full', label: '完全访问' },
]
export function EmbeddedConversation(): JSX.Element {
  const state = useEmbeddedAgent()
  const [document, setDocument] = useState(createEmptyPromptDocument)
  const [models, setModels] = useState<EmbeddedAgentModel[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const pendingGoal = useAssistantUiStore(store => store.pendingGoal)
  const [delivery, setDelivery] = useState<'wait' | 'interrupt'>('wait')
  const access = useAssistantUiStore(store => store.embeddedAccess)
  const setAccess = useAssistantUiStore(store => store.setEmbeddedAccess)
  const [submitting, setSubmitting] = useState(false)
  const [attachments, setAttachments] = useState<AssistantAttachmentDraft[]>([])
  const [importing, setImporting] = useState(false)
  const scroll = useConversationAutoScroll(state.sessionId)
  const [optimistic, setOptimistic] = useState<{ id: string; text: string; attachments: AgentAttachment[] } | null>(null)
  const previousSession = useRef(state.sessionId)
  const settingsOpen = useUiStore((store) => store.isSettingsOpen)
  const selectedModel = models[0]
  useEffect(() => {
    let disposed = false
    setModelsLoaded(false)
    void getPlatform().embeddedAgent.models().then((items) => { if (!disposed) { setModels(items); setModelsLoaded(true) } }, error => {
      if (!disposed) { setModels([]); setModelsLoaded(true); reportEmbeddedAgentError(error) }
    })
    return () => { disposed = true }
  }, [settingsOpen])
  const busy = submitting || state.busy
  // 回复中才有“停止 / 打断”；切换对话中（switching）同样算忙，但只能排队等待，切换完成后发送
  const replying = state.busy && !state.switching
  const switching = state.switching === true
  useEffect(() => {
    if (previousSession.current && previousSession.current !== state.sessionId && !busy) {
      setDocument(createEmptyPromptDocument()); setAttachments([]); setImporting(false)
    }
    previousSession.current = state.sessionId
  }, [state.sessionId, busy])
  const send = useCallback((text: string, submittedAttachments: AgentAttachment[], request?: { context?: string }): void => {
    if (!text || !selectedModel || submitting) return
    setSubmitting(true)
    const clientMessageId = crypto.randomUUID()
    setOptimistic({ id: clientMessageId, text, attachments: submittedAttachments })
    scroll.scrollToBottom()
    const sentDocument = document
    const sentAttachments = attachments
    if (!request) { setDocument(createEmptyPromptDocument()); setAttachments([]) }
    const context = createHostContextSnapshot()
    void getPlatform().embeddedAgent.prompt({ text, clientMessageId, model: { providerId: selectedModel.providerId, modelId: selectedModel.modelId }, access,
      context: request?.context ?? JSON.stringify({ workspace: context.workspace, project: context.project, surface: context.surface, ...(context.videoEdit ? { videoEdit: context.videoEdit } : {}) }), attachments: submittedAttachments, delivery: request || switching ? 'wait' : delivery })
      .catch(error => {
        if (!request) { setDocument(sentDocument); setAttachments(sentAttachments) }
        reportEmbeddedAgentError(error)
      })
      .finally(() => { setOptimistic(null); setSubmitting(false) })
  }, [access, attachments, delivery, document, scroll, selectedModel, submitting, switching])
  useEffect(() => {
    if (!pendingGoal || !modelsLoaded || submitting) return
    const pending = useAssistantUiStore.getState()
    if (pending.pendingGoal !== pendingGoal) return
    const options = pending.pendingGoalOptions
    // Consume before submission: StrictMode and snapshot updates must not resend.
    pending.setPendingGoal(null)
    if (options?.autoSend && selectedModel) send(pendingGoal, [], { context: options.context })
    else setDocument(createPlainTextPromptDocument(pendingGoal))
  }, [modelsLoaded, pendingGoal, selectedModel, send, submitting])
  const isEmpty = !state.messages.length && !state.sendingMessage && !optimistic && !state.pendingMessages?.length
  const needsModel = modelsLoaded && models.length === 0
  const openModelSettings = (): void => useUiStore.getState().openSettings({ tab: 'models', sectionId: 'models-assistant' })
  /*
   * 失败后重试：完全复用发送链路，把上一条用户消息（原文与附件）按“等待”语义重新提交一次，不新增运行时协议；
   * 不清空输入框里正在写的草稿。只在最后一轮还没有任何结论时提供——已有结论说明这轮已经答完，错误来自别的操作。
   */
  const lastUserIndex = state.messages.map(message => message.role).lastIndexOf('user')
  const lastUser = lastUserIndex >= 0 ? state.messages[lastUserIndex] : undefined
  const lastTurnAnswered = state.messages.slice(lastUserIndex + 1).some(message => message.role === 'assistant' && (message.kind === 'answer' || !message.kind))
  const canRetry = Boolean(state.error && lastUser && !lastTurnAnswered && !busy && selectedModel)
  const retry = (): void => { if (lastUser) send(lastUser.text, lastUser.attachments ?? [], {}) }
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div ref={scroll.viewportRef} onScroll={scroll.onScroll} onWheel={scroll.onWheel} onKeyDown={scroll.onKeyDown} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4" role="log" aria-label="助手对话">
      <div ref={scroll.contentRef} className="space-y-5">
      {isEmpty ? (needsModel
        ? <UiEmpty size="sm" icon={<Sparkles aria-hidden="true" className="h-5 w-5" />} title="先设置助手模型"
          description="助手需要一个支持工具调用的模型，才能查看项目、调整参数和安排任务。"
          action={<UiButton variant="secondary" onClick={openModelSettings}>设置可调用工具的模型</UiButton>} />
        : <UiEmpty size="sm" icon={<Sparkles aria-hidden="true" className="h-5 w-5" />} title="从当前工作开始"
          description="可以让我查看项目、调整参数，或帮你安排创作任务。" />)
        : <EmbeddedTranscript messages={state.messages} busy={state.busy} onToggle={scroll.suspendFollowing} />}
      {state.sendingMessage ? <EmbeddedUserMessage message={state.sendingMessage} /> : null}
      {optimistic && state.sendingMessage?.id !== optimistic.id && !state.pendingMessages?.some(message => message.id === optimistic.id)
        ? <EmbeddedUserMessage message={optimistic} /> : null}
      {busy ? <div role="status" aria-label={switching ? "正在切换对话" : "助手正在回复"} className="flex h-6 items-center">
        <LoaderCircle aria-hidden="true" className="h-4 w-4 text-accent-text motion-safe:animate-spin" />
      </div> : null}
      {state.pendingMessages?.map(message => <div key={message.id} className="space-y-1"><EmbeddedUserMessage message={message} />
        <p className={`text-right text-xs ${message.error ? 'text-danger-text' : 'text-text3'}`}>{message.error ? `发送未完成：${assistantErrorMessage(message.error)}` : '等待发送'}</p></div>)}
      </div>
    </div>
    <AudioEditAssistantAction disabled={busy || !selectedModel} />
    {state.error || (needsModel && !isEmpty) ? <div className="px-4">
      {state.error ? <UiError message={assistantErrorMessage(state.error)} title="操作未完成" size="xs" align="start"
        actions={canRetry ? <UiButton size="sm" onClick={retry} title="重新发送上一条消息">
          <RotateCcw aria-hidden="true" className="mr-1 h-3.5 w-3.5" />重试</UiButton> : undefined} /> : null}
      {needsModel && !isEmpty ? <UiButton variant="secondary" onClick={openModelSettings}>设置可调用工具的模型</UiButton> : null}
    </div> : null}
    <AssistantComposer key={state.sessionId ?? 'new'} value={document} onChange={setDocument} onSubmit={send} attachments={attachments} onAttachmentsChange={setAttachments}
      inputModalities={selectedModel?.inputModalities ?? []} attachmentsDisabled={submitting || !selectedModel} disabled={submitting || !selectedModel}
      busy={busy} submitting={submitting}
      onImportingChange={setImporting}
      onCancel={replying ? () => { void getPlatform().embeddedAgent.cancel().catch(reportEmbeddedAgentError) } : undefined}
      sendLabel={busy ? replying && delivery === 'interrupt' ? '打断发送' : '等待发送' : '发送'}
      controls={<><Dropdown value={access} options={accessOptions} onSelect={setAccess} disabled={busy || importing} ariaLabel="助手操作权限" appearance="text" size="sm" className="min-w-0" buttonClassName="w-auto max-w-full" panelWidthStrategy="options" />
        {replying ? <Dropdown value={delivery} options={[{ value: 'wait', label: '等待' }, { value: 'interrupt', label: '打断' }]} onSelect={setDelivery} ariaLabel="发送方式" appearance="text" size="sm" className="min-w-0" buttonClassName="w-auto max-w-full" panelWidthStrategy="options" /> : null}</>} />
  </div>
}
