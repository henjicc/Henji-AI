import { describe, expect, it } from 'vitest'
import { operationRecordSchema, type OperationRecord } from './operations'
import { projectExecutionFacts } from './executionFacts'
import type { AgentToolObservation } from './toolContracts'

const target = { kind: 'canvas.node', id: 'project:A' }
function operation(id: string, overrides: Partial<OperationRecord> = {}): OperationRecord {
  return operationRecordSchema.parse({
    runId: 'run', threadId: 'thread', key: id, toolCallId: id, toolName: 'change_application_entities', toolVersion: 1,
    inputDigest: 'a'.repeat(64), authorizationDigest: 'b'.repeat(64), readOnly: false, container: false, targets: [target],
    targetBindings: {}, expectedRevisions: {}, schemaVersion: 'operation-record/v1', operationId: id, logicalTaskId: 'run', attempt: 1,
    state: 'completed', createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:01.000Z',
    effects: [{ effect: 'update', entityTypes: ['canvas.node'], propertyIds: ['canvas.node.name'], targetRefs: [target], count: 1, verified: false, evidence: [] }],
    verifications: [{ operationId: id, conditionId: 'formal_result', targets: [target], status: 'passed', evidence: ['正式读回'], verifiedAt: '2026-09-12T00:00:01.000Z' }],
    ...overrides,
  })
}
function script(id: string, passed: boolean): AgentToolObservation {
  return { source: { toolName: 'run_henji_script', toolVersion: 1, toolCallId: id }, trust: 'untrusted_observation', dataClasses: ['C1'], summary: '',
    output: { status: passed ? 'completed' : 'partial', verification: { passed, summary: id, evidence: [] } },
    effects: passed ? [] : operation(id).effects }
}

describe('整项任务的执行事实汇总', () => {
  it('外部任务提交回执与最终结果分开，初次验证通过也不能关闭外部等待', () => {
    const submitted = operation('generation', { externalCalls: [{ key: 'generate', source: 'generation',
      inputDigest: 'd'.repeat(64), target: { kind: 'generation.task', id: 'task' }, state: 'submitted',
      dispatchedAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:01.000Z' }] })
    expect(projectExecutionFacts([submitted]).facts).toMatchObject({ completion: 'needs_check',
      unresolved: [{ operationId: 'generation', conditionId: 'external:generation:generate' }] })
    expect(projectExecutionFacts([{ ...submitted, externalCalls: [{ ...submitted.externalCalls[0], state: 'completed' }] }]).facts.unresolved).toEqual([])
  })
  it('后续脚本读取成功不能覆盖前序部分失败', () => {
    const result = projectExecutionFacts([], [script('partial-A', false), script('read-B', true)])
    expect(result.passed).toBe(false)
    expect(result.facts).toMatchObject({ completion: 'partial', verificationStatus: 'failed', resultRefs: [target],
      unresolved: [{ operationId: 'partial-A:0', conditionId: 'script_result' }] })
    expect(result.effects).toHaveLength(1)
  })

  it('分别记录执行与验证，原操作的准确验证通过后才关闭问题', () => {
    const failed = operation('A', { verifications: [{ ...operation('A').verifications[0], status: 'failed' }] })
    const other = operation('B', { targets: [{ ...target, id: 'project:B' }] })
    expect(projectExecutionFacts([failed, other]).facts).toMatchObject({ completion: 'partial', verificationStatus: 'failed',
      unresolved: [{ operationId: 'A', conditionId: 'formal_result', targets: [target] }] })
    expect(projectExecutionFacts([operation('A'), other])).toMatchObject({ passed: true, facts: { completion: 'completed', unresolved: [] } })
  })

  it('结果未知时保留已落盘引用及未验证事实，包装层不重复计算同一修改', () => {
    const unknown = operation('A', { state: 'unknown', effects: [], verifications: [{ ...operation('A').verifications[0], status: 'pending' }],
      persistenceReceipts: [{ operationId: 'A', boundaryId: 'save', targets: [target], storageTarget: { kind: 'canvas.project', id: 'project' },
        digest: 'c'.repeat(64), persistedAt: '2026-09-12T00:00:01.000Z' }] })
    const wrapper = operation('wrapper', { container: true, output: { status: 'completed', verification: { passed: true } } })
    const result = projectExecutionFacts([unknown, wrapper], [script('wrapper', true)])
    expect(result.facts.completion).toBe('needs_check')
    expect(result.facts.resultRefs).toEqual([target])
    expect(result.effects).toEqual([])
    expect(result.facts.unresolved.map((item) => item.operationId)).toEqual(['A', 'A'])
  })

  it('超过摘要展示数量的验证缺口仍完整保留，不以数组裁剪制造完成', () => {
    const records = Array.from({ length: 40 }, (_, index) => operation(`operation-${index}`, {
      verifications: [{ ...operation(`operation-${index}`).verifications[0], status: 'failed' }],
    }))
    expect(projectExecutionFacts(records).facts.unresolved).toHaveLength(40)
  })

  it('未执行的错误尝试须复用原操作推进到已验证，同工具同目标的新请求也不能代替', () => {
    const rejected = operation('rejected', { state: 'not_executed', effects: [], verifications: [] })
    const other = operation('other', { targets: [{ ...target, id: 'project:B' }] })
    expect(projectExecutionFacts([rejected, other]).facts.unresolved).toMatchObject([{ operationId: 'rejected', state: 'not_executed' }])
    expect(projectExecutionFacts([rejected, operation('fixed')]).facts.unresolved).toHaveLength(1)
    expect(projectExecutionFacts([operation('rejected')]).facts.unresolved).toEqual([])
  })
})
