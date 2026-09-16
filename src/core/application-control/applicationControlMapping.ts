import type { ApplicationOperationState } from '.'
import type { AgentRunStatus } from '../assistant/events'

export const APPLICATION_OPERATION_AGENT_STATUS_MAP = {
  planned: 'initializing',
  running: 'running',
  waiting_approval: 'waiting_approval',
  waiting_user: 'waiting_user',
  waiting_external: 'waiting_external',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const satisfies Readonly<Record<ApplicationOperationState, AgentRunStatus>>

export function toAgentRunStatus(state: ApplicationOperationState): AgentRunStatus {
  return APPLICATION_OPERATION_AGENT_STATUS_MAP[state]
}

