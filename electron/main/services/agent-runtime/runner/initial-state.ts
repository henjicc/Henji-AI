import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentBudgetConfigSchema,
  agentRunStateSchema,
  type AgentRunState,
} from '../../../../../src/core/assistant/events'
import type { AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import { DEFAULT_AGENT_BUDGET } from './budget'
import {
  agentWorkingSummarySchema,
  createAgentWorkingSummary,
  type AgentWorkingSummary,
} from '../../../../../src/core/assistant/workingContext'

export function createInitialAgentRunState(
  runId: string,
  request: AgentStartRunRequest,
  previousWorkingSummary?: AgentWorkingSummary
): AgentRunState {
  const now = new Date().toISOString()
  const budget = agentBudgetConfigSchema.parse({
    ...DEFAULT_AGENT_BUDGET,
    ...request.budget,
  })
  return agentRunStateSchema.parse({
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    runId,
    threadId: request.threadId,
    status: 'initializing',
    sequence: 0,
    turn: 0,
    currentStepId: null,
    currentToolCallId: null,
    waitingApprovalId: null,
    startedAt: now,
    updatedAt: now,
    finalText: null,
    error: null,
    budget,
    usage: {
      turns: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      knownCostUsd: null,
      consecutiveFailures: 0,
      noProgressTurns: 0,
      elapsedMs: 0,
    },
    lastScopeRevisions: null,
    workingSummary: previousWorkingSummary
      ? agentWorkingSummarySchema.parse({
          ...previousWorkingSummary,
          goal: request.goal,
          activeStep: null,
          pendingApprovals: [],
          updatedAt: now,
        })
      : createAgentWorkingSummary(request.goal),
  })
}
