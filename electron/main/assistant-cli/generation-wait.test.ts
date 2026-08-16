import { describe, expect, it, vi } from 'vitest'

import type { AgentRunState } from '../../../src/core/assistant/events'
import {
  extractSubmittedGenerationTaskIds,
  normalizeGenerationTaskObservation,
  waitForExternalContinuation,
  waitForSubmittedGenerationTasks,
} from './generation-wait'

function stateWithTask(taskId = 'task-cli-1'): AgentRunState {
  return {
    schemaVersion: 'agent-event/v2',
    runId: 'run-cli',
    threadId: 'thread-cli',
    status: 'completed',
    sequence: 1,
    turn: 1,
    currentStepId: null,
    currentToolCallId: null,
    waitingApprovalId: null,
    startedAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    finalText: '任务已提交',
    error: null,
    executionOutcome: { status: 'pending', effects: [], verificationSummary: { summary: '', evidence: [] } },
    presentationOutcome: { status: 'pending' },
    budget: {
      softMaxTurns: 10, maxTurns: 12, softMaxToolCalls: 20, maxToolCalls: 24,
      softMaxWriteToolCalls: 10, maxWriteToolCalls: 12, maxDurationMs: 60_000,
      maxInputTokens: null, maxOutputTokens: null, maxConsecutiveFailures: 3,
      maxRepeatedToolCalls: 2, maxNoProgressTurns: 3, softMaxCostUsd: null,
    },
    usage: {
      turns: 1, toolCalls: 1, writeToolCalls: 1, inputTokens: 1, outputTokens: 1,
      reasoningTokens: 0, totalTokens: 2, knownCostUsd: null,
      consecutiveFailures: 0, noProgressTurns: 0, elapsedMs: 1,
    },
    lastScopeRevisions: { navigation: 0, generation: 1, canvas: 0, toolbox: 0, assets: 0 },
    workingSummary: {
      version: 'agent-working-summary/v1',
      goal: '生成图片',
      route: null,
      planVersion: 1,
      activeStep: null,
      completedSteps: [{
        stepId: 'create-1', title: '创建可见生成任务', status: 'completed',
        toolName: 'create_visible_generation_task', toolCategory: 'generation',
        readOnly: false, idempotent: true, summary: '已提交', evidence: [`taskId:${taskId}`],
        startedAt: new Date(0).toISOString(), completedAt: new Date(0).toISOString(),
      }],
      failedSteps: [],
      evidence: [],
      pendingApprovals: [],
      unresolvedItems: [],
      toolLeases: [],
      toolLeaseCatalogRevision: null,
      scopeRevisions: { navigation: 0, generation: 1, canvas: 0, toolbox: 0, assets: 0 },
    artifactRefs: [],
    attachmentRefs: [],
      recovery: { mode: 'none', reason: '', toolName: null, toolCategory: null },
      updatedAt: new Date(0).toISOString(),
    },
  }
}

describe('命令行生成任务等待', () => {
  it('从运行证据中提取已提交任务标识', () => {
    expect(extractSubmittedGenerationTaskIds(stateWithTask())).toEqual(['task-cli-1'])
  })

  it('把宿主查询失败规范为终态而非伪造生成状态', () => {
    expect(normalizeGenerationTaskObservation('task-cli-1', {
      ok: false,
      error: { code: 'NOT_FOUND', message: '请求的宿主资源不存在', recoverable: false },
    })).toMatchObject({
      taskId: 'task-cli-1', status: 'unavailable', errorCode: 'NOT_FOUND', terminal: true,
    })
  })

  it('保持同一隐藏宿主并等待任务从生成中进入完成', async () => {
    const statuses = ['generating', 'completed']
    const observe = vi.fn().mockImplementation(async () => ({
      ok: true as const,
      data: { task: { status: statuses.shift(), progress: 100 } },
      resultingRevision: 1,
      resultingScopeRevisions: { navigation: 0, generation: 1, canvas: 0, toolbox: 0, assets: 0 },
    }))
    const onObservation = vi.fn()
    const result = await waitForSubmittedGenerationTasks({
      state: stateWithTask(),
      timeoutMs: 1_000,
      observe,
      onObservation,
      pollIntervalMs: 1,
      sleep: async () => undefined,
    })
    expect(result.status).toBe('completed')
    expect(observe).toHaveBeenCalledTimes(2)
    expect(onObservation).toHaveBeenCalledTimes(2)
  })

  it('从权威外部等待事件传入脚本内部提交的生成任务', async () => {
    const source = stateWithTask()
    source.workingSummary!.completedSteps = source.workingSummary!.completedSteps.filter(
      (step) => step.toolName !== 'create_visible_generation_task',
    )
    const observe = vi.fn().mockResolvedValue({
      ok: true as const,
      data: { task: { status: 'completed', progress: 100 } },
      resultingRevision: 1,
      resultingScopeRevisions: { navigation: 0, generation: 1, canvas: 0, toolbox: 0, assets: 0 },
    })
    const result = await waitForSubmittedGenerationTasks({
      state: source,
      taskIds: ['task-from-external-wait'],
      timeoutMs: 1_000,
      observe,
      onObservation: vi.fn(),
      pollIntervalMs: 1,
      sleep: async () => undefined,
    })
    expect(result).toMatchObject({
      status: 'completed',
      tasks: [expect.objectContaining({ taskId: 'task-from-external-wait' })],
    })
    expect(observe).toHaveBeenCalledWith('task-from-external-wait', 1)
  })

  it('外部任务完成后等待自动续接子运行结算，不在子运行启动时退出宿主', async () => {
    const source = { ...stateWithTask(), status: 'waiting_external' as const }
    const child = { ...stateWithTask(), runId: 'run-child', status: 'completed' as const }
    const listRuns = vi.fn()
      .mockReturnValueOnce([])
      .mockReturnValue([{
        runId: 'run-child', threadId: 'thread-cli', goal: '续接', status: 'completed',
        recoveryStatus: 'none', parentRunId: 'run-cli', createdAt: new Date(1).toISOString(),
        updatedAt: new Date(2).toISOString(), canRetry: true,
      }])
    const result = await waitForExternalContinuation({
      sourceRunId: 'run-cli', threadId: 'thread-cli', sourceState: source,
      timeoutMs: 1_000, listRuns, getState: () => child,
      pollIntervalMs: 1, sleep: async () => undefined,
    })
    expect(result).toMatchObject({ status: 'completed', runId: 'run-child' })
    expect(result.state.status).toBe('completed')
  })
})
