import { z } from 'zod'

import { createQueryDiagnosticEventsTool } from '../../diagnostics/query-diagnostic-events'
import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'
import type { AgentToolRegistry } from '../registry'
import { createModelPreferenceTools } from './model-preferences'

function eraseToolDefinition<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): AgentToolDefinition {
  return definition as unknown as AgentToolDefinition
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

  return [
    eraseToolDefinition(searchCapabilities),
    createQueryDiagnosticEventsTool(),
    ...createModelPreferenceTools(),
  ]
}
