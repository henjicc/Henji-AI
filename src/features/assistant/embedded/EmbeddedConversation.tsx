import { assistantErrorMessage } from '@/core/assistant/assistantErrorPresentation'
import { useEffect, useRef, useState } from 'react'
import { Dropdown, UiButton, UiError, UiLoading } from '@/components/ui'
import { createEmptyPromptDocument } from '@/core/inputs/promptDocument'
import type { EmbeddedAgentModel, EmbeddedAgentPrompt } from '@/core/assistant/embeddedAgent'
import { getPlatform } from '@/platform/runtime'
import { useUiStore } from '@/stores/uiStore'
import { useAssistantUiStore } from '../store/assistantUiStore'
import { createHostContextSnapshot } from '../hostContext/hostContext'
import { EmbeddedTranscript, EmbeddedUserMessage } from './EmbeddedTranscript'
import { useConversationAutoScroll } from '../conversation/useConversationAutoScroll'
import { reportEmbeddedAgentError, useEmbeddedAgent } from './controller'
import type { AgentAttachment } from '@/core/assistant/attachments'
import { AssistantComposer } from '../conversation/AssistantComposer'
import type { AssistantAttachmentDraft } from '../conversation/assistantAttachments'

const accessOptions: Array<{ value: EmbeddedAgentPrompt['access']; label: string }> = [
  { value: 'read', label: '只读访问' }, { value: 'write', label: '允许修改' }, { value: 'full', label: '完全访问' },
]
export function EmbeddedConversation(): JSX.Element {
  const state = useEmbeddedAgent()
  const [document, setDocument] = useState(createEmptyPromptDocument)
  const [models, setModels] = useState<EmbeddedAgentModel[]>([])
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
    void getPlatform().embeddedAgent.models().then((items) => { if (!disposed) setModels(items) }, reportEmbeddedAgentError)
    return () => { disposed = true }
  }, [settingsOpen])
  const busy = submitting || state.busy
  useEffect(() => {
    if (previousSession.current && previousSession.current !== state.sessionId && !busy) {
      setDocument(createEmptyPromptDocument()); setAttachments([]); setImporting(false)
    }
    previousSession.current = state.sessionId
  }, [state.sessionId, busy])
  const send = (text: string, submittedAttachments: AgentAttachment[]): void => {
    if (!text || !selectedModel || submitting) return
    setSubmitting(true)
    const clientMessageId = crypto.randomUUID()
    setOptimistic({ id: clientMessageId, text, attachments: submittedAttachments })
    scroll.scrollToBottom()
    const sentDocument = document
    const sentAttachments = attachments
    setDocument(createEmptyPromptDocument()); setAttachments([])
    const context = createHostContextSnapshot()
    void getPlatform().embeddedAgent.prompt({ text, clientMessageId, model: { providerId: selectedModel.providerId, modelId: selectedModel.modelId }, access,
      context: JSON.stringify({ workspace: context.workspace, project: context.project, surface: context.surface }), attachments: submittedAttachments, delivery })
      .catch(error => { setDocument(sentDocument); setAttachments(sentAttachments); reportEmbeddedAgentError(error) })
      .finally(() => { setOptimistic(null); setSubmitting(false) })
  }
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div ref={scroll.viewportRef} onScroll={scroll.onScroll} onWheel={scroll.onWheel} onKeyDown={scroll.onKeyDown} className="ui-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4" role="log" aria-label="助手对话">
      <div ref={scroll.contentRef} className="space-y-6">
      {!state.messages.length && !state.sendingMessage && !optimistic && !state.pendingMessages?.length ? <div className="space-y-2 py-8 text-sm text-text-muted">
        <p className="font-medium text-text-dark">从当前工作开始</p>
        <p>可以让我查看项目、调整参数，或帮你安排创作任务。</p>
      </div> : <EmbeddedTranscript messages={state.messages} busy={state.busy} onToggle={scroll.suspendFollowing} />}
      {state.sendingMessage ? <EmbeddedUserMessage message={state.sendingMessage} /> : null}
      {optimistic && state.sendingMessage?.id !== optimistic.id && !state.pendingMessages?.some(message => message.id === optimistic.id)
        ? <EmbeddedUserMessage message={optimistic} /> : null}
      {busy ? <div aria-label="助手正在回复"><UiLoading size="xs" className="!items-start !py-1 motion-reduce:[&>div]:animate-none" /></div> : null}
      {state.pendingMessages?.map(message => <div key={message.id} className="space-y-2"><EmbeddedUserMessage message={message} />
        <p className="text-right text-xs text-text-muted">{message.error ? `发送未完成：${assistantErrorMessage(message.error)}` : '等待发送'}</p></div>)}
      </div>
    </div>
    <div className="space-y-2 px-3 pt-3">
      {state.error ? <UiError message={assistantErrorMessage(state.error)} size="xs" /> : null}
      {models.length === 0 ? <UiButton size="sm" onClick={() => useUiStore.getState().openSettings({ tab: 'models', sectionId: 'models-assistant' })}>设置可调用工具的模型</UiButton> : null}
    </div>
    <AssistantComposer key={state.sessionId ?? 'new'} value={document} onChange={setDocument} onSubmit={send} attachments={attachments} onAttachmentsChange={setAttachments}
      inputModalities={selectedModel?.inputModalities ?? []} attachmentsDisabled={submitting || !selectedModel} disabled={submitting || !selectedModel}
      busy={busy} submitting={submitting} waitingForAnswer={false} messageMode="current_task" onMessageModeChange={() => {}}
      approvalMode="assistant_decides" onApprovalModeChange={() => {}} onImportingChange={setImporting}
      onCancel={() => { void getPlatform().embeddedAgent.cancel().catch(reportEmbeddedAgentError) }}
      sendLabel={busy ? delivery === 'wait' ? '等待发送' : '打断发送' : '发送'}
      controls={<><Dropdown value={access} options={accessOptions} onSelect={setAccess} disabled={busy || importing} ariaLabel="助手操作权限" appearance="text" className="min-w-0" buttonClassName="!h-7 !px-2 text-2xs" />
        {busy ? <Dropdown value={delivery} options={[{ value: 'wait', label: '等待' }, { value: 'interrupt', label: '打断' }]} onSelect={setDelivery} ariaLabel="发送方式" appearance="text" /> : null}</>} />
  </div>
}
