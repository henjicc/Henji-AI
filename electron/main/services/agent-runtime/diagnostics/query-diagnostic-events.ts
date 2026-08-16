import { z } from 'zod'

import {
  diagnosticQueryInputSchema,
  diagnosticQueryOutputSchema,
  queryDiagnosticEventsCapability,
} from '../../../../../src/core/assistant/capabilities/assistantRuntimeApplicationCapabilities'
import { listLogDates, queryLogEvents, type LogQueryResult } from '../../logging/query'
import { createMainLogger } from '../../logging'
import type { MainLogEvent } from '../../logging/types'
import { createBackendCapabilityTool } from '../tools/backend-capability-tool'
import { summarizeSafeText } from '../tools/security'
import type { AgentToolDefinition } from '../tools/types'

const logger = createMainLogger('main.agent_diagnostics')
const QUERY_PAGE_SIZE = 200
const MAX_PAGES_PER_DATE = 3
const SAFE_DETAIL_KEYS = new Set(['code', 'errorCode', 'status', 'httpStatus', 'retryable', 'reason', 'stage'])

export type DiagnosticQueryInput = z.infer<typeof diagnosticQueryInputSchema>

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

function toEvidence(
  event: MainLogEvent,
  index: number
): DiagnosticQueryOutput['evidence'][number] {
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
      const oldestTimestamp = result.events[result.events.length - 1]?.timestamp
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
  return createBackendCapabilityTool(queryDiagnosticEventsCapability, {
    preview: (input) => {
      const targetIds: Record<string, string> = {}
      if (input.subjectRequestId) targetIds.requestId = input.subjectRequestId
      return {
        title: '读取脱敏诊断证据',
        summary: `读取 ${input.from} 至 ${input.to} 的故障相关证据。`,
        targetIds,
        reversible: false,
        dataClasses: ['C2'] as const,
        destination: '当前智能助手模型 Provider',
      }
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
  }) as unknown as AgentToolDefinition
}
