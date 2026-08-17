import { z } from 'zod'

import { createQueryDiagnosticEventsTool } from '../../diagnostics/query-diagnostic-events'
import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'
import type { AgentToolRegistry } from '../registry'
import { createAskUserTool } from './ask-user'
import { createAssistantSkillTools } from './assistant-skills'
import { createUserInstructionTools } from './user-instructions'
import { createAgentMemoryTools } from './memory'
import { createAgentArtifactTools, type AgentArtifactToolAccess } from './artifacts'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '../../../../../../src/core/assistant/applicationCapabilities'
import {
  discoverApplicationCapabilitiesCapability,
  readApplicationSchemasCapability,
} from '../../../../../../src/core/assistant/capabilities/capabilityDiscoveryApplicationCapabilities'
import { AGENT_DISCOVERY_LEASE_TOOL_LIMIT } from '../../../../../../src/core/assistant/toolBudget'
import { AgentCapabilityDiscoveryCatalog } from '../../context/capability-discovery'
import { AGENT_TOOL_DOMAINS } from '../../context/types'
import { hydrateHenjiScriptApi } from '../../context/script-api-hydration'
import { rememberHenjiScriptApiLease } from '../../context/script-api-lease'
import { selectLeaseableToolNames } from '../../context/tool-activation'
import { createBackendCapabilityTool } from '../backend-capability-tool'
import type { FrontendToolInvoker } from './frontend-utils'
import { requireFrontendSuccess } from './frontend-utils'

/*
 * 分类清单只有一份：`AGENT_TOOL_DOMAINS`。
 *
 * 这里曾经并存三份同样的 17 项清单——`context/types.ts` 一份、本文件的 z.enum 一份、
 * 下面 aiInputSchema 的 `enum:` 数组又一份。三份谁都不会因为对方改了而报错，于是
 * "域注册了但没有能力"这类缺口可以在任意一份里安静地待着。收敛成派生之后，改一处即三处同步，
 * 域清单本身也就有了唯一可被门禁盯住的真相源（见 capability-category-coverage.test.ts）。
 */
export const APPLICATION_CAPABILITY_CATEGORIES = AGENT_TOOL_DOMAINS
const applicationCapabilityCategorySchema = z.enum(APPLICATION_CAPABILITY_CATEGORIES)

function eraseToolDefinition<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): AgentToolDefinition {
  return definition as unknown as AgentToolDefinition
}

export function createBackendBuiltinTools(
  registry: AgentToolRegistry,
  artifactAccess: AgentArtifactToolAccess,
  invokeFrontend?: FrontendToolInvoker,
): AgentToolDefinition[] {
  const discoveryCatalog = new AgentCapabilityDiscoveryCatalog(registry)
  const discoverCapabilities = createBackendCapabilityTool(
    discoverApplicationCapabilitiesCapability,
    {
      /*
       * 发现结果里的 `scriptApi.actions[].parameters` 是逐字投影的 JSON Schema，深度天然超出
       * 普通业务 DTO。用默认档位时，任何一条稍深的入参 schema 都会让**整个域**的发现抛
       * INVALID_INPUT——模型连目录都拿不到。实测 image_edit 因此长期不可发现（17 层 > 16）。
       * 放宽的只是深度，字节与键数上限不变；门禁在 capability-discovery-size.test.ts。
       */
      outputLimitProfile: 'schema',
      execute: async (input, context) => {
        const discovered = discoveryCatalog.discover(context.runId, input, context.hostContext)
        if (!invokeFrontend) return discovered
        const description = requireFrontendSuccess(await invokeFrontend({
          kind: 'capability',
          capability: {
            id: 'describe_application_entities',
            version: 1,
            input: {
              domains: input.domains,
              entityTypes: discovered.scriptApi.entities.entityTypes,
              refs: [],
            },
          },
        }, context))
        const hydrated = hydrateHenjiScriptApi(discovered, description)
        rememberHenjiScriptApiLease(context.runId, hydrated.scriptApi)
        return hydrated
      },
    }
  )
  const readSchemas = createBackendCapabilityTool(readApplicationSchemasCapability, {
    // 同上：这条工具的全部输出就是 JSON Schema，它是发现投影之外取完整入参定义的唯一途径。
    outputLimitProfile: 'schema',
    execute: (input) => Promise.resolve(discoveryCatalog.readSchemas(input)),
  })
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
      leasedToolNames: z.array(z.string().min(1)).max(AGENT_DISCOVERY_LEASE_TOOL_LIMIT),
      deferredCount: z.number().int().nonnegative(),
      nextCursor: z.number().int().nonnegative().nullable(),
    }).strict(),
    aiInputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        category: {
          type: 'string',
          enum: [...APPLICATION_CAPABILITY_CATEGORIES],
        },
        cursor: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
    execute: (input, context) => {
      const all = registry.search(input.query, input.category, context.hostContext, 100)
      const capabilities = all.slice(input.cursor, input.cursor + input.limit)
      const leaseSelection = selectLeaseableToolNames(
        registry,
        context.hostContext,
        capabilities.map((capability) => capability.name)
          .filter((name) => name !== 'search_application_capabilities')
      )
      return Promise.resolve({
        catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
        capabilities,
        leasedToolNames: leaseSelection.leasedToolNames,
        deferredCount: leaseSelection.deferredToolNames.length
          + Math.max(0, all.length - input.cursor - capabilities.length),
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
    eraseToolDefinition(discoverCapabilities),
    eraseToolDefinition(readSchemas),
    eraseToolDefinition(searchCapabilities),
    createAskUserTool(),
    createQueryDiagnosticEventsTool(),
    ...createAssistantSkillTools(),
    ...createUserInstructionTools(),
    ...createAgentMemoryTools(),
    ...createAgentArtifactTools(artifactAccess),
  ]
}
