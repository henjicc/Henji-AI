import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  operationCommandSchema, operationRecordSchema,
  operationTransportBindingSchema,
  type OperationCommand, type OperationRecord, type OperationTransportBinding, type OperationRecovery,
} from '../../../../../src/core/assistant/operations'
import type { AgentObservedEffect } from '../../../../../src/core/assistant/observedEffect'
import { isMutatingEffect } from '../../../../../src/core/assistant/observedEffect'
import { digestJson } from '../tools/security'
import { applicationPersistenceCorrelationSchema, type ApplicationPersistenceCorrelation } from '../../../../../src/core/application-control/persistenceCorrelation'
import { applicationExecutionPreparationSchema, type ApplicationExecutionPreparation } from '../../../../../src/core/application-control/transactions'

/** 主进程协调执行身份和回执；SQLite 是恢复依据，缓存不是。 */
export class AgentOperationStore {
  constructor(private readonly database: Database.Database) {}

  private task(runId: string): { logicalTaskId: string; threadId: string } {
    const seen = new Set<string>()
    let current = runId
    let threadId: string | undefined
    while (!seen.has(current)) {
      seen.add(current)
      const row = this.database.prepare('SELECT thread_id, parent_run_id, logical_task_id FROM agent_runs WHERE run_id = ?')
        .get(current) as { thread_id: string; parent_run_id: string | null; logical_task_id: string | null } | undefined
      if (!row || (threadId && row.thread_id !== threadId)) throw new Error('[OPERATION_OWNER_INVALID] 操作不属于有效任务')
      threadId = row.thread_id
      if (row.logical_task_id) {
        const root = this.database.prepare('SELECT thread_id FROM agent_runs WHERE run_id = ?').get(row.logical_task_id) as { thread_id: string } | undefined
        if (root?.thread_id !== threadId) throw new Error('[OPERATION_OWNER_INVALID] 逻辑任务不属于原会话')
        return { logicalTaskId: row.logical_task_id, threadId }
      }
      if (!row.parent_run_id) return { logicalTaskId: current, threadId }
      current = row.parent_run_id
    }
    throw new Error('[OPERATION_OWNER_INVALID] 任务恢复链循环')
  }

  logicalTaskId(runId: string): string { return this.task(runId).logicalTaskId }

  private parse(row: unknown): OperationRecord | null {
    return row ? operationRecordSchema.parse(JSON.parse((row as { record_json: string }).record_json)) : null
  }

  get(operationId: string): OperationRecord | null {
    return this.parse(this.database.prepare('SELECT record_json FROM agent_operations WHERE operation_id = ?').get(operationId))
  }

  owns(runId: string, operationId: string): boolean {
    return this.get(operationId)?.logicalTaskId === this.task(runId).logicalTaskId
  }

  private save(record: OperationRecord): OperationRecord {
    const value = operationRecordSchema.parse({ ...record, updatedAt: new Date().toISOString() })
    this.database.prepare(`INSERT INTO agent_operations(operation_id, logical_task_id, run_id, operation_key, state, record_json)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(operation_id) DO UPDATE SET state=excluded.state, record_json=excluded.record_json`)
      .run(value.operationId, value.logicalTaskId, value.runId, value.key, value.state, JSON.stringify(value))
    return value
  }

  execute(raw: OperationCommand): OperationRecord | OperationRecord[] | null {
    const command = operationCommandSchema.parse(raw)
    return this.database.transaction(() => {
      const runId = command.action === 'prepare' ? command.intent.runId : command.runId
      const owner = this.task(runId)
      if (command.action === 'list') {
        return this.database.prepare('SELECT record_json FROM agent_operations WHERE logical_task_id = ? ORDER BY rowid')
          .all(owner.logicalTaskId).map((row) => this.parse(row)!)
      }
      if (command.action === 'lookup' || command.action === 'prepare') {
        const key = command.action === 'lookup' ? command.key : command.intent.key
        const existing = this.parse(this.database.prepare('SELECT record_json FROM agent_operations WHERE logical_task_id = ? AND operation_key = ?')
          .get(owner.logicalTaskId, key))
        if (command.action === 'lookup') return existing
        const intent = command.intent
        if (intent.threadId !== owner.threadId) throw new Error('[OPERATION_OWNER_INVALID] 线程与操作不一致')
        if (existing) {
          if (existing.inputDigest !== intent.inputDigest || existing.toolName !== intent.toolName || existing.toolVersion !== intent.toolVersion) {
            throw new Error('[OPERATION_CONFLICT] 原操作身份不能绑定新的业务输入')
          }
          return existing
        }
        if (intent.recoveryOfOperationId) {
          const original = this.get(intent.recoveryOfOperationId)
          const recovery = original?.transaction?.persistence?.recovery
          if (original?.logicalTaskId !== owner.logicalTaskId || original.state !== 'partial' || recovery?.capabilityId !== intent.toolName
            || !intent.targets.some((ref) => ref.kind === recovery.target.kind && ref.id === recovery.target.id)) {
            throw new Error('[OPERATION_RECOVERY_MISMATCH] 恢复必须关联原任务的保存条件和具体目标')
          }
        }
        const now = new Date().toISOString()
        const operationId = randomUUID()
        let repairsOperationId: string | undefined
        if (intent.repairsScriptRunRef) {
          const records = this.execute({ action: 'list', runId: intent.runId }) as OperationRecord[]
          const original = records.find((item) => item.container && item.output && typeof item.output === 'object'
            && Reflect.get(item.output, 'scriptRunRef') === intent.repairsScriptRunRef)
          const output = original?.output && typeof original.output === 'object' ? original.output : null
          const error = output ? Reflect.get(output, 'error') as { phase?: unknown } | null : null
          if (!intent.container || intent.toolName !== 'run_henji_script' || !original || original.state !== 'completed'
            || Reflect.get(output!, 'status') !== 'failed' || !['parse', 'compile', 'preflight'].includes(String(error?.phase))
            || original.effects.length || original.persistenceReceipts.length || original.externalCalls.length
            || records.some((item) => item.parentToolCallId === original.toolCallId)) {
            throw new Error('[SCRIPT_REPAIR_UNSAFE] 仅可关联原任务中确认未进入执行的脚本；已执行或未知操作必须先核对')
          }
          repairsOperationId = original.operationId
        }
        return this.save({ ...intent, ...owner, schemaVersion: 'operation-record/v1', operationId,
          repairsOperationId,
          attempt: 1, attempts: [], persistenceReceipts: [], persistenceIntents: [], externalCalls: [], verificationPlans: [], state: 'prepared', createdAt: now, updatedAt: now, effects: [],
          verifications: intent.readOnly || intent.businessMutation === false ? [] : [{ operationId, conditionId: 'formal_result',
            targets: intent.verificationTargets ?? intent.targets, status: 'pending', evidence: [], verifiedAt: now }] })
      }
      const operationId = command.action === 'verify' ? command.verification.operationId : command.operationId
      const record = this.get(operationId)
      if (!record || record.logicalTaskId !== owner.logicalTaskId) throw new Error('[OPERATION_OWNER_INVALID] 找不到原操作')
      if (command.action === 'checkpoint') {
        if (!record.container) throw new Error('OPERATION_CHECKPOINT_INVALID')
        return this.save({ ...record, checkpoint: command.checkpoint })
      }
      if (command.action === 'dispatch') {
        if (record.state !== 'prepared' && record.state !== 'not_executed') throw new Error('[OPERATION_REPLAY_BLOCKED] 操作已派发，必须先核对原回执')
        const attempt = record.attempt + (record.state === 'not_executed' ? 1 : 0)
        const authorizationDigest = command.authorizationDigest ?? record.authorizationDigest
        const policyVersion = command.policyVersion ?? record.policyVersion
        return this.save({ ...record, state: 'dispatched', attempt, authorizationDigest, policyVersion,
          executionClaim: undefined, attempts: [...record.attempts, { attempt, runId, authorizationDigest,
            policyVersion, dispatchedAt: new Date().toISOString() }] })
      }
      if (command.action === 'complete') {
        if (record.state === 'prepared' || record.state === 'not_executed') throw new Error('[OPERATION_RECEIPT_INVALID] 尚未派发的操作不能确认执行')
        if (record.observation && digestJson(record.observation) !== digestJson(command.observation)) {
          throw new Error('[OPERATION_RECEIPT_CONFLICT] 原操作回执不允许覆盖')
        }
        return this.save(this.withVerificationTargets({ ...record, state: 'completed', observation: command.observation,
          output: command.observation.output, effects: command.observation.effects ?? [] }))
      }
      if (command.action === 'fail') {
        if (command.state === 'not_executed' && record.persistenceReceipts.length) {
          throw new Error('[OPERATION_FACT_CONFLICT] 已有领域保存事实，不能认定原操作未执行')
        }
        // 等待超时或事件发送失败不能覆盖已经落盘的业务回执。
        if (record.state === 'completed' || (record.state === 'not_executed' && command.state === 'unknown') || (record.state === 'partial' && !command.transaction && !command.effects.length)) return record
        return this.save(this.withVerificationTargets({ ...record, state: command.state, error: command.error,
          transaction: command.transaction ?? record.transaction,
          effects: command.effects.length ? command.effects : record.effects }))
      }
      const verification = command.verification
      const previousVerification = record.verifications.find((item) => item.conditionId === verification.conditionId)
      const required = previousVerification?.targets ?? []
      if (verification.status === 'passed' && !required.every((ref) => verification.targets.some((target) => ref.kind === target.kind && ref.id === target.id))) {
        throw new Error('[OPERATION_VERIFICATION_INCOMPLETE] 验证没有覆盖原操作的全部绑定目标')
      }
      const available = [...record.targets, ...record.effects.flatMap((effect) => effect.targetRefs),
        ...record.persistenceReceipts.flatMap((receipt) => receipt.targets),
        ...(record.transaction?.persistence ? [record.transaction.persistence.recovery.target] : [])]
      if (!verification.targets.every((target) => available.some((ref) => ref.kind === target.kind && ref.id === target.id))) {
        throw new Error('[OPERATION_VERIFICATION_MISMATCH] 验证引用不属于原操作')
      }
      if (verification.resolvesOperationId && verification.resolvesOperationId !== record.operationId) {
        throw new Error('[OPERATION_VERIFICATION_MISMATCH] 恢复关系必须核对被恢复操作')
      }
      const verificationTime = Date.parse(verification.verifiedAt)
      if (verificationTime < Date.parse(record.attempts.at(-1)?.dispatchedAt ?? record.createdAt)
        || (previousVerification && verificationTime < Date.parse(previousVerification.verifiedAt))) {
        throw new Error('[OPERATION_VERIFICATION_STALE] 验证早于当前执行尝试或已有核对，请重新读取原目标')
      }
      if (verification.status === 'passed' && ['prepared', 'not_executed'].includes(record.state)) {
        throw new Error('[OPERATION_VERIFICATION_NOT_EXECUTED] 未执行操作不能通过结果验证')
      }
      return this.save({ ...record, verifications: [
        ...record.verifications.filter((item) => item.conditionId !== verification.conditionId),
        { ...verification, targets: required.length ? required : verification.targets, checkedTargets: verification.targets },
      ] })
    })()
  }

  /** 业务返回到主进程即落盘，先于 utility 回执与运行事件。迟到结果同样保留。 */
  recordOutput(operationId: string, output: unknown, effects: AgentObservedEffect[] = []): void {
    const record = this.get(operationId)
    if (!record) throw new Error('[OPERATION_OWNER_INVALID] 业务回执缺少派发前记录')
    if (record.state === 'prepared' || record.state === 'not_executed') throw new Error('[OPERATION_RECEIPT_INVALID] 尚未派发的操作不能确认执行')
    if (record.output !== undefined && digestJson(record.output) !== digestJson(output)) {
      throw new Error('[OPERATION_RECEIPT_CONFLICT] 同一操作收到不同回执')
    }
    this.save(this.withVerificationTargets({ ...record, state: 'completed', output, effects: effects.length ? effects : record.effects }))
  }

  recoverableScript(runId: string): OperationRecovery | undefined {
    const records = this.execute({ action: 'list', runId }) as OperationRecord[]
    const latest = records.filter((record) => record.container).at(-1)
    const output = latest?.output && typeof latest.output === 'object' ? latest.output as Record<string, unknown> : null
    // 只续最后一段尚有剩余 IR 的脚本；外部等待继续由原等待记录核对，不能跳过等待。
    if (!latest?.checkpoint?.remainingInstructions.length || output?.status === 'waiting_external') return undefined
    return { sourceOperationId: latest.operationId, checkpoint: latest.checkpoint }
  }

  private withVerificationTargets(record: OperationRecord): OperationRecord {
    const observed = [...record.effects.filter(isMutatingEffect).flatMap((effect) => effect.targetRefs),
      ...record.persistenceReceipts.flatMap((receipt) => receipt.targets.map(({ kind, id }) => ({ kind, id })))]
    return { ...record, verifications: record.verifications.map((verification) => {
      if (verification.conditionId !== 'formal_result') return verification
      const targets = new Map([...verification.targets, ...observed].map((ref) => [`${ref.kind}\0${ref.id}`, ref]))
      return { ...verification, targets: [...targets.values()],
        status: targets.size > verification.targets.length ? 'pending' : verification.status }
    }) }
  }

  bindTransport(input: OperationTransportBinding): void {
    const binding = operationTransportBindingSchema.parse(input)
    const record = this.get(binding.operationId)
    if (!record || !this.owns(binding.runId, binding.operationId) || record.toolCallId !== binding.toolCallId) throw new Error('OPERATION_OWNER_INVALID')
    const existing = this.getTransport(binding.callId)
    if (existing && JSON.stringify(existing) !== JSON.stringify(binding)) throw new Error('OPERATION_TRANSPORT_CONFLICT')
    this.database.prepare('INSERT OR IGNORE INTO agent_operation_transports(call_id, operation_id, binding_json) VALUES (?, ?, ?)')
      .run(binding.callId, binding.operationId, JSON.stringify(binding))
  }

  getTransport(callId: string): OperationTransportBinding | null {
    const row = this.database.prepare('SELECT binding_json FROM agent_operation_transports WHERE call_id = ?').get(callId) as { binding_json: string } | undefined
    return row ? operationTransportBindingSchema.parse(JSON.parse(row.binding_json)) : null
  }

  assertPersistenceOwner(operationId: string, webContentsId: number): void {
    const record = this.get(operationId)
    const bindings = this.database.prepare('SELECT binding_json FROM agent_operation_transports WHERE operation_id = ?')
      .all(operationId) as Array<{ binding_json: string }>
    if (!record?.executionClaim || !bindings.some((row) =>
      operationTransportBindingSchema.parse(JSON.parse(row.binding_json)).webContentsId === webContentsId)) {
      throw new Error('[OPERATION_OWNER_INVALID] 保存关联不属于当前宿主已领取的操作')
    }
  }

  recordExecutionPreparation(operationId: string, raw: ApplicationExecutionPreparation, webContentsId: number): void {
    const preparation = applicationExecutionPreparationSchema.parse(raw)
    this.database.transaction(() => {
      this.assertPersistenceOwner(operationId, webContentsId)
      const record = this.get(operationId)!
      const existing = record.verificationPlans.find((item) => item.planRef === preparation.planRef)
      if (existing) {
        if (digestJson(existing) !== digestJson(preparation)) throw new Error('OPERATION_VERIFICATION_PLAN_CONFLICT:原计划的验证条件不能被覆盖')
        return
      }
      if (record.state !== 'dispatched') throw new Error('OPERATION_VERIFICATION_PLAN_CLOSED:原操作已结束或需要核对，不能追加执行计划')
      if (Date.parse(preparation.preparedAt) < Date.parse(record.attempts.at(-1)?.dispatchedAt ?? record.createdAt)) {
        throw new Error('OPERATION_VERIFICATION_STALE:验证计划早于本次派发')
      }
      this.save({ ...record, verificationPlans: [...record.verificationPlans, preparation] })
    }).immediate()
  }

  commitPersistence(correlation: ApplicationPersistenceCorrelation, storageTarget: { kind: string; id: string },
    webContentsId: number, digest: string, write: () => void): void {
    this.assertPersistenceOwner(correlation.operationId, webContentsId)
    this.database.transaction(() => {
      write()
      this.recordPersistence(correlation, storageTarget, digest)
    }).immediate()
  }

  /** 由正式领域存储在同一 SQLite 事务内调用；仅证明此保存边界，不冒充整项操作完成。 */
  recordPersistence(correlation: ApplicationPersistenceCorrelation, storageTarget: { kind: string; id: string }, digest: string): void {
    if (!this.database.inTransaction) throw new Error('[OPERATION_PERSISTENCE_NOT_ATOMIC] 保存关联必须与业务共用事务')
    const input = applicationPersistenceCorrelationSchema.parse(correlation)
    const record = this.get(input.operationId)
    if (!record || !record.executionClaim || ['prepared', 'not_executed'].includes(record.state)) {
      throw new Error('[OPERATION_OWNER_INVALID] 保存关联缺少原执行尝试')
    }
    const existing = record.persistenceReceipts.find((receipt) => receipt.boundaryId === input.boundaryId)
    if (existing) {
      if (existing.digest !== digest || existing.storageTarget.kind !== storageTarget.kind || existing.storageTarget.id !== storageTarget.id
        || digestJson(existing.targets) !== digestJson(input.targets)) throw new Error('[OPERATION_PERSISTENCE_CONFLICT] 原保存边界不能绑定另一次修改')
      return
    }
    this.save(this.withVerificationTargets({ ...record, persistenceReceipts: [...record.persistenceReceipts,
      { ...input, storageTarget, digest, persistedAt: new Date().toISOString() }] }))
  }

  /** 文件存储无法共用 SQLite 事务：先保存精确关联以便重启后定位原文件，尚不宣称已落盘。 */
  prepareFilePersistence(correlation: ApplicationPersistenceCorrelation, storageTarget: { kind: string; id: string }, digest: string, webContentsId: number): void {
    this.database.transaction(() => {
      this.assertPersistenceOwner(correlation.operationId, webContentsId)
      const input = applicationPersistenceCorrelationSchema.parse(correlation)
      const record = this.get(input.operationId)!
      const existing = record.persistenceIntents.find((intent) => intent.boundaryId === input.boundaryId)
      if (existing) {
        if (existing.digest !== digest || digestJson(existing.storageTarget) !== digestJson(storageTarget)
          || digestJson(existing.targets) !== digestJson(input.targets)) throw new Error('OPERATION_PERSISTENCE_CONFLICT')
        return
      }
      this.save({ ...record, persistenceIntents: [...record.persistenceIntents,
        { ...input, storageTarget, digest, preparedAt: new Date().toISOString() }] })
    }).immediate()
  }

  /** 只接收领域原子文件中的回执，必须与写入前记录完全一致。 */
  confirmFilePersistence(receipt: import('../../../../../src/core/application-control/persistenceCorrelation').ApplicationPersistenceReceiptRecord): void {
    this.database.transaction(() => {
      const record = this.get(receipt.operationId)
      const intent = record?.persistenceIntents.find((item) => item.boundaryId === receipt.boundaryId)
      if (!intent || intent.digest !== receipt.digest || digestJson(intent.storageTarget) !== digestJson(receipt.storageTarget)
        || digestJson(intent.targets) !== digestJson(receipt.targets)) throw new Error('OPERATION_PERSISTENCE_CONFLICT')
      this.recordPersistence({ operationId: receipt.operationId, boundaryId: receipt.boundaryId, targets: receipt.targets }, receipt.storageTarget, receipt.digest)
    }).immediate()
  }

  /** 主进程在业务调用前领取当前尝试；重传不能再次进入执行器。 */
  claimExecution(runId: string, operationId: string): void {
    this.database.transaction(() => {
      const record = this.get(operationId)
      if (!record || !this.owns(runId, operationId)) throw new Error('[OPERATION_OWNER_INVALID] 操作不属于当前任务')
      if (record.state !== 'dispatched' || record.executionClaim?.attempt === record.attempt) {
        throw new Error('[OPERATION_REPLAY_BLOCKED] 当前尝试已经进入业务执行，必须等待或核对原回执')
      }
      this.save({ ...record, executionClaim: { attempt: record.attempt, runId, claimedAt: new Date().toISOString() } })
    })()
  }

  markInterrupted(): void {
    this.database.transaction(() => {
      for (const row of this.database.prepare("SELECT record_json FROM agent_operations WHERE state = 'dispatched'").all()) {
        const record = this.parse(row)!
        const notExecuted = record.requiresMainClaim === true && !record.executionClaim
          && !record.persistenceReceipts.length && !record.persistenceIntents.length && !record.externalCalls.length
        this.save({ ...record, state: notExecuted ? 'not_executed' : 'unknown',
          error: notExecuted ? '应用中断前尚未进入主进程执行器；后续执行仍需重新校验授权。'
            : '应用中断，派发操作需要核对原回执；禁止自动重放。' })
      }
    })()
  }

  /** 外部提交先落盘再进入领域运行时；内存缓存或界面重传都不能再次发起同一提交。 */
  beginExternalCall(operationId: string, input: Pick<import('../../../../../src/core/assistant/operations').OperationExternalCall,
    'key' | 'source' | 'inputDigest' | 'target' | 'modelId'>, webContentsId: number): { existing: boolean; call: import('../../../../../src/core/assistant/operations').OperationExternalCall } {
    return this.database.transaction(() => {
      this.assertPersistenceOwner(operationId, webContentsId)
      const record = this.get(operationId)!
      const previous = record.externalCalls.find((call) => call.key === input.key)
      if (previous) {
        if (previous.source !== input.source || previous.modelId !== input.modelId || previous.inputDigest !== input.inputDigest || digestJson(previous.target) !== digestJson(input.target)) {
          throw new Error('OPERATION_EXTERNAL_CONFLICT')
        }
        return { existing: true, call: previous }
      }
      const now = new Date().toISOString()
      const call = { ...input, state: 'dispatched' as const, dispatchedAt: now, updatedAt: now }
      this.save({ ...record, externalCalls: [...record.externalCalls, call] })
      return { existing: false, call }
    }).immediate()
  }

  recordExternalCall(operationId: string, key: string, update: Pick<import('../../../../../src/core/assistant/operations').OperationExternalCall, 'state' | 'response' | 'error' | 'serverTaskId'>): void {
    this.database.transaction(() => {
      const record = this.get(operationId)
      const current = record?.externalCalls.find((call) => call.key === key)
      if (!record || !current) throw new Error('OPERATION_EXTERNAL_NOT_PREPARED')
      if (current.serverTaskId && update.serverTaskId && current.serverTaskId !== update.serverTaskId) throw new Error('OPERATION_EXTERNAL_CONFLICT')
      if (current.state === 'completed') {
        if (update.state === 'completed' && digestJson(current.response) !== digestJson(update.response)) throw new Error('OPERATION_EXTERNAL_CONFLICT')
        return
      }
      if (current.state === 'submitted' && update.state === 'unknown') return
      this.save({ ...record, externalCalls: record.externalCalls.map((call) => call.key === key
        ? { ...call, ...update, serverTaskId: update.serverTaskId ?? call.serverTaskId, updatedAt: new Date().toISOString() } : call) })
    }).immediate()
  }
}
