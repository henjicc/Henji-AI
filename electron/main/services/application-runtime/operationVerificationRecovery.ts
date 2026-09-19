import { applicationVerificationConditionSchema } from '../../../../src/core/application-control/transactions'
import { jsonValueSchema } from '../../../../src/core/application-control/identifiers'
import type { OperationRecord } from './operationStore'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** 仅接受已经全部落地、仅最终值核对失败的事务；未知执行和保存失败绝不能靠回读解除。 */
export function operationVerificationRecovery(record: OperationRecord): NonNullable<OperationRecord['recoveryVerification']> | undefined {
  const transaction = object(object(object(record.result?.error).details).transaction)
  if (record.state !== 'partial' || transaction.code !== 'VERIFICATION_FAILED' || transaction.persistence) return undefined
  const changes = record.input.changes
  const partial = object(transaction.partial)
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 32
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
    if (target.kind !== change.entityType || typeof target.id !== 'string') return undefined
    const properties = Object.entries(object(change.properties))
    if (!properties.length) return undefined
    for (const [propertyId, value] of properties) {
      const expected = jsonValueSchema.safeParse(value)
      const condition = applicationVerificationConditionSchema.safeParse({ kind: 'property_equals', target, propertyId, expected: expected.data })
      if (!expected.success || !condition.success) return undefined
      conditions.set(JSON.stringify([target.kind, target.id, propertyId]), condition.data)
    }
  }
  if (!conditions.size || conditions.size > 256) return undefined
  return { conditions: [...conditions.values()], evidence: [] }
}
