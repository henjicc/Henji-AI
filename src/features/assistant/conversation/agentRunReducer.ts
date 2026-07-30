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
        toolName: event.toolName,
        title: current?.title ?? event.toolName,
        status: 'running',
        startedAt: event.occurredAt,
      })
    } else if (event.type === 'ToolCompleted') {
      activities.set(event.toolCallId, {
        ...current,
        toolCallId: event.toolCallId,
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
    const last = pendingReadOnly[pendingReadOnly.length - 1]
    groups.push({
      groupId: `read:${first.toolCallId}:${last.toolCallId}`,
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
    event.type === 'ModelCompleted' && event.toolCallCount > 0 && event.displayText
      ? [{ stepId: event.stepId, sequence: event.sequence, text: event.displayText }]
      : []
  ))
}

export interface AgentExecutionPresentation {
  summary: NonNullable<AgentRunState['workingSummary']> | null
  verification: Extract<AgentEvent, { type: 'VerificationCompleted' }> | null
  clarification: Extract<AgentEvent, { type: 'ClarificationRequired' }> | null
  lastCompaction: Extract<AgentEvent, { type: 'ContextCompacted' }> | null
  nextAction: string
}

export function selectExecutionPresentation(
  state: AgentRunState | null,
  events: AgentEvent[]
): AgentExecutionPresentation {
  let verification: AgentExecutionPresentation['verification'] = null
  let clarification: AgentExecutionPresentation['clarification'] = null
  let lastCompaction: AgentExecutionPresentation['lastCompaction'] = null
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!verification && event.type === 'VerificationCompleted') verification = event
    if (!clarification && event.type === 'ClarificationRequired') clarification = event
    if (!lastCompaction && event.type === 'ContextCompacted') lastCompaction = event
    if (verification && clarification && lastCompaction) break
  }
  const summary = state?.workingSummary ?? null
  let nextAction = '正在理解目标并准备下一步。'
  if (clarification) nextAction = clarification.question
  else if (state?.status === 'waiting_approval') nextAction = '请查看审批内容，确认后助手才能继续执行。'
  else if (summary && summary.recovery.mode !== 'none') nextAction = summary.recovery.reason
  else if (summary?.activeStep) nextAction = `正在执行：${summary.activeStep.title}`
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
  return { summary, verification, clarification, lastCompaction, nextAction }
}
