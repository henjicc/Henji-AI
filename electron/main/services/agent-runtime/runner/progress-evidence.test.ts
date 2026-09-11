import { describe, expect, it } from 'vitest'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import { AgentRunMetrics } from './budget'
import { businessResultFingerprint, toolProgressEvidence } from '../tools/progress-evidence'

function observation(receipt: string, value: number): AgentToolObservation {
  return {
    source: { toolName: 'run_henji_script', toolVersion: 1, toolCallId: receipt },
    trust: 'untrusted_observation', dataClasses: ['C1'], summary: receipt,
    output: { status: 'completed', scriptRunRef: receipt, revision: value,
      progressEvidence: [{ kind: 'observation', subject: 'read_application_entity',
        fingerprint: businessResultFingerprint('read_application_entity', { properties: { value } }) }] },
  }
}

describe('business progress evidence', () => {
  it('重复目录发现只比较实际目录内容，查询指纹和缓存状态不计进展', () => {
    const fingerprint = (fingerprint: string, reused: boolean, name: string) => businessResultFingerprint(
      'discover_application_capabilities', { fingerprint, reused, scriptApi: { actions: [{ id: name }] } },
    )
    expect(fingerprint('query-a', false, 'read')).toBe(fingerprint('query-b', true, 'read'))
    expect(fingerprint('query-a', false, 'read')).not.toBe(fingerprint('query-a', true, 'write'))
  })

  it('重复脚本的新回执编号不能解除空转限制', () => {
    const budget = new AgentRunMetrics({ maxNoProgressTurns: 2, maxRepeatedToolCalls: null })
    budget.recordProgress(toolProgressEvidence(observation('first', 1)))
    budget.recordProgress(toolProgressEvidence(observation('second', 1)))
    expect(() => budget.recordProgress(toolProgressEvidence(observation('third', 1)))).toThrow(/没有产生新进展/)
  })

  it('识别 A B A B 循环，同时允许真实修改后重新验证 A', () => {
    const budget = new AgentRunMetrics({ maxNoProgressTurns: 2 })
    budget.recordProgress('read:A')
    budget.recordProgress('read:B')
    budget.recordProgress('read:A')
    expect(() => budget.recordProgress('read:B')).toThrow(/没有产生新进展/)
    budget.recordProgress({ kind: 'mutation', subject: 'A', fingerprint: 'a'.repeat(64) })
    expect(() => budget.recordProgress('read:A')).not.toThrow()
    expect(budget.snapshot().noProgressTurns).toBe(0)
  })

  it('真实读取值变化是进展；业务时间字段不会被传输信封裁剪误删', () => {
    const budget = new AgentRunMetrics({ maxNoProgressTurns: 1 })
    budget.recordProgress(toolProgressEvidence(observation('first', 1)))
    expect(() => budget.recordProgress(toolProgressEvidence(observation('next', 2)))).not.toThrow()
    const fingerprint = (value: number) => businessResultFingerprint('read', { revision: 10, properties: { updatedAt: value } })
    expect(fingerprint(1)).not.toBe(fingerprint(2))
    expect(businessResultFingerprint('read', { revision: 1, properties: { name: 'A' } }))
      .toBe(businessResultFingerprint('read', { revision: 2, properties: { name: 'A' } }))
  })
})
