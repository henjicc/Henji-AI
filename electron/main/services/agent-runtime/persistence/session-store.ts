import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

import { createMainLogger } from '../../logging'
import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import {
  AGENT_SESSION_ENTRY_SCHEMA_VERSION,
  agentSessionEntrySchema,
  agentThreadSummarySchema,
  agentTranscriptPageSchema,
  getAgentSessionMessageContent,
  type AgentSessionEntry,
  type AgentThreadSummary,
  type AgentTranscriptPage,
} from '../../../../../src/core/assistant/session'

const logger = createMainLogger('main.agent_session')

interface SessionEntryRow {
  entry_id: string
  thread_id: string
  sequence: number
  run_id: string | null
  turn: number | null
  kind: AgentSessionEntry['kind']
  payload_json: string
  status: AgentSessionEntry['status']
  parent_entry_id: string | null
  created_at: number
}

interface ThreadRow {
  thread_id: string
  title: string
  created_at: number
  updated_at: number
  last_run_id: string | null
  last_run_goal: string | null
  head_sequence: number
  last_message_preview: string | null
}

export interface AppendSessionMessageInput {
  threadId: string
  runId: string
  role: 'user' | 'assistant'
  content: string
  idempotencyKey: string
  createdAt?: number
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString()
}

function rowToEntry(row: SessionEntryRow): AgentSessionEntry {
  return agentSessionEntrySchema.parse({
    schemaVersion: AGENT_SESSION_ENTRY_SCHEMA_VERSION,
    entryId: row.entry_id,
    threadId: row.thread_id,
    sequence: row.sequence,
    runId: row.run_id,
    turn: row.turn,
    kind: row.kind,
    payload: JSON.parse(row.payload_json) as unknown,
    status: row.status,
    parentEntryId: row.parent_entry_id,
    createdAt: toIso(row.created_at),
  })
}

export class AgentSessionStore {
  constructor(private readonly database: Database.Database) {}

  appendMessage(input: AppendSessionMessageInput): AgentSessionEntry {
    const existing = this.database.prepare(`
      SELECT * FROM agent_session_entries
      WHERE thread_id = ? AND idempotency_key = ?
    `).get(input.threadId, input.idempotencyKey) as SessionEntryRow | undefined
    if (existing) return rowToEntry(existing)

    const head = this.getHead(input.threadId)
    const createdAt = input.createdAt ?? Date.now()
    const entryId = randomUUID()
    const kind = input.role === 'user' ? 'user_message' : 'assistant_message'
    this.database.prepare(`
      INSERT INTO agent_session_entries(
        entry_id, thread_id, sequence, run_id, turn, kind, schema_version,
        payload_json, status, parent_entry_id, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'active', NULL, ?, ?)
    `).run(
      entryId,
      input.threadId,
      head + 1,
      input.runId,
      kind,
      AGENT_SESSION_ENTRY_SCHEMA_VERSION,
      JSON.stringify({ content: input.content, legacy: false }),
      input.idempotencyKey,
      createdAt
    )
    this.database.prepare(`
      UPDATE agent_threads SET updated_at = ? WHERE thread_id = ?
    `).run(createdAt, input.threadId)
    const inserted = this.database.prepare(`
      SELECT * FROM agent_session_entries WHERE entry_id = ?
    `).get(entryId) as SessionEntryRow
    logger.info('Agent 会话条目已追加', {
      event: 'agent_session.entry.appended',
      requestId: input.runId,
      context: { threadId: input.threadId, sequence: head + 1, kind },
    })
    return rowToEntry(inserted)
  }

  getHead(threadId: string): number {
    const row = this.database.prepare(`
      SELECT COALESCE(MAX(sequence), 0) AS head FROM agent_session_entries WHERE thread_id = ?
    `).get(threadId) as { head: number }
    return Number(row.head)
  }

  listThreads(limit = 30): AgentThreadSummary[] {
    const safeLimit = Math.max(1, Math.min(100, limit))
    const rows = this.database.prepare(`
      SELECT
        t.thread_id,
        t.title,
        t.created_at,
        t.updated_at,
        t.last_run_id,
        (SELECT goal FROM agent_runs r WHERE r.run_id = t.last_run_id) AS last_run_goal,
        COALESCE(MAX(e.sequence), 0) AS head_sequence,
        (
          SELECT json_extract(latest.payload_json, '$.content')
          FROM agent_session_entries latest
          WHERE latest.thread_id = t.thread_id
            AND latest.status = 'active'
            AND latest.kind IN ('user_message', 'assistant_message')
          ORDER BY latest.sequence DESC
          LIMIT 1
        ) AS last_message_preview
      FROM agent_threads t
      LEFT JOIN agent_session_entries e ON e.thread_id = t.thread_id
      GROUP BY t.thread_id
      ORDER BY t.updated_at DESC, t.thread_id ASC
      LIMIT ?
    `).all(safeLimit) as ThreadRow[]
    return rows.map((row) => agentThreadSummarySchema.parse({
      threadId: row.thread_id,
      title: row.title,
      headSequence: Number(row.head_sequence),
      lastRunId: row.last_run_id,
      lastRunGoal: row.last_run_goal ?? row.title,
      lastMessagePreview: row.last_message_preview ?? '',
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    }))
  }

  loadTranscript(threadId: string, afterSequence = 0, limit = 100): AgentTranscriptPage {
    const safeLimit = Math.max(1, Math.min(200, limit))
    const headSequence = this.getHead(threadId)
    const rows = this.database.prepare(`
      SELECT * FROM agent_session_entries
      WHERE thread_id = ? AND sequence > ? AND status = 'active'
      ORDER BY sequence ASC
      LIMIT ?
    `).all(threadId, afterSequence, safeLimit + 1) as SessionEntryRow[]
    const hasMore = rows.length > safeLimit
    const entries = rows.slice(0, safeLimit).map(rowToEntry)
    const page = agentTranscriptPageSchema.parse({
      threadId,
      afterSequence,
      entries,
      headSequence,
      coveredThroughSequence: entries.at(-1)?.sequence ?? afterSequence,
      hasMore,
    })
    logger.debug('Agent 会话分页读取完成', {
      event: 'agent_session.transcript.loaded',
      context: { threadId, afterSequence, entryCount: entries.length, hasMore },
    })
    return page
  }

  projectConversation(threadId: string, excludeRunId?: string): ModelStepMessage[] {
    const rows = this.database.prepare(`
      SELECT * FROM agent_session_entries
      WHERE thread_id = ?
        AND status = 'active'
        AND kind IN ('user_message', 'assistant_message')
        AND (? IS NULL OR run_id IS NULL OR run_id <> ?)
      ORDER BY sequence ASC
    `).all(threadId, excludeRunId ?? null, excludeRunId ?? null) as SessionEntryRow[]
    return rows.flatMap((row): ModelStepMessage[] => {
      const entry = rowToEntry(row)
      const content = getAgentSessionMessageContent(entry)
      if (!content) return []
      return [{
        role: entry.kind === 'user_message' ? 'user' : 'assistant',
        content,
      }]
    })
  }
}
