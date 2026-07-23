import { z } from 'zod'

import { listLogDates, queryLogEvents, type LogQueryResult } from '../../logging/query'
import { createMainLogger } from '../../logging'
import type { MainLogEvent } from '../../logging/types'
import { defineAgentTool } from '../tools/define-tool'
import { summarizeSafeText } from '../tools/security'
import type { AgentToolDefinition } from '../tools/types'

const logger = createMainLogger('main.agent_diagnostics')
const MAX_WINDOW_MS = 30 * 60 * 1_000
const QUERY_PAGE_SIZE = 200
const MAX_PAGES_PER_DATE = 3
const MAX_EVIDENCE = 40
const SAFE_DETAIL_KEYS = new Set(['code', 'errorCode', 'status', 'httpStatus', 'retryable', 'reason', 'stage'])

export const diagnosticQueryInputSchema = z.object({
  subjectRequestId: z.string().min(1).max(500).optional(),
  domain: z.string().min(1).max(300).optional(),
  keyword: z.string().min(1).max(200).optional(),
  from: z.string().datetime(),
  to: z.string().datetime(),
  levels: z.array(z.enum(['trace', 'debug', 'info', 'warn', 'error'])).max(5).optional(),
  limit: z.number().int().min(1).max(MAX_EVIDENCE).default(20),
}).strict().superRefine((input, context) => {
  const duration = Date.parse(input.to) - Date.parse(input.from)
  if (duration < 0 || duration > MAX_WINDOW_MS) {
    context.addIssue({ code: 'custom', message: '诊断时间窗必须在 0～30 分钟内' })
  }
})
export type DiagnosticQueryInput = z.infer<typeof diagnosticQueryInputSchema>

const diagnosticEvidenceSchema = z.object({
  evidenceId: z.string(),
  timestamp: z.string().datetime(),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error']),
  domain: z.string(),
  event: z.string(),
  requestId: z.string().optional(),
  taskId: z.string().optional(),
  modelId: z.string().optional(),
  providerId: z.string().optional(),
  summary: z.string().max(500),
  details: z.record(z.string(), z.string().max(300)).optional(),
}).strict()

export const diagnosticQueryOutputSchema = z.object({
  evidence: z.array(diagnosticEvidenceSchema).max(MAX_EVIDENCE),
  truncated: z.boolean(),
  excludedCurrentRun: z.literal(true),
  correlation: z.object({
    strategy: z.enum(['request_id', 'domain_time', 'time_only']),
    confidence: z.enum(['high', 'medium', 'low']),
    scannedPages: z.number().int().nonnegative(),
  }).strict(),
}).strict()
export type DiagnosticQueryOutput = z.infer<typeof diagnosticQueryOutputSchema>

export interface DiagnosticQueryDependencies {
  listDates: () => Promise<string[]>
  query: (params: Parameters<typeof queryLogEvents>[0]) => Promise<LogQueryResult>
}

const defaultDependencies: DiagnosticQueryDependencies = {
  listDates: listLogDates,
  query: queryLogEvents,
}

function utcDatesBetween(from: Date, to: Date): string[] {
  const dates: string[] = []
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function extractSafeDetails(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const details: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!SAFE_DETAIL_KEYS.has(key)) continue
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      details[key] = summarizeSafeText(String(item), 300)
    }
  }
  return details
}

function toEvidence(event: MainLogEvent, index: number): z.infer<typeof diagnosticEvidenceSchema> {
  const details = { ...extractSafeDetails(event.context), ...extractSafeDetails(event.error) }
  return {
    evidenceId: `E${String(index + 1).padStart(3, '0')}`,
    timestamp: event.timestamp,
    level: event.level,
    domain: event.domain,
    event: event.event,
    requestId: event.requestId,
    taskId: event.taskId,
    modelId: event.modelId,
    providerId: event.providerId,
    summary: summarizeSafeText(event.message, 500),
    details: Object.keys(details).length > 0 ? details : undefined,
  }
}

function isRecursiveAgentEvent(event: MainLogEvent, currentRunId: string): boolean {
  return event.requestId === currentRunId
    || event.domain.startsWith('main.agent_')
    || event.domain.startsWith('features.assistant')
}

export async function queryDiagnosticEvidence(
  rawInput: DiagnosticQueryInput,
  currentRunId: string,
  dependencies: DiagnosticQueryDependencies = defaultDependencies
): Promise<DiagnosticQueryOutput> {
  const input = diagnosticQueryInputSchema.parse(rawInput)
  const from = new Date(input.from)
  const to = new Date(input.to)
  const availableDates = new Set(await dependencies.listDates())
  const dates = utcDatesBetween(from, to).filter((date) => availableDates.has(date))
  const matches: MainLogEvent[] = []
  let scannedPages = 0
  let sourceHasMore = false

  for (const date of dates) {
    let beforeLine: number | undefined
    for (let page = 0; page < MAX_PAGES_PER_DATE; page += 1) {
      const result = await dependencies.query({
        date,
        requestId: input.subjectRequestId,
        domainPrefix: input.subjectRequestId ? undefined : input.domain,
        keyword: input.subjectRequestId ? undefined : input.keyword,
        beforeLine,
        limit: QUERY_PAGE_SIZE,
      })
      scannedPages += 1
      matches.push(...result.events.filter((event) => {
        const timestamp = Date.parse(event.timestamp)
        if (timestamp < from.getTime() || timestamp > to.getTime()) return false
        if (isRecursiveAgentEvent(event, currentRunId)) return false
        if (input.levels && !input.levels.includes(event.level)) return false
        return true
      }))
      if (!result.hasMore || result.nextBeforeLine === undefined) break
      if (page === MAX_PAGES_PER_DATE - 1) {
        sourceHasMore = true
        break
      }
      beforeLine = result.nextBeforeLine
      const oldestTimestamp = result.events.at(-1)?.timestamp
      if (oldestTimestamp && Date.parse(oldestTimestamp) < from.getTime()) break
    }
  }

  const unique = new Map<string, MainLogEvent>()
  for (const event of matches) {
    unique.set(`${event.timestamp}:${event.domain}:${event.event}:${event.requestId ?? ''}:${event.taskId ?? ''}`, event)
  }
  const sorted = [...unique.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp))
  const selected = sorted.slice(-input.limit)
  const strategy = input.subjectRequestId ? 'request_id' : input.domain ? 'domain_time' : 'time_only'
  return diagnosticQueryOutputSchema.parse({
    evidence: selected.map(toEvidence),
    truncated: sourceHasMore || sorted.length > selected.length,
    excludedCurrentRun: true,
    correlation: {
      strategy,
      confidence: strategy === 'request_id' ? 'high' : strategy === 'domain_time' ? 'medium' : 'low',
      scannedPages,
    },
  })
}

export function createQueryDiagnosticEventsTool(): AgentToolDefinition {
  const definition = defineAgentTool({
    name: 'query_diagnostic_events',
    version: 1,
    title: '查询诊断事件',
    description: '在最多 30 分钟时间窗内查询脱敏日志证据；requestId 优先，并排除当前运行和 Agent 自身日志。',
    category: 'diagnostics',
    side: 'backend',
    risk: 'R1',
    permission: 'diagnostics:read',
    readOnly: true,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 10_000,
    retryPolicy: { maxRetries: 1, baseDelayMs: 100 },
    supportsPreview: false,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: diagnosticQueryInputSchema,
    outputSchema: diagnosticQueryOutputSchema,
    aiInputSchema: {
      type: 'object',
      properties: {
        subjectRequestId: { type: 'string' },
        domain: { type: 'string' },
        keyword: { type: 'string' },
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        levels: { type: 'array', items: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error'] } },
        limit: { type: 'integer', minimum: 1, maximum: MAX_EVIDENCE },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    execute: async (input, context) => {
      logger.info('Agent 诊断查询开始', {
        event: 'agent_diagnostics.query.start',
        requestId: context.runId,
        context: {
          subjectRequestId: input.subjectRequestId,
          domain: input.domain,
          hasKeyword: Boolean(input.keyword),
        },
      })
      const output = await queryDiagnosticEvidence(input, context.runId)
      logger.info('Agent 诊断查询完成', {
        event: 'agent_diagnostics.query.completed',
        requestId: context.runId,
        context: {
          subjectRequestId: input.subjectRequestId,
          evidenceCount: output.evidence.length,
          confidence: output.correlation.confidence,
          scannedPages: output.correlation.scannedPages,
        },
      })
      return output
    },
    concurrencyKey: () => 'diagnostics',
    targetIds: (input) => {
      const targets: Record<string, string> = {}
      if (input.subjectRequestId) targets.requestId = input.subjectRequestId
      return targets
    },
    dataClasses: () => ['C2'],
    summarize: (output) => `诊断查询返回 ${output.evidence.length} 条脱敏证据，关联置信度为 ${output.correlation.confidence}${output.truncated ? '，结果已裁剪' : ''}。`,
  })
  return definition as unknown as AgentToolDefinition
}
