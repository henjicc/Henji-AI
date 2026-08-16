import { describe, expect, it, vi } from 'vitest'

import type { AgentContextBuildResult } from '../context/types'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentSavePointCoordinator } from './save-point-coordinator'
import type { AgentToolExecutionCoordinator } from './tool-execution-coordinator'
import { AgentExternalContinuationCoordinator } from './external-continuation-coordinator'

function checkpoint() {
  return {
    version: 'henji-script-checkpoint/v1' as const,
    scriptRunRef: 'henji-script:test', planDigest: 'a'.repeat(64),
    continuationDigest: 'b'.repeat(64), nextInstruction: 1,
    remainingInstructions: [], variables: [], parents: [], resultRefs: [], effects: [], steps: [],
    verificationState: { evidence: [] },
  }
}

function createCoordinator(
  withCheckpoint = false,
  observedStatus: 'success' | 'error' | 'cancelled' | 'timeout' = 'success',
) {
  const execute = vi.fn().mockResolvedValue(undefined)
  const save = vi.fn().mockResolvedValue({ stateSequence: 4 })
  const registration = { catalog: { name: 'get_generation_task' } }
  const registry = {
    registrations: vi.fn(() => [registration]),
  } as unknown as AgentToolRegistry
  const coordinator = new AgentExternalContinuationCoordinator({
    continuation: {
      waitId: 'wait-1',
      sourceRunId: 'run-1',
      taskId: 'task-1',
      observedStatus,
      sourceTotalTokens: 42,
      sourceKnownCostUsd: 0.2,
      sourceEffects: [{
        effect: 'execute', entityTypes: ['generation.task'], propertyIds: [],
        targetRefs: [{ kind: 'generation.task', id: 'task-1' }], count: 1,
        verified: false, evidence: ['task:task-1'],
      }],
      scriptCheckpoint: withCheckpoint ? checkpoint() : null,
    },
    registry,
    tools: { execute } as unknown as AgentToolExecutionCoordinator,
    savePoints: { save } as unknown as AgentSavePointCoordinator,
  })
  return { coordinator, execute, save }
}

describe('AgentExternalContinuationCoordinator', () => {
  it('模型续接前只执行一次权威任务查询', async () => {
    const { coordinator, execute, save } = createCoordinator()
    const rebuilt = { messages: [] } as unknown as AgentContextBuildResult
    const freshHost = { scopeRevisions: { generation: 10 } } as never
    const input = {
      snapshot: {} as never,
      route: {} as never,
      scopeRevisions: { generation: 9 } as never,
      activeToolNames: [],
      refreshHost: vi.fn(() => freshHost),
      rebuild: vi.fn(() => rebuilt),
    }

    await expect(coordinator.queryAuthoritativeStatus(input)).resolves.toEqual({
      context: rebuilt,
      host: freshHost,
    })
    await expect(coordinator.queryAuthoritativeStatus(input)).resolves.toBeNull()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(
      [expect.objectContaining({ toolName: 'get_generation_task', input: { taskId: 'task-1' } })],
      expect.anything(),
      {},
      new Set(['get_generation_task'])
    )
    expect(save).toHaveBeenNthCalledWith(1, 'before_tools', expect.anything())
    expect(save).toHaveBeenNthCalledWith(2, 'after_tools', expect.anything())
    expect(input.rebuild).toHaveBeenCalledWith(freshHost)
  })

  it('从激活目录移除创建工具并拒绝模型重复提交', () => {
    const { coordinator } = createCoordinator()
    const activation = coordinator.extendActivation({
      registrations: [
        { catalog: { name: 'create_visible_generation_task' } },
        { catalog: { name: 'list_visible_generation_tasks' } },
      ],
      activeToolNames: ['create_visible_generation_task', 'list_visible_generation_tasks'],
      schemaBytes: 0,
      descriptionBytes: 0,
      candidateCount: 2,
      pinnedToolNames: [],
      droppedPinnedToolNames: [],
      droppedForCount: [],
      droppedForSchemaBudget: [],
      unavailableNames: [],
    } as never, {} as never)
    expect(activation.activeToolNames).toEqual([
      'list_visible_generation_tasks',
      'get_generation_task',
    ])
    expect(() => coordinator.assertNoResubmit([{
      toolCallId: 'call-1',
      toolName: 'create_visible_generation_task',
      input: {},
      dynamic: false,
    }])).toThrow('自动续接不得重复提交原生成任务')
  })

  it('存在脚本断点时在权威查询后由同一解释器自动续跑', async () => {
    const { coordinator, execute } = createCoordinator(true)
    const input = {
      snapshot: {} as never, route: {} as never, scopeRevisions: {} as never,
      activeToolNames: [], refreshHost: vi.fn(() => ({ scopeRevisions: {} }) as never),
      rebuild: vi.fn(() => ({ messages: [] }) as never),
    }

    await coordinator.queryAuthoritativeStatus(input)

    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenNthCalledWith(
      2,
      [expect.objectContaining({
        toolName: 'resume_henji_script',
        input: expect.objectContaining({ observedStatus: 'success' }),
      })],
      expect.anything(), {}, new Set(['get_generation_task', 'resume_henji_script']),
      new Set(['resume_henji_script'])
    )
  })

  it.each(['error', 'cancelled', 'timeout'] as const)(
    '外部生成终态为 %s 时只做权威读取并返回终态失败，不再调用脚本或模型补救',
    async (observedStatus) => {
      const { coordinator, execute } = createCoordinator(true, observedStatus)
      const input = {
        snapshot: {} as never, route: {} as never, scopeRevisions: {} as never,
        activeToolNames: [], refreshHost: vi.fn(() => ({ scopeRevisions: {} }) as never),
        rebuild: vi.fn(() => ({ messages: [] }) as never),
      }

      const result = await coordinator.queryAuthoritativeStatus(input)

      expect(execute).toHaveBeenCalledTimes(1)
      expect(execute).toHaveBeenCalledWith(
        [expect.objectContaining({ toolName: 'get_generation_task' })],
        expect.anything(), {}, new Set(['get_generation_task']),
      )
      expect(result?.terminalError?.message).toContain(`外部生成以 ${observedStatus} 结束`)
    },
  )

  it('只承认宿主权威读取返回的已验证稳定引用', () => {
    const { coordinator } = createCoordinator(true)
    const call = {
      toolCallId: 'external:wait-1:query', toolName: 'get_generation_task',
      input: { taskId: 'task-1' }, dynamic: false,
    }
    const observation = {
      toolCallId: call.toolCallId, toolName: call.toolName, ok: true,
      summary: '已读取。', output: {}, resultingRevisions: {},
      effects: [{
        effect: 'observe', entityTypes: ['generation.task'], propertyIds: [],
        targetRefs: [{ kind: 'generation.task', id: 'task-1' }], count: 1,
        verified: true, evidence: [],
      }],
    } as never

    expect(coordinator.verifiesRecovery(call, observation)).toBe(true)
    expect(coordinator.verifiesRecovery(
      { ...call, toolCallId: 'model-call' }, observation,
    )).toBe(false)
    expect(coordinator.verifiesRecovery(call, {
      effects: [{
        effect: 'observe', entityTypes: ['generation.task'], propertyIds: [],
        targetRefs: [{ kind: 'generation.task', id: 'task-1' }], count: 1,
        verified: false, evidence: [],
      }],
    } as never)).toBe(false)
  })
})
