import { describe, expect, it, vi } from 'vitest'

import { AGENT_EXTERNAL_WAIT_VERSION } from '../../../../../src/core/assistant/externalWait'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentTurnSnapshotDraft } from '../../../../../src/core/assistant/turn'
import type { AgentSavePointCoordinator } from './save-point-coordinator'
import { AgentExternalWaitRegistration } from './external-wait-registration'

describe('AgentExternalWaitRegistration', () => {
  it('生成提交证据持久化后进入 waiting_external 并发布稳定 waitId', async () => {
    const transition = vi.fn()
    const emit = vi.fn()
    const register = vi.fn(async (input) => ({
      version: AGENT_EXTERNAL_WAIT_VERSION,
      waitId: input.waitId,
      threadId: input.threadId,
      sourceRunId: input.sourceRunId,
      taskId: input.taskId,
      targetStatuses: input.targetStatuses,
      status: 'active' as const,
      resumePolicy: 'linked_child_once' as const,
      savePointSequence: 8,
      createdAt: '2026-07-30T10:00:00.000Z',
      expiresAt: '2026-07-30T11:00:00.000Z',
      lastObservedStatus: null,
      lastEventId: null,
      claimedAt: null,
      consumedAt: null,
      resumedRunId: null,
      error: null,
    }))
    const save = vi.fn().mockResolvedValue({ stateSequence: 8 })
    const coordinator = new AgentExternalWaitRegistration({
      runId: 'run-1',
      threadId: 'thread-1',
      savePoints: { save } as unknown as AgentSavePointCoordinator,
      register,
      transition,
      emit,
    })
    const observation: AgentToolObservation = {
      source: {
        toolName: 'create_visible_generation_task',
        toolVersion: 1,
        toolCallId: 'call-1',
      },
      trust: 'untrusted_observation',
      dataClasses: ['C1'],
      summary: '已提交任务',
      output: { taskId: 'task-1', status: 'submitted' },
    }

    await expect(coordinator.registerIfSubmitted(
      [observation],
      {} as AgentTurnSnapshotDraft
    )).resolves.toBe(true)
    expect(transition).toHaveBeenCalledWith('waiting_external', expect.any(String))
    expect(save).toHaveBeenCalledWith('waiting_external', expect.anything())
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1', timeoutMs: 60 * 60 * 1_000, savePointSequence: 8,
    }))
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ExternalWaitRegistered', taskId: 'task-1',
    }))
  })

  it('Henji Script 内提交生成任务时必须连同受控断点登记', async () => {
    const transition = vi.fn()
    const emit = vi.fn()
    const register = vi.fn(async (input) => ({
      version: AGENT_EXTERNAL_WAIT_VERSION,
      waitId: input.waitId, threadId: input.threadId, sourceRunId: input.sourceRunId,
      taskId: input.taskId, targetStatuses: input.targetStatuses, status: 'active' as const,
      resumePolicy: 'linked_child_once' as const, savePointSequence: 9,
      createdAt: '2026-07-30T10:00:00.000Z', expiresAt: '2026-07-30T11:00:00.000Z',
      lastObservedStatus: null, lastEventId: null, claimedAt: null, consumedAt: null,
      resumedRunId: null, error: null,
    }))
    const save = vi.fn().mockResolvedValue({ stateSequence: 9 })
    const coordinator = new AgentExternalWaitRegistration({
      runId: 'run-2', threadId: 'thread-2',
      savePoints: { save } as unknown as AgentSavePointCoordinator,
      register, transition, emit,
    })
    const observation: AgentToolObservation = {
      source: { toolName: 'run_henji_script', toolVersion: 1, toolCallId: 'script-1' },
      trust: 'untrusted_observation', dataClasses: ['C1'], summary: '程序已提交生成任务',
      output: {
        status: 'waiting_external',
        submittedTasks: [{
          toolName: 'create_visible_generation_task', taskId: 'task-program-1', status: 'submitted',
        }],
        checkpoint: {
          version: 'henji-script-checkpoint/v1', scriptRunRef: 'henji-script:test',
          planDigest: 'a'.repeat(64), continuationDigest: 'b'.repeat(64), nextInstruction: 1,
          remainingInstructions: [], variables: [], parents: [], resultRefs: [], effects: [], steps: [],
          verificationState: { evidence: [] },
        },
      },
    }

    await expect(coordinator.registerIfSubmitted(
      [observation], {} as AgentTurnSnapshotDraft
    )).resolves.toBe(true)
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-program-1',
      continuation: expect.objectContaining({ scriptRunRef: 'henji-script:test' }),
    }))
    expect(transition).toHaveBeenCalledWith('waiting_external', expect.any(String))
  })

  it('Henji Script 丢失断点时拒绝进入不可恢复的等待态', async () => {
    const coordinator = new AgentExternalWaitRegistration({
      runId: 'run-missing', threadId: 'thread-missing',
      savePoints: { save: vi.fn() } as unknown as AgentSavePointCoordinator,
      register: vi.fn(), transition: vi.fn(), emit: vi.fn(),
    })
    const observation: AgentToolObservation = {
      source: { toolName: 'run_henji_script', toolVersion: 1, toolCallId: 'script-missing' },
      trust: 'untrusted_observation', dataClasses: ['C1'], summary: '已提交但断点丢失',
      output: {
        status: 'waiting_external', submittedTasks: [{
          toolName: 'create_visible_generation_task', taskId: 'task-missing', status: 'submitted',
        }],
      },
    }

    await expect(coordinator.registerIfSubmitted([observation], {} as AgentTurnSnapshotDraft))
      .rejects.toThrow('HENJI_SCRIPT_CHECKPOINT_MISSING')
  })
})
