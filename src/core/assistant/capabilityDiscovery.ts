import { z } from 'zod'

import { applicationSchemaRefSchema } from '../application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from './applicationCapabilities'
import { agentTaskCapabilityKindSchema } from './taskGraph'
import type { AgentTaskFacet, AgentTaskGraph } from './taskGraph'
import {
  AGENT_DISCOVERY_LEASE_TOOL_LIMIT,
  AGENT_LEASE_FRONTIER_FACET_LIMIT,
} from './toolBudget'

export const APPLICATION_CAPABILITY_DISCOVERY_VERSION = 'application-capability-discovery/v2' as const

export const applicationCapabilityDiscoveryFacetSchema = z.object({
  facetId: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  queries: z.array(z.string().min(1).max(500)).max(8).default([]),
  domains: z.array(z.string().min(1).max(128)).max(8).default([]),
  entityTypes: z.array(z.string().min(1).max(128)).max(16).default([]),
  capabilityKinds: z.array(agentTaskCapabilityKindSchema).max(6).default([]),
  targetSurfaceIds: z.array(z.string().min(1).max(128)).max(8).default([]),
  requiredEffects: z.array(z.object({
    effect: z.enum(['observe', 'create', 'update', 'delete', 'navigate', 'execute']),
    entityTypes: z.array(z.string().min(1).max(128)).max(16).default([]),
    propertyIds: z.array(z.string().min(1).max(128)).max(128).default([]),
  }).strict()).max(32).optional(),
}).strict()
export type ApplicationCapabilityDiscoveryFacet = z.infer<
  typeof applicationCapabilityDiscoveryFacetSchema
>

export const applicationCapabilityDiscoveryInputSchema = z.object({
  discoveryVersion: z.literal(APPLICATION_CAPABILITY_DISCOVERY_VERSION)
    .default(APPLICATION_CAPABILITY_DISCOVERY_VERSION),
  facets: z.array(applicationCapabilityDiscoveryFacetSchema).min(1).max(AGENT_LEASE_FRONTIER_FACET_LIMIT),
  cursor: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(AGENT_DISCOVERY_LEASE_TOOL_LIMIT).default(AGENT_DISCOVERY_LEASE_TOOL_LIMIT),
}).strict()
export type ApplicationCapabilityDiscoveryInput = z.infer<
  typeof applicationCapabilityDiscoveryInputSchema
>

export const applicationCapabilityDiscoveryMatchSchema = z.object({
  name: z.string().min(1).max(128),
  capabilityId: z.string().min(1).max(128),
  version: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(1_000),
  domain: z.string().min(1).max(128),
  category: z.string().min(1).max(128),
  readOnly: z.boolean(),
  risk: z.enum(['R0', 'R1', 'R2', 'R3']),
  entityTypes: z.array(z.string().min(1).max(128)).max(32),
  propertyIds: z.array(z.string().min(1).max(128)).max(128),
  surfaceIds: z.array(z.string().min(1).max(128)).max(16),
  schemaRef: applicationSchemaRefSchema,
}).strict()
export type ApplicationCapabilityDiscoveryMatch = z.infer<
  typeof applicationCapabilityDiscoveryMatchSchema
>

const facetDiscoveryResultSchema = z.object({
  facetId: z.string().min(1).max(64),
  capabilityNames: z.array(z.string().min(1).max(128)).max(100),
  schemaRefs: z.array(applicationSchemaRefSchema).max(100),
  observationSuggestions: z.array(z.string().min(1).max(500)).max(16),
}).strict()

const missingFacetSchema = z.object({
  facetId: z.string().min(1).max(64),
  reason: z.enum(['no_matching_capability', 'permission_filtered', 'unsupported_domain']),
  requestedDomains: z.array(z.string().min(1).max(128)).max(8),
  requestedEntityTypes: z.array(z.string().min(1).max(128)).max(16),
}).strict()

export const applicationCapabilityDiscoveryOutputSchema = z.object({
  discoveryVersion: z.literal(APPLICATION_CAPABILITY_DISCOVERY_VERSION),
  catalogVersion: z.literal(APPLICATION_CAPABILITY_CATALOG_VERSION),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  reused: z.boolean(),
  capabilities: z.array(applicationCapabilityDiscoveryMatchSchema).max(AGENT_DISCOVERY_LEASE_TOOL_LIMIT),
  facets: z.array(facetDiscoveryResultSchema).max(16),
  missing: z.array(missingFacetSchema).max(16),
  leasedToolNames: z.array(z.string().min(1).max(128)).max(AGENT_DISCOVERY_LEASE_TOOL_LIMIT),
  deferredToolNames: z.array(z.string().min(1).max(128)).max(100),
  deferredCount: z.number().int().nonnegative(),
  page: z.object({
    returnedItems: z.number().int().nonnegative(),
    nextCursor: z.number().int().nonnegative().nullable(),
    hasMore: z.boolean(),
  }).strict(),
}).strict()
export type ApplicationCapabilityDiscoveryOutput = z.infer<
  typeof applicationCapabilityDiscoveryOutputSchema
>

export const applicationSchemaReadInputSchema = z.object({
  refs: z.array(applicationSchemaRefSchema).min(1).max(20),
}).strict()
export type ApplicationSchemaReadInput = z.infer<typeof applicationSchemaReadInputSchema>

export const applicationSchemaReadOutputSchema = z.object({
  catalogVersion: z.literal(APPLICATION_CAPABILITY_CATALOG_VERSION),
  documents: z.array(z.object({
    ref: applicationSchemaRefSchema,
    inputSchema: z.record(z.string(), z.unknown()),
  }).strict()).max(20),
  missing: z.array(applicationSchemaRefSchema).max(20),
}).strict()
export type ApplicationSchemaReadOutput = z.infer<typeof applicationSchemaReadOutputSchema>

export function listDependencyFrontierFacets(
  facets: AgentTaskFacet[],
  limit = AGENT_LEASE_FRONTIER_FACET_LIMIT,
): AgentTaskFacet[] {
  const completed = new Set(facets
    .filter((facet) => facet.status === 'completed')
    .map((facet) => facet.facetId))
  return facets.filter((facet) => (
    !['completed', 'blocked', 'waiting_user'].includes(facet.status)
    && facet.dependsOn.every((dependency) => completed.has(dependency))
  )).slice(0, limit)
}

/**
 * 由运行时 Facet 直接构造发现请求。
 *
 * `requiredEffects` 是租约排序的唯一依据（见 capability-discovery 的 requiredEffectScore）。
 * 模型手写的发现请求带不上它，结果租约名额退化成按名字排序，实测把 observe/verify 这类
 * 只读能力全挤进 deferred，Facet 因此永远拿不到验证证据、永远无法完成——依赖前沿卡死。
 * 所以运行时侧的规范化必须始终用这个函数生成请求，不能沿用模型自拟的字段。
 *
 * 但"不沿用"不等于"全部丢弃"：`extraQueries` 与 `extraDomains` 是模型（以及会话延续证据）
 * 唯一能表达"我要的东西不在这个域里"的通道。旧实现把模型自拟的 domains 整个覆盖掉，于是
 * 模型明明说了"当前上下文未持有 camera_stage 租约"，却没有任何办法把这个域要回来——只能
 * 反过来认为自己判断错了。运行时保留对 Facet 集合与 requiredEffects 的裁定权，领域则做并集。
 */
export function buildCapabilityDiscoveryInputForFacets(
  facets: AgentTaskFacet[],
  extraQueriesByFacetId: Readonly<Record<string, string[]>> = {},
  extraDomains: readonly string[] = []
): ApplicationCapabilityDiscoveryInput | null {
  if (facets.length === 0) return null
  return applicationCapabilityDiscoveryInputSchema.parse({
    discoveryVersion: APPLICATION_CAPABILITY_DISCOVERY_VERSION,
    facets: facets.map((facet) => ({
      facetId: facet.facetId,
      queries: [...new Set([
        facet.goal,
        ...(extraQueriesByFacetId[facet.facetId] ?? []),
      ])].slice(0, 8),
      domains: [...new Set([facet.domain, ...extraDomains])].slice(0, 8),
      entityTypes: [...new Set([
        ...facet.targetEntityTypes,
        ...facet.requiredEffects.flatMap((effect) => effect.entityTypes),
      ])],
      capabilityKinds: facet.capabilityKinds,
      targetSurfaceIds: facet.targetSurfaceId ? [facet.targetSurfaceId] : [],
      requiredEffects: facet.requiredEffects.map((effect) => ({
        effect: effect.effect,
        entityTypes: effect.entityTypes,
        propertyIds: effect.propertyIds,
      })),
    })),
    cursor: 0,
    limit: AGENT_DISCOVERY_LEASE_TOOL_LIMIT,
  })
}

/**
 * 一次发现就把整条链路要用的能力全租下来。
 *
 * 只发现"当前可运行"的 Facet 看着很克制，实际代价是每推进一步就要再来一次完整往返：发现 →
 * 结果卸载 → 分页读回 → 才轮到干活。一个 6 Facet 的三维任务因此在协议上就要烧掉二十多轮。
 * 下游 Facet 的工具提前拿在手里没有副作用——真正约束执行顺序的是 Task Graph 的依赖与结算，
 * 不是"看不看得见工具"。
 */
export function listDiscoverableFacets(
  facets: AgentTaskFacet[],
  limit = AGENT_LEASE_FRONTIER_FACET_LIMIT,
): AgentTaskFacet[] {
  const runnable = listDependencyFrontierFacets(facets, limit)
  const runnableIds = new Set(runnable.map((facet) => facet.facetId))
  const downstream = facets.filter((facet) => (
    !runnableIds.has(facet.facetId)
    && !['completed', 'blocked', 'waiting_user'].includes(facet.status)
  ))
  return [...runnable, ...downstream].slice(0, limit)
}

export function createCapabilityDiscoveryInputFromTaskGraph(
  taskGraph: AgentTaskGraph
): ApplicationCapabilityDiscoveryInput | null {
  return buildCapabilityDiscoveryInputForFacets(listDiscoverableFacets(taskGraph.facets))
}
