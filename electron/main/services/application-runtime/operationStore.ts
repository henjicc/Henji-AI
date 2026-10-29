import { randomUUID } from 'node:crypto'
export { operationDigest } from '../application-control/operationDigest'
import type Database from 'better-sqlite3'
import { UI_PAID_CAPABILITIES, generationReservationKey, type PaidReservation } from '../../../../src/core/application-control/paidApproval'

// UI 费用收据没有业务目标或派发身份；未知账单不能进入助手的修改核对流程。
const uiPaidCapabilities = Object.keys(UI_PAID_CAPABILITIES)
const uiPaidReceiptSql = `coalesce(json_extract(record_json, '$.origin.actor') = 'user'
  AND json_extract(record_json, '$.capabilityId') IN (${uiPaidCapabilities.map(() => '?').join(',')})
  AND json_type(record_json, '$.input.paid') = 'object'
  AND NOT EXISTS (SELECT 1 FROM json_each(record_json, '$.input') WHERE key != 'paid')
  AND request_id IS NULL AND renderer_epoch IS NULL
  AND coalesce(json_array_length(record_json, '$.targetRefs'), 0) = 0, 0)`

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
  capabilityId: import('../../../../src/core/application-control/localHostContracts').LocalHostRequest['capabilityId'] | 'load_assistant_skill'
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
  private prunedPaidDay: number | undefined
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
    this.pruneUiPaidReceipts()
    // 新宿主代次不会接受旧基线；分批删除以限制媒体回收触发器每批处理量。
    const prune = this.db.prepare('DELETE FROM application_observations WHERE rowid IN (SELECT rowid FROM application_observations LIMIT 256)')
    while (prune.run().changes > 0) { /* 只清理可重建的读取基线，不删除操作事实。 */ }
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
    return (this.db.prepare(`SELECT record_json FROM application_invocations WHERE state IN ('preparing','awaiting_user_confirmation','executing','unknown','partial') AND NOT (${uiPaidReceiptSql})`).all(...uiPaidCapabilities) as Array<{ record_json: string }>).map((row) => JSON.parse(row.record_json) as OperationRecord)
  }
  /** 自然日预算过后只清理无业务恢复用途的 UI 终态收据；助手事实与在途请求永久保留原语义。 */
  private pruneUiPaidReceipts(): void {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const since = today.getTime()
    if (this.prunedPaidDay === since) return
    this.db.prepare(`DELETE FROM application_invocations WHERE state IN ('completed','not_executed','unknown')
      AND updated_at < ? AND (${uiPaidReceiptSql})
      AND NOT EXISTS (SELECT 1 FROM json_each(record_json, '$.paidReservations') WHERE json_array_length(json_extract(value, '$.generationTaskIds')) > 0)
      AND NOT EXISTS (SELECT 1 FROM json_each(record_json, '$.paidReservations') WHERE json_extract(value, '$.reservedAt') >= ?)`)
      .run(since, ...uiPaidCapabilities, since)
    this.prunedPaidDay = since
  }
  /** 持久预算按所有 Agent 共用的自然日范围统计，换会话或重启不会重置。 */
  generationSpendSince(since: number): number {
    const rows = this.db.prepare("SELECT record_json FROM application_invocations WHERE state != 'not_executed' AND updated_at >= ?").all(since) as Array<{ record_json: string }>
    const seen = new Set<string>()
    return rows.reduce((sum, row) => {
      const record = JSON.parse(row.record_json) as OperationRecord
      return sum + (record.paidReservations ?? []).reduce((total, value) => {
        if (value.reservedAt < since) return total
        const key = generationReservationKey(value)
        if (key && seen.has(key)) return total
        if (key) seen.add(key)
        return total + (value.estimatedCny ?? 0)
      }, 0)
    }, 0)
  }
  /** 任务预留跨自然日保留；失败或断线不能让同一批生成再次占用额度。 */
  generationTaskReservations(): PaidReservation[] {
    const rows = this.db.prepare("SELECT record_json FROM application_invocations WHERE state != 'not_executed'").iterate() as Iterable<{ record_json: string }>
    const reservations: PaidReservation[] = []
    for (const row of rows) {
      const record = JSON.parse(row.record_json) as OperationRecord
      for (const reservation of record.paidReservations ?? []) {
        if (generationReservationKey(reservation)) reservations.push(reservation)
      }
    }
    return reservations
  }
  prepare(record: OperationRecord): OperationRecord {
    this.pruneUiPaidReceipts()
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
    this.db.prepare('DELETE FROM application_observations WHERE rowid IN (SELECT rowid FROM application_observations ORDER BY rowid DESC LIMIT -1 OFFSET 1024)').run()
    return baseline
  }
  readBaseline(id: string, callerId: string): ReadBaseline {
    const row = this.db.prepare('SELECT record_json FROM application_observations WHERE baseline_id = ? AND caller_id = ?').get(id, callerId) as { record_json: string } | undefined
    if (!row) throw new Error('BASELINE_REQUIRED:请使用本连接读取原目标所得的基线。')
    return JSON.parse(row.record_json) as ReadBaseline
  }
}
