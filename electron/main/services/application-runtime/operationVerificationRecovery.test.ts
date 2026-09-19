import { describe, expect, it } from 'vitest'
import type { OperationRecord } from './operationStore'
import { operationVerificationRecovery } from './operationVerificationRecovery'

function record(): OperationRecord {
  return { operationId: 'operation', callerId: 'caller', inputDigest: 'digest', state: 'partial', capabilityId: 'change_application_entities',
    input: { changes: [{ kind: 'set_properties', entityType: 'asset', target: { kind: 'asset', id: 'one' }, properties: { 'asset.tags': ['B', 'A'] } }] },
    result: { ok: false, error: { details: { transaction: { code: 'VERIFICATION_FAILED', partial: { completedStepIndexes: [0], compensatedStepIndexes: [], uncompensatedStepIndexes: [0] } } } } } }
}
describe('仅回读恢复操作核实', () => {
  it('保留原输入的精确预期值，重复属性仅核对最终值', () => {
    const original = record()
    const changes = original.input.changes as Array<Record<string, unknown>>
    changes.push({ ...changes[0], properties: { 'asset.tags': ['C'] } })
    const transaction = ((original.result!.error as { details: { transaction: { partial: { completedStepIndexes: number[]; uncompensatedStepIndexes: number[] } } } }).details.transaction)
    transaction.partial.completedStepIndexes.push(1)
    transaction.partial.uncompensatedStepIndexes.push(1)
    expect(operationVerificationRecovery(original)).toEqual({ conditions: [{ kind: 'property_equals', target: { kind: 'asset', id: 'one' }, propertyId: 'asset.tags', expected: ['C'] }], evidence: [] })
  })
  it.each(['unknown', 'executing', 'completed', 'not_executed'] as const)('%s 不可按最终值推断执行事实', state => {
    expect(operationVerificationRecovery({ ...record(), state })).toBeUndefined()
  })
  it.each(['persistence', 'incomplete', 'compensated', 'algorithm'])('拒绝 %s', kind => {
    const original = record()
    const transaction = (original.result!.error as { details: { transaction: Record<string, unknown> } }).details.transaction
    if (kind === 'persistence') transaction.persistence = { status: 'failed' }
    if (kind === 'incomplete') transaction.partial = { completedStepIndexes: [], compensatedStepIndexes: [] }
    if (kind === 'compensated') transaction.partial = { completedStepIndexes: [0], compensatedStepIndexes: [0] }
    if (kind === 'algorithm') original.input.changes = [{ kind: 'create_items' }]
    expect(operationVerificationRecovery(original)).toBeUndefined()
  })
})
