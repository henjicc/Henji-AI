import { z } from 'zod'

import { queryLogEvents } from '../../../logging/query'
import type { MainLogEvent } from '../../../logging/types'
import { defineAgentTool } from '../define-tool'
import { summarizeSafeText } from '../security'
import type { AgentToolDefinition } from '../types'
import type { AgentToolRegistry } from '../registry'

function eraseToolDefinition<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): AgentToolDefinition {
  return definition as unknown as AgentToolDefinition
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

function toEvidence(event: MainLogEvent, index: number): Record<string, unknown> {
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
    summary: summarizeSafeText(event.message, 1_024),
  }
}

export function createBackendBuiltinTools(registry: AgentToolRegistry): AgentToolDefinition[] {
  const searchCapabilities = defineAgentTool({
    name: 'search_application_capabilities',
    version: 1,
    title: '搜索应用能力',
    description: '搜索当前上下文中可用的受控应用工具目录，最多返回 20 项。',
    category: 'catalog',
    side: 'backend',
    risk: 'R0',
    permission: 'catalog:read',
    readOnly: true,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 1, baseDelayMs: 50 },
    supportsPreview: false,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: z.object({
      query: z.string().max(500).default(''),
      category: z.string().min(1).optional(),
      cursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(20).default(10),
    }).strict(),
    outputSchema: z.object({
      catalogVersion: z.literal('agent-tool-catalog/v1'),
      capabilities: z.array(z.record(z.string(), z.unknown())),
      nextCursor: z.number().int().nonnegative().nullable(),
    }).strict(),
    aiInputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        category: { type: 'string' },
        cursor: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
    execute: (input, context) => {
      const all = registry.search(input.query, input.category, context.hostContext, 20)
      const capabilities = all.slice(input.cursor, input.cursor + input.limit)
      return Promise.resolve({
        catalogVersion: 'agent-tool-catalog/v1' as const,
        capabilities,
        nextCursor: input.cursor + capabilities.length < all.length ? input.cursor + capabilities.length : null,
      })
    },
    concurrencyKey: () => 'catalog',
    targetIds: () => ({}),
    dataClasses: () => ['C0'],
    summarize: (output) => `应用能力目录返回 ${output.capabilities.length} 项。`,
  })

  const queryDiagnostics = defineAgentTool({
    name: 'query_diagnostic_events',
    version: 1,
    title: '查询诊断事件',
    description: '在最多 30 分钟时间窗内查询脱敏日志证据；默认排除当前运行和 Agent 自身日志。',
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
    inputSchema: z.object({
      subjectRequestId: z.string().min(1).optional(),
      domain: z.string().min(1).optional(),
      from: z.string().datetime(),
      to: z.string().datetime(),
      levels: z.array(z.enum(['trace', 'debug', 'info', 'warn', 'error'])).max(5).optional(),
      limit: z.number().int().min(1).max(40).default(20),
    }).strict().superRefine((input, context) => {
      const duration = Date.parse(input.to) - Date.parse(input.from)
      if (duration < 0 || duration > 30 * 60 * 1_000) {
        context.addIssue({ code: 'custom', message: '诊断时间窗必须在 0～30 分钟内' })
      }
    }),
    outputSchema: z.object({
      evidence: z.array(z.record(z.string(), z.unknown())).max(40),
      truncated: z.boolean(),
      excludedCurrentRun: z.boolean(),
    }).strict(),
    aiInputSchema: {
      type: 'object',
      properties: {
        subjectRequestId: { type: 'string' },
        domain: { type: 'string' },
        from: { type: 'string', format: 'date-time' },
        to: { type: 'string', format: 'date-time' },
        levels: { type: 'array', items: { type: 'string', enum: ['trace', 'debug', 'info', 'warn', 'error'] } },
        limit: { type: 'integer', minimum: 1, maximum: 40 },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    execute: async (input, context) => {
      const from = new Date(input.from)
      const to = new Date(input.to)
      const batches = await Promise.all(utcDatesBetween(from, to).map((date) => queryLogEvents({
        date,
        domainPrefix: input.domain,
        requestId: input.subjectRequestId,
        limit: 2_000,
      })))
      const filtered = batches.flatMap((batch) => batch.events).filter((event) => {
        const timestamp = Date.parse(event.timestamp)
        if (timestamp < from.getTime() || timestamp > to.getTime()) return false
        if (event.requestId === context.runId) return false
        if (event.domain.startsWith('main.agent_')) return false
        if (input.levels && !input.levels.includes(event.level)) return false
        return true
      }).sort((left, right) => left.timestamp.localeCompare(right.timestamp))
      const selected = filtered.slice(-input.limit)
      return {
        evidence: selected.map(toEvidence),
        truncated: filtered.length > selected.length,
        excludedCurrentRun: true,
      }
    },
    concurrencyKey: () => 'diagnostics',
    targetIds: (input) => {
      const targetIds: Record<string, string> = {}
      if (input.subjectRequestId) targetIds.requestId = input.subjectRequestId
      return targetIds
    },
    dataClasses: () => ['C2'],
    summarize: (output) => `诊断查询返回 ${output.evidence.length} 条脱敏证据${output.truncated ? '，结果已裁剪' : ''}。`,
  })

  return [eraseToolDefinition(searchCapabilities), eraseToolDefinition(queryDiagnostics)]
}
