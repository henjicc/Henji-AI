import type Database from 'better-sqlite3'

import {
  agentTraceCompleteInputSchema,
  agentTraceDetailResultSchema,
  agentTraceFailInputSchema,
  agentTraceQueryResultSchema,
  agentTraceQuerySchema,
  agentTraceStartInputSchema,
  type AgentTraceCompleteInput,
  type AgentTraceDetailResult,
  type AgentTraceFailInput,
  type AgentTraceQuery,
  type AgentTraceQueryResult,
  type AgentTraceRunSummary,
  type AgentTraceStartInput,
  type AgentTraceStatus,
  type AgentTraceStepSummary,
} from '../../../../src/core/assistant/trace'
import { modelStepUsageSchema, type ModelStepUsage } from '@henjicc/ai-sdk'
import {
  sanitizeAgentTraceDetail,
  sanitizeAgentTraceValue,
} from '../../../../src/core/assistant/traceSanitize'
import { MAIN_LOG_MAX_TOTAL_BYTES, MAIN_LOG_RETENTION_DAYS } from './types'
import { createMainLogger } from './main-logger'

const logger = createMainLogger('main.agent_trace')

const TRACE_MAX_TOTAL_BYTES = MAIN_LOG_MAX_TOTAL_BYTES
const TRACE_RETENTION_MS = MAIN_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1_000

interface TraceRow {
  trace_id: string
  run_id: string
  request_id: string
  step_id: string
  step_kind: AgentTraceStepSummary['kind']
  turn: number | null
  provider_id: string
  model_id: string
  status: AgentTraceStatus
  started_at: number
  completed_at: number | null
  elapsed_ms: number | null
  finish_reason: string | null
  usage_json: string
  capture_mode: 'summary' | 'detailed'
  detail_json: string | null
  detail_bytes: number
  original_detail_bytes: number
  detail_truncated: number
  error_json: string | null
  updated_at: number
  thread_id: string | null
  goal: string | null
  run_status: string | null
}

interface TraceIdentityRow {
  run_id: string
  step_id: string
  provider_id: string
  model_id: string
}

const EMPTY_USAGE: ModelStepUsage = {
  inputTokens: null,
  inputNoCacheTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  outputTokens: null,
  textTokens: null,
  reasoningTokens: null,
  totalTokens: null,
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString()
}

function toTimestamp(value: string): number {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error(`无效时间：${value}`)
  return timestamp
}

function localDateRange(value: string): { start: number; end: number } {
  const [year, month, day] = value.split('-').map(Number)
  const start = new Date(year, month - 1, day).getTime()
  const end = new Date(year, month - 1, day + 1).getTime()
  return { start, end }
}

function usageJson(usage: ModelStepUsage): string {
  return JSON.stringify(modelStepUsageSchema.parse(usage))
}

function readUsage(value: string): ModelStepUsage {
  return modelStepUsageSchema.parse(parseJson(value))
}

function readErrorMessage(value: string | null): string | undefined {
  if (!value) return undefined
  try {
    const parsed = parseJson(value)
    if (typeof parsed === 'object' && parsed !== null && 'message' in parsed) {
      const message = Reflect.get(parsed, 'message')
      return typeof message === 'string' ? message : undefined
    }
  } catch {
    return value
  }
  return undefined
}

function rowToStep(row: TraceRow): AgentTraceStepSummary {
  return {
    traceId: row.trace_id,
    runId: row.run_id,
    requestId: row.request_id,
    stepId: row.step_id,
    kind: row.step_kind,
    ...(row.turn === null ? {} : { turn: row.turn }),
    providerId: row.provider_id,
    modelId: row.model_id,
    status: row.status,
    startedAt: toIso(row.started_at),
    ...(row.completed_at === null ? {} : { completedAt: toIso(row.completed_at) }),
    ...(row.elapsed_ms === null ? {} : { elapsedMs: row.elapsed_ms }),
    ...(row.finish_reason === null ? {} : { finishReason: row.finish_reason }),
    usage: readUsage(row.usage_json),
    hasDetail: row.detail_json !== null,
    detailBytes: row.detail_bytes,
    originalDetailBytes: row.original_detail_bytes,
    detailTruncated: row.detail_truncated === 1,
    ...(readErrorMessage(row.error_json) ? { errorMessage: readErrorMessage(row.error_json) } : {}),
  }
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null
  return (a ?? 0) + (b ?? 0)
}

function addUsage(target: ModelStepUsage, value: ModelStepUsage): ModelStepUsage {
  return {
    inputTokens: addNullable(target.inputTokens, value.inputTokens),
    inputNoCacheTokens: addNullable(target.inputNoCacheTokens, value.inputNoCacheTokens),
    cacheReadTokens: addNullable(target.cacheReadTokens, value.cacheReadTokens),
    cacheWriteTokens: addNullable(target.cacheWriteTokens, value.cacheWriteTokens),
    outputTokens: addNullable(target.outputTokens, value.outputTokens),
    textTokens: addNullable(target.textTokens, value.textTokens),
    reasoningTokens: addNullable(target.reasoningTokens, value.reasoningTokens),
    totalTokens: addNullable(target.totalTokens, value.totalTokens),
  }
}

function statusRank(status: AgentTraceStatus): number {
  if (status === 'running') return 5
  if (status === 'failed') return 4
  if (status === 'cancelled') return 3
  if (status === 'interrupted') return 2
  return 1
}

function aggregateStatus(current: AgentTraceStatus, next: AgentTraceStatus): AgentTraceStatus {
  return statusRank(next) > statusRank(current) ? next : current
}

function statusFromRuntime(
  runtimeStatus: string | null,
  requestAggregate: AgentTraceStatus,
): AgentTraceStatus {
  if (runtimeStatus === 'completed' || runtimeStatus === 'completed_with_warning') return 'completed'
  if (runtimeStatus === 'failed' || runtimeStatus === 'budget_exhausted') return 'failed'
  if (runtimeStatus === 'cancelled') return 'cancelled'
  if (runtimeStatus === null) return requestAggregate
  return 'running'
}

export class AgentTraceStore {
  constructor(private readonly database: Database.Database) {}

  start(rawInput: AgentTraceStartInput): void {
    const input = agentTraceStartInputSchema.parse(rawInput)
    const now = Date.now()
    this.database.prepare(`
      INSERT OR REPLACE INTO agent_model_traces(
        trace_id, run_id, request_id, step_id, step_kind, turn,
        provider_id, model_id, status, started_at, completed_at,
        elapsed_ms, finish_reason, usage_json, capture_mode, detail_json,
        detail_bytes, original_detail_bytes, detail_truncated, error_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, NULL, NULL, NULL, ?, ?, NULL, 0, 0, 0, NULL, ?)
    `).run(
      input.traceId,
      input.runId,
      input.requestId,
      input.stepId,
      input.kind,
      input.turn ?? null,
      input.providerId,
      input.modelId,
      toTimestamp(input.startedAt),
      usageJson(EMPTY_USAGE),
      input.captureMode,
      now
    )
    logger.info('助手模型追踪开始', {
      event: 'agent_trace.step.started',
      requestId: input.runId,
      taskId: input.stepId,
      modelId: input.modelId,
      providerId: input.providerId,
      context: { traceId: input.traceId, kind: input.kind, turn: input.turn, captureMode: input.captureMode },
    })
  }

  complete(rawInput: AgentTraceCompleteInput): void {
    const input = agentTraceCompleteInputSchema.parse(rawInput)
    const detail = input.detail ? sanitizeAgentTraceDetail(input.detail) : undefined
    const detailJson = detail ? JSON.stringify(detail) : null
    const identity = this.getIdentity(input.traceId)
    this.database.prepare(`
      UPDATE agent_model_traces
      SET status = 'completed', completed_at = ?, elapsed_ms = ?, finish_reason = ?,
          usage_json = ?, detail_json = ?, detail_bytes = ?, original_detail_bytes = ?,
          detail_truncated = ?, error_json = NULL, updated_at = ?
      WHERE trace_id = ?
    `).run(
      toTimestamp(input.completedAt),
      input.elapsedMs,
      input.finishReason ?? null,
      usageJson(input.usage),
      detailJson,
      detail?.capture.storedBytes ?? 0,
      detail?.capture.originalBytes ?? 0,
      detail?.capture.truncated ? 1 : 0,
      Date.now(),
      input.traceId
    )
    this.cleanup()
    logger.info('助手模型追踪完成', {
      event: 'agent_trace.step.completed',
      requestId: identity?.run_id ?? input.traceId,
      taskId: identity?.step_id,
      modelId: identity?.model_id,
      providerId: identity?.provider_id,
      context: { elapsedMs: input.elapsedMs, hasDetail: Boolean(detail), finishReason: input.finishReason },
    })
  }

  fail(rawInput: AgentTraceFailInput): void {
    const input = agentTraceFailInputSchema.parse(rawInput)
    const detail = input.detail ? sanitizeAgentTraceDetail(input.detail) : undefined
    const safeError = sanitizeAgentTraceValue(input.error) as AgentTraceFailInput['error']
    const detailJson = detail ? JSON.stringify(detail) : null
    const identity = this.getIdentity(input.traceId)
    this.database.prepare(`
      UPDATE agent_model_traces
      SET status = ?, completed_at = ?, elapsed_ms = ?, finish_reason = NULL,
          usage_json = ?, detail_json = ?, detail_bytes = ?, original_detail_bytes = ?,
          detail_truncated = ?, error_json = ?, updated_at = ?
      WHERE trace_id = ?
    `).run(
      input.status,
      toTimestamp(input.completedAt),
      input.elapsedMs,
      usageJson(input.usage),
      detailJson,
      detail?.capture.storedBytes ?? 0,
      detail?.capture.originalBytes ?? 0,
      detail?.capture.truncated ? 1 : 0,
      JSON.stringify(safeError),
      Date.now(),
      input.traceId
    )
    this.cleanup()
    logger.warn('助手模型追踪失败', {
      event: 'agent_trace.step.failed',
      requestId: identity?.run_id ?? input.traceId,
      taskId: identity?.step_id,
      modelId: identity?.model_id,
      providerId: identity?.provider_id,
      context: { elapsedMs: input.elapsedMs, status: input.status, hasDetail: Boolean(detail) },
      error: safeError,
    })
  }

  query(rawQuery: AgentTraceQuery): AgentTraceQueryResult {
    const query = agentTraceQuerySchema.parse(rawQuery)
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (query.runId) {
      clauses.push('t.run_id = ?')
      params.push(query.runId)
    }
    if (query.date) {
      const { start, end } = localDateRange(query.date)
      clauses.push('t.started_at >= ? AND t.started_at < ?')
      params.push(start, end)
    }
    if (query.beforeTimestamp) {
      clauses.push('t.started_at < ?')
      params.push(toTimestamp(query.beforeTimestamp))
    }
    if (query.providerId) {
      clauses.push('t.provider_id = ?')
      params.push(query.providerId)
    }
    if (query.modelId) {
      clauses.push('t.model_id = ?')
      params.push(query.modelId)
    }
    if (query.status) {
      clauses.push('t.status = ?')
      params.push(query.status)
    }
    if (query.keyword) {
      const keyword = `%${query.keyword}%`
      clauses.push('(t.run_id LIKE ? OR t.request_id LIKE ? OR t.step_id LIKE ? OR t.provider_id LIKE ? OR t.model_id LIKE ? OR r.goal LIKE ?)')
      params.push(keyword, keyword, keyword, keyword, keyword, keyword)
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.database.prepare(`
      SELECT t.*, r.thread_id, r.goal, r.status AS run_status
      FROM agent_model_traces t
      LEFT JOIN agent_runs r ON r.run_id = t.run_id
      ${where}
      ORDER BY t.started_at DESC
      LIMIT ?
    `).all(...params, query.limit + 1) as TraceRow[]

    const hasMore = rows.length > query.limit
    const visibleRows = rows.slice(0, query.limit)
    const grouped = new Map<string, AgentTraceRunSummary>()
    const runtimeStatuses = new Map<string, string | null>()
    for (const row of visibleRows) {
      runtimeStatuses.set(row.run_id, row.run_status)
      const step = rowToStep(row)
      const existing = grouped.get(row.run_id)
      if (!existing) {
        grouped.set(row.run_id, {
          runId: row.run_id,
          ...(row.thread_id ? { threadId: row.thread_id } : {}),
          ...(row.goal ? { goal: row.goal.slice(0, 2_000) } : {}),
          status: row.status,
          startedAt: toIso(row.started_at),
          updatedAt: toIso(row.updated_at),
          requestCount: 1,
          completedCount: row.status === 'completed' ? 1 : 0,
          failedCount: row.status === 'failed' ? 1 : 0,
          totalElapsedMs: row.elapsed_ms ?? 0,
          usage: readUsage(row.usage_json),
          steps: [step],
        })
        continue
      }
      existing.status = aggregateStatus(existing.status, row.status)
      existing.startedAt = new Date(Math.min(Date.parse(existing.startedAt), row.started_at)).toISOString()
      existing.updatedAt = new Date(Math.max(Date.parse(existing.updatedAt), row.updated_at)).toISOString()
      existing.requestCount += 1
      if (row.status === 'completed') existing.completedCount += 1
      if (row.status === 'failed') existing.failedCount += 1
      existing.totalElapsedMs += row.elapsed_ms ?? 0
      existing.usage = addUsage(existing.usage, readUsage(row.usage_json))
      existing.steps.push(step)
    }

    const runs = [...grouped.values()]
      .map((run) => ({
        ...run,
        status: statusFromRuntime(runtimeStatuses.get(run.runId) ?? null, run.status),
        steps: run.steps.slice().sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const oldest = visibleRows[visibleRows.length - 1]?.started_at
    return agentTraceQueryResultSchema.parse({
      runs,
      hasMore,
      ...(hasMore && oldest !== undefined ? { nextBeforeTimestamp: toIso(oldest) } : {}),
    })
  }

  getDetail(traceId: string): AgentTraceDetailResult | null {
    const row = this.database.prepare(`
      SELECT t.*, r.thread_id, r.goal, r.status AS run_status
      FROM agent_model_traces t
      LEFT JOIN agent_runs r ON r.run_id = t.run_id
      WHERE t.trace_id = ?
    `).get(traceId) as TraceRow | undefined
    if (!row) return null
    const summary = rowToStep(row)
    const detail = row.detail_json ? parseJson(row.detail_json) : null
    return agentTraceDetailResultSchema.parse({ summary, detail })
  }

  markInterrupted(runIds?: string[]): void {
    const now = Date.now()
    if (!runIds || runIds.length === 0) {
      this.database.prepare(`
        UPDATE agent_model_traces
        SET status = 'interrupted', completed_at = ?,
            elapsed_ms = MAX(0, ? - started_at), updated_at = ?
        WHERE status = 'running'
      `).run(now, now, now)
      return
    }
    const placeholders = runIds.map(() => '?').join(', ')
    this.database.prepare(`
      UPDATE agent_model_traces
      SET status = 'interrupted', completed_at = ?,
          elapsed_ms = MAX(0, ? - started_at), updated_at = ?
      WHERE status = 'running' AND run_id IN (${placeholders})
    `).run(now, now, now, ...runIds)
  }

  clear(date?: string): void {
    if (!date) {
      const result = this.database.prepare('DELETE FROM agent_model_traces').run()
      logger.info('助手模型追踪已清空', {
        event: 'agent_trace.records.cleared',
        context: { count: result.changes, scope: 'all' },
      })
      return
    }
    const { start, end } = localDateRange(date)
    const result = this.database.prepare('DELETE FROM agent_model_traces WHERE started_at >= ? AND started_at < ?')
      .run(start, end)
    logger.info('助手模型追踪已按日期清空', {
      event: 'agent_trace.records.cleared',
      context: { count: result.changes, scope: 'date', date },
    })
  }

  cleanup(now = Date.now()): void {
    const cutoff = now - TRACE_RETENTION_MS
    this.database.transaction(() => {
      this.database.prepare(`
        UPDATE agent_model_traces SET status = 'interrupted', updated_at = ?
        WHERE status = 'running' AND started_at < ?
      `).run(now, cutoff)
      this.database.prepare('DELETE FROM agent_model_traces WHERE started_at < ?').run(cutoff)
      const totalRow = this.database.prepare(
        'SELECT COALESCE(SUM(detail_bytes), 0) AS total FROM agent_model_traces'
      ).get() as { total: number } | undefined
      let total = Number(totalRow?.total ?? 0)
      while (total > TRACE_MAX_TOTAL_BYTES) {
        const oldest = this.database.prepare(`
          SELECT trace_id, detail_bytes FROM agent_model_traces
          ORDER BY started_at ASC LIMIT 1
        `).get() as { trace_id: string; detail_bytes: number } | undefined
        if (!oldest) break
        this.database.prepare('DELETE FROM agent_model_traces WHERE trace_id = ?').run(oldest.trace_id)
        total -= oldest.detail_bytes
      }
    })()
  }

  private getIdentity(traceId: string): TraceIdentityRow | undefined {
    return this.database.prepare(`
      SELECT run_id, step_id, provider_id, model_id
      FROM agent_model_traces
      WHERE trace_id = ?
    `).get(traceId) as TraceIdentityRow | undefined
  }
}

export function createAgentTraceStore(database: Database.Database): AgentTraceStore {
  const store = new AgentTraceStore(database)
  store.markInterrupted()
  store.cleanup()
  return store
}
