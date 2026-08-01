import type {
  AgentApprovalRequest,
  AgentEvent,
  AgentRunState,
  AgentToolCompletionKind,
  SerializedAgentError,
} from '@/core/assistant/events'
import type { AgentRunSnapshot } from '@/core/assistant/runtimeContracts'
import { reduceAgentWorkingSummary } from '@/core/assistant/workingSummaryReducer'

export type AgentRunConnection = 'idle' | 'recovering' | 'connected' | 'disconnected'

export interface AgentRunViewState {
  runState: AgentRunState | null
  events: AgentEvent[]
  connection: AgentRunConnection
  actionError: string | null
}

export type AgentRunViewAction =
  | { type: 'begin'; state: AgentRunState }
  | { type: 'event'; event: AgentEvent }
  | { type: 'events'; events: AgentEvent[] }
  | { type: 'hydrate'; snapshot: AgentRunSnapshot }
  | { type: 'sync_state'; state: AgentRunState }
  | { type: 'connection'; connection: AgentRunConnection }
  | { type: 'action_error'; message: string | null }
  | { type: 'clear' }

export interface AgentToolActivity {
  toolCallId: string
  sequence: number
  toolName: string
  title: string
  status: 'requested' | 'running' | 'completed' | 'failed'
  category?: string
  readOnly?: boolean
  completionKind?: AgentToolCompletionKind
  inputDigest?: string
  summary?: string
  error?: SerializedAgentError
  artifactRef?: string
  resultReferences?: Record<string, string>
  startedAt?: string
  completedAt?: string
}

export interface AgentToolActivityGroup {
  groupId: string
  activities: AgentToolActivity[]
  collapsedByDefault: boolean
}

export interface AgentModelPublicUpdate {
  stepId: string
  sequence: number
  text: string
}

export function selectLatestToolEventSequence(events: AgentEvent[]): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type === 'ToolRequested' || event.type === 'ToolStarted' || event.type === 'ToolCompleted' || event.type === 'ToolFailed') {
      return event.sequence
    }
  }
  return 0
}

export function createInitialAgentRunViewState(): AgentRunViewState {
  return { runState: null, events: [], connection: 'idle', actionError: null }
}

function mergeEvents(current: AgentEvent[], incoming: AgentEvent[]): AgentEvent[] {
  const byId = new Map(current.map((event) => [event.eventId, event]))
  for (const event of incoming) byId.set(event.eventId, event)
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence)
}

function applyEventToRunState(state: AgentRunState, event: AgentEvent): AgentRunState {
  const next: AgentRunState = {
    ...state,
    sequence: Math.max(state.sequence, event.sequence),
    updatedAt: event.occurredAt,
  }
  switch (event.type) {
    case 'RunStateChanged':
      next.status = event.current
      break
    case 'ModelStarted':
      next.currentStepId = event.stepId
      next.turn = event.turn
      break
    case 'ModelCompleted':
      if (next.currentStepId === event.stepId) next.currentStepId = null
      break
    case 'ContextUpdated':
      next.turn = event.turn
      break
    case 'ToolRequested':
    case 'ToolStarted':
      next.currentToolCallId = event.toolCallId
      break
    case 'ToolCompleted':
    case 'ToolFailed':
      if (next.currentToolCallId === event.toolCallId) next.currentToolCallId = null
      break
    case 'ApprovalRequired':
      next.waitingApprovalId = event.approval.approvalId
      next.currentToolCallId = event.toolCallId
      break
    case 'ApprovalResolved':
      if (next.waitingApprovalId === event.approvalId) next.waitingApprovalId = null
      break
    case 'RunCompleted':
      next.status = 'completed'
      next.finalText = event.finalText
      next.usage = event.usage
      next.currentStepId = null
      next.currentToolCallId = null
      break
    case 'RunFailed':
      next.status = 'failed'
      next.error = event.error
      next.usage = event.usage
      next.currentStepId = null
      next.currentToolCallId = null
      break
    case 'RunCancelled':
      next.status = 'cancelled'
      next.usage = event.usage
      next.currentStepId = null
      next.currentToolCallId = null
      break
    default:
      break
  }
  next.workingSummary = reduceAgentWorkingSummary(
    next.workingSummary,
    event,
    next.lastScopeRevisions
  )
  return next
}

function applyIncomingEvents(
  state: AgentRunViewState,
  incoming: AgentEvent[]
): AgentRunViewState {
  const relevant = state.runState
    ? incoming.filter((event) => event.runId === state.runState?.runId)
    : incoming
  if (relevant.length === 0) return state
  const events = mergeEvents(state.events, relevant)
  let runState = state.runState
  if (runState) {
    for (const event of [...relevant].sort((left, right) => left.sequence - right.sequence)) {
      if (event.sequence > runState.sequence) runState = applyEventToRunState(runState, event)
    }
  }
  return { ...state, events, runState, connection: 'connected' }
}

export function agentRunViewReducer(
  state: AgentRunViewState,
  action: AgentRunViewAction
): AgentRunViewState {
  switch (action.type) {
    case 'begin':
      return { runState: action.state, events: [], connection: 'connected', actionError: null }
    case 'event':
      return applyIncomingEvents(state, [action.event])
    case 'events':
      return applyIncomingEvents(state, action.events)
    case 'hydrate': {
      const existingEvents = state.runState?.runId === action.snapshot.state.runId
        ? state.events
        : []
      const hydrated = applyIncomingEvents({
        runState: action.snapshot.state,
        events: existingEvents,
        connection: state.connection,
        actionError: null,
      }, action.snapshot.events)
      return { ...hydrated, connection: 'connected' }
    }
    case 'sync_state':
      return { ...state, runState: action.state, connection: 'connected', actionError: null }
    case 'connection':
      return { ...state, connection: action.connection }
    case 'action_error':
      return { ...state, actionError: action.message }
    case 'clear':
      return createInitialAgentRunViewState()
  }
}

export function selectPendingApproval(events: AgentEvent[]): AgentApprovalRequest | null {
  const resolvedIds = new Set(events.flatMap((event) => (
    event.type === 'ApprovalResolved' ? [event.approvalId] : []
  )))
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type === 'ApprovalRequired' && !resolvedIds.has(event.approval.approvalId)) {
      return event.approval
    }
  }
  return null
}

export function selectToolActivities(events: AgentEvent[]): AgentToolActivity[] {
  const activities = new Map<string, AgentToolActivity>()
  for (const event of events) {
    if (!('toolCallId' in event)) continue
    const current = activities.get(event.toolCallId)
    if (event.type === 'ToolRequested') {
      activities.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        sequence: event.sequence,
        toolName: event.toolName,
        title: event.title ?? event.toolName,
        status: 'requested',
        category: event.category,
        readOnly: event.readOnly,
        inputDigest: event.inputDigest,
      })
    } else if (event.type === 'ToolStarted') {
      activities.set(event.toolCallId, {
        ...current,
        toolCallId: event.toolCallId,
        sequence: current?.sequence ?? event.sequence,
        toolName: event.toolName,
        title: current?.title ?? event.toolName,
        status: 'running',
        startedAt: event.occurredAt,
      })
    } else if (event.type === 'ToolCompleted') {
      activities.set(event.toolCallId, {
        ...current,
        toolCallId: event.toolCallId,
        sequence: current?.sequence ?? event.sequence,
        toolName: event.toolName,
        title: current?.title ?? event.toolName,
        status: 'completed',
        category: event.category ?? current?.category,
        readOnly: event.readOnly ?? current?.readOnly,
        completionKind: event.completionKind ?? (event.readOnly ? 'observed' : 'executed'),
        summary: event.summary,
        artifactRef: event.artifactRef,
        resultReferences: event.resultReferences,
        completedAt: event.occurredAt,
      })
    } else if (event.type === 'ToolFailed') {
      activities.set(event.toolCallId, {
        ...current,
        toolCallId: event.toolCallId,
        sequence: current?.sequence ?? event.sequence,
        toolName: event.toolName,
        title: current?.title ?? event.toolName,
        status: 'failed',
        category: event.category ?? current?.category,
        readOnly: event.readOnly ?? current?.readOnly,
        error: event.error,
        completedAt: event.occurredAt,
      })
    }
  }
  return [...activities.values()]
}

function canCollapseToolActivity(activity: AgentToolActivity): boolean {
  return activity.readOnly === true && activity.status === 'completed'
}

/**
 * 连续完成的只读工具默认折叠：运行中的查询仍实时可见，完成后才收纳，
 * 既保留每一步的可追溯性，也避免大量目录/参数读取挤占对话和拖慢布局。
 */
export function groupToolActivitiesForDisplay(
  activities: AgentToolActivity[]
): AgentToolActivityGroup[] {
  const groups: AgentToolActivityGroup[] = []
  let pendingReadOnly: AgentToolActivity[] = []

  const flushReadOnly = (): void => {
    if (pendingReadOnly.length === 0) return
    const first = pendingReadOnly[0]
    groups.push({
      // 只用首个调用生成稳定 key。后续只读结果加入同一组时不能让组件重挂载，
      // 否则用户手动选择的展开状态会被默认折叠覆盖。
      groupId: `read:${first.toolCallId}`,
      activities: pendingReadOnly,
      collapsedByDefault: pendingReadOnly.length > 1,
    })
    pendingReadOnly = []
  }

  for (const activity of activities) {
    if (canCollapseToolActivity(activity)) {
      pendingReadOnly.push(activity)
      continue
    }
    flushReadOnly()
    groups.push({
      groupId: `action:${activity.toolCallId}`,
      activities: [activity],
      collapsedByDefault: false,
    })
  }
  flushReadOnly()
  return groups
}

/** 仅取携带工具调用的模型公开说明；最终无工具回答由最终消息卡单独显示，避免重复。 */
export function selectModelPublicUpdates(events: AgentEvent[]): AgentModelPublicUpdate[] {
  return events.flatMap((event) => (
    event.type === 'ModelCompleted'
      && (event.toolCallCount > 0 || event.stepId === 'attachment-observer')
      && event.displayText
      ? [{ stepId: event.stepId, sequence: event.sequence, text: event.displayText }]
      : []
  ))
}

export interface AgentExecutionPresentation {
  summary: NonNullable<AgentRunState['workingSummary']> | null
  facets: AgentExecutionFacetPresentation[]
  artifactRefs: string[]
  verification: Extract<AgentEvent, { type: 'VerificationCompleted' }> | null
  clarification: Extract<AgentEvent, { type: 'ClarificationRequired' }> | null
  lastCompaction: Extract<AgentEvent, { type: 'ContextCompacted' }> | null
  retrying: Extract<AgentEvent, { type: 'ModelRetrying' }> | null
  nextAction: string
}

export type AgentExecutionFacetStatus = 'pending' | 'active' | 'completed' | 'blocked' | 'waiting_user' | 'skipped'

export interface AgentExecutionFacetPresentation {
  facetId: string
  goal: string
  domain: string
  status: AgentExecutionFacetStatus
  reason: string
  evidence: string[]
}

function selectFacetPresentations(
  summary: NonNullable<AgentRunState['workingSummary']> | null
): AgentExecutionFacetPresentation[] {
  const facets = summary?.route?.taskGraph?.facets ?? []
  const blockedIds = new Set(facets.flatMap((facet) => facet.status === 'blocked' ? [facet.facetId] : []))
  return facets.map((facet) => ({
    facetId: facet.facetId,
    goal: facet.goal,
    domain: facet.domain,
    status: facet.status === 'blocked' && facet.dependsOn.some((id) => blockedIds.has(id))
      ? 'skipped'
      : facet.status,
    reason: facet.statusReason,
    evidence: facet.evidence,
  }))
}

export function selectExecutionPresentation(
  state: AgentRunState | null,
  events: AgentEvent[]
): AgentExecutionPresentation {
  let verification: AgentExecutionPresentation['verification'] = null
  let clarification: AgentExecutionPresentation['clarification'] = null
  let lastCompaction: AgentExecutionPresentation['lastCompaction'] = null
  let retrying: AgentExecutionPresentation['retrying'] = null
  let newerModelActivity = false
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!verification && event.type === 'VerificationCompleted') verification = event
    if (!clarification && event.type === 'ClarificationRequired') clarification = event
    if (!lastCompaction && event.type === 'ContextCompacted') lastCompaction = event
    if (!retrying && !newerModelActivity && event.type === 'ModelRetrying') retrying = event
    if (event.type === 'ModelStarted' || event.type === 'ModelCompleted') newerModelActivity = true
    if (verification && clarification && lastCompaction && retrying) break
  }
  const summary = state?.workingSummary ?? null
  if (state && state.status !== 'waiting_user') clarification = null
  const facets = selectFacetPresentations(summary)
  let nextAction = '正在理解目标并准备下一步。'
  if (clarification) nextAction = clarification.question
  else if (retrying) nextAction = retrying.delayMs > 0
    ? `模型请求暂时失败，将在 ${Math.ceil(retrying.delayMs / 1000)} 秒后重试。`
    : '模型步骤暂时失败，助手正在安全地重新规划。'
  else if (state?.status === 'waiting_approval') nextAction = '请查看审批内容，确认后助手才能继续执行。'
  else if (state?.status === 'waiting_external') nextAction = '已提交外部任务，正在等待最终结果。'
  else if (state?.status === 'paused') nextAction = '执行已暂停，可以继续或停止当前任务。'
  else if (state?.status === 'cancelled') nextAction = '任务已取消，已完成的步骤和证据仍会保留。'
  else if (state?.status === 'waiting_user') nextAction = '需要你补充必要信息后才能继续。'
  else if (summary && summary.recovery.mode !== 'none') nextAction = summary.recovery.reason
  else if (summary?.activeStep) nextAction = `正在执行：${summary.activeStep.title}`
  else if (facets.some((facet) => facet.status === 'active')) {
    nextAction = `正在处理：${facets.find((facet) => facet.status === 'active')?.goal ?? '当前子目标'}`
  }
  else if (state?.status === 'completed') {
    nextAction = verification?.passed
      ? '执行结果已通过结构化验证，请查看助手结论。'
      : '执行已经结束，请查看助手结论和未完成事项。'
  } else if (state?.status === 'failed') {
    nextAction = state.error?.retryable
      ? '本次运行未完成，可按错误建议处理后重新发起。'
      : '本次运行无法继续，请查看错误原因并补充所需信息。'
  } else if (summary?.completedSteps.length) {
    nextAction = '正在核对最新观察并决定下一步。'
  }
  return {
    summary,
    facets,
    artifactRefs: summary?.artifactRefs ?? [],
    verification,
    clarification,
    lastCompaction,
    retrying,
    nextAction,
  }
}
