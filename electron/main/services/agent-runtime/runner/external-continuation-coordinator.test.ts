import { describe, expect, it, vi } from 'vitest'

import type { AgentContextBuildResult } from '../context/types'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentSavePointCoordinator } from './save-point-coordinator'
import type { AgentToolExecutionCoordinator } from './tool-execution-coordinator'
import { AgentExternalContinuationCoordinator } from './external-continuation-coordinator'

function createCoordinator() {
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
      observedStatus: 'success',
      sourceTotalTokens: 42,
      sourceKnownCostUsd: 0.2,
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
    const input = {
      snapshot: {} as never,
      route: {} as never,
      scopeRevisions: {} as never,
      activeToolNames: [],
      rebuild: vi.fn(() => rebuilt),
    }

    await expect(coordinator.queryAuthoritativeStatus(input)).resolves.toBe(rebuilt)
    await expect(coordinator.queryAuthoritativeStatus(input)).resolves.toBeNull()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith(
      [expect.objectContaining({ toolName: 'get_generation_task', input: { taskId: 'task-1' } })],
      expect.anything(),
      expect.anything(),
      new Set(['get_generation_task'])
    )
    expect(save).toHaveBeenNthCalledWith(1, 'before_tools', expect.anything())
    expect(save).toHaveBeenNthCalledWith(2, 'after_tools', expect.anything())
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
})
