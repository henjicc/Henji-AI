import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react'
import {
  AlertCircle,
  ArrowDown,
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
import {
  agentQueuedMessagePayloadSchema,
  getAgentSessionMessageAttachments,
  getAgentSessionMessageContent,
} from '@/core/assistant/session'
import type { AgentQueuedMessagePayload } from '@/core/assistant/session'
import type { AgentAttachment } from '@/core/assistant/attachments'
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
import { ModelProgressMessage } from './ModelProgressMessage'
import {
  groupToolActivitiesForDisplay,
  selectLatestToolEventSequence,
  selectExecutionPresentation,
  selectModelPublicUpdates,
  selectPendingApproval,
  selectToolActivities,
} from './agentRunReducer'
import { describeStructuredError } from './errorPresentation'
import { ToolActivityGroup } from './ToolActivityGroup'
import { useConversationAutoScroll } from './useConversationAutoScroll'
import {
  refreshAssistantAttachments,
  assistantAttachmentDraftReducer,
} from './assistantAttachments'

const terminalStatuses = new Set(['completed', 'budget_exhausted', 'failed', 'cancelled'])
const deferredBlockStyle: CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 96px',
  contain: 'layout paint style',
}

function AssistantMessageAttachments({ attachments }: { attachments: AgentAttachment[] }): JSX.Element | null {
  const [resolved, setResolved] = useState<Awaited<ReturnType<typeof refreshAssistantAttachments>>>([])
  useEffect(() => {
    let active = true
    void refreshAssistantAttachments(attachments).then(items => { if (active) setResolved(items) })
    return () => { active = false }
  }, [attachments])
  if (attachments.length === 0) return null
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {attachments.map((attachment, index) => {
        const asset = resolved[index]?.asset
        const unavailable = !asset || asset.inspectionStatus !== 'ready'
        return (
          <div key={attachment.mediaRef} className="min-w-0 overflow-hidden rounded-lg border border-border-dark bg-surface-dark">
            {!unavailable && attachment.modality === 'image' ? (
              <img src={asset.displayUrl} alt={attachment.displayName} className="h-24 w-full object-cover" />
            ) : !unavailable && attachment.modality === 'video' ? (
              <video src={asset.displayUrl} aria-label={attachment.displayName} className="h-24 w-full object-cover" controls />
            ) : !unavailable ? (
              <audio src={asset.displayUrl} aria-label={attachment.displayName} className="h-16 w-full px-1" controls />
            ) : (
              <div className={`flex h-16 items-center justify-center px-2 text-center ${UI_TEXT_META_CLASS}`}>附件源已失效</div>
            )}
            <div className={`truncate px-2 py-1.5 ${UI_TEXT_META_CLASS}`}>{attachment.displayName}</div>
          </div>
        )
      })}
    </div>
  )
}

export function AssistantConversation(): JSX.Element {
  const run = useAgentRun()
  const startRun = run.start
  const [document, setDocument] = useState<PromptDocumentV1>(() => createEmptyPromptDocument())
  const [attachments, dispatchAttachments] = useReducer(assistantAttachmentDraftReducer, [])
  const [resultError, setResultError] = useState<string | null>(null)
  const [messageMode, setMessageMode] = useState<AgentQueuedMessagePayload['mode']>('current_task')
  const [activityExpanded, setActivityExpanded] = useState(true)
  const pendingHandledRef = useRef<string | null>(null)
  const toolActivitiesCacheRef = useRef<{
    runId: string | null
    eventSequence: number
    activities: ReturnType<typeof selectToolActivities>
  } | null>(null)
  const activeRunId = useAssistantUiStore((state) => state.activeRunId)
  const conversationScroll = useConversationAutoScroll(activeRunId)
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
      if (entry.kind !== 'user_message' && entry.kind !== 'assistant_message') return false
      return entry.runId !== activeRunId || entry.kind === 'user_message'
    }),
    [activeRunId, transcript.entries]
  )
  const hasCurrentRunUserMessage = historicalMessages.some(entry => (
    entry.runId === activeRunId && entry.kind === 'user_message'
  ))

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

  const toolEventSequence = selectLatestToolEventSequence(run.view.events)
  const cachedToolActivities = toolActivitiesCacheRef.current
  const tools = cachedToolActivities?.runId === activeRunId && cachedToolActivities.eventSequence === toolEventSequence
    ? cachedToolActivities.activities
    : selectToolActivities(run.view.events)
  if (tools !== cachedToolActivities?.activities) {
    toolActivitiesCacheRef.current = { runId: activeRunId, eventSequence: toolEventSequence, activities: tools }
  }
  const modelUpdates = useMemo(() => selectModelPublicUpdates(run.view.events), [run.view.events])
  const executionTimeline = useMemo(() => {
    const ordered = [
      ...tools.map((activity) => ({
        kind: 'tool' as const,
        sequence: activity.sequence,
        activity,
      })),
      ...modelUpdates.map((update) => ({
        kind: 'model' as const,
        sequence: update.sequence,
        update,
      })),
    ].sort((left, right) => left.sequence - right.sequence)
    const timeline: Array<
      | { kind: 'model'; sequence: number; update: (typeof modelUpdates)[number] }
      | { kind: 'tools'; sequence: number; groups: ReturnType<typeof groupToolActivitiesForDisplay> }
    > = []
    let pendingTools: typeof tools = []
    const flushTools = (): void => {
      if (pendingTools.length === 0) return
      timeline.push({
        kind: 'tools',
        sequence: pendingTools[0].sequence,
        groups: groupToolActivitiesForDisplay(pendingTools),
      })
      pendingTools = []
    }
    for (const item of ordered) {
      if (item.kind === 'tool') {
        pendingTools.push(item.activity)
      } else {
        flushTools()
        timeline.push(item)
      }
    }
    flushTools()
    return timeline
  }, [modelUpdates, tools])
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
  const finalResponseStarted = Boolean(runState?.finalText)
  const runErrorPresentation = runState?.error ? describeStructuredError(runState.error) : null
  useEffect(() => {
    if (activityRunIdRef.current !== activeRunId) {
      activityRunIdRef.current = activeRunId
      setActivityExpanded(true)
      return
    }
    if (finalResponseStarted) setActivityExpanded(false)
  }, [activeRunId, finalResponseStarted])
  const submit = useCallback((goal: string, submittedAttachments: AgentAttachment[]): void => {
    if (busy) {
      void run.enqueue(goal, messageMode, clarificationWaitId).then((accepted) => {
        if (accepted) setDocument(createEmptyPromptDocument())
      })
      return
    }
    void startRun(goal, submittedAttachments).then((started) => {
      if (started) {
        setDocument(createEmptyPromptDocument())
        dispatchAttachments({ type: 'clear' })
      }
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
    // 不自带底色：面板表面由 AssistantSidebar 统一提供，正文与顶栏、输入区同为一块连续表面
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="relative flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
        <div
          ref={conversationScroll.viewportRef}
          tabIndex={0}
          aria-label="助手对话记录"
          onScroll={conversationScroll.onScroll}
          onWheel={conversationScroll.onWheel}
          onKeyDown={conversationScroll.onKeyDown}
          className="ui-scrollbar min-h-0 min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-4 outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-accent [contain:layout_paint_style]"
        >
          <div ref={conversationScroll.contentRef} className="flex min-h-full min-w-0 flex-col gap-2">
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
              <UiPanel key={entry.entryId} variant="inset" style={deferredBlockStyle} className="min-w-0 w-fit max-w-[80%] self-end p-3">
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
            <UiPanel key={entry.entryId} variant="inset" style={deferredBlockStyle} className="min-w-0 w-fit max-w-[80%] self-end p-3">
              <div className={`mb-1.5 flex items-center justify-end gap-1.5 text-right font-medium ${UI_TEXT_META_CLASS}`}>
                <span>你</span>
                <UserRound className="h-3.5 w-3.5 shrink-0" />
              </div>
              <p className={`whitespace-pre-wrap break-words leading-6 ${UI_TEXT_BODY_CLASS}`}>{content}</p>
              <AssistantMessageAttachments attachments={getAgentSessionMessageAttachments(entry)} />
            </UiPanel>
          ) : (
            <section key={entry.entryId} style={deferredBlockStyle} className="min-w-0 w-full max-w-full overflow-hidden">
              <div className={`mb-1.5 flex items-center gap-1.5 font-medium ${UI_TEXT_META_CLASS}`}><Bot className="h-3.5 w-3.5" />助手</div>
              <AssistantMarkdown>{content}</AssistantMarkdown>
            </section>
          )
        })}

        {transcript.error ? (
          <UiError size="xs" message={transcript.error} onRetry={() => void transcript.refresh()} />
        ) : null}

        {/* 用户消息使用右侧有限宽度气泡；助手消息使用整行正文。 */}
        {currentGoal && !hasCurrentRunUserMessage ? (
          <UiPanel variant="inset" style={deferredBlockStyle} className="min-w-0 w-fit max-w-[80%] self-end p-3">
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
          <section className={`min-w-0 max-w-full overflow-hidden rounded-lg ${UI_INSET_SURFACE_CLASS}`}>
            <div className="flex items-center gap-1">
              <UiButton
                type="button"
                variant="plain"
                onClick={() => {
                  // 手动展开/收起要保持点击位置不动；自动展开（第 247/250 行）不走这里。
                  conversationScroll.suspendFollowing()
                  setActivityExpanded((expanded) => !expanded)
                }}
                aria-expanded={activityExpanded}
                className="!h-8 min-w-0 flex-1 justify-start gap-2 !rounded-lg !px-2 text-left"
              >
                <span className={`shrink-0 font-medium ${UI_TEXT_META_CLASS}`}>执行过程</span>
                <span className={`min-w-0 flex-1 truncate ${UI_TEXT_META_CLASS}`}>
                  {terminalStatuses.has(runState.status)
                    ? runState.status === 'completed'
                      ? '已完成'
                      : runState.status === 'budget_exhausted'
                        ? runState.error ? '已达任务预算，需要确认后继续' : '准备续跑'
                        : runState.status === 'failed' ? '未完成' : '已取消'
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
                <div className={`min-w-0 space-y-1 border-t border-border-dark/60 p-1.5 transition-transform duration-200 ${
                  activityExpanded ? 'translate-y-0' : '-translate-y-2'
                }`}>
                  <ExecutionPlanCard presentation={execution} runStatus={runState.status} />
                  {executionTimeline.map((item) => (
                    item.kind === 'model'
                      ? (
                          <ModelProgressMessage
                            key={`model:${item.update.stepId}:${item.sequence}`}
                            update={item.update}
                          />
                        )
                      : (
                          <section
                            key={`tools:${item.sequence}`}
                            aria-label="助手工具执行记录"
                            className="space-y-1"
                          >
                            {item.groups.map((group) => (
                              <ToolActivityGroup
                                key={group.groupId}
                                group={group}
                                onOpenTask={openTask}
                                onOpenNode={openNode}
                              />
                            ))}
                          </section>
                        )
                  ))}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {/*
          助手在等回答时必须把问题完整摆出来。
          之前它只作为执行计划折叠行里的一句 truncate 文案，实测模型问完"这个方案可以吗"就进入
          waiting_user，界面什么都没显示，用户以为卡死并手动终止了整次任务。
        */}
        {runState?.status === 'waiting_user' && execution.clarification ? (
          <UiPanel variant="inset" className="p-3">
            <div className={`font-medium ${UI_TEXT_META_CLASS}`}>助手需要你确认</div>
            <div className="mt-1 min-w-0">
              <AssistantMarkdown>{execution.clarification.question}</AssistantMarkdown>
            </div>
            <p className={`mt-2 ${UI_TEXT_META_CLASS}`}>在下方直接回复即可继续执行。</p>
          </UiPanel>
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


        {runState?.finalText ? (
          <section style={deferredBlockStyle} className="w-full">
            <AssistantMarkdown>{runState.finalText}</AssistantMarkdown>
          </section>
        ) : null}

        {/* 错误块靠语义色底提示，不再加边框——它已在侧栏卡片内部，加框就是第二层卡片 */}
        {runState?.error ? (
          <section style={deferredBlockStyle} className="rounded-lg bg-danger/10 p-3 text-xs text-danger">
            <div className="flex items-center gap-1.5 font-medium"><AlertCircle className="h-4 w-4" />{runErrorPresentation?.title}</div>
            <p className="mt-1.5 leading-5 text-text-muted">{runState.error.message}</p>
            <p className="mt-1.5 leading-5 text-text-muted">下一步：{runErrorPresentation?.nextAction}</p>
          </section>
        ) : null}

        {run.view.actionError || resultError ? (
          <section style={deferredBlockStyle} className="rounded-lg bg-danger/10 p-3 text-xs text-danger">
            <div className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span className="leading-5">{run.view.actionError ?? resultError}</span></div>
            <UiButton type="button" size="sm" variant="ghost" onClick={() => { run.clearActionError(); setResultError(null) }} className="mt-2 h-7 px-2">知道了</UiButton>
          </section>
        ) : null}

          </div>
        </div>

        {!conversationScroll.isFollowing ? (
          <UiButton
            type="button"
            size="sm"
            variant="ghost"
            className="absolute bottom-3 left-1/2 z-raised -translate-x-1/2 gap-1.5 shadow-panel"
            onClick={conversationScroll.scrollToBottom}
            aria-live="polite"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            {conversationScroll.hasNewContent ? '有新内容' : '回到底部'}
          </UiButton>
        ) : null}
      </div>

      <AssistantComposer
        value={document}
        onChange={setDocument}
        onSubmit={submit}
        attachments={attachments}
        onAttachmentsChange={next => dispatchAttachments({ type: 'replace', attachments: next })}
        attachmentsDisabled={busy}
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
