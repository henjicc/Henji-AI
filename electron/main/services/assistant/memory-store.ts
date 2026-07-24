import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'

import {
  AGENT_MEMORY_SCHEMA_VERSION,
  agentMemoryCandidateSchema,
  agentMemoryContextEntrySchema,
  agentMemoryRecordSchema,
  agentMemorySettingsSchema,
  agentMemoryStateSchema,
  agentMemoryUpdateSchema,
  agentMemoryRetrievalQuerySchema,
  agentMemoryRetrievalResultSchema,
  type AgentMemoryCandidate,
  type AgentMemoryContextEntry,
  type AgentMemoryRecord,
  type AgentMemoryScope,
  type AgentMemorySettings,
  type AgentMemorySettingsUpdate,
  type AgentMemoryState,
  type AgentMemoryUpdate,
  type AgentMemoryRetrievalQuery,
  type AgentMemoryRetrievalResult,
} from '../../../../src/core/assistant/memory'
import { createMainLogger } from '../logging'
import { evaluateAgentMemoryProposal } from './memory-policy'
import { scoreAgentMemory } from './memory-relevance'

const logger = createMainLogger('main.agent_memory')
const CANDIDATE_TTL_MS = 24 * 60 * 60 * 1_000

interface MemoryRow {
  memory_id: string
  scope_type: AgentMemoryScope['type']
  scope_id: string | null
  kind: AgentMemoryRecord['kind']
  content: string
  source_run_id: string | null
  source_label: string
  sensitivity: AgentMemoryRecord['sensitivity']
  status: AgentMemoryRecord['status']
  conflict_key: string | null
  expires_at: number | null
  created_at: number
  updated_at: number
}

interface CandidateRow {
  candidate_id: string
  scope_type: AgentMemoryScope['type']
  scope_id: string | null
  kind: AgentMemoryCandidate['kind']
  content: string
  source_run_id: string
  source_label: string
  conflict_key: string | null
  status: AgentMemoryCandidate['status']
  ttl_days: number
  expires_at: number
  created_at: number
}

function toIso(value: number): string {
  return new Date(value).toISOString()
}

function memoryFromRow(row: MemoryRow): AgentMemoryRecord {
  return agentMemoryRecordSchema.parse({
    schemaVersion: AGENT_MEMORY_SCHEMA_VERSION,
    memoryId: row.memory_id,
    scope: { type: row.scope_type, id: row.scope_id },
    kind: row.kind,
    content: row.content,
    sourceRunId: row.source_run_id,
    sourceLabel: row.source_label,
    sensitivity: row.sensitivity,
    status: row.status,
    conflictKey: row.conflict_key,
    expiresAt: row.expires_at ? toIso(row.expires_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  })
}

function candidateFromRow(row: CandidateRow): AgentMemoryCandidate {
  return agentMemoryCandidateSchema.parse({
    schemaVersion: AGENT_MEMORY_SCHEMA_VERSION,
    candidateId: row.candidate_id,
    scope: { type: row.scope_type, id: row.scope_id },
    kind: row.kind,
    content: row.content,
    sourceRunId: row.source_run_id,
    sourceLabel: row.source_label,
    conflictKey: row.conflict_key,
    status: row.status,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
  })
}

export class AgentMemoryStore {
  constructor(private readonly database: Database.Database) {}

  getSettings(): AgentMemorySettings {
    const row = this.database.prepare(`
      SELECT enabled, default_ttl_days, updated_at FROM agent_memory_settings WHERE id = 1
    `).get() as { enabled: number; default_ttl_days: number; updated_at: number }
    return agentMemorySettingsSchema.parse({
      schemaVersion: AGENT_MEMORY_SCHEMA_VERSION,
      enabled: row.enabled === 1,
      defaultTtlDays: row.default_ttl_days,
      updatedAt: toIso(row.updated_at || Date.now()),
    })
  }

  updateSettings(update: AgentMemorySettingsUpdate): AgentMemorySettings {
    const current = this.getSettings()
    const enabled = update.enabled ?? current.enabled
    const defaultTtlDays = update.defaultTtlDays ?? current.defaultTtlDays
    this.database.prepare(`
      UPDATE agent_memory_settings
      SET enabled = ?, default_ttl_days = ?, updated_at = ?
      WHERE id = 1
    `).run(enabled ? 1 : 0, defaultTtlDays, Date.now())
    logger.info('Agent 记忆设置已更新', {
      event: 'agent_memory.settings.updated',
      context: { enabled, defaultTtlDays },
    })
    return this.getSettings()
  }

  getState(): AgentMemoryState {
    this.expireStaleEntries()
    const memories = (this.database.prepare(`
      SELECT * FROM agent_memories
      WHERE status = 'active'
      ORDER BY updated_at DESC LIMIT 200
    `).all() as MemoryRow[]).map(memoryFromRow)
    const candidates = (this.database.prepare(`
      SELECT * FROM agent_memory_candidates
      WHERE status = 'pending'
      ORDER BY created_at DESC LIMIT 100
    `).all() as CandidateRow[]).map(candidateFromRow)
    return agentMemoryStateSchema.parse({
      settings: this.getSettings(),
      memories,
      candidates,
    })
  }

  propose(
    runId: string,
    sourceLabel: string,
    input: unknown
  ): AgentMemoryCandidate {
    const settings = this.getSettings()
    if (!settings.enabled) throw new Error('[memory_disabled] 助手长期记忆尚未启用')
    const policy = evaluateAgentMemoryProposal(input)
    const candidateId = randomUUID()
    const now = Date.now()
    const ttlDays = policy.proposal.ttlDays ?? settings.defaultTtlDays
    this.database.prepare(`
      INSERT INTO agent_memory_candidates(
        candidate_id, scope_type, scope_id, kind, content, source_run_id,
        source_label, conflict_key, status, ttl_days, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      candidateId,
      policy.proposal.scope.type,
      policy.proposal.scope.id,
      policy.proposal.kind,
      policy.proposal.content,
      runId,
      sourceLabel,
      policy.conflictKey,
      ttlDays,
      now + CANDIDATE_TTL_MS,
      now
    )
    logger.info('Agent 记忆候选已创建', {
      event: 'agent_memory.candidate.created',
      requestId: runId,
      context: {
        candidateId,
        scopeType: policy.proposal.scope.type,
        kind: policy.proposal.kind,
      },
    })
    return candidateFromRow(this.requireCandidateRow(candidateId))
  }

  confirm(candidateId: string): AgentMemoryRecord {
    if (!this.getSettings().enabled) throw new Error('[memory_disabled] 助手长期记忆尚未启用')
    const candidate = this.requireCandidateRow(candidateId)
    if (candidate.status !== 'pending') throw new Error('[memory_candidate_closed] 记忆候选已处理')
    if (candidate.expires_at <= Date.now()) {
      this.rejectCandidate(candidateId, 'expired')
      throw new Error('[memory_candidate_expired] 记忆候选已过期')
    }
    const policy = evaluateAgentMemoryProposal({
      content: candidate.content,
      scope: { type: candidate.scope_type, id: candidate.scope_id },
      kind: candidate.kind,
      conflictKey: candidate.conflict_key ?? undefined,
      ttlDays: candidate.ttl_days,
    })
    const memoryId = randomUUID()
    const now = Date.now()
    const expiresAt = now + candidate.ttl_days * 24 * 60 * 60 * 1_000
    this.database.transaction(() => {
      const existing = this.database.prepare(`
        SELECT memory_id FROM agent_memories
        WHERE status = 'active'
          AND scope_type = ?
          AND COALESCE(scope_id, '') = COALESCE(?, '')
          AND conflict_key = ?
        LIMIT 1
      `).get(candidate.scope_type, candidate.scope_id, policy.conflictKey) as {
        memory_id: string
      } | undefined
      if (existing) {
        this.database.prepare(`
          UPDATE agent_memories SET status = 'superseded', updated_at = ? WHERE memory_id = ?
        `).run(now, existing.memory_id)
      }
      this.database.prepare(`
        INSERT INTO agent_memories(
          memory_id, scope_type, scope_id, kind, content, source_run_id,
          source_label, sensitivity, status, conflict_key,
          expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
      `).run(
        memoryId,
        candidate.scope_type,
        candidate.scope_id,
        candidate.kind,
        candidate.content,
        candidate.source_run_id,
        candidate.source_label,
        policy.sensitivity,
        policy.conflictKey,
        expiresAt,
        now,
        now
      )
      this.database.prepare(`
        UPDATE agent_memory_candidates SET status = 'confirmed' WHERE candidate_id = ?
      `).run(candidateId)
      if (existing) {
        this.database.prepare(`
          INSERT INTO agent_memory_conflicts(
            conflict_id, existing_memory_id, replacement_memory_id, resolution, created_at
          ) VALUES (?, ?, ?, 'replace', ?)
        `).run(randomUUID(), existing.memory_id, memoryId, now)
      }
    })()
    logger.info('Agent 记忆候选已确认', {
      event: 'agent_memory.candidate.approved',
      requestId: candidate.source_run_id,
      context: { candidateId, memoryId, scopeType: candidate.scope_type },
    })
    return this.requireMemory(memoryId)
  }

  reject(candidateId: string): void {
    const candidate = this.requireCandidateRow(candidateId)
    this.rejectCandidate(candidateId, 'rejected')
    logger.info('Agent 记忆候选已拒绝', {
      event: 'agent_memory.candidate.rejected',
      requestId: candidate.source_run_id,
      context: { candidateId },
    })
  }

  update(updateInput: AgentMemoryUpdate): AgentMemoryRecord {
    const update = agentMemoryUpdateSchema.parse(updateInput)
    const current = this.requireMemory(update.memoryId)
    const content = update.content ?? current.content
    const policy = evaluateAgentMemoryProposal({
      content,
      scope: current.scope,
      kind: current.kind,
      conflictKey: current.conflictKey ?? undefined,
      ttlDays: update.ttlDays ?? undefined,
    })
    const expiresAt = update.ttlDays === undefined
      ? current.expiresAt ? Date.parse(current.expiresAt) : null
      : update.ttlDays === null ? null : Date.now() + update.ttlDays * 24 * 60 * 60 * 1_000
    this.database.prepare(`
      UPDATE agent_memories
      SET content = ?, sensitivity = ?, expires_at = ?, updated_at = ?
      WHERE memory_id = ? AND status = 'active'
    `).run(policy.proposal.content, policy.sensitivity, expiresAt, Date.now(), update.memoryId)
    logger.info('Agent 记忆已编辑', {
      event: 'agent_memory.updated',
      context: { memoryId: update.memoryId },
    })
    return this.requireMemory(update.memoryId)
  }

  delete(memoryId: string): void {
    const result = this.database.prepare(`
      UPDATE agent_memories SET status = 'deleted', updated_at = ?
      WHERE memory_id = ? AND status = 'active'
    `).run(Date.now(), memoryId)
    if (result.changes === 0) throw new Error('[memory_not_found] 记忆不存在')
    logger.info('Agent 记忆已删除', {
      event: 'agent_memory.deleted',
      context: { memoryId },
    })
  }

  clear(scope?: AgentMemoryScope): number {
    const now = Date.now()
    const result = scope
      ? this.database.prepare(`
          UPDATE agent_memories SET status = 'deleted', updated_at = ?
          WHERE status = 'active' AND scope_type = ? AND COALESCE(scope_id, '') = COALESCE(?, '')
        `).run(now, scope.type, scope.id)
      : this.database.prepare(`
          UPDATE agent_memories SET status = 'deleted', updated_at = ? WHERE status = 'active'
        `).run(now)
    logger.info('Agent 记忆已清空', {
      event: 'agent_memory.cleared',
      context: { count: result.changes, scopeType: scope?.type ?? 'all' },
    })
    return result.changes
  }

  retrieve(
    goal: string,
    workspaceId: string,
    projectId: string | null,
    limit = 6
  ): AgentMemoryContextEntry[] {
    return this.retrieveDetailed({
      goal,
      workspaceId,
      projectId,
      toolDomains: [],
      stepSignals: [],
      limit,
    }).entries
  }

  retrieveDetailed(input: AgentMemoryRetrievalQuery): AgentMemoryRetrievalResult {
    const query = agentMemoryRetrievalQuerySchema.parse(input)
    if (!this.getSettings().enabled) {
      return agentMemoryRetrievalResultSchema.parse({
        entries: [],
        consideredCount: 0,
        excludedCount: 0,
        truncated: false,
        exclusionReasons: ['长期记忆未启用，使用空记忆上下文'],
        retrievedAt: new Date().toISOString(),
      })
    }
    this.expireStaleEntries()
    const records = (this.database.prepare(`
      SELECT * FROM agent_memories WHERE status = 'active' ORDER BY updated_at DESC LIMIT 200
    `).all() as MemoryRow[]).map(memoryFromRow)
    const scored = records.flatMap((memory) => {
      const relevance = scoreAgentMemory(memory, query)
      return relevance ? [{ memory, relevance }] : []
    }).sort((left, right) => (
      right.relevance.score - left.relevance.score
      || Date.parse(right.memory.updatedAt) - Date.parse(left.memory.updatedAt)
    ))
    const entries = scored.slice(0, query.limit).map(({ memory, relevance }) => (
      agentMemoryContextEntrySchema.parse({
        memoryId: memory.memoryId,
        scope: memory.scope,
        kind: memory.kind,
        content: memory.content,
        sourceLabel: memory.sourceLabel,
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
        expiresAt: memory.expiresAt,
        layer: relevance.layer,
        score: relevance.score,
        retrievalReasons: relevance.reasons,
      })
    ))
    const result = agentMemoryRetrievalResultSchema.parse({
      entries,
      consideredCount: records.length,
      excludedCount: records.length - scored.length,
      truncated: scored.length > entries.length,
      exclusionReasons: [
        ...(records.length > scored.length
          ? [`${records.length - scored.length} 条记忆因作用域或任务相关性不足被排除`]
          : []),
        ...(scored.length > entries.length
          ? [`${scored.length - entries.length} 条相关记忆因召回数量上限被截断`]
          : []),
      ],
      retrievedAt: new Date().toISOString(),
    })
    logger.debug('Agent 相关记忆检索完成', {
      event: 'agent_memory.retrieve.completed',
      context: {
        count: entries.length,
        consideredCount: records.length,
        excludedCount: result.excludedCount,
        truncated: result.truncated,
        exclusionReasons: result.exclusionReasons,
        workspaceId: query.workspaceId,
        hasProject: Boolean(query.projectId),
        intent: query.intent,
      },
    })
    return result
  }

  private expireStaleEntries(): void {
    const now = Date.now()
    const memories = this.database.prepare(`
      SELECT memory_id FROM agent_memories
      WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
    `).all(now) as Array<{ memory_id: string }>
    const candidates = this.database.prepare(`
      SELECT candidate_id FROM agent_memory_candidates
      WHERE status = 'pending' AND expires_at <= ?
    `).all(now) as Array<{ candidate_id: string }>
    this.database.transaction(() => {
      this.database.prepare(`
        UPDATE agent_memories SET status = 'deleted', updated_at = ?
        WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?
      `).run(now, now)
      this.database.prepare(`
        UPDATE agent_memory_candidates SET status = 'expired'
        WHERE status = 'pending' AND expires_at <= ?
      `).run(now)
    })()
    if (memories.length || candidates.length) {
      logger.info('Agent 记忆过期项已清理', {
        event: 'agent_memory.expired',
        context: {
          memoryIds: memories.map((item) => item.memory_id),
          candidateIds: candidates.map((item) => item.candidate_id),
        },
      })
    }
  }

  private rejectCandidate(candidateId: string, status: 'rejected' | 'expired'): void {
    this.database.prepare(`
      UPDATE agent_memory_candidates SET status = ? WHERE candidate_id = ? AND status = 'pending'
    `).run(status, candidateId)
  }

  private requireMemory(memoryId: string): AgentMemoryRecord {
    const row = this.database.prepare(`
      SELECT * FROM agent_memories WHERE memory_id = ?
    `).get(memoryId) as MemoryRow | undefined
    if (!row) throw new Error('[memory_not_found] 记忆不存在')
    return memoryFromRow(row)
  }

  private requireCandidateRow(candidateId: string): CandidateRow {
    const row = this.database.prepare(`
      SELECT * FROM agent_memory_candidates WHERE candidate_id = ?
    `).get(candidateId) as CandidateRow | undefined
    if (!row) throw new Error('[memory_candidate_not_found] 记忆候选不存在')
    return row
  }
}
