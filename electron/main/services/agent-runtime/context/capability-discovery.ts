import { createHash } from 'node:crypto'
import { z } from 'zod'

import {
  AGENT_DISCOVERY_LEASE_TOOL_LIMIT,
} from '../../../../../src/core/assistant/toolBudget'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolCatalogEntry } from '../../../../../src/core/assistant/toolContracts'
import {
  APPLICATION_CAPABILITY_DISCOVERY_VERSION,
  HENJI_SCRIPT_LANGUAGE_RULES,
  applicationCapabilityDiscoveryInputSchema,
  applicationCapabilityDiscoveryOutputSchema,
  applicationSchemaReadInputSchema,
  applicationSchemaReadOutputSchema,
  type ApplicationCapabilityDiscoveryInput,
  type ApplicationCapabilityDiscoveryMatch,
  type ApplicationCapabilityDiscoveryOutput,
  type ApplicationSchemaReadInput,
  type ApplicationSchemaReadOutput,
} from '../../../../../src/core/assistant/capabilityDiscovery'
import {
  APPLICATION_CAPABILITY_CATALOG_VERSION,
} from '../../../../../src/core/assistant/applicationCapabilities'
import type { ApplicationSchemaRef } from '../../../../../src/core/application-control'
import type { AgentToolRegistry } from '../tools/registry'
import { selectLeaseableToolNames } from './tool-activation'
import { rememberHenjiScriptApiLease } from './script-api-lease'
import { HENJI_RECIPE_REGISTRY } from '../../application-control/henji-script/recipes'

/**
 * Facet 点名了实体时，被放宽进来的域最多补几个租约。
 *
 * 存在的意义是给"被放宽进来的域"留一条活路：域放宽（延续证据、路由域、模型自报）之后，新域的
 * 能力通常命不中原 Facet 的实体，但它们恰恰是这次放宽想要的东西。
 *
 * 名额由 Facet 租约上限推导而不是拍一个数：一个新域至少要凑齐「观察 → 写入 → 验证」这个最小
 * 闭包才有用，三分之一的名额正好覆盖它，同时不至于挤掉别的 Facet。
 */

const SCRIPT_INTERNAL_CAPABILITIES = new Set([
  'run_henji_script',
  'describe_application_entities', 'list_application_entities',
  'read_application_entity', 'change_application_entities',
])

function publicResultShape(schema: z.ZodType): { fields: string[]; hasResultRefs: boolean } {
  try {
    const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }) as {
      properties?: Record<string, unknown>
    }
    const fields = Object.keys(jsonSchema.properties ?? {}).slice(0, 64)
    return { fields, hasResultRefs: fields.includes('resultRefs') }
  } catch {
    return { fields: [], hasResultRefs: false }
  }
}

const surfaceIdsByDomain: Readonly<Record<string, string[]>> = {
  application: [],
  navigation: [],
  models: ['settings.providers_models', 'workspace.generation'],
  generation: ['workspace.generation'],
  canvas: ['workspace.canvas'],
  toolbox: ['workspace.tools'],
  camera_stage: ['tool.camera_stage'],
  storyboard: ['workspace.canvas'],
  image_edit: ['tool.image_edit'],
  image_mark: ['tool.image_edit'],
  assets: ['workspace.assets', 'overlay.assets'],
  settings: ['settings.general'],
}

interface IndexedCapability {
  entry: AgentToolCatalogEntry
  definition: AgentToolDefinitionLike
  match: ApplicationCapabilityDiscoveryMatch
}

type AgentToolDefinitionLike = ReturnType<AgentToolRegistry['allDefinitions']>[number]

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableValue(item)]))
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function operationSchemaRef(definition: AgentToolDefinitionLike): ApplicationSchemaRef {
  return {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    kind: 'operation',
    id: definition.name,
    version: definition.version,
    digest: digest(definition.aiInputSchema),
  }
}

function entityTypes(definition: AgentToolDefinitionLike, entry: AgentToolCatalogEntry): string[] {
  const capability = definition.capability
  return unique([
    ...entry.acceptsRefs,
    ...entry.producesRefs,
    ...(capability?.control?.impacts.flatMap((impact) => impact.entityTypes) ?? []),
  ])
}

function propertyIds(definition: AgentToolDefinitionLike): string[] {
  return unique(definition.capability?.control?.impacts.flatMap((impact) => impact.propertyIds) ?? [])
}

function surfaceIds(entry: AgentToolCatalogEntry): string[] {
  return unique([
    ...(surfaceIdsByDomain[entry.domain] ?? []),
    ...(surfaceIdsByDomain[entry.category] ?? []),
  ])
}


/**
 * 准入只有一条：域。其余全部是排序信号。
 *
 * 这条规则是四次同类事故换来的，每一次的形状完全一样——**某个软信号被当成硬过滤，于是一个
 * 明明注册好的能力对模型彻底隐身**，模型如实回答"应用没有这个能力"，用户看到的却是凭空的
 * 能力否认。逐条记在这里，因为下一个想加过滤条件的人需要先读完它们：
 *
 * 1. `targetSurfaceIds` 硬过滤 → 模型兜底 Facet 把它填成**当前页面**（用户此刻站在哪儿，
 *    不是任务要求）。实测 targetSurfaceIds=['workspace.generation'] 时 camera_stage 的能力
 *    被全部筛掉，用户问三维，租到的全是生成任务查询。
 * 2. `entityTypes` 硬过滤 → 域会被放宽（延续证据、路由域、模型自报），实体清单却不会跟着变。
 *    实测 domains 正确放宽成 ['diagnostics','camera_stage']、entityTypes 还是
 *    ['diagnostics.event']，camera_stage 能力一个都匹配不上，发现返回 0 项，整次运行卡死。
 * 3. `capabilityKinds` 硬过滤 → 模型声明的 kinds 是 observe/query/plan/mutate，而唯一能在场景
 *    里创建对象的 place_camera_stage_object 声明的 effect 是 execute。用词对不上，能力消失：
 *    camera_stage 的 13 个能力进来 11 个，恰好少了能干活的那一个。
 * 4. 「导航 Facet 时按 Surface 硬过滤」→ 上面第 1 条打的补丁本身又是同一个坑。模型完全可能
 *    声明一个 kinds=['navigate','mutate']、targetSurfaceId=当前页面的混合 Facet，那一刻
 *    第 1 条的场景原样复现。
 *
 * 每次修完都只堵住了当次那一条，因为**过滤这个动作本身**才是错的：这些字段全部来自模型对
 * 任务的猜测，猜错的代价不该是能力消失。域是唯一由注册表定义、模型只是转述的字段，所以它
 * 留下；其余交给 entityTypeScore 与语义查询排序，再由 pairReadAndWriteByEntity 兜底——
 * 排错顺序只是慢一点，过滤错了是直接没有。
 *
 * 见 capability-reachability.test.ts：那条门禁会枚举全部能力 × 全部域，并把实体一律填错，
 * 任何一处重新变成硬过滤都会当场变红。
 */
function structuralMatch(
  request: ApplicationCapabilityDiscoveryInput,
  indexed: IndexedCapability
): boolean {
  return request.domains.length === 0
    || request.domains.includes(indexed.entry.domain)
    || request.domains.includes(indexed.entry.category)
}

/** 请求点名的实体是否被这个能力覆盖；命中的排在前面。 */
function entityTypeScore(
  request: ApplicationCapabilityDiscoveryInput,
  indexed: IndexedCapability
): boolean {
  return request.entityTypes.length > 0
    && request.entityTypes.some((entityType) => indexed.match.entityTypes.includes(entityType))
}

/**
 * 保证每个被点名的实体在投影里**读写成对**。
 *
 * 替代的是 `requiredEffectScore`。那个函数存在的唯一理由，注释写得很清楚：带
 * verificationRequired 的 Effect 必须拿到观察证据才算完成，而只读的 observe/verify 能力
 * 因为 0 分被字母序挤进 deferred，Facet 于是永远停在 active、依赖前沿再也不推进。
 *
 * 但它的输入 `requiredEffects` 是运行时代填的——模型写不出来，所以旧实现必须强行改写模型的
 * 请求，才轮得到这个分数生效。整条链路是为了喂饱一个模型看不见的字段而存在的。
 *
 * 换成一条**从注册表推导**的结构规则：脚本要写就得先读（拿 ref、读回验证），要读也常常
 * 需要写（否则这次发现没意义）。所以对每个点名实体，至少保证一个只读能力和一个写能力进入
 * 投影，剩余名额再按分数补齐。这条规则不依赖模型的任何猜测，可以穷举验证。
 *
 * **它只在名额不够分时才真正生效**：当前目录规模下排序已经把实体命中的能力全放进来了，
 * 撤掉这个函数测试也不会变红。保留它是因为名额是固定的而目录会增长——某个实体的能力数
 * 一旦超过预算，按字母序被切掉的很可能恰好是那个写能力。见测试里用小 limit 直接验证。
 */
export function pairReadAndWriteByEntity(
  request: ApplicationCapabilityDiscoveryInput,
  sorted: IndexedCapability[],
  limit: number
): string[] {
  const guaranteed: string[] = []
  for (const entityType of request.entityTypes) {
    const touching = sorted.filter((item) => item.match.entityTypes.includes(entityType))
    const readable = touching.find((item) => item.entry.readOnly)
    const writable = request.writes ? touching.find((item) => !item.entry.readOnly) : undefined
    for (const item of [readable, writable]) {
      if (item && !guaranteed.includes(item.entry.name)) guaranteed.push(item.entry.name)
    }
  }
  const rest = sorted
    .map((item) => item.entry.name)
    .filter((name) => !guaranteed.includes(name))
  return [...guaranteed, ...rest].slice(0, limit)
}

function observationSuggestions(request: ApplicationCapabilityDiscoveryInput): string[] {
  return unique([
    ...(request.entityTypes.length > 0
      ? [`先按 schemaRef 读取 ${request.entityTypes.join('、')} 的控制结构，再观察当前实体 revision。`]
      : []),
  ])
}

export class AgentCapabilityDiscoveryCatalog {
  private readonly cache = new Map<string, ApplicationCapabilityDiscoveryOutput>()

  constructor(private readonly registry: AgentToolRegistry) {}

  discover(
    runId: string,
    rawInput: ApplicationCapabilityDiscoveryInput,
    context: HostContextSnapshot | null
  ): ApplicationCapabilityDiscoveryOutput {
    const input = applicationCapabilityDiscoveryInputSchema.parse(rawInput)
    const fingerprint = digest({
      input,
      catalogRevision: context?.catalogRevision ?? null,
      availableCapabilities: [...(context?.availableCapabilities ?? [])].sort(),
    })
    const cacheKey = `${runId}:${fingerprint}`
    const cached = this.cache.get(cacheKey)
    if (cached) {
      const reused = applicationCapabilityDiscoveryOutputSchema.parse({ ...cached, reused: true })
      rememberHenjiScriptApiLease(runId, reused.scriptApi)
      return reused
    }

    const indexed = this.index(context)
    const matched = this.matchRequest(input, indexed, context)
    const allMatches = matched.names.flatMap((name) => {
      const item = indexed.find((candidate) => candidate.entry.name === name)
      return item ? [item.match] : []
    })
    const capabilities = allMatches.slice(input.cursor, input.cursor + input.limit)
    const nextCursor = input.cursor + capabilities.length < allMatches.length
      ? input.cursor + capabilities.length
      : null
    const leaseSelection = selectLeaseableToolNames(this.registry, context, matched.leaseCandidates)
    const leasedToolNames = leaseSelection.leasedToolNames
    const leasedNameSet = new Set(leasedToolNames)
    const scriptMatches = allMatches.filter((item) => leasedNameSet.has(item.name))
    const availableNames = new Set(this.registry.list(context).map((entry) => entry.name))
    /*
     * Recipe 覆盖判定改由「点名实体」驱动。
     *
     * 旧实现按 requiredEffects 做贪心集合覆盖——那份 Effect 是运行时代填的，模型写不出来。
     * 现在只问一个可从注册表回答的问题：这条 Recipe 碰的实体是不是本次任务点名的实体之一。
     */
    const scriptRecipes = HENJI_RECIPE_REGISTRY.list(new Set(input.domains)).filter((recipe) => (
      recipe.actionIds.every((actionId) => availableNames.has(actionId))
    ))
    const applicableScriptRecipes = input.entityTypes.length === 0
      ? scriptRecipes
      : scriptRecipes.filter((recipe) => recipe.covers.some((covered) => (
        covered.entityTypes.some((entityType) => input.entityTypes.includes(entityType))
      )))
    const recipeCoveredEntityTypes = new Set(applicableScriptRecipes.flatMap((recipe) => (
      recipe.covers.flatMap((covered) => covered.entityTypes)
    )))
    const recipesCoverAllRequestedEntities = input.entityTypes.length > 0
      && applicableScriptRecipes.length > 0
      && input.entityTypes.every((entityType) => recipeCoveredEntityTypes.has(entityType))
    /*
     * scriptApi 里的实体与属性清单**只能来自注册表**，绝不能回声模型自己写的请求。
     *
     * 这里曾经把 `input.entityTypes` 和从 `input.queries` 里正则抠出来的点分标识符一起并进
     * 清单。那等于把模型的**提问**当成**事实**答复回去：模型问"有没有 settings.preference"，
     * 投影回答"你的实体清单是：settings.preference、settings.registry…"，模型当然就照着写脚本，
     * 然后撞 ENTITY_TYPE_NOT_FOUND。实测这条让一次改设置的任务从 5 回合 3.8 万 token 变成
     * 18 回合 25 万 token，中间四次重新发现能力都纠正不过来——因为每次发现都在重复同一个谎。
     *
     * 清单短一点没关系：模型看不到某个实体，它会去发现；模型看到一个不存在的实体，它会一直
     * 撞墙。宁可少说，不能乱说。
     */
    const scriptEntityTypes = unique(scriptMatches.flatMap((item) => item.entityTypes)).slice(0, 64)
    const scriptPropertyIds = unique(scriptMatches.flatMap((item) => item.propertyIds)).slice(0, 256)
    const deferredToolNames = unique([
      ...leaseSelection.deferredToolNames,
      ...matched.names.filter((name) => !leasedNameSet.has(name)),
    ])
    const output = applicationCapabilityDiscoveryOutputSchema.parse({
      discoveryVersion: APPLICATION_CAPABILITY_DISCOVERY_VERSION,
      catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
      fingerprint,
      reused: false,
      capabilities,
      observationSuggestions: observationSuggestions(input).slice(0, 16),
      missing: matched.names.length > 0 ? [] : [{
        reason: matched.missingReason,
        requestedDomains: input.domains,
        requestedEntityTypes: input.entityTypes,
      }],
      leasedToolNames: leasedToolNames.filter((name) => ![
        'discover_application_capabilities', 'search_application_capabilities',
      ].includes(name)),
      deferredToolNames: deferredToolNames.slice(0, 100),
      deferredCount: deferredToolNames.length,
      scriptApi: {
        language: 'henji-ts/v1',
        entryTool: 'run_henji_script',
        forbiddenEffects: [],
        rules: [...HENJI_SCRIPT_LANGUAGE_RULES],
        entities: {
          methods: ['list', 'read', 'create', 'update', 'remove'],
          entityTypes: scriptEntityTypes,
          propertyIds: scriptPropertyIds,
          entityDefinitions: [],
          propertyDefinitions: [],
        },
        assertions: {
          equal: 'app.assert.equal(actual, expected)',
          exists: 'app.assert.exists(value)',
          absent: 'app.assert.absent(value)',
          matches: 'app.assert.matches(value, pattern)',
        },
        /*
         * 配方能覆盖全部点名实体时不再倾倒低层 action——这是**体积即行为**。
         *
         * 我一度把两者都给出，理由是"模型自己选更省一轮试错"。实测相反：三维场景投影
         * 22,477 字节、画布 28,242 字节，都越过 19,200 的卸载阈值，于是发现结果被存成
         * artifact，模型只能 read_agent_artifact 一页页读回来——一次运行 18 次回读、9 轮
         * 仍未收敛。给得越多，模型实际看到的越少。
         *
         * 覆盖判定改用 entityTypes（v3 请求里模型真写得出来的字段），不再用运行时代填的
         * requiredEffects。判定保守：只有请求点了名、且每个点名实体都被某条配方覆盖时才抑制；
         * 有一个没覆盖到就照常给 action。配方的容量上限由 recipes[].limits 交给模型自己判断。
         */
        actions: (recipesCoverAllRequestedEntities ? [] : scriptMatches).flatMap((item) => {
          if (SCRIPT_INTERNAL_CAPABILITIES.has(item.name)) return []
          const definition = this.registry.get(item.name)
          return definition ? [{
            id: item.name,
            title: item.title,
            parameters: definition.aiInputSchema,
            returns: publicResultShape(definition.outputSchema),
          }] : []
        }).slice(0, 32),
        recipes: applicableScriptRecipes.map((recipe) => ({
          id: recipe.id, title: recipe.title, parameters: recipe.parameters,
          returns: { fields: ['resultRefs'], hasResultRefs: true },
          verification: [...recipe.verification],
          // 容量上限如实给出，让模型自己判断这条 Recipe 装不装得下本次任务。
          limits: recipe.covers.map((covered) => ({
            effect: covered.effect,
            entityTypes: [...covered.entityTypes],
            maximumCount: covered.maximumCount,
          })).slice(0, 16),
        })).slice(0, 16),
      },
      page: {
        returnedItems: capabilities.length,
        nextCursor,
        hasMore: nextCursor !== null,
      },
    })
    this.cache.set(cacheKey, output)
    rememberHenjiScriptApiLease(runId, output.scriptApi)
    return output
  }

  readSchemas(rawInput: ApplicationSchemaReadInput): ApplicationSchemaReadOutput {
    const input = applicationSchemaReadInputSchema.parse(rawInput)
    const definitions = new Map(this.registry.allDefinitions().map((definition) => [definition.name, definition]))
    const documents: ApplicationSchemaReadOutput['documents'] = []
    const missing: ApplicationSchemaRef[] = []
    for (const ref of input.refs) {
      const definition = definitions.get(ref.id)
      if (!definition || ref.kind !== 'operation') {
        missing.push(ref)
        continue
      }
      const expected = operationSchemaRef(definition)
      if (expected.catalogVersion !== ref.catalogVersion
        || expected.version !== ref.version
        || expected.digest !== ref.digest) {
        missing.push(ref)
        continue
      }
      documents.push({ ref: expected, inputSchema: definition.aiInputSchema })
    }
    return applicationSchemaReadOutputSchema.parse({
      catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
      documents,
      missing,
    })
  }

  /** 忽略宿主可用性的全量索引，只用于判定「是不是真的被权限过滤掉了」。 */
  private indexAll(): IndexedCapability[] {
    return this.index(null)
  }

  private index(context: HostContextSnapshot | null): IndexedCapability[] {
    const definitions = new Map(this.registry.allDefinitions().map((definition) => [definition.name, definition]))
    return this.registry.list(context).flatMap((entry) => {
      const definition = definitions.get(entry.name)
      if (!definition || entry.risk === 'R4') return []
      return [{
        entry,
        definition,
        match: {
          name: entry.name,
          capabilityId: entry.capabilityId,
          version: entry.version,
          title: entry.title,
          description: entry.description,
          domain: entry.domain,
          category: entry.category,
          readOnly: entry.readOnly,
          risk: entry.risk,
          entityTypes: entityTypes(definition, entry),
          propertyIds: propertyIds(definition),
          surfaceIds: surfaceIds(entry),
          schemaRef: operationSchemaRef(definition),
        },
      }]
    })
  }

  /**
   * 一次扁平匹配。准入只有域，其余全是排序信号。
   *
   * `structuralMatch` 保持原样——它上面那段注释记录了四次同形事故（surface / entityTypes /
   * capabilityKinds / 导航 surface 分别被当成硬过滤，导致已注册能力对模型隐身）。
   * 每次修都只堵住当次那一条，因为**过滤这个动作本身**才是错的。
   */
  private matchRequest(
    request: ApplicationCapabilityDiscoveryInput,
    indexed: IndexedCapability[],
    context: HostContextSnapshot | null
  ): {
    names: string[]
    leaseCandidates: string[]
    missingReason: 'no_matching_capability' | 'permission_filtered' | 'unsupported_domain'
  } {
    const semanticNames = new Set(request.queries.flatMap((query) => (
      this.registry.search(query, undefined, context, 100).map((entry) => entry.name)
    )))
    const hasStructuralFilter = request.domains.length > 0 || request.entityTypes.length > 0
    const candidates = indexed.filter((item) => (
      structuralMatch(request, item)
      && (hasStructuralFilter || semanticNames.has(item.entry.name))
    ))
    const sorted = [...candidates].sort((left, right) => (
      Number(entityTypeScore(request, right)) - Number(entityTypeScore(request, left))
      || Number(semanticNames.has(right.entry.name)) - Number(semanticNames.has(left.entry.name))
      || left.entry.name.localeCompare(right.entry.name)
    ))
    const knownDomains = new Set(this.registry.allDefinitions().flatMap((definition) => [
      definition.category,
      definition.capability?.domain ?? definition.category,
    ]))
    const unsupported = request.domains.length > 0
      && request.domains.every((domain) => !knownDomains.has(domain))
    /*
     * permission_filtered 必须真的是权限造成的。
     *
     * 旧判定是"本轮没匹配到 && 存在同域定义"——只要那个域有任何能力存在就报权限过滤。实测
     * 一次 0 命中被报成 permission_filtered，助手照着这个标签编出了"需要先授权 3D 对象写入
     * 能力"这个根本不存在的原因，还建议用户去授权。错误标签比没有标签更贵：它会被当成事实
     * 写进答复。正确判定只有一种：忽略宿主可用性重新匹配一遍，能匹配上才是真被过滤了。
     */
    const permissionFiltered = sorted.length === 0
      && this.indexAll().some((candidate) => structuralMatch(request, candidate))
    return {
      names: sorted.map((item) => item.entry.name),
      leaseCandidates: pairReadAndWriteByEntity(request, sorted, AGENT_DISCOVERY_LEASE_TOOL_LIMIT),
      missingReason: unsupported
        ? 'unsupported_domain'
        : permissionFiltered ? 'permission_filtered' : 'no_matching_capability',
    }
  }
}


