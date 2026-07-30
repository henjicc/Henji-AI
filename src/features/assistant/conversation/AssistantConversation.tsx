import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AlertCircle, Bot, BrainCircuit, UserRound } from 'lucide-react'

import { UI_TEXT_BODY_CLASS, UI_TEXT_META_CLASS, UiButton, UiEmpty, UiError, UiPanel } from '@/components/ui'
import type { AgentEvent } from '@/core/assistant/events'
import { getAgentSessionMessageContent } from '@/core/assistant/session'
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
import { RunStatusBar } from './RunStatusBar'
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const pendingHandledRef = useRef<string | null>(null)
  const toolActivitiesCacheRef = useRef<{
    runId: string | null
    eventSequence: number
    activities: ReturnType<typeof selectToolActivities>
  } | null>(null)
  const activeRunId = useAssistantUiStore((state) => state.activeRunId)
  const threadId = useAssistantUiStore((state) => state.threadId)
  const currentGoal = useAssistantUiStore((state) => state.currentGoal)
  const pendingGoal = useAssistantUiStore((state) => state.pendingGoal)
  const setPendingGoal = useAssistantUiStore((state) => state.setPendingGoal)
  const approvalMode = useAssistantUiStore((state) => state.approvalMode)
  const setApprovalMode = useAssistantUiStore((state) => state.setApprovalMode)
  const runState = run.view.runState
  const busy = Boolean(activeRunId && (!runState || !terminalStatuses.has(runState.status)))
  const transcript = useAgentTranscript(
    threadId,
    `${activeRunId ?? 'none'}:${runState?.status ?? 'idle'}:${runState?.updatedAt ?? ''}`
  )
  const historicalMessages = useMemo(
    () => transcript.entries.filter((entry) => (
      entry.runId !== activeRunId
      && (entry.kind === 'user_message' || entry.kind === 'assistant_message')
    )),
    [activeRunId, transcript.entries]
  )

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
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const container = scrollRef.current
      if (container) container.scrollTop = container.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [approval, deferredStreamedText, historicalMessages.length, runState?.status, tools.length])

  const submit = useCallback((goal: string): void => {
    void startRun(goal).then((started) => {
      if (started) setDocument(createEmptyPromptDocument())
    })
  }, [startRun])

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
      {runState ? (
        <RunStatusBar
          state={runState}
          events={run.view.events}
          currentAction={execution.nextAction}
          verificationPassed={execution.verification?.passed ?? null}
          onPause={() => void run.pause()}
          onResume={() => void run.resume()}
          onCancel={() => void run.cancel()}
          onRefresh={() => void run.refresh()}
        />
      ) : null}

      <div ref={scrollRef} className="ui-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4 [contain:layout_paint_style]">
        {!runState && !currentGoal && historicalMessages.length === 0 && !transcript.loading ? (
          <UiEmpty
            className="min-h-full px-8"
            icon={<BrainCircuit className="h-7 w-7" />}
            title="让助手操作工作台"
            description="可以切换工作区、查模型、创建可见生成任务、编排画布节点，或基于脱敏日志诊断错误。所有动作都经过受控工具网关。"
          />
        ) : null}

        {historicalMessages.map((entry) => {
          const content = getAgentSessionMessageContent(entry)
          if (!content) return null
          return entry.kind === 'user_message' ? (
            <UiPanel key={entry.entryId} variant="inset" style={deferredBlockStyle} className="ml-7 p-3">
              <div className={`mb-1.5 flex items-center gap-1.5 font-medium ${UI_TEXT_META_CLASS}`}><UserRound className="h-3.5 w-3.5" />你</div>
              <p className={`whitespace-pre-wrap break-words leading-6 ${UI_TEXT_BODY_CLASS}`}>{content}</p>
            </UiPanel>
          ) : (
            <section key={entry.entryId} style={deferredBlockStyle} className="mr-7">
              <div className={`mb-1.5 flex items-center gap-1.5 font-medium ${UI_TEXT_META_CLASS}`}><Bot className="h-3.5 w-3.5" />助手</div>
              <AssistantMarkdown>{content}</AssistantMarkdown>
            </section>
          )
        })}

        {transcript.error ? (
          <UiError size="xs" message={transcript.error} onRetry={() => void transcript.refresh()} />
        ) : null}

        {/* 用户消息短、需要边界感，用 inset（比侧栏底色更暗）；助手消息长，只留缩进不套容器 */}
        {currentGoal ? (
          <UiPanel variant="inset" style={deferredBlockStyle} className="ml-7 p-3">
            <div className={`mb-1.5 flex items-center gap-1.5 font-medium ${UI_TEXT_META_CLASS}`}><UserRound className="h-3.5 w-3.5" />你的目标</div>
            <p className={`whitespace-pre-wrap break-words leading-6 ${UI_TEXT_BODY_CLASS}`}>{currentGoal}</p>
          </UiPanel>
        ) : null}

        {runState ? <ExecutionPlanCard presentation={execution} runStatus={runState.status} /> : null}

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

        {approval ? <ApprovalCard approval={approval} onDecision={(decision) => void run.respondApproval(approval.approvalId, decision)} /> : null}

        {deferredStreamedText && runState && !terminalStatuses.has(runState.status) ? (
          <section style={deferredBlockStyle} className="mr-7">
            <div className={`mb-1.5 flex items-center gap-1.5 font-medium ${UI_TEXT_META_CLASS}`}><Bot className="h-3.5 w-3.5" />回应生成中</div>
            <AssistantMarkdown>{deferredStreamedText}</AssistantMarkdown>
          </section>
        ) : null}

        {runState?.finalText ? (
          <section style={deferredBlockStyle} className="mr-7">
            <div className={`mb-1.5 flex items-center gap-1.5 font-medium ${UI_TEXT_META_CLASS}`}><Bot className="h-3.5 w-3.5" />助手</div>
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

        {run.view.connection === 'recovering' ? <div className={`text-center ${UI_TEXT_META_CLASS}`}>正在恢复运行事件…</div> : null}
      </div>

      <AssistantComposer
        value={document}
        onChange={setDocument}
        onSubmit={submit}
        disabled={busy}
        submitting={run.submitting}
        approvalMode={approvalMode}
        onApprovalModeChange={setApprovalMode}
      />
    </div>
  )
}
