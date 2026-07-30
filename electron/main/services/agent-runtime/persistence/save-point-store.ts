import type Database from 'better-sqlite3'

import {
  AGENT_SAVE_POINT_VERSION,
  agentSavePointSchema,
  type AgentSavePoint,
  type AgentSavePointAppend,
  type AgentSavePointStage,
  type AgentTurnSnapshotDraft,
} from '../../../../../src/core/assistant/turn'
import type { AgentRunState } from '../../../../../src/core/assistant/events'

interface SavePointRow {
  stage: AgentSavePoint['stage']
  snapshot_json: string
  state_sequence: number
  idempotency_key: string
  created_at: number
}

function toSavePoint(row: SavePointRow): AgentSavePoint {
  return agentSavePointSchema.parse({
    version: AGENT_SAVE_POINT_VERSION,
    stage: row.stage,
    snapshot: JSON.parse(row.snapshot_json) as unknown,
    stateSequence: row.state_sequence,
    idempotencyKey: row.idempotency_key,
    createdAt: new Date(row.created_at).toISOString(),
  })
}

export class AgentSavePointStore {
  constructor(private readonly database: Database.Database) {}

  append(input: AgentSavePointAppend, sessionHeadSequence: number): AgentSavePoint {
    return this.appendRecord(
      input.stage,
      input.snapshot,
      input.state,
      input.idempotencyKey,
      sessionHeadSequence
    )
  }

  appendSettled(state: AgentRunState, sessionHeadSequence: number): AgentSavePoint | null {
    const latest = this.latest(state.runId)
    if (!latest) return null
    const { sessionHeadSequence: _head, createdAt: _createdAt, ...draft } = latest.snapshot
    return this.appendRecord('settled', draft, state, `settled:${state.runId}`, sessionHeadSequence)
  }

  latest(runId: string): AgentSavePoint | null {
    const row = this.database.prepare(`
      SELECT stage, snapshot_json, state_sequence, idempotency_key, created_at
      FROM agent_save_points WHERE run_id = ? ORDER BY save_point_id DESC LIMIT 1
    `).get(runId) as SavePointRow | undefined
    return row ? toSavePoint(row) : null
  }

  count(runId: string): number {
    const row = this.database.prepare(`SELECT COUNT(*) AS count FROM agent_save_points WHERE run_id = ?`)
      .get(runId) as { count: number }
    return row.count
  }

  private appendRecord(
    stage: AgentSavePointStage,
    draft: AgentTurnSnapshotDraft,
    state: AgentRunState,
    idempotencyKey: string,
    sessionHeadSequence: number
  ): AgentSavePoint {
    const createdAt = Date.now()
    const snapshot = {
      ...draft,
      sessionHeadSequence,
      createdAt: new Date(createdAt).toISOString(),
    }
    this.database.prepare(`
      INSERT OR IGNORE INTO agent_save_points(
        run_id, thread_id, turn, stage, version, snapshot_json,
        state_sequence, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      draft.runId,
      draft.threadId,
      draft.turn,
      stage,
      AGENT_SAVE_POINT_VERSION,
      JSON.stringify(snapshot),
      state.sequence,
      idempotencyKey,
      createdAt
    )
    return this.requireByIdempotency(draft.runId, idempotencyKey)
  }

  private requireByIdempotency(runId: string, idempotencyKey: string): AgentSavePoint {
    const row = this.database.prepare(`
      SELECT stage, snapshot_json, state_sequence, idempotency_key, created_at
      FROM agent_save_points WHERE run_id = ? AND idempotency_key = ?
    `).get(runId, idempotencyKey) as SavePointRow | undefined
    if (!row) throw new Error('[SAVE_POINT_WRITE_FAILED] 保存点写入失败')
    return toSavePoint(row)
  }
}
