import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  AlertCircle,
  Bot,
  BrainCircuit,
  ChevronDown,
  CirclePause,
  CirclePlay,
  Square,
  UserRound,
} from 'lucide-react'

import {
  UI_INSET_SURFACE_CLASS,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiEmpty,
  UiError,
  UiIconButton,
  UiPanel,
} from '@/components/ui'
import type { AgentEvent } from '@/core/assistant/events'
import { agentQueuedMessagePayloadSchema, getAgentSessionMessageContent } from '@/core/assistant/session'
import type { AgentQueuedMessagePayload } from '@/core/assistant/session'
import {
  createEmptyPromptDocument,
  createPlainTextPromptDocument,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'

import { useAgentRun } from '../hooks/useAgentRun'
import { useAgentTranscript } from '../hooks/useAgentTranscript'
import {
  openAssistantCanvasResult,
  openAssistantGenerationResult,
} from '../results/openAssistantResult'
import { useAssistantUiStore } from '../store/assistantUiStore'
import { ApprovalCard } from './ApprovalCard'
import { AssistantMarkdown } from './AssistantMarkdown'
import { AssistantComposer } from './AssistantComposer'
import { ExecutionPlanCard } from './ExecutionPlanCard'
import {
  groupToolActivitiesForDisplay,
  selectExecutionPresentation,
  selectModelPublicUpdates,
  selectPendingApproval,
  selectToolActivities,
} from './agentRunReducer'
import { describeErrorRecovery } from './errorPresentation'
import { ModelProgressMessage } from './ModelProgressMessage'
import { ToolActivityGroup } from './ToolActivityGroup'

const terminalStatuses = new Set(['completed', 'failed', 'cancelled'])
const deferredBlockStyle: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 96px',
  contain: 'layout paint style',
}

function latestToolEventSequence(events: AgentEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type === 'ToolRequested' || event.type === 'ToolStarted' || event.type === 'ToolCompleted' || event.type === 'ToolFailed') {
      return event.sequence
    }
  }
  return 0
}

export function AssistantConversation(): JSX.Element {
  const run = useAgentRun()
  const startRun = run.start
  const [document, setDocument] = useState<PromptDocumentV1>(() => createEmptyPromptDocument())
  const [resultError, setResultError] = useState<string | null>(null)
  const [messageMode, setMessageMode] = useState<AgentQueuedMessagePayload['mode']>('current_task')
  const [activityExpanded, setActivityExpanded] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingHandledRef = useRef<string | null>(null)
  const toolActivitiesCacheRef = useRef<{
    runId: string | null
    eventSequence: number
    activities: ReturnType<typeof selectToolActivities>
  } | null>(null)
  const activeRunId = useAssistantUiStore((state) => state.activeRunId)
  const activityRunIdRef = useRef(activeRunId)
  const threadId = useAssistantUiStore((state) => state.threadId)
  const currentGoal = useAssistantUiStore((state) => state.currentGoal)
  const pendingGoal = useAssistantUiStore((state) => state.pendingGoal)
  const setPendingGoal = useAssistantUiStore((state) => state.setPendingGoal)
  const approvalMode = useAssistantUiStore((state) => state.approvalMode)
  const setApprovalMode = useAssistantUiStore((state) => state.setApprovalMode)
  const runState = run.view.runState
  const busy = Boolean(activeRunId && (!runState || !terminalStatuses.has(runState.status)))
  const runCanBeControlled = Boolean(
    runState
    && !terminalStatuses.has(runState.status)
    && runState.status !== 'waiting_external'
  )
  const waitingForAnswer = runState?.status === 'waiting_user'
  const clarificationWaitId = useMemo(() => {
    if (!waitingForAnswer) return undefined
    for (let index = run.view.events.length - 1; index >= 0; index -= 1) {
      const event = run.view.events[index]
      if (event.type === 'ClarificationRequired') return event.waitId
    }
    return runState.waitingClarificationId ?? undefined
  }, [run.view.events, runState, waitingForAnswer])
  const transcript = useAgentTranscript(
    threadId,
    `${activeRunId ?? 'none'}:${runState?.status ?? 'idle'}:${runState?.updatedAt ?? ''}:${run.queueRevision}`
  )
  const historicalMessages = useMemo(
    () => transcript.entries.filter((entry) => {
      if (entry.kind === 'queued_message') {
        const payload = agentQueuedMessagePayloadSchema.safeParse(entry.payload)
        return payload.success && !(payload.data.mode === 'after_task' && payload.data.status === 'consumed')
      }
      return entry.runId !== activeRunId
        && (entry.kind === 'user_message' || entry.kind === 'assistant_message')
    }),
    [activeRunId, transcript.entries]
  )

  useEffect(() => {
    if (waitingForAnswer) setMessageMode('clarification')
    else if (messageMode === 'clarification') setMessageMode('current_task')
  }, [messageMode, waitingForAnswer])

  useEffect(() => {
    if (!pendingGoal) {
      pendingHandledRef.current = null
      return
    }
    if (pendingHandledRef.current === pendingGoal) return
    pendingHandledRef.current = pendingGoal
    setDocument(createPlainTextPromptDocument(pendingGoal))
    setPendingGoal(null)
    if (!busy) {
      void startRun(pendingGoal).then((started) => {
        if (started) setDocument(createEmptyPromptDocument())
      })
    }
  }, [busy, pendingGoal, setPendingGoal, startRun])

  const toolEventSequence = latestToolEventSequence(run.view.events)
  const cachedToolActivities = toolActivitiesCacheRef.current
  const tools = cachedToolActivities?.runId === activeRunId && cachedToolActivities.eventSequence === toolEventSequence
    ? cachedToolActivities.activities
    : selectToolActivities(run.view.events)
  if (tools !== cachedToolActivities?.activities) {
    toolActivitiesCacheRef.current = { runId: activeRunId, eventSequence: toolEventSequence, activities: tools }
  }
  const toolGroups = useMemo(() => groupToolActivitiesForDisplay(tools), [tools])
  const modelUpdates = useMemo(() => selectModelPublicUpdates(run.view.events), [run.view.events])
  const approval = useMemo(() => selectPendingApproval(run.view.events), [run.view.events])
  const externalWait = useMemo(() => {
    for (let index = run.view.events.length - 1; index >= 0; index -= 1) {
      const event = run.view.events[index]
      if (event.type === 'ExternalWaitRegistered') return event
    }
    return null
  }, [run.view.events])
  const execution = useMemo(
    () => selectExecutionPresentation(runState, run.view.events),
    [run.view.events, runState]
  )
  const latestModelStep = useMemo(() => {
    for (let index = run.view.events.length - 1; index >= 0; index -= 1) {
      const event = run.view.events[index]
      if (event.type === 'ModelStarted') return event
    }
    return null
  }, [run.view.events])
  const streamedText = useMemo(() => {
    if (!latestModelStep) return ''
    return run.view.events.flatMap((event) => (
      event.type === 'ModelDelta' && event.stepId === latestModelStep.stepId ? [event.text] : []
    )).join('')
  }, [latestModelStep, run.view.events])
  const deferredStreamedText = useDeferredValue(streamedText)
  const modelResponseStreaming = Boolean(
    deferredStreamedText
    && latestModelStep
    && runState?.currentStepId === latestModelStep.stepId
  )
  const finalResponseStarted = Boolean(runState?.finalText) || Boolean(
    modelResponseStreaming
    && tools.every((activity) => activity.status === 'completed' || activity.status === 'failed')
  )
  const hasActiveTool = tools.some((activity) => activity.status === 'requested' || activity.status === 'running')
  useEffect(() => {
    if (activityRunIdRef.current !== activeRunId) {
      activityRunIdRef.current = activeRunId
      setActivityExpanded(!finalResponseStarted)
      return
    }
    if (finalResponseStarted) setActivityExpanded(false)
    else if (hasActiveTool) setActivityExpanded(true)
  }, [activeRunId, finalResponseStarted, hasActiveTool])
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current
      if (container) container.scrollTop = container.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [approval, deferredStreamedText, historicalMessages.length, runState?.status, tools.length])

  const submit = useCallback((goal: string): void => {
    if (busy) {
      void run.enqueue(goal, messageMode, clarificationWaitId).then((accepted) => {
        if (accepted) setDocument(createEmptyPromptDocument())
      })
      return
    }
    void startRun(goal).then((started) => {
      if (started) setDocument(createEmptyPromptDocument())
    })
  }, [busy, clarificationWaitId, messageMode, run, startRun])

  const openTask = useCallback((taskId: string): void => {
    setResultError(null)
    void openAssistantGenerationResult(taskId).then((opened) => {
      if (!opened) setResultError(`任务 ${taskId} 当前不存在或被筛选隐藏；你可以切到生成工作区后重新查找。`)
    })
  }, [])

  const openNode = useCallback((projectId: string, nodeId: string): void => {
    setResultError(null)
    void openAssistantCanvasResult(projectId, nodeId).then((opened) => {
      if (!opened) setResultError(`节点 ${nodeId} 当前无法定位；项目可能已删除或画布尚未准备完成。`)
    })
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-app">
      <div ref={scrollRef} className="ui-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-4 [contain:layout_paint_style]">
        {!runState && !currentGoal && historicalMessages.length === 0 && !transcript.loading ? (
          <UiEmpty
            className="min-h-full px-8"
            icon={<BrainCircuit className="h-7 w-7" />}
            title="让助手操作工作台"
            description="可以查找模型、创建生成任务、编排画布，或帮你排查问题。"
          />
        ) : null}

        {historicalMessages.map((entry) => {
          const content = getAgentSessionMessageContent(entry)
          if (!content) return null
          if (entry.kind === 'queued_message') {
            const payload = agentQueuedMessagePayloadSchema.safeParse(entry.payload)
            if (!payload.success) return null
            const statusLabel = payload.data.status === 'accepted'
              ? '待处理'
              : payload.data.status === 'consumed'
                ? '已处理'
                : payload.data.status === 'cancelled' ? '已取消' : '处理失败'
            const modeLabel = payload.data.mode === 'clarification'
              ? '回答当前问题'
              : payload.data.mode === 'current_task' ? '补充当前任务' : '任务结束后继续'
            return (
              <UiPanel key={entry.entryId} variant="inset" style={deferredBlockStyle} className="w-fit max-w-[80%] self-end p-3">
                <div className={`mb-1.5 flex items-center justify-end gap-1.5 text-right font-medium ${UI_TEXT_META_CLASS}`}>
                  <span>你 · {modeLabel} · {statusLabel}</span>
                  <UserRound className="h-3.5 w-3.5 shrink-0" />
                </div>
                <p className={`whitespace-pre-wrap break-words leading-6 ${UI_TEXT_BODY_CLASS}`}>{content}</p>
                {payload.data.status === 'accepted' ? (
                  <UiButton
                    type="button"
                    size="sm"
                    variant="plain"
                    className="mt-1.5 !h-7 px-2"
                    onClick={() => void run.cancelQueued(entry.entryId)}
                  >取消排队</UiButton>
                ) : payload.data.statusReason ? (
                  <p className={`mt-1 ${UI_TEXT_META_CLASS}`}>{payload.data.statusReason}</p>
                ) : null}
              </UiPanel>
            )
          }
          return entry.kind === 'user_message' ? (
            <UiPanel key={entry.entryId} variant="inset" style={deferredBlockStyle} className="w-fit max-w-[80%] self-end p-3">
              <div className={`mb-1.5 flex items-center justify-end gap-1.5 text-right font-medium ${UI_TEXT_META_CLASS}`}>
                <span>你</span>
                <UserRound className="h-3.5 w-3.5 shrink-0" />
              </div>
              <p className={`whitespace-pre-wrap break-words leading-6 ${UI_TEXT_BODY_CLASS}`}>{content}</p>
            </UiPanel>
          ) : (
            <section key={entry.entryId} style={deferredBlockStyle} className="w-full">
              <div className={`mb-1.5 flex items-center gap-1.5 font-medium ${UI_TEXT_META_CLASS}`}><Bot className="h-3.5 w-3.5" />助手</div>
              <AssistantMarkdown>{content}</AssistantMarkdown>
            </section>
          )
        })}

        {transcript.error ? (
          <UiError size="xs" message={transcript.error} onRetry={() => void transcript.refresh()} />
        ) : null}

        {/* 用户消息使用右侧有限宽度气泡；助手消息使用整行正文。 */}
        {currentGoal ? (
          <UiPanel variant="inset" style={deferredBlockStyle} className="w-fit max-w-[80%] self-end p-3">
            <div className={`mb-1.5 flex items-center justify-end gap-1.5 text-right font-medium ${UI_TEXT_META_CLASS}`}>
              <span>你</span>
              <UserRound className="h-3.5 w-3.5 shrink-0" />
            </div>
            <p className={`whitespace-pre-wrap break-words leading-6 ${UI_TEXT_BODY_CLASS}`}>{currentGoal}</p>
          </UiPanel>
        ) : null}

        {runState ? (
          <div className={`flex items-center gap-1.5 font-medium ${UI_TEXT_META_CLASS}`}>
            <Bot className="h-3.5 w-3.5 shrink-0" />
            <span>助手</span>
          </div>
        ) : null}

        {runState ? (
          <section className={`rounded-lg ${UI_INSET_SURFACE_CLASS}`}>
            <div className="flex items-center gap-1">
              <UiButton
                type="button"
                variant="plain"
                onClick={() => setActivityExpanded((expanded) => !expanded)}
                aria-expanded={activityExpanded}
                className="!h-8 min-w-0 flex-1 justify-start gap-2 !rounded-lg !px-2 text-left"
              >
                <span className={`shrink-0 font-medium ${UI_TEXT_META_CLASS}`}>执行过程</span>
                <span className={`min-w-0 flex-1 truncate ${UI_TEXT_META_CLASS}`}>
                  {terminalStatuses.has(runState.status)
                    ? runState.status === 'completed' ? '已完成' : runState.status === 'failed' ? '未完成' : '已取消'
                    : execution.nextAction}
                </span>
                <ChevronDown className={`h-3 w-3 shrink-0 text-text-muted transition-transform duration-200 ${activityExpanded ? 'rotate-180' : ''}`} />
              </UiButton>
              {runCanBeControlled ? (
                <>
                  <UiIconButton
                    type="button"
                    showBorder={false}
                    appearance="hover-only"
                    title={runState.status === 'paused' ? '继续' : '暂停'}
                    onClick={() => void (runState.status === 'paused' ? run.resume() : run.pause())}
                    className="!h-7 !w-7 !rounded-lg"
                  >
                    {runState.status === 'paused'
                      ? <CirclePlay className="h-3.5 w-3.5" />
                      : <CirclePause className="h-3.5 w-3.5" />}
                  </UiIconButton>
                  <UiIconButton
                    type="button"
                    showBorder={false}
                    appearance="hover-only"
                    title="停止"
                    hoverVariant="danger"
                    onClick={() => void run.cancel()}
                    className="!h-7 !w-7 !rounded-lg"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </UiIconButton>
                </>
              ) : null}
            </div>

            <div
              className={`grid transition-[grid-template-rows,opacity] duration-200 ${
                activityExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div
                aria-hidden={!activityExpanded}
                className={`min-h-0 overflow-hidden ${activityExpanded ? '' : 'pointer-events-none select-none'}`}
              >
                <div className={`space-y-1 border-t border-border-dark/60 p-1.5 transition-transform duration-200 ${
                  activityExpanded ? 'translate-y-0' : '-translate-y-2'
                }`}>
                  <ExecutionPlanCard presentation={execution} runStatus={runState.status} />
                  {modelUpdates.map((update) => <ModelProgressMessage key={update.stepId} update={update} />)}
                  {toolGroups.length > 0 ? (
                    <section aria-label="助手工具执行记录" className="space-y-1">
                      {toolGroups.map((group) => (
                        <ToolActivityGroup
                          key={group.groupId}
                          group={group}
                          onOpenTask={openTask}
                          onOpenNode={openNode}
                        />
                      ))}
                    </section>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {runState?.status === 'waiting_external' && externalWait ? (
          <UiPanel variant="inset" className="p-3">
            <div className={UI_TEXT_BODY_CLASS}>正在等待生成任务 {externalWait.taskId} 的最终结果</div>
            <p className={`mt-1 ${UI_TEXT_META_CLASS}`}>
              最晚等待到 {new Date(externalWait.expiresAt).toLocaleString()}；等待期间可以继续补充要求。
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <UiButton
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void run.cancelExternalWait(externalWait.waitId, false)}
              >仅停止等待</UiButton>
              <UiButton
                type="button"
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() => void run.cancelExternalWait(externalWait.waitId, true)}
              >停止等待并取消生成</UiButton>
            </div>
          </UiPanel>
        ) : null}

        {approval ? <ApprovalCard approval={approval} onDecision={(decision) => void run.respondApproval(approval.approvalId, decision)} /> : null}

        {modelResponseStreaming && runState && !terminalStatuses.has(runState.status) ? (
          <section style={deferredBlockStyle} className="w-full">
            <AssistantMarkdown>{deferredStreamedText}</AssistantMarkdown>
          </section>
        ) : null}

        {runState?.finalText ? (
          <section style={deferredBlockStyle} className="w-full">
            <AssistantMarkdown>{runState.finalText}</AssistantMarkdown>
          </section>
        ) : null}

        {/* 错误块靠语义色底提示，不再加边框——它已在侧栏卡片内部，加框就是第二层卡片 */}
        {runState?.error ? (
          <section style={deferredBlockStyle} className="rounded-lg bg-danger/10 p-3 text-xs text-danger">
            <div className="flex items-center gap-1.5 font-medium"><AlertCircle className="h-4 w-4" />{runState.error.code}</div>
            <p className="mt-1.5 leading-5">{runState.error.message}</p>
            <p className="mt-1.5 leading-5 text-text-muted">下一步：{describeErrorRecovery(runState.error)}</p>
          </section>
        ) : null}

        {run.view.actionError || resultError ? (
          <section style={deferredBlockStyle} className="rounded-lg bg-danger/10 p-3 text-xs text-danger">
            <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span className="leading-5">{run.view.actionError ?? resultError}</span></div>
            <UiButton type="button" size="sm" variant="ghost" onClick={() => { run.clearActionError(); setResultError(null) }} className="mt-2 h-7 px-2">知道了</UiButton>
          </section>
        ) : null}

      </div>

      <AssistantComposer
        value={document}
        onChange={setDocument}
        onSubmit={submit}
        disabled={false}
        busy={busy}
        waitingForAnswer={waitingForAnswer}
        messageMode={messageMode}
        onMessageModeChange={setMessageMode}
        submitting={run.submitting}
        approvalMode={approvalMode}
        onApprovalModeChange={setApprovalMode}
      />
    </div>
  )
}
