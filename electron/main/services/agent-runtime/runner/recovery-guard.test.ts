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
})
