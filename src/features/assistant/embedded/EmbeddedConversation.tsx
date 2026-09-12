import { useEffect, useRef, useState } from 'react'
import { Send, Square } from 'lucide-react'
import { Dropdown, PromptEditor, UiButton, UiError, UI_TEXT_BODY_CLASS } from '@/components/ui'
import { createEmptyPromptDocument, toModelPromptText } from '@/core/inputs/promptDocument'
import type { EmbeddedAgentModel, EmbeddedAgentPrompt } from '@/core/assistant/embeddedAgent'
import { getPlatform } from '@/platform/runtime'
import { useUiStore } from '@/stores/uiStore'
import { createHostContextSnapshot } from '../hostContext/hostContext'
import { AssistantMarkdown } from '../conversation/AssistantMarkdown'
import { reportEmbeddedAgentError, useEmbeddedAgent } from './controller'

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
  const endRef = useRef<HTMLDivElement>(null)
  const settingsOpen = useUiStore((store) => store.isSettingsOpen)
  const selectedModel = models.find((model) => JSON.stringify([model.providerId, model.modelId]) === selection) ?? models[0]
  useEffect(() => {
    let disposed = false
    void getPlatform().embeddedAgent.models().then((items) => { if (!disposed) setModels(items) }, reportEmbeddedAgentError)
    return () => { disposed = true }
  }, [settingsOpen])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [state.messages, state.activity])
  const busy = submitting || state.busy
  const send = (): void => {
    const text = toModelPromptText(document).trim()
    if (!text || !selectedModel || busy) return
    setSubmitting(true)
    const context = createHostContextSnapshot()
    void getPlatform().embeddedAgent.prompt({ text, model: { providerId: selectedModel.providerId, modelId: selectedModel.modelId }, access,
      context: JSON.stringify({ workspace: context.workspace, project: context.project, surface: context.surface }) })
      .then(() => setDocument(createEmptyPromptDocument()), reportEmbeddedAgentError)
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
      </div>)}
      {state.activity ? <p role="status" className="py-2 text-sm text-text-muted">{state.activity}</p> : null}
      <div ref={endRef} />
    </div>
    <div className="space-y-2 p-3">
      {state.error ? <UiError message={state.error} size="xs" /> : null}
      {models.length === 0 ? <UiButton size="sm" onClick={() => useUiStore.getState().openSettings({ tab: 'models', sectionId: 'models-assistant' })}>设置可调用工具的模型</UiButton> : null}
      <Dropdown value={selectedModel ? JSON.stringify([selectedModel.providerId, selectedModel.modelId]) : ''}
        options={models.map((model) => ({ value: JSON.stringify([model.providerId, model.modelId]), label: model.name }))}
        onSelect={setSelection} ariaLabel="助手模型" display={selectedModel?.name ?? '请选择模型'} disabled={busy || !models.length} />
      <PromptEditor mode="edit" preset="plain" layout="fill-scroll" value={document} onChange={setDocument}
        ariaLabel="向智能助手描述任务" placeholder="描述你想完成的事…" disabled={busy} maxCharacters={32000}
        submitShortcut="enter" onSubmit={send} editorShellClassName="!rounded-xl !border-border-dark bg-surface-dark"
        editorClassName={`max-h-32 min-h-[72px] px-3 py-2.5 ${UI_TEXT_BODY_CLASS}`} />
      <div className="flex items-center justify-between gap-2">
        <Dropdown value={access} options={accessOptions} onSelect={setAccess} disabled={busy} ariaLabel="助手操作权限" appearance="text" className="min-w-0" />
        {busy ? <UiButton size="sm" onClick={() => { void getPlatform().embeddedAgent.cancel().catch(reportEmbeddedAgentError) }}><Square className="mr-1 h-3 w-3" />停止</UiButton>
          : <UiButton size="sm" variant="primary" disabled={!selectedModel || !toModelPromptText(document).trim()} onClick={send}><Send className="mr-1 h-3 w-3" />发送</UiButton>}
      </div>
    </div>
  </div>
}
