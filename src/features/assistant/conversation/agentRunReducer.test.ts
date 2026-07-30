import { describe, expect, it } from 'vitest'

import {
  agentRunViewReducer,
  createInitialAgentRunViewState,
  groupToolActivitiesForDisplay,
  selectExecutionPresentation,
  selectModelPublicUpdates,
  selectPendingApproval,
  selectToolActivities,
} from './agentRunReducer'
import type { AgentEvent } from '@/core/assistant/events'
import { createAgentWorkingSummary } from '@/core/assistant/workingContext'

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

  it('将连续完成的只读查询收纳为默认折叠组，但保留写操作和失败项', () => {
    const activities = [
      {
        toolCallId: 'read-1', toolName: 'search_models', title: '搜索生成模型',
        status: 'completed' as const, readOnly: true,
      },
      {
        toolCallId: 'read-2', toolName: 'get_model_schema', title: '读取模型参数结构',
        status: 'completed' as const, readOnly: true,
      },
      {
        toolCallId: 'write-1', toolName: 'create_visible_generation_task', title: '创建可见生成任务',
        status: 'completed' as const, readOnly: false,
      },
      {
        toolCallId: 'read-failed', toolName: 'get_generation_task', title: '读取生成任务',
        status: 'failed' as const, readOnly: true,
      },
    ]

    expect(groupToolActivitiesForDisplay(activities)).toEqual([
      expect.objectContaining({
        activities: activities.slice(0, 2),
        collapsedByDefault: true,
      }),
      expect.objectContaining({ activities: [activities[2]], collapsedByDefault: false }),
      expect.objectContaining({ activities: [activities[3]], collapsedByDefault: false }),
    ])
  })

  it('保留携带工具调用的公开模型说明，不把最终回答重复放入进展流', () => {
    const events: AgentEvent[] = [
      event<Extract<AgentEvent, { type: 'ModelCompleted' }>>({
        type: 'ModelCompleted', sequence: 1, stepId: 'step-1', finishReason: 'tool-calls',
        toolCallCount: 1, displayText: '我先根据你的偏好筛选兼容模型。',
        usage: {
          inputTokens: 1, inputNoCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
          outputTokens: 1, textTokens: 1, reasoningTokens: 0, totalTokens: 2,
        },
      }),
      event<Extract<AgentEvent, { type: 'ModelCompleted' }>>({
        type: 'ModelCompleted', sequence: 2, stepId: 'step-2', finishReason: 'stop',
        toolCallCount: 0, displayText: '任务已经提交。',
        usage: {
          inputTokens: 1, inputNoCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
          outputTokens: 1, textTokens: 1, reasoningTokens: 0, totalTokens: 2,
        },
      }),
    ]

    expect(selectModelPublicUpdates(events)).toEqual([
      { stepId: 'step-1', sequence: 1, text: '我先根据你的偏好筛选兼容模型。' },
    ])
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

    const otherRun = {
      ...older,
      eventId: 'event-other-run',
      runId: 'run-2',
      sequence: 6,
    }
    const unchanged = agentRunViewReducer(state, { type: 'event', event: otherRun })
    expect(unchanged).toBe(state)

    const hydratedEmptySnapshot = agentRunViewReducer({
      runState: currentState,
      events: [],
      connection: 'recovering',
      actionError: null,
    }, {
      type: 'hydrate',
      snapshot: { state: currentState, events: [] },
    })
    expect(hydratedEmptySnapshot.connection).toBe('connected')
  })

  it('批量事件实时重建计划步骤并区分提交与验证状态', () => {
    const initialState = {
      schemaVersion: 'agent-event/v1' as const,
      runId: 'run-1', threadId: 'thread-1', status: 'running' as const, sequence: 0, turn: 0,
      currentStepId: null, currentToolCallId: null, waitingApprovalId: null,
      startedAt: '2026-07-23T00:00:00.000Z', updatedAt: '2026-07-23T00:00:00.000Z',
      finalText: null, error: null,
      budget: {
        maxTurns: 12, maxToolCalls: 24, maxDurationMs: 600_000, maxInputTokens: 120_000,
        maxOutputTokens: 32_000, maxConsecutiveFailures: 3, maxRepeatedToolCalls: 2, maxNoProgressTurns: 3,
      },
      usage: {
        turns: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
        totalTokens: 0, knownCostUsd: null, consecutiveFailures: 0, noProgressTurns: 0, elapsedMs: 0,
      },
      lastScopeRevisions: null,
      workingSummary: createAgentWorkingSummary('生成一张海报'),
    }
    const events: AgentEvent[] = [
      event<Extract<AgentEvent, { type: 'PlanUpdated' }>>({
        type: 'PlanUpdated', sequence: 1, intent: 'generate', summary: '选择模型后提交任务', toolDomains: ['models', 'generation'],
      }),
      event<Extract<AgentEvent, { type: 'ToolRequested' }>>({
        type: 'ToolRequested', sequence: 2, toolCallId: 'call-create', toolName: 'create_visible_generation_task',
        title: '创建可见生成任务', inputDigest: 'digest', category: 'generation', readOnly: false, idempotent: true,
      }),
      event<Extract<AgentEvent, { type: 'ToolCompleted' }>>({
        type: 'ToolCompleted', sequence: 3, toolCallId: 'call-create', toolName: 'create_visible_generation_task',
        summary: '任务已提交', category: 'generation', readOnly: false, idempotent: true,
        completionKind: 'submitted', resultReferences: { taskId: 'task-1' },
      }),
      event<Extract<AgentEvent, { type: 'VerificationCompleted' }>>({
        type: 'VerificationCompleted', sequence: 4, passed: true,
        summary: '提交状态与最终答复一致', evidence: ['generation_status:submitted'],
      }),
    ]
    const state = agentRunViewReducer({
      runState: initialState, events: [], connection: 'connected', actionError: null,
    }, { type: 'events', events })

    expect(state.runState?.workingSummary).toMatchObject({
      route: { intent: 'generate' },
      completedSteps: [{ title: '创建可见生成任务', summary: '任务已提交' }],
    })
    expect(selectToolActivities(state.events)).toEqual([
      expect.objectContaining({ title: '创建可见生成任务', completionKind: 'submitted' }),
    ])
    expect(selectExecutionPresentation(state.runState, state.events)).toMatchObject({
      verification: { passed: true },
      nextAction: '正在核对最新观察并决定下一步。',
    })
  })

  it('澄清事件转换为用户可执行的下一步', () => {
    const clarification = event<Extract<AgentEvent, { type: 'ClarificationRequired' }>>({
      type: 'ClarificationRequired', sequence: 1,
      question: '请提供需要处理的项目名称。', reason: '目标项目不明确',
    })
    const presentation = selectExecutionPresentation(null, [clarification])
    expect(presentation.nextAction).toBe('请提供需要处理的项目名称。')
    expect(presentation.clarification?.reason).toBe('目标项目不明确')
  })
})
