import { z } from 'zod'

import { createQueryDiagnosticEventsTool } from '../../diagnostics/query-diagnostic-events'
import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'
import type { AgentToolRegistry } from '../registry'
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
import { selectLeaseableToolNames } from '../../context/tool-activation'
import { createBackendCapabilityTool } from '../backend-capability-tool'
import {
  agentAcceptedActionPlanDeclarationSchema,
  agentActionPlanDeclarationInputSchema,
  deriveActionGroups,
  normalizeDeclaredRequiredEffects,
} from '../../../../../../src/core/assistant/taskGraph'

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
  const discoveryCatalog = new AgentCapabilityDiscoveryCatalog(registry)
  const discoverCapabilities = createBackendCapabilityTool(
    discoverApplicationCapabilitiesCapability,
    {
      execute: (input, context) => Promise.resolve(discoveryCatalog.discover(
        context.runId,
        input,
        context.hostContext
      )),
    }
  )
  const readSchemas = createBackendCapabilityTool(readApplicationSchemasCapability, {
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

  const declareActionPlan = defineAgentTool({
    name: 'declare_action_plan',
    version: 1,
    title: '声明多项操作计划',
    description: '在结构化规划不可用时，于首次多项写入前声明可结算的 Effect 与 action group；只登记计划，不执行业务写入。',
    category: 'application',
    side: 'backend',
    risk: 'R0',
    permission: 'application:read',
    readOnly: true,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false,
    supportsUndo: false,
    requiredContext: [],
    // 输入用宽松版：effectId / actionGroupId / actionGroups 全部由运行时按 Facet 推导。
    // 让模型手写这些交叉引用只会换来一句 "Invalid input"，而它无从自纠。
    inputSchema: agentActionPlanDeclarationInputSchema,
    outputSchema: agentAcceptedActionPlanDeclarationSchema,
    aiInputSchema: z.toJSONSchema(agentActionPlanDeclarationInputSchema, {
      target: 'draft-7', io: 'input',
    }) as Record<string, unknown>,
    // 真正的规范化与提交由执行守卫完成，这里只回显被接受的声明。
    execute: (input) => Promise.resolve({
      accepted: true as const,
      facets: input.facets.map((facet) => ({
        facetId: facet.facetId,
        requiredEffects: normalizeDeclaredRequiredEffects(facet.facetId, facet.requiredEffects),
      })),
      actionGroups: deriveActionGroups(input.facets.map((facet) => ({
        facetId: facet.facetId,
        domain: 'application',
        goal: facet.facetId,
        targetEntityTypes: [],
        requiredObservations: [],
        capabilityKinds: ['plan' as const],
        targetSurfaceId: null,
        dependsOn: [],
        parallelizable: false,
        completionConditions: [facet.facetId],
        requiredEffects: normalizeDeclaredRequiredEffects(facet.facetId, facet.requiredEffects),
        uncertainties: [],
        confidence: 1,
        status: 'pending' as const,
        statusReason: '',
        evidence: [],
      }))),
    }),
    concurrencyKey: () => 'action-plan',
    targetIds: () => ({}),
    dataClasses: () => ['C0'],
    summarize: (output) => `已声明 ${output.actionGroups.length} 个操作组。`,
    // 两条示例覆盖两种真实用法：给已有 Facet 补 Effect，以及路由判错时补建新 Facet 并作废旧的。
    // 后者是本工具最容易被忽略的能力——模型不知道能这么用，就只能停下来说自己被阻塞。
    inputExamples: [
      {
        facets: [{
          facetId: 'camera_scene',
          requiredEffects: [
            { effect: 'execute', entityTypes: ['camera_stage.object'], minimumCount: 2 },
            { effect: 'update', entityTypes: ['camera_stage.object'], minimumCount: 2 },
          ],
        }],
        actionGroups: [],
        supersededFacetIds: [],
      },
      {
        facets: [{
          facetId: 'camera_scene',
          requiredEffects: [{ effect: 'execute', entityTypes: ['camera_stage.object'], minimumCount: 1 }],
        }],
        actionGroups: [],
        supersededFacetIds: ['canvas'],
      },
    ],
  })

  return [
    eraseToolDefinition(discoverCapabilities),
    eraseToolDefinition(readSchemas),
    eraseToolDefinition(searchCapabilities),
    eraseToolDefinition(declareActionPlan),
    createQueryDiagnosticEventsTool(),
    ...createAssistantSkillTools(),
    ...createUserInstructionTools(),
    ...createAgentMemoryTools(),
    ...createAgentArtifactTools(artifactAccess),
  ]
}
