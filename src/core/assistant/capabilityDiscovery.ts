import { z } from 'zod'

import {
  applicationPropertyValueSchema,
  applicationSchemaRefSchema,
  jsonValueSchema,
} from '../application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from './applicationCapabilities'
import { agentTaskEffectKindSchema } from './taskGraph'
import type { AgentTaskFacet, AgentTaskGraph } from './taskGraph'
import {
  AGENT_DISCOVERY_LEASE_TOOL_LIMIT,
  AGENT_LEASE_FRONTIER_FACET_LIMIT,
} from './toolBudget'

export const APPLICATION_CAPABILITY_DISCOVERY_VERSION = 'application-capability-discovery/v3' as const

/**
 * 发现请求的单位是**实体**，不是 Facet。
 *
 * 这次发现的产物是 `scriptApi` 投影——「这段脚本里能调哪些实体和 action」。租约本身对模型
 * 不可见（`tool-activation.ts` 的 modelVisible 把所有带 capability 的工具挡在模型视野外，
 * 唯一入口是 run_henji_script），所以名额分配要解决的问题从来不是"给模型几个工具槽位"，
 * 而是"投影里放什么"。Facet 计的是"任务被拆成几步"，和投影需要的"任务碰哪些实体"不是一回事。
 *
 * 删掉的字段与理由：
 * - `facets[]`：请求扁平化，一次运行发一次就够
 * - `requiredEffects`：它是运行时代填的排序信号，模型写不出来；替代方案见
 *   capability-discovery 的读写配对保底（从注册表推导，可穷举测试）
 * - `capabilityKinds` / `targetSurfaceIds`：注释里记了四次事故，全是它们被当成硬过滤
 * - `forbiddenEffects`：否定约束由 Gateway 与审批承担，不该让发现层去猜
 */
export const applicationCapabilityDiscoveryInputSchema = z.object({
  discoveryVersion: z.literal(APPLICATION_CAPABILITY_DISCOVERY_VERSION)
    .default(APPLICATION_CAPABILITY_DISCOVERY_VERSION),
  /** 自然语言检索意图，模型自己写。 */
  queries: z.array(z.string().min(1).max(500)).min(1).max(8),
  /** 领域是唯一的硬准入条件；其余全是排序信号。 */
  domains: z.array(z.string().min(1).max(128)).max(8).default([]),
  /** 本次任务要读写的实体类型（形如 camera_stage.object）；投影与排序的主信号。 */
  entityTypes: z.array(z.string().min(1).max(128)).max(24).default([]),
  /** 本轮是否会写入；false 时投影只放只读 action，压缩 schema 体积。 */
  writes: z.boolean().default(true),
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

const missingCapabilitySchema = z.object({
  reason: z.enum(['no_matching_capability', 'permission_filtered', 'unsupported_domain']),
  requestedDomains: z.array(z.string().min(1).max(128)).max(8),
  requestedEntityTypes: z.array(z.string().min(1).max(128)).max(24),
}).strict()

const scriptApiOperationSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  parameters: z.record(z.string(), z.unknown()),
  returns: z.object({
    fields: z.array(z.string().min(1).max(128)).max(64),
    hasResultRefs: z.boolean(),
  }).strict(),
  verification: z.array(z.string().min(1).max(500)).max(8).optional(),
  /**
   * Recipe 单次调用的容量上限，按 effect × 实体类型声明。
   *
   * 这个字段是一次真实回归换来的：设置领域的 Recipe 只能做 1 次 update，而"改一个值再恢复
   * 原值"需要 2 次。旧实现拿运行时代填的 requiredEffects.minimumCount 做容量校验，把装不下的
   * Recipe 直接过滤掉；请求扁平化后那个字段没有了，于是容量不足的 Recipe 也被投影出来——
   * 模型选中它、失败、重试，实测一次设置任务因此烧掉 3 次脚本调用和 2 次守卫失败。
   *
   * 现在不替模型做这个判断，而是把上限如实给它：装不下就自己组合低层 action。
   * 过滤错了是直接没有出路，信息给全了模型自己会选。
   */
  limits: z.array(z.object({
    effect: z.string().min(1).max(32),
    entityTypes: z.array(z.string().min(1).max(128)).max(16),
    maximumCount: z.number().int().positive(),
  }).strict()).max(16).optional(),
}).strict()

export const henjiScriptEntityDefinitionSchema = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  parentTypes: z.array(z.string().min(1).max(128)).max(16),
  collectionWrite: z.object({
    creatable: z.boolean(),
    removable: z.boolean(),
    requiredPropertyIds: z.array(z.string().min(1).max(128)).max(32),
    maxItemsPerChange: z.number().int().positive().max(256),
  }).strict().optional(),
  readOnlyReason: z.string().min(1).max(500).optional(),
}).strict()
export type HenjiScriptEntityDefinition = z.infer<typeof henjiScriptEntityDefinitionSchema>

export const henjiScriptPropertyDefinitionSchema = z.object({
  id: z.string().min(1).max(128),
  entityType: z.string().min(1).max(128),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  value: applicationPropertyValueSchema,
  nullable: z.boolean().default(false),
  writable: z.boolean(),
  writeOperations: z.array(z.enum(['set', 'clear', 'append', 'remove'])).max(4).default([]),
  defaultValue: jsonValueSchema.optional(),
}).strict()
export type HenjiScriptPropertyDefinition = z.infer<typeof henjiScriptPropertyDefinitionSchema>

export const HENJI_ENTITY_METHOD_SIGNATURES = {
  list: 'app.entities.list(entityType, options?) -> { refs, nextCursor, revisions }',
  read: 'app.entities.read(ref, propertyIds?) -> { ref, properties, revisions }',
  create: 'app.entities.create(entityType, { parent?, properties }) -> { resultRefs, effects }；仅当父类型和父实例都唯一时可省略 parent',
  update: 'app.entities.update(ref, mutations) -> { resultRefs, effects }',
  remove: 'app.entities.remove(ref) -> { resultRefs, effects }；父类型和父实例唯一时由宿主自动解析父上下文',
} as const

export const HENJI_SCRIPT_LANGUAGE_RULES = [
  '只允许 const 声明；不允许 let、var、用户函数或类。',
  '不支持 Array.find/map/filter 等任意方法；有界遍历只使用 for...of，循环体不能修改变量。',
  '普通结果字段使用点访问；含点号的属性 ID 使用静态字符串字面量下标，例如 properties[\'asset.library.name\']。',
  'create/update/remove 已由宿主从正式状态源自动读回验证；不要仅为重复验证而额外 list/read。',
  'update(ref, mutations) 的 mutations 直接使用完整属性 ID 到值的映射，不要再嵌套 properties。',
  '尽量把能一起做的写进同一段：一段里连续完成创建、更新、删除最省，也最不容易出竞态。'
    + '但确实需要上一段的结果才能决定下一步时，就写第二段——不要为了凑成一段反复琢磨。',
  '断言只支持 equal、exists、absent、matches；基于读取值选择替代值可使用确定性三元表达式。',
  'recipes[].limits 是该配方单次调用的容量上限（按 effect × 实体类型给出 maximumCount）。'
    + '本次任务需要的次数超过上限时不要硬套那条配方——它会执行失败，直接用 app.entities 与 app.action 自己组合。'
    + '例如"改一个设置值再恢复原值"是 2 次 update，装不进 maximumCount 为 1 的配方。',
] as const

export const henjiScriptApiProjectionSchema = z.object({
  language: z.literal('henji-ts/v1'),
  entryTool: z.literal('run_henji_script'),
  exactRecipe: z.boolean().optional(),
  forbiddenEffects: z.array(agentTaskEffectKindSchema).max(6).default([]),
  rules: z.array(z.string().min(1).max(300)).length(HENJI_SCRIPT_LANGUAGE_RULES.length)
    .default([...HENJI_SCRIPT_LANGUAGE_RULES]),
  entities: z.object({
    methods: z.array(z.enum(['list', 'read', 'create', 'update', 'remove'])).length(5),
    signatures: z.object({
      list: z.literal(HENJI_ENTITY_METHOD_SIGNATURES.list),
      read: z.literal(HENJI_ENTITY_METHOD_SIGNATURES.read),
      create: z.literal(HENJI_ENTITY_METHOD_SIGNATURES.create),
      update: z.literal(HENJI_ENTITY_METHOD_SIGNATURES.update),
      remove: z.literal(HENJI_ENTITY_METHOD_SIGNATURES.remove),
    }).strict().default(HENJI_ENTITY_METHOD_SIGNATURES),
    entityTypes: z.array(z.string().min(1).max(128)).max(64),
    propertyIds: z.array(z.string().min(1).max(128)).max(256),
    entityDefinitions: z.array(henjiScriptEntityDefinitionSchema).max(64).default([]),
    propertyDefinitions: z.array(henjiScriptPropertyDefinitionSchema).max(256).default([]),
  }).strict(),
  assertions: z.object({
    equal: z.literal('app.assert.equal(actual, expected)'),
    exists: z.literal('app.assert.exists(value)'),
    absent: z.literal('app.assert.absent(value)'),
    matches: z.literal('app.assert.matches(value, pattern)'),
  }).strict().optional(),
  actions: z.array(scriptApiOperationSchema).max(32),
  recipes: z.array(scriptApiOperationSchema).max(16),
}).strict()
export type HenjiScriptApiProjection = z.infer<typeof henjiScriptApiProjectionSchema>

export const applicationCapabilityDiscoveryOutputSchema = z.object({
  discoveryVersion: z.literal(APPLICATION_CAPABILITY_DISCOVERY_VERSION),
  catalogVersion: z.literal(APPLICATION_CAPABILITY_CATALOG_VERSION),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  reused: z.boolean(),
  capabilities: z.array(applicationCapabilityDiscoveryMatchSchema).max(AGENT_DISCOVERY_LEASE_TOOL_LIMIT),
  observationSuggestions: z.array(z.string().min(1).max(500)).max(16).default([]),
  missing: z.array(missingCapabilitySchema).max(4).default([]),
  leasedToolNames: z.array(z.string().min(1).max(128)).max(AGENT_DISCOVERY_LEASE_TOOL_LIMIT),
  deferredToolNames: z.array(z.string().min(1).max(128)).max(100),
  deferredCount: z.number().int().nonnegative(),
  scriptApi: henjiScriptApiProjectionSchema.default({
    language: 'henji-ts/v1', entryTool: 'run_henji_script',
    forbiddenEffects: [],
    rules: [...HENJI_SCRIPT_LANGUAGE_RULES],
    entities: {
      methods: ['list', 'read', 'create', 'update', 'remove'],
      signatures: HENJI_ENTITY_METHOD_SIGNATURES,
      entityTypes: [], propertyIds: [], entityDefinitions: [], propertyDefinitions: [],
    },
    assertions: {
      equal: 'app.assert.equal(actual, expected)', exists: 'app.assert.exists(value)',
      absent: 'app.assert.absent(value)', matches: 'app.assert.matches(value, pattern)',
    },
    actions: [], recipes: [],
  }),
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
 * 从任务图推出一次**扁平**发现请求，作为模型没有自拟请求时的兜底。
 *
 * 与旧实现的关键差别：它不再改写模型写的请求，只在模型没写时提供一个起点。
 * 旧的 `normalizeCallInput` 会把模型申报的 facetId / entityTypes / capabilityKinds 全部替换
 * 成运行时依赖前沿，于是主模型——唯一拿得到完整会话历史的角色——连"我要的东西在另一个领域"
 * 都表达不了。现在模型写什么就发什么。
 */
export function createCapabilityDiscoveryFallbackInput(
  taskGraph: AgentTaskGraph
): ApplicationCapabilityDiscoveryInput | null {
  const facets = listDependencyFrontierFacets(taskGraph.facets)
  if (facets.length === 0) return null
  return applicationCapabilityDiscoveryInputSchema.parse({
    queries: [...new Set(facets.map((facet) => facet.goal))].slice(0, 8),
    domains: [...new Set(facets.map((facet) => facet.domain))].slice(0, 8),
    entityTypes: [...new Set(facets.flatMap((facet) => [
      ...facet.targetEntityTypes,
      ...facet.requiredEffects.flatMap((effect) => effect.entityTypes),
    ]))].slice(0, 24),
    writes: facets.some((facet) => (
      facet.capabilityKinds.includes('mutate') || facet.capabilityKinds.includes('execute')
    )),
  })
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
  extraDomains: readonly string[] = [],
  forbiddenEffects: AgentTaskGraph['forbiddenEffects'] = [],
): ApplicationCapabilityDiscoveryInput | null {
  if (facets.length === 0) return null
  return applicationCapabilityDiscoveryInputSchema.parse({
    discoveryVersion: APPLICATION_CAPABILITY_DISCOVERY_VERSION,
    forbiddenEffects,
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
        minimumCount: effect.minimumCount,
      })),
    })),
    cursor: 0,
    limit: AGENT_DISCOVERY_LEASE_TOOL_LIMIT,
  })
}



