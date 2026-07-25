import { describe, expect, it, vi } from 'vitest'

import type { AgentRunState } from '../../../src/core/assistant/events'
import {
  extractSubmittedGenerationTaskIds,
  normalizeGenerationTaskObservation,
  waitForSubmittedGenerationTasks,
} from './generation-wait'

function stateWithTask(taskId = 'task-cli-1'): AgentRunState {
  return {
    schemaVersion: 'agent-event/v1',
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
    budget: {
      maxTurns: 12, maxToolCalls: 24, maxDurationMs: 60_000,
      maxInputTokens: null, maxOutputTokens: null, maxConsecutiveFailures: 3,
      maxRepeatedToolCalls: 2, maxNoProgressTurns: 3,
    },
    usage: {
      turns: 1, toolCalls: 1, inputTokens: 1, outputTokens: 1,
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
      scopeRevisions: { navigation: 0, generation: 1, canvas: 0, toolbox: 0, assets: 0 },
      artifactRefs: [],
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
})
