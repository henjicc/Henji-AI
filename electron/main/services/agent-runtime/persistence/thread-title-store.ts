import type Database from 'better-sqlite3'

import {
  agentThreadTitleContextRequestSchema,
  agentThreadTitleContextSchema,
  agentThreadTitleStageSchema,
  agentThreadTitleUpdateResultSchema,
  agentThreadTitleUpdateSchema,
  type AgentThreadTitleContext,
  type AgentThreadTitleContextRequest,
  type AgentThreadTitleUpdate,
  type AgentThreadTitleUpdateResult,
} from '../../../../../src/core/assistant/threadTitle'

interface ThreadTitleRow {
  title: string
  title_generation_stage: number
}

interface UserInstructionRow {
  content: string | null
}

function normalizeInstruction(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, ' ').trim().slice(0, 4_000) ?? ''
  return normalized || null
}

export class AgentThreadTitleStore {
  constructor(private readonly database: Database.Database) {}

  getContext(raw: AgentThreadTitleContextRequest): AgentThreadTitleContext {
    const input = agentThreadTitleContextRequestSchema.parse(raw)
    const thread = this.database.prepare(`
      SELECT title, title_generation_stage
      FROM agent_threads
      WHERE thread_id = ?
        AND EXISTS (
          SELECT 1 FROM agent_runs
          WHERE run_id = ? AND thread_id = agent_threads.thread_id
        )
    `).get(input.threadId, input.runId) as ThreadTitleRow | undefined
    if (!thread) throw new Error('[THREAD_TITLE_CONTEXT_DENIED] 标题上下文不属于当前运行')

    const countRow = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM agent_session_entries
      WHERE thread_id = ? AND status = 'active' AND kind = 'user_message'
    `).get(input.threadId) as { count: number }
    const rows = this.database.prepare(`
      SELECT json_extract(payload_json, '$.content') AS content
      FROM agent_session_entries
      WHERE thread_id = ? AND status = 'active' AND kind = 'user_message'
      ORDER BY sequence ASC
      LIMIT 6
    `).all(input.threadId) as UserInstructionRow[]

    return agentThreadTitleContextSchema.parse({
      threadId: input.threadId,
      currentTitle: thread.title,
      generationStage: agentThreadTitleStageSchema.parse(thread.title_generation_stage),
      userMessageCount: Number(countRow.count),
      userInstructions: rows
        .map((row) => normalizeInstruction(row.content))
        .filter((value): value is string => value !== null),
    })
  }

  update(raw: AgentThreadTitleUpdate): AgentThreadTitleUpdateResult {
    const input = agentThreadTitleUpdateSchema.parse(raw)
    const result = this.database.prepare(`
      UPDATE agent_threads
      SET title = ?, title_generation_stage = ?, title_generated_at = ?, updated_at = MAX(updated_at, ?)
      WHERE thread_id = ? AND title_generation_stage = ?
        AND EXISTS (
          SELECT 1 FROM agent_runs
          WHERE run_id = ? AND thread_id = agent_threads.thread_id
        )
    `).run(
      input.title,
      input.nextStage,
      Date.now(),
      Date.now(),
      input.threadId,
      input.expectedStage,
      input.runId
    )
    const row = this.database.prepare(`
      SELECT title, title_generation_stage
      FROM agent_threads
      WHERE thread_id = ?
    `).get(input.threadId) as ThreadTitleRow | undefined
    if (!row) throw new Error('[THREAD_NOT_FOUND] 会话不存在')
    return agentThreadTitleUpdateResultSchema.parse({
      updated: result.changes === 1,
      title: row.title,
      generationStage: row.title_generation_stage,
    })
  }
}
