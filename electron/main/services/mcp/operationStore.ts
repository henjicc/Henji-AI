import { randomUUID } from 'node:crypto'
export { operationDigest } from '../application-control/operationDigest'
import type Database from 'better-sqlite3'

export type OperationState = 'prepared' | 'executing' | 'completed' | 'not_executed' | 'partial' | 'unknown'
export interface OperationRecord {
  operationId: string
  callerId: string
  inputDigest: string
  input: Record<string, unknown>
  expectedRevisions: Record<string, number>
  state: OperationState
  verificationState?: 'verified' | 'unresolved'
  recoveryOf?: string
  capabilityId?: import('../../../../src/core/application-control/localHostContracts').LocalHostRequest['capabilityId']
  targetRefs?: Array<{ kind: string; id: string }>
  recoveryVerification?: import('../../../../src/core/application-control/localHostContracts').LocalHostRequest['recoveryVerification']
  recoveryResult?: Record<string, unknown>
  requestId?: string
  sessionId?: string
  result?: Record<string, unknown>
}
export interface ReadBaseline {
  id: string
  callerId: string
  refs: Array<{ kind: string; id: string }>
  revisions: Record<string, number>
  capturedAt: number
  sessionId: string
}

/** 不占用助手迁移版本，也没有会话删除外键；旧业务表原样保留。 */
export function migrateMcpOperations(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS application_operation_migrations (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS application_operations (
        operation_id TEXT PRIMARY KEY, caller_id TEXT NOT NULL, state TEXT NOT NULL,
        request_id TEXT UNIQUE, session_id TEXT, record_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS application_read_baselines (
        baseline_id TEXT PRIMARY KEY, caller_id TEXT NOT NULL, record_json TEXT NOT NULL, created_at INTEGER NOT NULL);
      INSERT OR IGNORE INTO application_operation_migrations(version) VALUES(1);`)
  })()
}


export class McpOperationStore {
  constructor(private readonly db: Database.Database) { migrateMcpOperations(db) }
  recoverInterrupted(): void {
    const rows = this.db.prepare("SELECT record_json FROM application_operations WHERE state = 'executing'").all() as Array<{ record_json: string }>
    for (const row of rows) this.save({ ...JSON.parse(row.record_json) as OperationRecord, state: 'unknown' })
  }
  get(operationId: string, callerId: string): OperationRecord | undefined {
    const row = this.db.prepare('SELECT caller_id, record_json FROM application_operations WHERE operation_id = ?').get(operationId) as { caller_id: string; record_json: string } | undefined
    if (!row) return undefined
    if (row.caller_id !== callerId) throw new Error('PERMISSION_DENIED:操作属于其他连接。')
    return JSON.parse(row.record_json) as OperationRecord
  }
  byRequest(requestId: string, sessionId: string): OperationRecord | undefined {
    const row = this.db.prepare('SELECT record_json FROM application_operations WHERE request_id = ? AND session_id = ?').get(requestId, sessionId) as { record_json: string } | undefined
    return row ? JSON.parse(row.record_json) as OperationRecord : undefined
  }
  unresolved(): OperationRecord[] {
    return (this.db.prepare("SELECT record_json FROM application_operations WHERE state IN ('executing','unknown','partial')").all() as Array<{ record_json: string }>).map((row) => JSON.parse(row.record_json) as OperationRecord)
  }
  prepare(record: OperationRecord): OperationRecord {
    return this.db.transaction(() => {
      const existing = this.get(record.operationId, record.callerId)
      if (existing) {
        if (existing.inputDigest !== record.inputDigest) throw new Error('OPERATION_INPUT_CONFLICT:操作标识已绑定其他参数，请为新的业务请求使用新标识。')
        return existing
      }
      this.save(record)
      return record
    })()
  }
  save(record: OperationRecord): void {
    this.db.prepare(`INSERT INTO application_operations(operation_id,caller_id,state,request_id,session_id,record_json,updated_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(operation_id) DO UPDATE SET state=excluded.state,request_id=excluded.request_id,
      session_id=excluded.session_id,record_json=excluded.record_json,updated_at=excluded.updated_at`)
      .run(record.operationId, record.callerId, record.state, record.requestId ?? null, record.sessionId ?? null, JSON.stringify(record), Date.now())
  }
  claim(record: OperationRecord, requestId: string, sessionId: string): void {
    const next = { ...record, state: 'executing' as const, requestId, sessionId }
    const result = this.db.prepare("UPDATE application_operations SET state = 'executing',request_id = ?, session_id = ?,record_json = ?,updated_at = ? WHERE operation_id = ? AND caller_id = ? AND state = 'prepared'")
      .run(requestId, sessionId, JSON.stringify(next), Date.now(), record.operationId, record.callerId)
    if (result.changes !== 1) throw new Error('OPERATION_ALREADY_CLAIMED:操作已派发，请查询原记录。')
  }
  baseline(callerId: string, refs: ReadBaseline['refs'], revisions: Record<string, number>, sessionId: string): ReadBaseline {
    const baseline = { id: randomUUID(), callerId, refs, revisions, sessionId, capturedAt: Date.now() }
    this.db.prepare('INSERT INTO application_read_baselines(baseline_id,caller_id,record_json,created_at) VALUES(?,?,?,?)').run(baseline.id, callerId, JSON.stringify(baseline), baseline.capturedAt)
    return baseline
  }
  readBaseline(id: string, callerId: string): ReadBaseline {
    const row = this.db.prepare('SELECT record_json FROM application_read_baselines WHERE baseline_id = ? AND caller_id = ?').get(id, callerId) as { record_json: string } | undefined
    if (!row) throw new Error('BASELINE_REQUIRED:请使用本连接读取原目标所得的基线。')
    return JSON.parse(row.record_json) as ReadBaseline
  }
}
