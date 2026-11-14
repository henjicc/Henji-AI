import { revertMemory } from '@/services/assistantMemory/memoryService'
import { UiFieldMessage } from '@/components/ui'
import { UiSpinner } from '@/components/ui'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { withPaidOperation } from '@/services/paidApproval'
import { assistantErrorMessage } from '@/core/assistant/assistantErrorPresentation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw, Sparkles } from 'lucide-react'
import { Dropdown, UiButton, UiEmpty, UiError } from '@/components/ui'
import { createEmptyPromptDocument, createPlainTextPromptDocument, toModelPromptText } from '@/core/inputs/promptDocument'
import { buildEmbeddedPromptContext, type EmbeddedAgentModel, type EmbeddedAgentPrompt, type EmbeddedPermissionMode } from '@/core/assistant/embeddedAgent'
import { getPlatform } from '@/platform/runtime'
import { useUiStore } from '@/stores/uiStore'
import { useAssistantUiStore, type AssistantGoalOptions } from '../store/assistantUiStore'
import { captureHostSelection, createHostContextSnapshot } from '../../application-control/hostContext/hostContext'
import { EmbeddedTranscript, EmbeddedUserMessage } from './EmbeddedTranscript'
import { useConversationAutoScroll } from '../conversation/useConversationAutoScroll'
import { isEmbeddedAgentHydrated, reportEmbeddedAgentError, useEmbeddedAgent } from './controller'
import type { AgentAttachment } from '@/core/assistant/attachments'
import { AssistantComposer } from '../conversation/AssistantComposer'
import type { AssistantAttachmentDraft } from '../conversation/assistantAttachments'
import { AudioEditAssistantAction } from '@/features/audioEdit/AudioEditAssistantAction'
import { LLM_CONFIG_CHANGED_EVENT } from '@/core/llm/events'
import { AssistantModelControls } from './AssistantModelControls'
import { EmbeddedTakeover } from './EmbeddedTakeover'

type Delivery = NonNullable<EmbeddedAgentPrompt['delivery']>
const MODE_OPTIONS: Array<{ value: EmbeddedPermissionMode; label: string; description: string }> = [
  { value: 'auto', label: '自动', description: '直接做，删除进回收站，付费按额度' },
  { value: 'ask', label: '改前先问', description: '运行命令、改文件前先问你' },
  { value: 'plan', label: '只计划', description: '只查不改，交出计划等你点头' },
]
const DELIVERY_OPTIONS: Array<{ value: Delivery; label: string; description: string }> = [
  { value: 'wait', label: '排队', description: '这轮做完再发' },
  { value: 'steer', label: '插入', description: '不停下，下一步就看到' },
  { value: 'interrupt', label: '打断', description: '停掉这轮，先处理这条' },
]
const SEND_LABELS: Readonly<Record<Delivery, string>> = { wait: '排队发送', steer: '插入发送', interrupt: '打断发送' }
/** 模式是这台电脑上的个人习惯：记在本机，读不到就用自动。 */
const MODE_STORAGE_KEY = 'henji.assistant.permission_mode'
function readStoredMode(): EmbeddedPermissionMode {
  try { const value = localStorage.getItem(MODE_STORAGE_KEY); return MODE_OPTIONS.some(option => option.value === value) ? value as EmbeddedPermissionMode : 'auto' } catch { return 'auto' }
}

export function EmbeddedConversation(): JSX.Element {
  const state = useEmbeddedAgent()
  const [document, setDocument] = useState(createEmptyPromptDocument)
  const [models, setModels] = useState<EmbeddedAgentModel[]>([])
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const pendingGoal = useAssistantUiStore(store => store.pendingGoal)
  const [delivery, setDelivery] = useState<Delivery>('wait')
  const [mode, setModeState] = useState(readStoredMode)
  const setMode = useCallback((value: EmbeddedPermissionMode): void => {
    setModeState(value)
    try { localStorage.setItem(MODE_STORAGE_KEY, value) } catch { /* 记不住只影响下次打开的默认值 */ }
  }, [])
  const [submitting, setSubmitting] = useState(false)
  const [preparedRequest, setPreparedRequest] = useState<AssistantGoalOptions | undefined>()
  const [attachments, setAttachments] = useState<AssistantAttachmentDraft[]>([])
  const scroll = useConversationAutoScroll(state.sessionId)
  const [revertedMemories, setRevertedMemories] = useState<string[]>([])
  const [optimistic, setOptimistic] = useState<{ id: string; text: string; attachments: AgentAttachment[] } | null>(null)
  const previousSession = useRef(state.sessionId)
  const settingsOpen = useUiStore((store) => store.isSettingsOpen)
  const selectedModel = models[0]
  // 设置页或输入框底栏换了助手模型都会改配置，配置变了就重新取当前模型
  const [configVersion, setConfigVersion] = useState(0)
  useEffect(() => {
    const bump = (): void => setConfigVersion(value => value + 1)
    window.addEventListener(LLM_CONFIG_CHANGED_EVENT, bump)
    return () => window.removeEventListener(LLM_CONFIG_CHANGED_EVENT, bump)
  }, [])
  useEffect(() => {
    let disposed = false
    setModelsLoaded(false)
    void getPlatform().embeddedAgent.models().then((items) => { if (!disposed) { setModels(items); setModelsLoaded(true) } }, error => {
      if (!disposed) { setModels([]); setModelsLoaded(true); reportEmbeddedAgentError(error) }
    })
    return () => { disposed = true }
  }, [settingsOpen, configVersion])
  const busy = submitting || state.busy
  // 回复中才有“停止 / 打断”；切换对话中（switching）同样算忙，但只能排队等待，切换完成后发送
  const replying = state.busy && !state.switching
  const switching = state.switching === true
  useEffect(() => {
    if (previousSession.current && previousSession.current !== state.sessionId && !busy) {
      setDocument(createEmptyPromptDocument()); setAttachments([])
    }
    previousSession.current = state.sessionId
  }, [state.sessionId, busy])
  const send = useCallback((text: string, submittedAttachments: AgentAttachment[], request?: AssistantGoalOptions): void => {
    if (!text || !selectedModel || !modelsLoaded || submitting) return
    const prepared = request ?? preparedRequest
    try { prepared?.beforeSend?.(); prepared?.onTextSubmitted?.(text) } catch (error) { reportEmbeddedAgentError(error); return }
    setSubmitting(true)
    const clientMessageId = crypto.randomUUID()
    setOptimistic({ id: clientMessageId, text, attachments: submittedAttachments })
    scroll.scrollToBottom()
    const sentDocument = document
    const sentAttachments = attachments
    if (!request) { setDocument(createEmptyPromptDocument()); setAttachments([]) }
    const context = createHostContextSnapshot()
    void withPaidOperation({ category: 'generation', titleKey: 'paidApproval.assistantChat', capabilityId: 'ui_assistant_chat', messageKey: 'paidApproval.assistantChatContent' }, () => getPlatform().embeddedAgent.prompt({ text, clientMessageId, model: { providerId: selectedModel.providerId, modelId: selectedModel.modelId },
      ...(prepared?.context === undefined ? { selectionSnapshot: captureHostSelection() } : {}),
      context: prepared?.context ?? buildEmbeddedPromptContext(context), attachments: submittedAttachments, delivery: request || switching ? 'wait' : delivery, permissionMode: mode }))
      .then(() => { setPreparedRequest(undefined) })
      .catch(error => {
        try { prepared?.onRejected?.() } catch (rollbackError) { reportEmbeddedAgentError(rollbackError) }
        if (!request) { setDocument(sentDocument); setAttachments(sentAttachments) }
        reportEmbeddedAgentError(error)
      })
      .finally(() => { setOptimistic(null); setSubmitting(false) })
  }, [attachments, delivery, document, mode, modelsLoaded, preparedRequest, scroll, selectedModel, submitting, switching])
  useEffect(() => {
    if (!pendingGoal || !modelsLoaded || submitting) return
    const pending = useAssistantUiStore.getState()
    if (pending.pendingGoal !== pendingGoal) return
    const options = pending.pendingGoalOptions
    // Consume before submission: StrictMode and snapshot updates must not resend.
    pending.setPendingGoal(null)
    if (options?.autoSend && selectedModel) send(pendingGoal, (options.attachments ?? []).map(item => item.attachment), options)
    else if (options?.appendToDraft) {
      setDocument(current => toModelPromptText(current).trim() ? current : createPlainTextPromptDocument(pendingGoal))
      setAttachments(current => [...new Map([...current, ...(options.attachments ?? [])].map(item => [item.attachment.mediaRef, item])).values()])
    } else { setDocument(createPlainTextPromptDocument(pendingGoal)); setAttachments(options?.attachments ?? []); setPreparedRequest(options ?? undefined) }
  }, [modelsLoaded, pendingGoal, selectedModel, send, submitting])
  const isEmpty = !state.messages.length && !state.sendingMessage && !optimistic && !state.pendingMessages?.length
  const needsModel = modelsLoaded && models.length === 0
  const openModelSettings = (): void => useUiStore.getState().openSettings({ tab: 'assistant', sectionId: 'assistant-models' })
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
      {isEmpty && !isEmbeddedAgentHydrated() ? null : isEmpty ? (needsModel
        ? <UiEmpty size="sm" icon={<Sparkles aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.lg}`} />} title="先设置助手模型"
          description="助手需要一个支持工具调用的模型，才能查看项目、调整参数和安排任务。"
          action={<UiButton variant="secondary" onClick={openModelSettings}>设置可调用工具的模型</UiButton>} />
        : <UiEmpty size="sm" icon={<Sparkles aria-hidden="true" className={`${UI_ICON_SIZE_CLASS.lg}`} />} title="从当前工作开始"
          description="可以让我查看项目、调整参数，或帮你安排创作任务。" />)
        : <EmbeddedTranscript messages={state.messages} busy={state.busy} onToggle={scroll.suspendFollowing} />}
      {state.memoryNotices?.map(notice => <UiFieldMessage key={notice.historyId} tone="hint">{notice.text} · {revertedMemories.includes(notice.historyId) ? '已撤销' : <UiButton size="sm" onClick={() => { void revertMemory(notice.historyId).then(() => setRevertedMemories(values => [...values, notice.historyId]), reportEmbeddedAgentError) }}>撤销</UiButton>}</UiFieldMessage>)}
      {state.sendingMessage ? <EmbeddedUserMessage message={state.sendingMessage} /> : null}
      {optimistic && state.sendingMessage?.id !== optimistic.id && !state.pendingMessages?.some(message => message.id === optimistic.id)
        ? <EmbeddedUserMessage message={optimistic} /> : null}
      {busy ? <div role="status" aria-label={switching ? "正在切换对话" : "助手正在回复"} className="flex h-6 items-center">
        <UiSpinner size="sm" tone="accent" />
      </div> : null}
      {state.pendingMessages?.map(message => <div key={message.id} className="space-y-1"><EmbeddedUserMessage message={message} />
        <UiFieldMessage tone={message.error ? 'error' : 'hint'} className="text-right">{message.error ? `发送未完成：${assistantErrorMessage(message.error)}` : '等待发送'}</UiFieldMessage></div>)}
      </div>
    </div>
    <AudioEditAssistantAction disabled={busy || !selectedModel} />
    {state.error || (needsModel && !isEmpty) ? <div className="px-4">
      {state.error ? <UiError message={assistantErrorMessage(state.error)} title="操作未完成" size="xs" align="start"
        actions={canRetry ? <UiButton size="sm" onClick={retry} tooltip="重新发送上一条消息">
          <RotateCcw aria-hidden="true" className={`mr-1`} />重试</UiButton> : undefined} /> : null}
      {needsModel && !isEmpty ? <UiButton variant="secondary" onClick={openModelSettings}>设置可调用工具的模型</UiButton> : null}
    </div> : null}
    {state.pendingApproval || state.pendingQuestion ? <EmbeddedTakeover approval={state.pendingApproval} question={state.pendingQuestion}
      onDecide={decision => { if (state.pendingApproval) void getPlatform().embeddedAgent.decideApproval({ id: state.pendingApproval.id, ...decision }).catch(reportEmbeddedAgentError) }}
      onAnswer={answer => {
        if (!state.pendingQuestion) return
        if (answer.permissionMode) setMode(answer.permissionMode)
        void getPlatform().embeddedAgent.answerQuestion({ id: state.pendingQuestion.id, ...answer }).catch(reportEmbeddedAgentError)
      }} /> : <AssistantComposer key={state.sessionId ?? 'new'} value={document} onChange={setDocument} onSubmit={send} attachments={attachments} onAttachmentsChange={setAttachments}
      inputModalities={selectedModel?.inputModalities ?? []} attachmentsDisabled={submitting || !selectedModel} disabled={submitting || !selectedModel || !modelsLoaded}
      busy={busy} submitting={submitting}
      onCancel={replying ? () => { void getPlatform().embeddedAgent.cancel().catch(reportEmbeddedAgentError) } : undefined}
      sendLabel={busy ? replying ? SEND_LABELS[delivery] : SEND_LABELS.wait : '发送'}
      controls={<>
        <Dropdown<EmbeddedPermissionMode> value={mode} options={MODE_OPTIONS} onSelect={setMode} ariaLabel="助手模式" appearance="text" size="sm" changed={mode !== 'auto'}
          className="shrink-0" buttonClassName="w-auto" panelWidthStrategy="options" />
        <AssistantModelControls disabled={submitting} onSwitching={() => setModelsLoaded(false)} />
        {replying ? <Dropdown<Delivery> value={delivery} options={DELIVERY_OPTIONS} onSelect={setDelivery} ariaLabel="发送方式" appearance="text" size="sm" className="min-w-0" buttonClassName="w-auto max-w-full" panelWidthStrategy="options" /> : null}</>} />}
  </div>
}
