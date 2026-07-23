import type {
  AgentApprovalRequest,
  AgentEvent,
  AgentRunState,
  SerializedAgentError,
} from '@/core/assistant/events'
import type { AgentRunSnapshot } from '@/core/assistant/runtimeContracts'

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
  | { type: 'hydrate'; snapshot: AgentRunSnapshot }
  | { type: 'sync_state'; state: AgentRunState }
  | { type: 'connection'; connection: AgentRunConnection }
  | { type: 'action_error'; message: string | null }
  | { type: 'clear' }

export interface AgentToolActivity {
  toolCallId: string
  toolName: string
  status: 'requested' | 'running' | 'completed' | 'failed'
  inputDigest?: string
  summary?: string
  error?: SerializedAgentError
  artifactRef?: string
  resultReferences?: Record<string, string>
  startedAt?: string
  completedAt?: string
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
  return next
}

export function agentRunViewReducer(
  state: AgentRunViewState,
  action: AgentRunViewAction
): AgentRunViewState {
  switch (action.type) {
    case 'begin':
      return { runState: action.state, events: [], connection: 'connected', actionError: null }
    case 'event':
      if (state.runState && action.event.sequence <= state.runState.sequence) {
        return {
          ...state,
          events: mergeEvents(state.events, [action.event]),
          connection: 'connected',
        }
      }
      return {
        ...state,
        events: mergeEvents(state.events, [action.event]),
        runState: state.runState ? applyEventToRunState(state.runState, action.event) : state.runState,
        connection: 'connected',
      }
    case 'hydrate':
      return {
        runState: action.snapshot.state,
        events: mergeEvents(state.events, action.snapshot.events),
        connection: 'connected',
        actionError: null,
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
        status: 'requested',
        inputDigest: event.inputDigest,
      })
    } else if (event.type === 'ToolStarted') {
      activities.set(event.toolCallId, {
        ...current,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: 'running',
        startedAt: event.occurredAt,
      })
    } else if (event.type === 'ToolCompleted') {
      activities.set(event.toolCallId, {
        ...current,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: 'completed',
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
        status: 'failed',
        error: event.error,
        completedAt: event.occurredAt,
      })
    }
  }
  return [...activities.values()]
}
