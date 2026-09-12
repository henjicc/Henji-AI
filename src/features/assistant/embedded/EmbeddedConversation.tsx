import { useEffect, useRef, useState } from 'react'
import { Dropdown, UiButton, UiError } from '@/components/ui'
import { createEmptyPromptDocument } from '@/core/inputs/promptDocument'
import type { EmbeddedAgentModel, EmbeddedAgentPrompt } from '@/core/assistant/embeddedAgent'
import { getPlatform } from '@/platform/runtime'
import { useUiStore } from '@/stores/uiStore'
import { useAssistantUiStore } from '../store/assistantUiStore'
import { createHostContextSnapshot } from '../hostContext/hostContext'
import { AssistantMarkdown } from '../conversation/AssistantMarkdown'
import { reportEmbeddedAgentError, useEmbeddedAgent } from './controller'
import type { AgentAttachment } from '@/core/assistant/attachments'
import { AssistantComposer } from '../conversation/AssistantComposer'
import { AssistantMessageAttachments } from '../conversation/AssistantMessageAttachments'
import type { AssistantAttachmentDraft } from '../conversation/assistantAttachments'

const accessOptions: Array<{ value: EmbeddedAgentPrompt['access']; label: string }> = [
  { value: 'read', label: '仅查看' }, { value: 'write', label: '允许修改' }, { value: 'full', label: '允许修改、删除和付费生成' },
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
  const endRef = useRef<HTMLDivElement>(null)
  const previousSession = useRef(state.sessionId)
  const settingsOpen = useUiStore((store) => store.isSettingsOpen)
  const selectedModel = models[0]
  useEffect(() => {
    let disposed = false
    void getPlatform().embeddedAgent.models().then((items) => { if (!disposed) setModels(items) }, reportEmbeddedAgentError)
    return () => { disposed = true }
  }, [settingsOpen])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [state.messages, state.activity, state.pendingMessages])
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
    const sentDocument = document
    const sentAttachments = attachments
    setDocument(createEmptyPromptDocument()); setAttachments([])
    const context = createHostContextSnapshot()
    void getPlatform().embeddedAgent.prompt({ text, model: { providerId: selectedModel.providerId, modelId: selectedModel.modelId }, access,
      context: JSON.stringify({ workspace: context.workspace, project: context.project, surface: context.surface }), attachments: submittedAttachments, delivery })
      .catch(error => { setDocument(sentDocument); setAttachments(sentAttachments); reportEmbeddedAgentError(error) })
      .finally(() => setSubmitting(false))
  }
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" role="log" aria-label="助手对话">
      {!state.messages.length ? <div className="space-y-2 py-8 text-sm text-text-muted">
        <p className="font-medium text-text-dark">从当前工作开始</p>
        <p>可以让我查看项目、调整参数，或帮你安排创作任务。</p>
      </div> : state.messages.map((message) => <div key={message.id} className="mb-5 min-w-0">
        <div className="mb-1 text-xs text-text-muted">{message.role === 'user' ? '你' : '助手'}</div>
        <AssistantMarkdown>{message.text}</AssistantMarkdown>
        {message.attachments?.length ? <AssistantMessageAttachments attachments={message.attachments} /> : null}
      </div>)}
      {state.activity ? <p role="status" className="py-2 text-sm text-text-muted">{state.activity}</p> : null}
      {state.pendingMessages?.map(message => <div key={message.id} className="mb-3 text-sm text-text-muted"><p>{message.error ? `发送未完成：${message.error}` : '等待发送'}</p><AssistantMarkdown>{message.text}</AssistantMarkdown>
        {message.attachments?.length ? <AssistantMessageAttachments attachments={message.attachments} /> : null}</div>)}
      <div ref={endRef} />
    </div>
    <div className="space-y-2 px-3 pt-3">
      {state.error ? <UiError message={state.error} size="xs" /> : null}
      {models.length === 0 ? <UiButton size="sm" onClick={() => useUiStore.getState().openSettings({ tab: 'models', sectionId: 'models-assistant' })}>设置可调用工具的模型</UiButton> : null}
    </div>
    <AssistantComposer key={state.sessionId ?? 'new'} value={document} onChange={setDocument} onSubmit={send} attachments={attachments} onAttachmentsChange={setAttachments}
      inputModalities={selectedModel?.inputModalities ?? []} attachmentsDisabled={submitting || !selectedModel} disabled={submitting || !selectedModel}
      busy={busy} submitting={submitting} waitingForAnswer={false} messageMode="current_task" onMessageModeChange={() => {}}
      approvalMode="assistant_decides" onApprovalModeChange={() => {}} onImportingChange={setImporting}
      onCancel={() => { void getPlatform().embeddedAgent.cancel().catch(reportEmbeddedAgentError) }}
      sendLabel={busy ? delivery === 'wait' ? '等待发送' : '打断发送' : '发送'}
      controls={<><Dropdown value={access} options={accessOptions} onSelect={setAccess} disabled={busy || importing} ariaLabel="助手操作权限" appearance="text" className="min-w-0" />
        {busy ? <Dropdown value={delivery} options={[{ value: 'wait', label: '等待' }, { value: 'interrupt', label: '打断' }]} onSelect={setDelivery} ariaLabel="发送方式" appearance="text" /> : null}</>} />
  </div>
}
