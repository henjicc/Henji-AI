import { describe, expect, it } from 'vitest'

import { agentRunStateSchema, type AgentRunState } from '../../../../../src/core/assistant/events'
import { decideAgentBudgetContinuation } from './job-budget'

function state(runId: string, usage: Partial<AgentRunState['usage']>): AgentRunState {
  return agentRunStateSchema.parse({
    schemaVersion: 'agent-event/v1', runId, threadId: 'thread', status: 'budget_exhausted',
    sequence: 1, turn: usage.turns ?? 0, currentStepId: null, currentToolCallId: null,
    waitingApprovalId: null, waitingClarificationId: null,
    startedAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:01:00.000Z',
    finalText: null, error: null,
    budget: {
      maxTurns: 32, maxToolCalls: 100, maxDurationMs: 1_800_000,
      maxInputTokens: null, maxOutputTokens: null, maxConsecutiveFailures: 3,
      maxRepeatedToolCalls: 2, maxNoProgressTurns: 3, maxCostUsd: 10,
    },
    usage: {
      turns: 0, toolCalls: 0, writeToolCalls: 0, inputTokens: 0, outputTokens: 0,
      reasoningTokens: 0, totalTokens: 0, knownCostUsd: null,
      consecutiveFailures: 0, noProgressTurns: 0, elapsedMs: 0, ...usage,
    },
    lastScopeRevisions: null,
  })
}

describe('Agent Job budget', () => {
  it('续跑不重置累计工具、写入、费用与时间预算', () => {
    const decision = decideAgentBudgetContinuation([
      state('run-1', { turns: 32, toolCalls: 90, writeToolCalls: 20, knownCostUsd: 4 }),
      state('run-2', { turns: 32, toolCalls: 80, writeToolCalls: 20, knownCostUsd: 3 }),
    ], 3, undefined, Date.parse('2026-08-04T00:30:00.000Z'))
    expect(decision).toMatchObject({
      allowed: true,
      budget: { maxTurns: 32, maxToolCalls: 30, maxWriteToolCalls: 8, maxCostUsd: 3 },
    })
  })

  it('最多只自动创建初始段后的两次续跑', () => {
    const runs = [state('run-1', {}), state('run-2', {}), state('run-3', {})]
    expect(decideAgentBudgetContinuation(runs, 4, undefined)).toMatchObject({ allowed: false })
  })

  it('任一 Job 累计硬预算耗尽就拒绝换 runId 绕过', () => {
    expect(decideAgentBudgetContinuation([
      state('run-1', { toolCalls: 100 }), state('run-2', { toolCalls: 100 }),
    ], 3, undefined)).toMatchObject({ allowed: false, reason: 'Job 累计预算已耗尽' })
  })
})
