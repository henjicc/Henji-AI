import { useEffect, useRef, useState } from 'react'
import { Dropdown, UiButton, UiError } from '@/components/ui'
import { createEmptyPromptDocument } from '@/core/inputs/promptDocument'
import type { EmbeddedAgentModel, EmbeddedAgentPrompt } from '@/core/assistant/embeddedAgent'
import { getPlatform } from '@/platform/runtime'
import { useUiStore } from '@/stores/uiStore'
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
  const [selection, setSelection] = useState('')
  const [access, setAccess] = useState<EmbeddedAgentPrompt['access']>('write')
  const [submitting, setSubmitting] = useState(false)
  const [attachments, setAttachments] = useState<AssistantAttachmentDraft[]>([])
  const [importing, setImporting] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const previousSession = useRef(state.sessionId)
  const settingsOpen = useUiStore((store) => store.isSettingsOpen)
  const selectedModel = models.find((model) => JSON.stringify([model.providerId, model.modelId]) === selection) ?? models[0]
  useEffect(() => {
    let disposed = false
    void getPlatform().embeddedAgent.models().then((items) => { if (!disposed) setModels(items) }, reportEmbeddedAgentError)
    return () => { disposed = true }
  }, [settingsOpen])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [state.messages, state.activity])
  const busy = submitting || state.busy
  useEffect(() => {
    if (previousSession.current && previousSession.current !== state.sessionId && !busy) {
      setDocument(createEmptyPromptDocument()); setAttachments([]); setImporting(false)
    }
    previousSession.current = state.sessionId
  }, [state.sessionId, busy])
  const send = (text: string, submittedAttachments: AgentAttachment[]): void => {
    if (!text || !selectedModel || busy) return
    setSubmitting(true)
    const context = createHostContextSnapshot()
    void getPlatform().embeddedAgent.prompt({ text, model: { providerId: selectedModel.providerId, modelId: selectedModel.modelId }, access,
      context: JSON.stringify({ workspace: context.workspace, project: context.project, surface: context.surface }), attachments: submittedAttachments })
      .then(() => { setDocument(createEmptyPromptDocument()); setAttachments([]) }, reportEmbeddedAgentError)
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
      <div ref={endRef} />
    </div>
    <div className="space-y-2 px-3 pt-3">
      {state.error ? <UiError message={state.error} size="xs" /> : null}
      {models.length === 0 ? <UiButton size="sm" onClick={() => useUiStore.getState().openSettings({ tab: 'models', sectionId: 'models-assistant' })}>设置可调用工具的模型</UiButton> : null}
      <Dropdown value={selectedModel ? JSON.stringify([selectedModel.providerId, selectedModel.modelId]) : ''}
        options={models.map((model) => ({ value: JSON.stringify([model.providerId, model.modelId]), label: model.name }))}
        onSelect={setSelection} ariaLabel="助手模型" display={selectedModel?.name ?? '请选择模型'} disabled={busy || importing || !models.length} />
    </div>
    <AssistantComposer key={state.sessionId ?? 'new'} value={document} onChange={setDocument} onSubmit={send} attachments={attachments} onAttachmentsChange={setAttachments}
      inputModalities={selectedModel?.inputModalities ?? []} attachmentsDisabled={busy || !selectedModel} disabled={busy || !selectedModel}
      busy={busy} submitting={busy} waitingForAnswer={false} messageMode="current_task" onMessageModeChange={() => {}}
      approvalMode="assistant_decides" onApprovalModeChange={() => {}} onImportingChange={setImporting}
      onCancel={() => { void getPlatform().embeddedAgent.cancel().catch(reportEmbeddedAgentError) }}
      controls={<Dropdown value={access} options={accessOptions} onSelect={setAccess} disabled={busy} ariaLabel="助手操作权限" appearance="text" className="min-w-0" />} />
  </div>
}
