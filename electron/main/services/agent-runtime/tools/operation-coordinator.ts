import {
  operationRecordSchema, type OperationIntent, type OperationPersistence, type OperationRecord,
} from '../../../../../src/core/assistant/operations'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import { failureObservedEffects } from '../../../../../src/core/assistant/applicationTransactionFailureFacts'
import { AgentToolGatewayError } from './gateway-support'

/** 此协调器只连接持久化契约，不保存另一份业务状态。 */
export class AgentOperationCoordinator {
  constructor(private readonly persistence?: OperationPersistence) {}

  async list(runId: string): Promise<OperationRecord[]> {
    return this.persistence ? operationRecordSchema.array().parse(await this.persistence.execute({ action: 'list', runId })) : []
  }

  async verify(runId: string, key: string, targets: OperationIntent['targets'], passed: boolean, evidence: string[]): Promise<void> {
    if (!this.persistence) return
    const record = operationRecordSchema.parse(await this.persistence.execute({ action: 'lookup', runId, key }))
    await this.persistence.execute({ action: 'verify', runId, verification: {
      operationId: record.operationId, conditionId: 'formal_result', targets,
      status: passed ? 'passed' : 'failed', evidence, verifiedAt: new Date().toISOString(),
    } })
  }

  async prepare(intent: OperationIntent): Promise<OperationRecord | null> {
    if (!this.persistence) return null
    const records = !intent.readOnly && !intent.container && intent.businessMutation !== false ? await this.list(intent.runId) : []
    const original = records.find((item) => item.state === 'partial' && item.transaction?.persistence?.recovery.capabilityId === intent.toolName
      && !item.verifications.some((verification) => verification.conditionId === 'persistence' && verification.status === 'passed')
      && intent.targets.some((ref) => ref.kind === item.transaction!.persistence!.recovery.target.kind && ref.id === item.transaction!.persistence!.recovery.target.id))
    const record = operationRecordSchema.parse(await this.persistence.execute({ action: 'prepare', intent: {
      ...intent, ...(original ? { recoveryOfOperationId: original.operationId } : {}),
    } }))
    if (record.state === 'completed') return record
    if (['dispatched', 'unknown', 'partial'].includes(record.state)) {
      throw new AgentToolGatewayError('CONFLICT', '原操作已经派发，结果尚待核对；不能重新执行或再次创建。', true, 'user_action')
    }
    if (!intent.readOnly && !intent.container && intent.businessMutation !== false) {
      const blockers = records.filter((item) => !item.readOnly && !item.container && item.businessMutation !== false && (
        ['unknown', 'dispatched'].includes(item.state)
        || (item.state === 'partial' && !item.verifications.some((verification) => verification.conditionId === 'persistence' && verification.status === 'passed'))
      ))
      if (blockers.some((item) => {
        const recovery = item.transaction?.persistence?.recovery
        return item.state !== 'partial' || recovery?.capabilityId !== intent.toolName
          || !intent.targets.some((ref) => ref.kind === recovery.target.kind && ref.id === recovery.target.id)
      })) {
        throw new AgentToolGatewayError('CONFLICT', '本任务有未核对的写入；请查询原操作和目标回执，其他对象的读取不能解除保护。', true, 'user_action')
      }
    }
    return record
  }

  async dispatch(runId: string, record: OperationRecord | null, policyVersion?: number, authorizationDigest?: string): Promise<OperationRecord | null> {
    if (!record || !this.persistence || record.state === 'completed') return record
    return operationRecordSchema.parse(await this.persistence.execute({ action: 'dispatch', runId, operationId: record.operationId, policyVersion, authorizationDigest }))
  }

  async complete(runId: string, record: OperationRecord | null, observation: AgentToolObservation): Promise<void> {
    if (!record || !this.persistence) return
    await this.persistence.execute({ action: 'complete', runId, operationId: record.operationId, observation })
    const output = observation.output && typeof observation.output === 'object' ? observation.output as Record<string, unknown> : null
    if (output?.status !== 'persisted') return
    const outputRefs = operationTargetRefs(output)
    const records = await this.list(runId)
    const completed = records.find((item) => item.operationId === record.operationId)
    for (const original of records) {
      const recovery = original.transaction?.persistence?.recovery
      if (record.recoveryOfOperationId !== original.operationId || original.state !== 'partial' || recovery?.capabilityId !== record.toolName
        || !record.targets.some((ref) => ref.kind === recovery.target.kind && ref.id === recovery.target.id)
        || !outputRefs.some((ref) => ref.kind === recovery.target.kind && ref.id === recovery.target.id)) continue
      // 成功文案与同目标读取都不能替代保存屏障；须有本次恢复后新增的领域保存事实。
      const dispatchedAt = completed?.attempts.at(-1)?.dispatchedAt
      const receipts = [...original.persistenceReceipts, ...(completed?.persistenceReceipts ?? [])]
      if (!dispatchedAt || !receipts.some((receipt) => Date.parse(receipt.persistedAt) >= Date.parse(dispatchedAt)
        && ((original.transaction?.persistence?.stage === 'projection' && receipt.operationId === original.operationId)
          || [receipt.storageTarget, ...receipt.targets].some((ref) => ref.kind === recovery.target.kind && ref.id === recovery.target.id)))) continue
      await this.persistence.execute({ action: 'verify', runId, verification: {
        operationId: original.operationId, conditionId: 'persistence', targets: [recovery.target],
        status: 'passed', evidence: [`保存屏障已确认；恢复操作 ${record.operationId}，原修改未重放。`],
        verifiedAt: new Date().toISOString(), resolvesOperationId: original.operationId,
      } })
    }
  }

  async fail(runId: string, record: OperationRecord | null, error: AgentToolGatewayError): Promise<void> {
    if (!record || !this.persistence) return
    const transaction = error.transaction
    const effects = transaction ? failureObservedEffects(transaction) : []
    await this.persistence.execute({ action: 'fail', runId, operationId: record.operationId,
      state: record.readOnly || transaction?.executionState === 'not_started' || record.state === 'prepared' || record.state === 'not_executed' ? 'not_executed' : effects.length || transaction?.persistence ? 'partial' : 'unknown',
      error: error.message.slice(0, 2000), transaction, effects })
  }
}

export function operationTargetRefs(value: unknown): OperationIntent['targets'] {
  const refs = new Map<string, OperationIntent['targets'][number]>()
  const visit = (input: unknown): void => {
    if (!input || typeof input !== 'object') return
    if (Array.isArray(input)) { input.forEach(visit); return }
    const record = input as Record<string, unknown>
    if (typeof record.kind === 'string' && typeof record.id === 'string') {
      refs.set(`${record.kind}\0${record.id}`, { kind: record.kind, id: record.id })
    }
    Object.values(record).forEach(visit)
  }
  visit(value)
  return [...refs.values()]
}

/** 输入中的来源/父引用不是要验证的修改目标；通用动词显式绑定被修改的对象。 */
export function operationVerificationTargets(toolName: string, value: unknown): OperationIntent['targets'] {
  if (toolName !== 'change_application_entities' || !value || typeof value !== 'object') return []
  const changes = Reflect.get(value, 'changes')
  if (!Array.isArray(changes)) return []
  return changes.flatMap((change: unknown) => {
    if (!change || typeof change !== 'object') return []
    const kind = Reflect.get(change, 'kind')
    if (kind === 'set_properties' || kind === 'mutate_properties') return operationTargetRefs(Reflect.get(change, 'target'))
    return kind === 'remove_items' ? operationTargetRefs(Reflect.get(change, 'targets')) : []
  })
}
