import { z } from 'zod'

import { createQueryDiagnosticEventsTool } from '../../diagnostics/query-diagnostic-events'
import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'
import type { AgentToolRegistry } from '../registry'
import { createUserInstructionTools } from './user-instructions'
import { createAgentMemoryTools } from './memory'
import { createAgentArtifactTools, type AgentArtifactToolAccess } from './artifacts'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '../../../../../../src/core/assistant/applicationCapabilities'

const applicationCapabilityCategorySchema = z.enum([
  'catalog',
  'application',
  'navigation',
  'models',
  'generation',
  'user_instructions',
  'memory',
  'diagnostics',
  'canvas',
  'toolbox',
  'camera_stage',
  'storyboard',
  'image_edit',
  'assets',
  'workflows',
  'artifacts',
  'settings',
])

function eraseToolDefinition<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): AgentToolDefinition {
  return definition as unknown as AgentToolDefinition
}

export function createBackendBuiltinTools(
  registry: AgentToolRegistry,
  artifactAccess: AgentArtifactToolAccess
): AgentToolDefinition[] {
  const searchCapabilities = defineAgentTool({
    name: 'search_application_capabilities',
    version: 1,
    title: '搜索应用能力',
    description: '搜索当前上下文中可用的受控应用工具目录，最多返回 20 项。创建图片/视频/音频使用 generation 分类，查找生成模型使用 models 分类。',
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
      category: applicationCapabilityCategorySchema.optional(),
      cursor: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(20).default(10),
    }).strict(),
    outputSchema: z.object({
      catalogVersion: z.literal(APPLICATION_CAPABILITY_CATALOG_VERSION),
      capabilities: z.array(z.record(z.string(), z.unknown())),
      addedToolNames: z.array(z.string().min(1)).max(20),
      nextCursor: z.number().int().nonnegative().nullable(),
    }).strict(),
    aiInputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        category: {
          type: 'string',
          enum: [
            'catalog',
            'application',
            'navigation',
            'models',
            'generation',
            'user_instructions',
            'memory',
            'diagnostics',
            'canvas',
            'toolbox',
            'camera_stage',
            'storyboard',
            'image_edit',
            'assets',
            'workflows',
            'artifacts',
            'settings',
          ],
        },
        cursor: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
    execute: (input, context) => {
      const all = registry.search(input.query, input.category, context.hostContext, 100)
      const capabilities = all.slice(input.cursor, input.cursor + input.limit)
      return Promise.resolve({
        catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
        capabilities,
        addedToolNames: capabilities
          .map((capability) => capability.name)
          .filter((name) => name !== 'search_application_capabilities'),
        nextCursor: input.cursor + capabilities.length < all.length ? input.cursor + capabilities.length : null,
      })
    },
    concurrencyKey: () => 'catalog',
    targetIds: () => ({}),
    dataClasses: () => ['C0'],
    summarize: (output) => {
      const titles = output.capabilities.flatMap((capability) => {
        const title = capability.title
        return typeof title === 'string' && title.trim() ? [title.trim()] : []
      })
      if (titles.length === 0) return '没有找到符合当前任务的应用能力。'
      const visible = titles.slice(0, 5)
      const remaining = titles.length - visible.length
      return `找到 ${titles.length} 项能力：${visible.join('、')}${remaining > 0 ? `等 ${titles.length} 项` : ''}。`
    },
  })

  return [
    eraseToolDefinition(searchCapabilities),
    createQueryDiagnosticEventsTool(),
    ...createUserInstructionTools(),
    ...createAgentMemoryTools(),
    ...createAgentArtifactTools(artifactAccess),
  ]
}
