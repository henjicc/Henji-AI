import { applicationVerificationConditionSchema } from '../../../../src/core/application-control/transactions'
import { jsonValueSchema } from '../../../../src/core/application-control/identifiers'
import type { OperationRecord } from './operationStore'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** 只接受原执行器的恢复证明或已全部落地的验证失败；不能从当前值猜执行，也不替代保存恢复。 */
export function operationVerificationRecovery(record: OperationRecord): NonNullable<OperationRecord['recoveryVerification']> | undefined {
  const details = object(object(record.result?.error).details)
  const transaction = object(details.transaction)
  // 原执行器留下的精确条件/证据可以重读验证；失败不等于没执行，保存失败也不能借此解除。
  const proof = record.recoveryVerification ?? transaction.recoveryVerification
  if (['unknown', 'awaiting_user_confirmation'].includes(record.state) && !transaction.persistence && !details.persistence && proof && typeof proof === 'object') {
    const value = proof as NonNullable<OperationRecord['recoveryVerification']>
    if (value.conditions?.length && value.evidence?.length) return value
  }
  if (record.state !== 'partial' || transaction.code !== 'VERIFICATION_FAILED' || transaction.persistence || details.persistence) return undefined
  const changes = record.input.changes
  const partial = object(transaction.partial)
  if (!Array.isArray(changes) || changes.length === 0
    || !Array.isArray(partial.completedStepIndexes) || partial.completedStepIndexes.length !== changes.length
    || !changes.every((_, index) => (partial.completedStepIndexes as unknown[]).includes(index))
    || !Array.isArray(partial.compensatedStepIndexes) || partial.compensatedStepIndexes.length !== 0
    || !Array.isArray(partial.uncompensatedStepIndexes) || partial.uncompensatedStepIndexes.length !== changes.length
    || !changes.every((_, index) => (partial.uncompensatedStepIndexes as unknown[]).includes(index))) return undefined
  const conditions = new Map<string, ReturnType<typeof applicationVerificationConditionSchema.parse>>()
  for (const raw of changes) {
    const change = object(raw)
    // 集合创建、算法及 append/remove 需要各自的恢复证明，不能从输入猜最终值。
    if (change.kind !== 'set_properties') return undefined
    const target = object(change.target)
    if (typeof change.entityType !== 'string' || target.kind !== undefined && target.kind !== change.entityType || typeof target.id !== 'string') return undefined
    const properties = Object.entries(object(change.properties))
    if (!properties.length) return undefined
    for (const [propertyId, value] of properties) {
      const expected = jsonValueSchema.safeParse(value)
      const resolvedPropertyId = propertyId.includes('.') ? propertyId : `${change.entityType}.${propertyId}`
      const condition = applicationVerificationConditionSchema.safeParse({ kind: 'property_equals', target: { ...target, kind: change.entityType }, propertyId: resolvedPropertyId, expected: expected.data })
      if (!expected.success || !condition.success) return undefined
      conditions.set(JSON.stringify([change.entityType, target.id, resolvedPropertyId]), condition.data)
    }
  }
  if (!conditions.size) return undefined
  return { conditions: [...conditions.values()], evidence: [] }
}
