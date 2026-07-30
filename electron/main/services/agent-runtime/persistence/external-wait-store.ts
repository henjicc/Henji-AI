import type Database from 'better-sqlite3'

import {
  AGENT_EXTERNAL_WAIT_VERSION,
  agentExternalWaitRecordSchema,
  agentExternalWaitRegisterSchema,
  generationStatusEventSchema,
  generationTaskStatusSchema,
  type AgentExternalWaitRecord,
  type AgentExternalWaitRegister,
  type GenerationStatusEvent,
  type GenerationTaskStatus,
} from '../../../../../src/core/assistant/externalWait'
import { createMainLogger } from '../../logging'

const logger = createMainLogger('main.agent_external_wait')
interface WaitRow {
  wait_id: string
  thread_id: string
  source_run_id: string
  task_id: string
  target_statuses_json: string
  status: AgentExternalWaitRecord['status']
  resume_policy: 'linked_child_once'
  save_point_sequence: number
  created_at: number
  expires_at: number
  last_observed_status: GenerationTaskStatus | null
  last_event_id: string | null
  claimed_at: number | null
  consumed_at: number | null
  resumed_run_id: string | null
  error: string | null
}

function toIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString()
}

function rowToRecord(row: WaitRow): AgentExternalWaitRecord {
  return agentExternalWaitRecordSchema.parse({
    version: AGENT_EXTERNAL_WAIT_VERSION,
    waitId: row.wait_id,
    threadId: row.thread_id,
    sourceRunId: row.source_run_id,
    taskId: row.task_id,
    targetStatuses: JSON.parse(row.target_statuses_json) as unknown,
    status: row.status,
    resumePolicy: row.resume_policy,
    savePointSequence: row.save_point_sequence,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    lastObservedStatus: row.last_observed_status,
    lastEventId: row.last_event_id,
    claimedAt: toIso(row.claimed_at),
    consumedAt: toIso(row.consumed_at),
    resumedRunId: row.resumed_run_id,
    error: row.error,
  })
}

export class AgentExternalWaitStore {
  constructor(private readonly database: Database.Database) {}

  register(raw: AgentExternalWaitRegister): AgentExternalWaitRecord {
    const input = agentExternalWaitRegisterSchema.parse(raw)
    const now = Date.now()
    this.database.prepare(`
      INSERT INTO agent_external_waits(
        wait_id, thread_id, source_run_id, task_id, target_statuses_json,
        status, resume_policy, save_point_sequence, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      ON CONFLICT(source_run_id, task_id) DO NOTHING
    `).run(
      input.waitId, input.threadId, input.sourceRunId, input.taskId,
      JSON.stringify(input.targetStatuses), input.resumePolicy,
      input.savePointSequence, now, now + input.timeoutMs
    )
    this.refreshLastObserved(input.taskId)
    const record = this.getBySourceTask(input.sourceRunId, input.taskId)
    if (!record) throw new Error('[EXTERNAL_WAIT_PERSIST_FAILED] 外部等待记录未能保存')
    logger.info('Agent 外部等待已登记', {
      event: 'agent_external_wait.registered', requestId: input.sourceRunId,
      taskId: input.taskId, context: { waitId: record.waitId, expiresAt: record.expiresAt },
    })
    return record
  }

  recordStatus(raw: GenerationStatusEvent): boolean {
    const event = generationStatusEventSchema.parse(raw)
    const result = this.database.prepare(`
      INSERT OR IGNORE INTO agent_generation_status_events(
        event_id, task_id, status, revision, occurred_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      event.eventId, event.taskId, event.status, event.revision,
      Date.parse(event.occurredAt), JSON.stringify(event)
    )
    if (result.changes === 1) this.refreshLastObserved(event.taskId)
    return result.changes === 1
  }

  claimReady(taskId?: string): AgentExternalWaitRecord[] {
    const rows = (taskId
      ? this.database.prepare(`SELECT * FROM agent_external_waits WHERE status = 'active' AND task_id = ?`).all(taskId)
      : this.database.prepare(`SELECT * FROM agent_external_waits WHERE status = 'active'`).all()
    ) as WaitRow[]
    const claimed: AgentExternalWaitRecord[] = []
    const claim = this.database.prepare(`
      UPDATE agent_external_waits SET status = 'claimed', claimed_at = ?, error = NULL
      WHERE wait_id = ? AND status = 'active'
    `)
    for (const row of rows) {
      if (!row.last_observed_status) continue
      const targets = generationTaskStatusSchemaArray(row.target_statuses_json)
      if (!targets.includes(row.last_observed_status)) continue
      if (claim.run(Date.now(), row.wait_id).changes !== 1) continue
      const current = this.get(row.wait_id)
      if (current) claimed.push(current)
    }
    return claimed
  }

  claimExpired(now = Date.now()): AgentExternalWaitRecord[] {
    const rows = this.database.prepare(`
      SELECT * FROM agent_external_waits WHERE status = 'active' AND expires_at <= ?
    `).all(now) as WaitRow[]
    const claimed: AgentExternalWaitRecord[] = []
    const update = this.database.prepare(`
      UPDATE agent_external_waits
      SET status = 'claimed', claimed_at = ?, last_observed_status = 'timeout',
          last_event_id = ?, error = NULL
      WHERE wait_id = ? AND status = 'active'
    `)
    for (const row of rows) {
      if (update.run(now, `timeout:${row.wait_id}:${now}`, row.wait_id).changes !== 1) continue
      const record = this.get(row.wait_id)
      if (record) claimed.push(record)
    }
    return claimed
  }

  listClaimed(threadId?: string): AgentExternalWaitRecord[] {
    const rows = (threadId
      ? this.database.prepare(`SELECT * FROM agent_external_waits WHERE status = 'claimed' AND thread_id = ? ORDER BY created_at`).all(threadId)
      : this.database.prepare(`SELECT * FROM agent_external_waits WHERE status = 'claimed' ORDER BY created_at`).all()
    ) as WaitRow[]
    return rows.map(rowToRecord)
  }

  hasPendingThread(threadId: string): boolean {
    const row = this.database.prepare(`
      SELECT 1 FROM agent_external_waits
      WHERE thread_id = ? AND status IN ('active', 'claimed')
      LIMIT 1
    `).get(threadId)
    return Boolean(row)
  }

  consume(waitId: string, resumedRunId: string): AgentExternalWaitRecord | null {
    const result = this.database.prepare(`
      UPDATE agent_external_waits
      SET status = 'consumed', consumed_at = ?, resumed_run_id = ?, error = NULL
      WHERE wait_id = ? AND status = 'claimed'
    `).run(Date.now(), resumedRunId, waitId)
    return result.changes === 1 ? this.get(waitId) : null
  }

  release(waitId: string, error: string): void {
    this.database.prepare(`
      UPDATE agent_external_waits SET status = 'active', claimed_at = NULL, error = ?
      WHERE wait_id = ? AND status = 'claimed'
    `).run(error.slice(0, 1_000), waitId)
  }

  fail(waitId: string, error: string): AgentExternalWaitRecord {
    this.database.prepare(`
      UPDATE agent_external_waits SET status = 'failed', consumed_at = ?, error = ?
      WHERE wait_id = ? AND status = 'claimed'
    `).run(Date.now(), error.slice(0, 1_000), waitId)
    const record = this.get(waitId)
    if (!record) throw new Error('[EXTERNAL_WAIT_NOT_FOUND] 外部等待不存在')
    return record
  }

  cancel(waitId: string): AgentExternalWaitRecord {
    this.database.prepare(`
      UPDATE agent_external_waits SET status = 'cancelled', consumed_at = ?
      WHERE wait_id = ? AND status IN ('active', 'claimed')
    `).run(Date.now(), waitId)
    const record = this.get(waitId)
    if (!record) throw new Error('[EXTERNAL_WAIT_NOT_FOUND] 外部等待不存在')
    return record
  }

  get(waitId: string): AgentExternalWaitRecord | null {
    const row = this.database.prepare('SELECT * FROM agent_external_waits WHERE wait_id = ?')
      .get(waitId) as WaitRow | undefined
    return row ? rowToRecord(row) : null
  }

  getBySourceTask(sourceRunId: string, taskId: string): AgentExternalWaitRecord | null {
    const row = this.database.prepare(`
      SELECT * FROM agent_external_waits WHERE source_run_id = ? AND task_id = ?
    `).get(sourceRunId, taskId) as WaitRow | undefined
    return row ? rowToRecord(row) : null
  }

  private refreshLastObserved(taskId: string): void {
    const latest = this.database.prepare(`
      SELECT event_id, status FROM agent_generation_status_events
      WHERE task_id = ? ORDER BY occurred_at DESC, revision DESC, event_id DESC LIMIT 1
    `).get(taskId) as { event_id: string; status: GenerationTaskStatus } | undefined
    if (!latest) return
    this.database.prepare(`
      UPDATE agent_external_waits SET last_observed_status = ?, last_event_id = ?
      WHERE task_id = ? AND status IN ('active', 'claimed')
    `).run(latest.status, latest.event_id, taskId)
  }
}

function generationTaskStatusSchemaArray(value: string): GenerationTaskStatus[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((item) => {
    const status = generationTaskStatusSchema.safeParse(item)
    return status.success ? [status.data] : []
  })
}
