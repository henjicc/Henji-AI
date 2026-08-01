import type { AgentRunState } from '@/core/assistant/events'
import type { AgentRunSummary } from '@/core/assistant/persistence'
import type { AgentStartRunRequest } from '@/core/assistant/runtimeContracts'
import {
  cancelAgentRun,
  getAgentRunSnapshot,
  getAgentRunState,
  listAgentRuns,
  pauseAgentRun,
  resumeAgentRun,
  retryAgentRun,
  startAgentRun,
} from '@/commands/assistant'

const ACTIVE_STATUSES = new Set([
  'initializing',
  'running',
  'waiting_tool',
  'waiting_approval',
  'waiting_user',
  'waiting_external',
])

export interface AssistantRunApplicationSnapshot {
  runRef: { kind: 'assistant.run'; id: string }
  runId: string
  threadId: string
  status: AgentRunState['status']
  sequence: number
  waitingExternal: boolean
  cancellable: boolean
  resumable: boolean
  retryable: boolean
  artifactRefs: string[]
  error: AgentRunState['error']
  updatedAt: string
  evidence: {
    stateRef: string
    eventCursor: number
  }
}

function artifactRefs(state: AgentRunState): string[] {
  return [...new Set(state.workingSummary?.artifactRefs ?? [])]
}

export function toAssistantRunApplicationSnapshot(state: AgentRunState): AssistantRunApplicationSnapshot {
  return {
    runRef: { kind: 'assistant.run', id: state.runId },
    runId: state.runId,
    threadId: state.threadId,
    status: state.status,
    sequence: state.sequence,
    waitingExternal: state.status === 'waiting_external',
    cancellable: ACTIVE_STATUSES.has(state.status) || state.status === 'paused',
    resumable: state.status === 'paused',
    retryable: state.status === 'failed' || state.status === 'cancelled',
    artifactRefs: artifactRefs(state),
    error: state.error,
    updatedAt: state.updatedAt,
    evidence: {
      stateRef: `assistant-run:${state.runId}:state:${state.sequence}`,
      eventCursor: state.sequence,
    },
  }
}

export async function listAssistantRunSummaries(threadId?: string, limit = 30): Promise<AgentRunSummary[]> {
  return listAgentRuns(threadId, limit)
}

export async function readAssistantRun(runId: string): Promise<AssistantRunApplicationSnapshot> {
  return toAssistantRunApplicationSnapshot(await getAgentRunState(runId))
}

export async function readAssistantRunWithEvents(runId: string) {
  const snapshot = await getAgentRunSnapshot(runId)
  return {
    run: toAssistantRunApplicationSnapshot(snapshot.state),
    events: snapshot.events,
  }
}

export async function startAssistantRun(
  request: Omit<AgentStartRunRequest, 'schemaVersion'>,
): Promise<AssistantRunApplicationSnapshot> {
  const result = await startAgentRun(request)
  return toAssistantRunApplicationSnapshot(result.state)
}

export async function cancelAssistantRun(runId: string, reason = '用户取消'): Promise<AssistantRunApplicationSnapshot> {
  return toAssistantRunApplicationSnapshot(await cancelAgentRun(runId, reason))
}

export async function pauseAssistantRun(runId: string): Promise<AssistantRunApplicationSnapshot> {
  return toAssistantRunApplicationSnapshot(await pauseAgentRun(runId))
}

export async function resumeAssistantRun(runId: string): Promise<AssistantRunApplicationSnapshot> {
  return toAssistantRunApplicationSnapshot(await resumeAgentRun(runId))
}

export async function retryAssistantRun(runId: string): Promise<AssistantRunApplicationSnapshot> {
  const result = await retryAgentRun(runId)
  return toAssistantRunApplicationSnapshot(result.state)
}
