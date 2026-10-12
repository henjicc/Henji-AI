import { randomUUID } from 'node:crypto'
export { operationDigest } from '../application-control/operationDigest'
import type Database from 'better-sqlite3'

export type OperationState = import('../../../../src/core/application-control/userConfirmation').ApplicationOperationState
export interface OperationRecord {
  operationId: string
  callerId: string
  origin?: import('zod').infer<typeof import('../../../../src/core/application-control/operationReview').operationOriginSchema>
  inputDigest: string
  input: Record<string, unknown>
  expectedRevisions?: Record<string, number>
  paidGenerationEstimate?: number | null
  paidGenerationEstimateKind?: 'upper-bound' | 'estimate'
  paidReservations?: Array<import('zod').infer<typeof import('../../../../src/core/application-control/paidApproval').paidReservationSchema>>
  approval?: import('../../../../src/core/application-control/paidApproval').PaidApprovalReceipt
  state: OperationState
  verificationState?: 'verified' | 'unresolved'
  recoveryOf?: string
  capabilityId: import('../../../../src/core/application-control/localHostContracts').LocalHostRequest['capabilityId']
  targetRefs?: Array<{ kind: string; id: string }>
  recoveryVerification?: import('../../../../src/core/application-control/localHostContracts').LocalHostRequest['recoveryVerification']
  recoveryOperation?: import('../../../../src/core/application-control/localHostContracts').LocalHostRequest['recoveryOperation']
  recoveryResult?: Record<string, unknown>
  requestId?: string
  rendererEpoch?: string
  /** 执行器将身份与剪辑修改原子保存，可在新渲染会话证明是否保留落位。 */
  atomicPlacement?: boolean
  confirmation?: import('../../../../src/core/application-control/userConfirmation').ApplicationUserConfirmation
  result?: Record<string, unknown>
}
export interface ReadBaseline {
  id: string
  callerId: string
  refs: Array<{ kind: string; id: string }>
  revisions: Record<string, number>
  capturedAt: number
  rendererEpoch: string
}

/** 应用操作账本的表（迁移账本第 10 项），唯一读写入口是本文件的 ApplicationOperationStore。 */
export function createApplicationOperationTablesV1(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS application_invocations (
    operation_id TEXT NOT NULL, caller_id TEXT NOT NULL, state TEXT NOT NULL,
    request_id TEXT UNIQUE, renderer_epoch TEXT, record_json TEXT NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY(caller_id, operation_id));
    CREATE TABLE IF NOT EXISTS application_observations (
      baseline_id TEXT PRIMARY KEY, caller_id TEXT NOT NULL, record_json TEXT NOT NULL, created_at INTEGER NOT NULL);`)
}

/** v19 → v20：人工核对无截止期限，已有待确认记录原地保留，不删除业务事实。 */
export function migrateApplicationReviewsV20(db: Database.Database): void {
  const update = db.prepare('UPDATE application_invocations SET record_json = ? WHERE caller_id = ? AND operation_id = ?')
  const read = db.prepare('SELECT rowid, record_json FROM application_invocations WHERE rowid > ? ORDER BY rowid LIMIT 256')
  let cursor = 0
  for (;;) {
    // 分批释放 SELECT 游标后才能在同一 better-sqlite3 连接写入；256 只是批量大小。
    const rows = read.all(cursor) as Array<{ rowid: number; record_json: string }>
    if (!rows.length) break
    for (const row of rows) {
      const record = JSON.parse(row.record_json) as OperationRecord
      if (record.confirmation?.purpose !== 'review') continue
      const confirmation = { ...record.confirmation, expiresAt: null,
        continuation: '用户已收到提示，可在应用中处理。稍后处理不会解除保护；用原 operationId 查询 get_application_operation，不要重复提交。' }
      update.run(JSON.stringify({ ...record, confirmation }), record.callerId, record.operationId)
    }
    cursor = rows[rows.length - 1].rowid
  }
}

export class ApplicationOperationStore {
  /** 表由迁移账本第 10 项创建。 */
  constructor(private readonly db: Database.Database) {}
  recoverInterrupted(): void {
    const waiting = this.db.prepare("SELECT record_json FROM application_invocations WHERE state = 'awaiting_user_confirmation'").all() as Array<{ record_json: string }>
    for (const row of waiting) {
      const record = JSON.parse(row.record_json) as OperationRecord
      // Review concerns an earlier unknown mutation: abandoning review cannot prove it never ran.
      this.save(record.confirmation?.purpose === 'review' ? record
        : { ...record, state: 'not_executed', confirmation: undefined, verificationState: 'verified',
          result: { ok: false, error: { code: 'CONFIRMATION_INTERRUPTED', message: '应用在等待确认时退出；未继续执行或计费。', details: { execution: { notExecuted: true } } } } })
    }
    // 准备阶段尚未派发业务；进程退出后可明确终止，不能自动重新提交。
    const preparing = this.db.prepare("SELECT record_json FROM application_invocations WHERE state = 'preparing'").all() as Array<{ record_json: string }>
    for (const row of preparing) this.save({ ...JSON.parse(row.record_json) as OperationRecord, state: 'not_executed',
      result: { ok: false, error: { code: 'PREPARATION_INTERRUPTED', message: '应用在提交前退出；本操作没有派发。', details: { execution: { notExecuted: true } } } } })
    const rows = this.db.prepare("SELECT record_json FROM application_invocations WHERE state = 'executing'").all() as Array<{ record_json: string }>
    for (const row of rows) this.save({ ...JSON.parse(row.record_json) as OperationRecord, state: 'unknown' })
  }
  get(operationId: string, callerId: string): OperationRecord | undefined {
    const row = this.db.prepare('SELECT caller_id, record_json FROM application_invocations WHERE operation_id = ? AND caller_id = ?').get(operationId, callerId) as { caller_id: string; record_json: string } | undefined
    if (!row) return undefined
    return JSON.parse(row.record_json) as OperationRecord
  }
  byRequest(requestId: string, rendererEpoch: string): OperationRecord | undefined {
    const row = this.db.prepare('SELECT record_json FROM application_invocations WHERE request_id = ? AND renderer_epoch = ?').get(requestId, rendererEpoch) as { record_json: string } | undefined
    return row ? JSON.parse(row.record_json) as OperationRecord : undefined
  }
  unresolved(): OperationRecord[] {
    return (this.db.prepare("SELECT record_json FROM application_invocations WHERE state IN ('preparing','awaiting_user_confirmation','executing','unknown','partial')").all() as Array<{ record_json: string }>).map((row) => JSON.parse(row.record_json) as OperationRecord)
  }
  /** 持久预算按所有 Agent 共用的自然日范围统计，换会话或重启不会重置。 */
  generationSpendSince(since: number): number {
    const rows = this.db.prepare("SELECT record_json FROM application_invocations WHERE state != 'not_executed' AND updated_at >= ?").all(since) as Array<{ record_json: string }>
    return rows.reduce((sum, row) => {
      const record = JSON.parse(row.record_json) as OperationRecord
      return sum + (record.paidReservations ?? []).reduce((total, value) => total + (value.reservedAt >= since ? value.estimatedCny ?? 0 : 0), 0)
    }, 0)
  }
  prepare(record: OperationRecord): OperationRecord {
    record = { ...record, origin: record.origin ?? { at: Date.now(), actor: 'external' } }
    return this.db.transaction(() => {
      const existing = this.get(record.operationId, record.callerId)
      if (existing) {
        if (existing.inputDigest !== record.inputDigest) throw new Error('OPERATION_INPUT_CONFLICT:操作标识已绑定其他参数，请为新的业务请求使用新标识。')
        // 只有明确零执行可以用同一身份重新准备；未知/部分/回滚结果不自动重放。
        if (existing.state !== 'not_executed') return existing
      }
      this.save(record)
      return record
    })()
  }
  save(record: OperationRecord): void {
    this.db.prepare(`INSERT INTO application_invocations(operation_id,caller_id,state,request_id,renderer_epoch,record_json,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(caller_id,operation_id) DO UPDATE SET state=excluded.state,request_id=excluded.request_id,
      renderer_epoch=excluded.renderer_epoch,record_json=excluded.record_json,updated_at=excluded.updated_at`)
      .run(record.operationId, record.callerId, record.state, record.requestId ?? null, record.rendererEpoch ?? null, JSON.stringify(record), Date.now())
  }
  claim(record: OperationRecord, requestId: string, rendererEpoch: string): void {
    const next = { ...record, state: 'executing' as const, requestId, rendererEpoch }
    const result = this.db.prepare("UPDATE application_invocations SET state = 'executing',request_id = ?, renderer_epoch = ?,record_json = ?,updated_at = ? WHERE operation_id = ? AND caller_id = ? AND state IN ('prepared','preparing')")
      .run(requestId, rendererEpoch, JSON.stringify(next), Date.now(), record.operationId, record.callerId)
    if (result.changes !== 1) throw new Error('OPERATION_ALREADY_CLAIMED:操作已派发，请查询原记录。')
  }
  /** 同步持久认领生成准备；第二个请求只能查询，不能重复估价和预留。 */
  beginPreparation(record: OperationRecord): boolean {
    const next = { ...record, state: 'preparing' as const }
    const result = this.db.prepare("UPDATE application_invocations SET state='preparing', record_json=?, updated_at=? WHERE caller_id=? AND operation_id=? AND state='prepared'")
      .run(JSON.stringify(next), Date.now(), record.callerId, record.operationId)
    return result.changes === 1
  }
  baseline(callerId: string, refs: ReadBaseline['refs'], revisions: Record<string, number>, rendererEpoch: string): ReadBaseline {
    const baseline = { id: randomUUID(), callerId, refs, revisions, rendererEpoch, capturedAt: Date.now() }
    this.db.prepare('INSERT INTO application_observations(baseline_id,caller_id,record_json,created_at) VALUES(?,?,?,?)').run(baseline.id, callerId, JSON.stringify(baseline), baseline.capturedAt)
    return baseline
  }
  readBaseline(id: string, callerId: string): ReadBaseline {
    const row = this.db.prepare('SELECT record_json FROM application_observations WHERE baseline_id = ? AND caller_id = ?').get(id, callerId) as { record_json: string } | undefined
    if (!row) throw new Error('BASELINE_REQUIRED:请使用本连接读取原目标所得的基线。')
    return JSON.parse(row.record_json) as ReadBaseline
  }
}
