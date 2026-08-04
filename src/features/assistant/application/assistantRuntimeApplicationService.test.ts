import { describe, expect, it } from 'vitest'

import type { AgentRunState } from '@/core/assistant/events'
import { createAgentWorkingSummary } from '@/core/assistant/workingContext'

import { toAssistantRunApplicationSnapshot } from './assistantRuntimeApplicationService'

function state(status: AgentRunState['status']): AgentRunState {
  return {
    schemaVersion: 'agent-event/v1',
    runId: 'run-1',
    threadId: 'thread-1',
    status,
    sequence: 12,
    turn: 3,
    currentStepId: null,
    currentToolCallId: null,
    waitingApprovalId: null,
    waitingClarificationId: null,
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:01:00.000Z',
    finalText: null,
    error: null,
    budget: {
      softMaxTurns: 20,
      maxTurns: 100,
      softMaxToolCalls: 50,
      maxToolCalls: 100,
      softMaxWriteToolCalls: 12,
      maxWriteToolCalls: 24,
      maxDurationMs: 60_000,
      maxInputTokens: 100_000,
      maxOutputTokens: 100_000,
      maxConsecutiveFailures: 3,
      maxRepeatedToolCalls: 3,
      maxNoProgressTurns: 3,
      softMaxCostUsd: 3,
    },
    usage: {
      turns: 3,
      toolCalls: 2,
      writeToolCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 0,
      totalTokens: 120,
      knownCostUsd: null,
      consecutiveFailures: 0,
      noProgressTurns: 0,
      elapsedMs: 60_000,
    },
    lastScopeRevisions: null,
    workingSummary: {
      ...createAgentWorkingSummary('完成任务'),
      artifactRefs: ['artifact:one', 'artifact:one', 'artifact:two'],
    },
  }
}

describe('assistantRuntimeApplicationService', () => {
  it('把外部等待映射为统一长任务状态并保留去重后的稳定产物引用', () => {
    expect(toAssistantRunApplicationSnapshot(state('waiting_external'))).toMatchObject({
      runRef: { kind: 'assistant.run', id: 'run-1' },
      waitingExternal: true,
      cancellable: true,
      resumable: false,
      retryable: false,
      artifactRefs: ['artifact:one', 'artifact:two'],
      evidence: { stateRef: 'assistant-run:run-1:state:12', eventCursor: 12 },
    })
  })

  it('只允许暂停运行恢复，并为失败运行提供重试语义', () => {
    expect(toAssistantRunApplicationSnapshot(state('paused'))).toMatchObject({
      cancellable: true,
      resumable: true,
      retryable: false,
    })
    expect(toAssistantRunApplicationSnapshot(state('failed'))).toMatchObject({
      cancellable: false,
      resumable: false,
      retryable: true,
    })
  })
})
