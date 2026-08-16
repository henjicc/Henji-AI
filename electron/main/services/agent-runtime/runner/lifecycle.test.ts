import { describe, expect, it, vi } from 'vitest'

import { agentRunStateSchema, type AgentEvent } from '../../../../../src/core/assistant/events'
import { createAgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import { AgentRunMetrics } from './budget'
import { AgentRunnerLifecycle } from './lifecycle'
import { AgentStateMachine } from './state-machine'

function fixture() {
  const now = new Date().toISOString()
  const budget = new AgentRunMetrics()
  const machine = new AgentStateMachine()
  machine.transition('running')
  const state = agentRunStateSchema.parse({
    schemaVersion: 'agent-event/v2', runId: 'run-lifecycle', threadId: 'thread-1',
    status: 'running', sequence: 0, turn: 0, currentStepId: null, currentToolCallId: null,
    waitingApprovalId: null, waitingClarificationId: null, startedAt: now, updatedAt: now,
    finalText: null, error: null,
    executionOutcome: { status: 'pending', effects: [], verificationSummary: { summary: '', evidence: [] } },
    presentationOutcome: { status: 'pending' }, budget: budget.config, usage: budget.snapshot(),
    lastScopeRevisions: null, workingSummary: createAgentWorkingSummary('制作动画'),
  })
  const events: AgentEvent[] = []
  const lifecycle = new AgentRunnerLifecycle({
    runId: state.runId, state, machine, budget,
    dependencies: { onEvent: (event) => events.push(event), onCheckpoint: vi.fn(), onTerminal: vi.fn() },
    onEventDispatchError: vi.fn(),
  })
  return { lifecycle, state, events }
}

describe('AgentRunnerLifecycle 执行与说明终态分离', () => {
  it('执行过程中持续保存强类型回执，供外部等待续跑继承', () => {
    const { lifecycle, state } = fixture()
    lifecycle.recordExecutionEffects([{
      effect: 'execute', entityTypes: ['generation.task'], propertyIds: [],
      targetRefs: [{ kind: 'generation.task', id: 'task-1' }], count: 1,
      verified: false, evidence: ['task:task-1'],
    }])

    expect(state.executionOutcome).toMatchObject({
      status: 'pending',
      effects: [expect.objectContaining({
        effect: 'execute', targetRefs: [{ kind: 'generation.task', id: 'task-1' }],
      })],
    })
  })

  it('执行成功封存后，模型失败只能降级为 completed_with_warning', () => {
    const { lifecycle, state, events } = fixture()
    lifecycle.sealExecution({
      effects: [{
        effect: 'update', entityTypes: ['camera_stage.object'], propertyIds: [],
        targetRefs: [], count: 1, verified: true, evidence: ['camera_stage.object:updated'],
      }],
      summary: '三点动画与播放已验证', evidence: ['state_keyframes:3', 'playing:true'],
    })

    lifecycle.fail(new Error('[MODEL_REQUEST_FAILED] 最终说明请求失败'))

    expect(state.status).toBe('completed_with_warning')
    expect(state.executionOutcome.status).toBe('sealed_success')
    expect(state.presentationOutcome.status).toBe('fallback')
    expect(state.finalText).toContain('应用操作已经完成')
    expect(events.some((event) => event.type === 'RunCompletedWithWarning')).toBe(true)
    expect(events.some((event) => event.type === 'RunFailed')).toBe(false)
  })

  it('执行成功封存前的模型失败仍然是 failed', () => {
    const { lifecycle, state, events } = fixture()

    lifecycle.fail(new Error('[MODEL_REQUEST_FAILED] 执行阶段请求失败'))

    expect(state.status).toBe('failed')
    expect(state.executionOutcome.status).toBe('failed')
    expect(events.some((event) => event.type === 'RunFailed')).toBe(true)
    expect(events.some((event) => event.type === 'RunCompletedWithWarning')).toBe(false)
  })
})
