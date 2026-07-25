import { describe, expect, it } from 'vitest'

import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import { createAgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { AgentToolRegistry } from '../tools/registry'
import { AgentRecoveryWriteGuard } from './recovery-guard'

describe('AgentRecoveryWriteGuard', () => {
  it('只接受同领域成功只读观察解除写保护', () => {
    const summary = {
      ...createAgentWorkingSummary('恢复生成任务'),
      recovery: {
        mode: 'verify_before_write' as const,
        reason: '上次写入副作用未知',
        toolName: 'create_task',
        toolCategory: 'generation',
      },
    }
    const definitions = new Map([
      ['create_task', { readOnly: false, category: 'generation' }],
      ['read_canvas', { readOnly: true, category: 'canvas' }],
      ['read_task', { readOnly: true, category: 'generation' }],
    ])
    const registry = {
      get: (name: string) => definitions.get(name),
    } as unknown as AgentToolRegistry
    const guard = new AgentRecoveryWriteGuard(summary, registry)
    const writeCall = {
      toolCallId: 'write', toolName: 'create_task', input: {}, dynamic: false,
    }
    const observation: AgentToolObservation = {
      source: { toolName: 'read_task', toolVersion: 1, toolCallId: 'read' },
      trust: 'untrusted_observation',
      dataClasses: ['C0'],
      summary: '状态已确认',
      output: { ok: true, status: 'completed' },
    }

    expect(guard.validate(writeCall)).toContain('恢复检查尚未完成')
    expect(guard.consumeVerification({
      toolCallId: 'wrong', toolName: 'read_canvas', input: {}, dynamic: false,
    }, observation)).toBe(false)
    expect(guard.validate(writeCall)).toContain('恢复检查尚未完成')
    expect(guard.consumeVerification({
      toolCallId: 'read', toolName: 'read_task', input: {}, dynamic: false,
    }, observation)).toBe(true)
    expect(guard.validate(writeCall)).toBeNull()
  })

  it('供应商参数错误后只允许修正原模型并提交一次', () => {
    const definitions = new Map([
      ['get_generation_task', { readOnly: true, category: 'generation' }],
      ['get_model_schema', { readOnly: true, category: 'models' }],
      ['prepare_generation_task', { readOnly: true, category: 'generation' }],
      ['create_visible_generation_task', { readOnly: false, category: 'generation' }],
      ['search_models', { readOnly: true, category: 'models' }],
    ])
    const registry = { get: (name: string) => definitions.get(name) } as unknown as AgentToolRegistry
    const guard = new AgentRecoveryWriteGuard(undefined, registry)
    const sourceFailure: AgentToolObservation = {
      source: { toolName: 'get_generation_task', toolVersion: 1, toolCallId: 'read-source' },
      trust: 'untrusted_observation',
      dataClasses: ['C0'],
      summary: '生成任务状态：error。',
      output: {
        task: {
          taskId: 'task-source',
          status: 'error',
          recovery: {
            strategy: 'correct_same_model_parameters',
            sourceTaskId: 'task-source',
            sourceModelId: 'kie-z-image',
          },
        },
      },
    }
    guard.observe({ toolCallId: 'read-source', toolName: 'get_generation_task', input: { taskId: 'task-source' }, dynamic: false }, sourceFailure)
    expect(guard.validate({ toolCallId: 'search', toolName: 'search_models', input: {}, dynamic: false })).toContain('禁止搜索替代模型')
    expect(guard.validate({ toolCallId: 'other-schema', toolName: 'get_model_schema', input: { modelId: 'kie-grok-imagine' }, dynamic: false })).toContain('禁止读取替代模型')
    expect(guard.validate({ toolCallId: 'create-before-prepare', toolName: 'create_visible_generation_task', input: { modelId: 'kie-z-image' }, dynamic: false })).toContain('必须先读取模型')

    const prepared: AgentToolObservation = {
      source: { toolName: 'prepare_generation_task', toolVersion: 1, toolCallId: 'prepare' },
      trust: 'untrusted_observation',
      dataClasses: ['C0'],
      summary: '参数通过。',
      output: { preparation: { prepared: true, modelId: 'kie-z-image' } },
    }
    guard.observe({ toolCallId: 'prepare', toolName: 'prepare_generation_task', input: { modelId: 'kie-z-image' }, dynamic: false }, prepared)
    expect(guard.validate({ toolCallId: 'create', toolName: 'create_visible_generation_task', input: { modelId: 'kie-z-image' }, dynamic: false })).toBeNull()
  })
})
