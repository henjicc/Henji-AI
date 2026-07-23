import { describe, expect, it } from 'vitest'

import {
  agentRunViewReducer,
  createInitialAgentRunViewState,
  selectPendingApproval,
  selectToolActivities,
} from './agentRunReducer'
import type { AgentEvent } from '@/core/assistant/events'

function event<TEvent extends AgentEvent>(value: Omit<TEvent, 'schemaVersion' | 'eventId' | 'occurredAt' | 'runId'>): TEvent {
  return {
    ...value,
    schemaVersion: 'agent-event/v1',
    eventId: `event-${value.sequence}`,
    occurredAt: `2026-07-23T00:00:0${value.sequence}.000Z`,
    runId: 'run-1',
  } as TEvent
}

describe('agentRunViewReducer', () => {
  it('按 eventId 去重并按 sequence 重排重放事件', () => {
    const second = event<Extract<AgentEvent, { type: 'PlanUpdated' }>>({
      type: 'PlanUpdated', sequence: 2, intent: 'diagnose', summary: '诊断错误', toolDomains: ['diagnostics'],
    })
    const first = event<Extract<AgentEvent, { type: 'RunStarted' }>>({
      type: 'RunStarted', sequence: 1, threadId: 'thread-1',
    })
    let state = createInitialAgentRunViewState()
    state = agentRunViewReducer(state, { type: 'event', event: second })
    state = agentRunViewReducer(state, { type: 'event', event: first })
    state = agentRunViewReducer(state, { type: 'event', event: second })
    expect(state.events.map((item) => item.sequence)).toEqual([1, 2])
  })

  it('聚合工具状态并识别尚未处理的审批', () => {
    const requested = event<Extract<AgentEvent, { type: 'ToolRequested' }>>({
      type: 'ToolRequested', sequence: 1, toolCallId: 'call-1', toolName: 'create_visible_generation_task', inputDigest: 'digest',
    })
    const completed = event<Extract<AgentEvent, { type: 'ToolCompleted' }>>({
      type: 'ToolCompleted', sequence: 2, toolCallId: 'call-1', toolName: 'create_visible_generation_task', summary: '已创建任务', resultReferences: { taskId: 'task-1' },
    })
    const approval = event<Extract<AgentEvent, { type: 'ApprovalRequired' }>>({
      type: 'ApprovalRequired', sequence: 3, toolCallId: 'call-2', approval: {
        approvalId: 'approval-1', runId: 'run-1', toolCallId: 'call-2', toolName: 'cancel_generation_task',
        toolVersion: 1, risk: 'R2', title: '取消任务', summary: '取消 task-1', argsDigest: 'a', previewDigest: 'p',
        targetIds: { taskId: 'task-1' }, expectedRevisions: {}, permission: 'generation:cancel', scope: 'task-1',
        expiresAt: '2026-07-23T01:00:00.000Z', reversible: false,
      },
    })
    expect(selectToolActivities([requested, completed])).toEqual([expect.objectContaining({
      status: 'completed', resultReferences: { taskId: 'task-1' },
    })])
    expect(selectPendingApproval([requested, completed, approval])?.approvalId).toBe('approval-1')
  })

  it('重复或较旧事件只补齐历史，不回退当前运行状态', () => {
    const currentState = {
      schemaVersion: 'agent-event/v1' as const,
      runId: 'run-1', threadId: 'thread-1', status: 'running' as const, sequence: 5, turn: 1,
      currentStepId: null, currentToolCallId: null, waitingApprovalId: null,
      startedAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:05.000Z',
      finalText: null, error: null,
      budget: {
        maxTurns: 12, maxToolCalls: 24, maxDurationMs: 600_000, maxInputTokens: 120_000,
        maxOutputTokens: 32_000, maxConsecutiveFailures: 3, maxRepeatedToolCalls: 2, maxNoProgressTurns: 3,
      },
      usage: {
        turns: 1, toolCalls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
        totalTokens: 0, knownCostUsd: null, consecutiveFailures: 0, noProgressTurns: 0, elapsedMs: 5_000,
      },
      lastScopeRevisions: null,
    }
    const older = event<Extract<AgentEvent, { type: 'RunStateChanged' }>>({
      type: 'RunStateChanged', sequence: 4, previous: 'running', current: 'waiting_approval',
    })
    const state = agentRunViewReducer({
      runState: currentState, events: [], connection: 'connected', actionError: null,
    }, { type: 'event', event: older })

    expect(state.runState?.status).toBe('running')
    expect(state.runState?.sequence).toBe(5)
    expect(state.events).toEqual([older])
  })
})
