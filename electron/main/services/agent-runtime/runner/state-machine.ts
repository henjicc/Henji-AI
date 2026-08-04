import type { AgentRunStatus } from '../../../../../src/core/assistant/events'

const terminalStates = new Set<AgentRunStatus>([
  'completed', 'budget_exhausted', 'failed', 'cancelled', 'waiting_external',
])

const transitions: Readonly<Record<AgentRunStatus, ReadonlySet<AgentRunStatus>>> = {
  initializing: new Set(['running', 'budget_exhausted', 'failed', 'cancelled']),
  running: new Set(['waiting_tool', 'waiting_user', 'waiting_external', 'paused', 'completed', 'budget_exhausted', 'failed', 'cancelled']),
  waiting_tool: new Set(['running', 'waiting_approval', 'paused', 'budget_exhausted', 'failed', 'cancelled']),
  waiting_approval: new Set(['waiting_tool', 'running', 'paused', 'budget_exhausted', 'failed', 'cancelled']),
  waiting_user: new Set(['running', 'paused', 'budget_exhausted', 'failed', 'cancelled']),
  waiting_external: new Set(['failed', 'cancelled']),
  paused: new Set(['running', 'waiting_tool', 'waiting_approval', 'waiting_user', 'budget_exhausted', 'failed', 'cancelled']),
  completed: new Set(),
  budget_exhausted: new Set(),
  failed: new Set(),
  cancelled: new Set(),
}

export class InvalidAgentStateTransitionError extends Error {
  constructor(readonly from: AgentRunStatus, readonly to: AgentRunStatus) {
    super(`非法 Agent 状态迁移：${from} -> ${to}`)
    this.name = 'InvalidAgentStateTransitionError'
  }
}

export function isTerminalAgentState(status: AgentRunStatus): boolean {
  return terminalStates.has(status)
}

export function canTransitionAgentState(from: AgentRunStatus, to: AgentRunStatus): boolean {
  return from === to || transitions[from].has(to)
}

export class AgentStateMachine {
  private currentStatus: AgentRunStatus = 'initializing'

  get status(): AgentRunStatus {
    return this.currentStatus
  }

  transition(next: AgentRunStatus): AgentRunStatus {
    const previous = this.currentStatus
    if (previous === next) return previous
    if (!canTransitionAgentState(previous, next)) {
      throw new InvalidAgentStateTransitionError(previous, next)
    }
    this.currentStatus = next
    return previous
  }
}
