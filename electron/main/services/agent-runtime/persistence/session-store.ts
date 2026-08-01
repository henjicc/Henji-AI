import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

import { createMainLogger } from '../../logging'
import type { ModelStepMessage } from '../../../../../src/core/llm/modelStep'
import type { AgentAttachment } from '../../../../../src/core/assistant/attachments'
import {
  adaptAgentContextMessages,
  createDefaultSessionProjectorRegistry,
} from '../../../../../src/core/assistant/contextProjection'
import {
  AGENT_SESSION_ENTRY_SCHEMA_VERSION,
  agentSessionCompactionPayloadSchema,
  agentQueuedMessagePayloadSchema,
  agentSessionEntrySchema,
  agentSessionInternalMessagePayloadSchema,
  agentSessionMessagePayloadSchema,
  agentThreadSummarySchema,
  agentTranscriptPageSchema,
  type AgentSessionEntry,
  type AgentSessionCompactionPayload,
  type AgentSessionInternalMessagePayload,
  type AgentQueuedMessagePayload,
  type AgentThreadSummary,
  type AgentTranscriptPage,
} from '../../../../../src/core/assistant/session'

const logger = createMainLogger('main.agent_session')
const QUEUE_TTL_MS: Record<AgentQueuedMessagePayload['mode'], number> = {
  clarification: 24 * 60 * 60 * 1_000,
  current_task: 24 * 60 * 60 * 1_000,
  after_task: 7 * 24 * 60 * 60 * 1_000,
}

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
  message_count: number
}

export interface AppendSessionMessageInput {
  threadId: string
  runId: string
  role: 'user' | 'assistant'
  content: string
  idempotencyKey: string
  createdAt?: number
  contextVisible?: boolean
  attachments?: AgentAttachment[]
}

export interface AppendSessionInternalMessageInput {
  threadId: string
  runId: string
  turn: number
  kind: 'model_message' | 'tool_result'
  payload: AgentSessionInternalMessagePayload
  idempotencyKey: string
  createdAt?: number
}

export interface AppendSessionCompactionInput {
  threadId: string
  runId: string
  turn: number
  payload: AgentSessionCompactionPayload
  idempotencyKey: string
  createdAt?: number
}

export interface AgentConversationProjection {
  messages: ModelStepMessage[]
  sourceSequences: number[]
}

export interface EnqueueSessionMessageInput {
  threadId: string
  runId: string
  clientMessageId: string
  content: string
  mode: AgentQueuedMessagePayload['mode']
  waitId?: string
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
  private readonly projector = createDefaultSessionProjectorRegistry()

  constructor(private readonly database: Database.Database) {}

  appendMessage(input: AppendSessionMessageInput): AgentSessionEntry {
    const existing = this.database.prepare(`
      SELECT * FROM agent_session_entries
      WHERE thread_id = ? AND idempotency_key = ?
    `).get(input.threadId, input.idempotencyKey) as SessionEntryRow | undefined
    if (existing) return rowToEntry(existing)

    const head = this.getHeadEntry(input.threadId)
    const createdAt = input.createdAt ?? Date.now()
    const entryId = randomUUID()
    const kind = input.role === 'user' ? 'user_message' : 'assistant_message'
    this.database.prepare(`
      INSERT INTO agent_session_entries(
        entry_id, thread_id, sequence, run_id, turn, kind, schema_version,
        payload_json, status, parent_entry_id, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      entryId,
      input.threadId,
      head.sequence + 1,
      input.runId,
      kind,
      AGENT_SESSION_ENTRY_SCHEMA_VERSION,
      JSON.stringify(agentSessionMessagePayloadSchema.parse({
        content: input.content,
        legacy: false,
        contextVisible: input.contextVisible ?? true,
        attachments: input.attachments,
      })),
      head.entryId,
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
      context: { threadId: input.threadId, sequence: head.sequence + 1, kind },
    })
    return rowToEntry(inserted)
  }

  appendInternalMessage(input: AppendSessionInternalMessageInput): AgentSessionEntry {
    const existing = this.database.prepare(`
      SELECT * FROM agent_session_entries
      WHERE thread_id = ? AND idempotency_key = ?
    `).get(input.threadId, input.idempotencyKey) as SessionEntryRow | undefined
    if (existing) return rowToEntry(existing)
    const head = this.getHeadEntry(input.threadId)
    const createdAt = input.createdAt ?? Date.now()
    const entryId = randomUUID()
    const payload = agentSessionInternalMessagePayloadSchema.parse(input.payload)
    this.database.prepare(`
      INSERT INTO agent_session_entries(
        entry_id, thread_id, sequence, run_id, turn, kind, schema_version,
        payload_json, status, parent_entry_id, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      entryId,
      input.threadId,
      head.sequence + 1,
      input.runId,
      input.turn,
      input.kind,
      AGENT_SESSION_ENTRY_SCHEMA_VERSION,
      JSON.stringify(payload),
      head.entryId,
      input.idempotencyKey,
      createdAt
    )
    this.database.prepare('UPDATE agent_threads SET updated_at = ? WHERE thread_id = ?')
      .run(createdAt, input.threadId)
    const inserted = this.database.prepare(
      'SELECT * FROM agent_session_entries WHERE entry_id = ?'
    ).get(entryId) as SessionEntryRow
    logger.debug('Agent 内部会话条目已追加', {
      event: 'agent_session.internal.appended',
      requestId: input.runId,
      context: {
        threadId: input.threadId,
        sequence: head.sequence + 1,
        kind: input.kind,
      },
    })
    return rowToEntry(inserted)
  }

  appendCompaction(input: AppendSessionCompactionInput): AgentSessionEntry {
    const existing = this.database.prepare(`
      SELECT * FROM agent_session_entries
      WHERE thread_id = ? AND idempotency_key = ?
    `).get(input.threadId, input.idempotencyKey) as SessionEntryRow | undefined
    if (existing) return rowToEntry(existing)
    const head = this.getHeadEntry(input.threadId)
    const createdAt = input.createdAt ?? Date.now()
    const entryId = randomUUID()
    this.database.prepare(`
      INSERT INTO agent_session_entries(
        entry_id, thread_id, sequence, run_id, turn, kind, schema_version,
        payload_json, status, parent_entry_id, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, ?, 'compaction', ?, ?, 'active', ?, ?, ?)
    `).run(
      entryId,
      input.threadId,
      head.sequence + 1,
      input.runId,
      input.turn,
      AGENT_SESSION_ENTRY_SCHEMA_VERSION,
      JSON.stringify(input.payload),
      head.entryId,
      input.idempotencyKey,
      createdAt
    )
    this.database.prepare(`
      UPDATE agent_threads SET updated_at = ? WHERE thread_id = ?
    `).run(createdAt, input.threadId)
    const inserted = this.database.prepare(`
      SELECT * FROM agent_session_entries WHERE entry_id = ?
    `).get(entryId) as SessionEntryRow
    logger.info('Agent 会话语义压缩条目已追加', {
      event: 'agent_session.compaction.appended',
      requestId: input.runId,
      context: {
        threadId: input.threadId,
        sequence: head.sequence + 1,
        coveredThroughSequence: input.payload.coveredThroughSequence,
      },
    })
    return rowToEntry(inserted)
  }

  enqueueMessage(input: EnqueueSessionMessageInput): { entry: AgentSessionEntry; deduplicated: boolean } {
    const key = `queued:${input.clientMessageId}`
    const existing = this.database.prepare(`
      SELECT * FROM agent_session_entries WHERE thread_id = ? AND idempotency_key = ?
    `).get(input.threadId, key) as SessionEntryRow | undefined
    if (existing) return { entry: rowToEntry(existing), deduplicated: true }
    const pending = this.database.prepare(`
      SELECT COUNT(*) AS count FROM agent_session_entries
      WHERE run_id = ? AND kind = 'queued_message'
        AND json_extract(payload_json, '$.status') = 'accepted'
    `).get(input.runId) as { count: number }
    if (Number(pending.count) >= 50) {
      throw new Error('[QUEUE_LIMIT_REACHED] 当前任务的待处理消息已达 50 条上限')
    }
    const createdAt = input.createdAt ?? Date.now()
    const payload = agentQueuedMessagePayloadSchema.parse({
      clientMessageId: input.clientMessageId,
      content: input.content,
      mode: input.mode,
      status: 'accepted',
      targetRunId: input.runId,
      waitId: input.waitId,
      expiresAt: new Date(createdAt + QUEUE_TTL_MS[input.mode]).toISOString(),
    })
    const entryId = randomUUID()
    const head = this.getHeadEntry(input.threadId)
    this.database.prepare(`
      INSERT INTO agent_session_entries(
        entry_id, thread_id, sequence, run_id, turn, kind, schema_version,
        payload_json, status, parent_entry_id, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, NULL, 'queued_message', ?, ?, 'active', ?, ?, ?)
    `).run(
      entryId, input.threadId, head.sequence + 1, input.runId,
      AGENT_SESSION_ENTRY_SCHEMA_VERSION, JSON.stringify(payload), head.entryId, key, createdAt
    )
    this.database.prepare('UPDATE agent_threads SET updated_at = ? WHERE thread_id = ?')
      .run(createdAt, input.threadId)
    const row = this.database.prepare('SELECT * FROM agent_session_entries WHERE entry_id = ?')
      .get(entryId) as SessionEntryRow
    logger.info('Agent 忙碌消息已入队', {
      event: 'agent_session.queue.accepted', requestId: input.runId,
      context: { entryId, threadId: input.threadId, mode: input.mode },
    })
    return { entry: rowToEntry(row), deduplicated: false }
  }

  consumeQueuedMessages(runId: string, mode: AgentQueuedMessagePayload['mode']): AgentSessionEntry[] {
    this.expireQueuedMessages(runId)
    const rows = this.database.prepare(`
      SELECT * FROM agent_session_entries
      WHERE run_id = ? AND kind = 'queued_message' AND status = 'active'
        AND json_extract(payload_json, '$.mode') = ?
        AND json_extract(payload_json, '$.status') = 'accepted'
      ORDER BY sequence ASC LIMIT 50
    `).all(runId, mode) as SessionEntryRow[]
    const update = this.database.prepare(`
      UPDATE agent_session_entries
      SET payload_json = json_set(payload_json, '$.status', 'consumed', '$.consumedByRunId', ?)
      WHERE entry_id = ? AND json_extract(payload_json, '$.status') = 'accepted'
    `)
    const consumed: AgentSessionEntry[] = []
    for (const row of rows) {
      if (update.run(runId, row.entry_id).changes !== 1) continue
      const updated = this.database.prepare('SELECT * FROM agent_session_entries WHERE entry_id = ?')
        .get(row.entry_id) as SessionEntryRow
      consumed.push(rowToEntry(updated))
    }
    if (consumed.length > 0) logger.info('Agent 队列消息已消费', {
      event: 'agent_session.queue.consumed', requestId: runId,
      context: { mode, entryIds: consumed.map((entry) => entry.entryId) },
    })
    return consumed
  }

  listQueuedMessages(
    runId: string,
    mode: AgentQueuedMessagePayload['mode'],
    status: AgentQueuedMessagePayload['status'] = 'accepted'
  ): AgentSessionEntry[] {
    this.expireQueuedMessages(runId)
    const rows = this.database.prepare(`
      SELECT * FROM agent_session_entries
      WHERE run_id = ? AND kind = 'queued_message' AND status = 'active'
        AND json_extract(payload_json, '$.mode') = ?
        AND json_extract(payload_json, '$.status') = ?
      ORDER BY sequence ASC LIMIT 50
    `).all(runId, mode, status) as SessionEntryRow[]
    return rows.map(rowToEntry)
  }

  findAcceptedAfterTaskRun(threadId: string): string | null {
    const row = this.database.prepare(`
      SELECT e.run_id AS run_id
      FROM agent_session_entries e
      JOIN agent_runs r ON r.run_id = e.run_id
      WHERE e.thread_id = ? AND e.kind = 'queued_message'
        AND json_extract(e.payload_json, '$.mode') = 'after_task'
        AND json_extract(e.payload_json, '$.status') = 'accepted'
        AND r.status IN ('completed', 'failed', 'cancelled')
      ORDER BY e.sequence ASC LIMIT 1
    `).get(threadId) as { run_id: string | null } | undefined
    return row?.run_id ?? null
  }

  retargetAfterTaskMessages(sourceRunId: string, targetRunId: string): number {
    return this.database.prepare(`
      UPDATE agent_session_entries
      SET run_id = ?, payload_json = json_set(payload_json, '$.targetRunId', ?)
      WHERE run_id = ? AND kind = 'queued_message'
        AND json_extract(payload_json, '$.mode') = 'after_task'
        AND json_extract(payload_json, '$.status') = 'accepted'
    `).run(targetRunId, targetRunId, sourceRunId).changes
  }

  cancelQueuedMessages(runId: string, reason: string): number {
    const count = this.database.prepare(`
      UPDATE agent_session_entries
      SET payload_json = json_set(payload_json, '$.status', 'cancelled', '$.statusReason', ?)
      WHERE run_id = ? AND kind = 'queued_message'
        AND json_extract(payload_json, '$.mode') IN ('current_task', 'clarification')
        AND json_extract(payload_json, '$.status') = 'accepted'
    `).run(reason, runId).changes
    if (count > 0) logger.info('Agent 未消费消息已批量取消', {
      event: 'agent_session.queue.cancelled', requestId: runId,
      context: { count, reason },
    })
    return count
  }

  updateQueuedMessageStatus(
    entryId: string,
    expected: AgentQueuedMessagePayload['status'],
    status: AgentQueuedMessagePayload['status'],
    reason?: string,
    consumedByRunId?: string
  ): AgentSessionEntry | null {
    const result = this.database.prepare(`
      UPDATE agent_session_entries
      SET payload_json = json_set(
        payload_json,
        '$.status', ?,
        '$.statusReason', ?,
        '$.consumedByRunId', ?
      )
      WHERE entry_id = ? AND kind = 'queued_message'
        AND json_extract(payload_json, '$.status') = ?
    `).run(status, reason ?? null, consumedByRunId ?? null, entryId, expected)
    if (result.changes !== 1) return null
    const row = this.database.prepare('SELECT * FROM agent_session_entries WHERE entry_id = ?')
      .get(entryId) as SessionEntryRow
    const entry = rowToEntry(row)
    logger.info('Agent 队列消息状态已更新', {
      event: `agent_session.queue.${status}`,
      requestId: entry.runId ?? undefined,
      context: { entryId, status, reason },
    })
    return entry
  }

  cancelQueuedMessage(threadId: string, entryId: string): AgentSessionEntry {
    const row = this.database.prepare(`
      SELECT * FROM agent_session_entries
      WHERE entry_id = ? AND thread_id = ? AND kind = 'queued_message'
    `).get(entryId, threadId) as SessionEntryRow | undefined
    if (!row) throw new Error('[QUEUE_ENTRY_NOT_FOUND] 排队消息不存在')
    const payload = agentQueuedMessagePayloadSchema.parse(JSON.parse(row.payload_json) as unknown)
    if (payload.status !== 'accepted') return rowToEntry(row)
    const cancelled = this.updateQueuedMessageStatus(entryId, 'accepted', 'cancelled', '用户取消')
    if (!cancelled) throw new Error('[QUEUE_STATUS_CONFLICT] 排队消息状态已变化')
    return cancelled
  }

  private expireQueuedMessages(runId: string): void {
    const now = new Date().toISOString()
    const result = this.database.prepare(`
      UPDATE agent_session_entries
      SET payload_json = json_set(
        payload_json,
        '$.status', 'failed',
        '$.statusReason', '排队消息已过期'
      )
      WHERE run_id = ? AND kind = 'queued_message'
        AND json_extract(payload_json, '$.status') = 'accepted'
        AND json_extract(payload_json, '$.expiresAt') IS NOT NULL
        AND json_extract(payload_json, '$.expiresAt') <= ?
    `).run(runId, now)
    if (result.changes > 0) logger.warn('Agent 排队消息已过期', {
      event: 'agent_session.queue.expired', requestId: runId,
      context: { count: result.changes },
    })
  }

  getHead(threadId: string): number {
    return this.getHeadEntry(threadId).sequence
  }

  private getHeadEntry(threadId: string): { sequence: number; entryId: string | null } {
    const row = this.database.prepare(`
      SELECT sequence, entry_id
      FROM agent_session_entries
      WHERE thread_id = ?
      ORDER BY sequence DESC
      LIMIT 1
    `).get(threadId) as { sequence: number; entry_id: string } | undefined
    return { sequence: Number(row?.sequence ?? 0), entryId: row?.entry_id ?? null }
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
        (
          SELECT COUNT(*)
          FROM agent_session_entries visible
          WHERE visible.thread_id = t.thread_id
            AND visible.status = 'active'
            AND visible.kind IN ('user_message', 'assistant_message')
        ) AS message_count
      FROM agent_threads t
      ORDER BY t.updated_at DESC, t.thread_id ASC
      LIMIT ?
    `).all(safeLimit) as ThreadRow[]
    return rows.map((row) => agentThreadSummarySchema.parse({
      threadId: row.thread_id,
      title: row.title,
      messageCount: Number(row.message_count),
      lastRunId: row.last_run_id,
      lastRunGoal: row.last_run_goal ?? row.title,
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
        AND kind IN ('user_message', 'assistant_message', 'queued_message')
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

  projectConversation(threadId: string, excludeRunId?: string): AgentConversationProjection {
    const rows = this.database.prepare(`
      SELECT * FROM agent_session_entries
      WHERE thread_id = ?
        AND status = 'active'
        AND kind IN (
          'user_message', 'assistant_message', 'model_message',
          'tool_result', 'compaction'
        )
        AND (? IS NULL OR run_id IS NULL OR run_id <> ?)
      ORDER BY sequence ASC
    `).all(threadId, excludeRunId ?? null, excludeRunId ?? null) as SessionEntryRow[]
    const entries = rows.map(rowToEntry)
    const latestCompaction = [...entries].reverse().find((entry) => (
      entry.kind === 'compaction'
      && agentSessionCompactionPayloadSchema.safeParse(entry.payload).success
    ))
    const coveredThroughSequence = latestCompaction
      ? agentSessionCompactionPayloadSchema.parse(latestCompaction.payload).coveredThroughSequence
      : 0
    const projectable = [
      ...(latestCompaction ? [latestCompaction] : []),
      ...entries.filter((entry) => (
        entry.kind !== 'compaction' && entry.sequence > coveredThroughSequence
      )),
    ]
    const contextMessages = this.projector.project(projectable)
    return {
      messages: adaptAgentContextMessages(contextMessages),
      sourceSequences: contextMessages.map((message) => message.sourceSequence),
    }
  }
}
