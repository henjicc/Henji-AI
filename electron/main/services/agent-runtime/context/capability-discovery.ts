import { createHash } from 'node:crypto'

import {
  AGENT_DISCOVERY_LEASE_TOOL_LIMIT,
  AGENT_FACET_LEASE_TOOL_LIMIT,
} from '../../../../../src/core/assistant/toolBudget'
import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolCatalogEntry } from '../../../../../src/core/assistant/toolContracts'
import {
  APPLICATION_CAPABILITY_DISCOVERY_VERSION,
  applicationCapabilityDiscoveryInputSchema,
  applicationCapabilityDiscoveryOutputSchema,
  applicationSchemaReadInputSchema,
  applicationSchemaReadOutputSchema,
  type ApplicationCapabilityDiscoveryFacet,
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

/**
 * Facet 点名了实体时，被放宽进来的域最多补几个租约。
 *
 * 存在的意义是给"被放宽进来的域"留一条活路：域放宽（延续证据、路由域、模型自报）之后，新域的
 * 能力通常命不中原 Facet 的实体，但它们恰恰是这次放宽想要的东西。
 *
 * 名额由 Facet 租约上限推导而不是拍一个数：一个新域至少要凑齐「观察 → 写入 → 验证」这个最小
 * 闭包才有用，三分之一的名额正好覆盖它，同时不至于挤掉别的 Facet。
 */
const LEASE_TAIL_LIMIT = Math.max(3, Math.floor(AGENT_FACET_LEASE_TOOL_LIMIT / 3))

const surfaceIdsByDomain: Readonly<Record<string, string[]>> = {
  application: [],
  navigation: [],
  models: ['settings.models', 'workspace.generation'],
  generation: ['workspace.generation'],
  canvas: ['workspace.canvas'],
  toolbox: ['workspace.tools'],
  camera_stage: ['tool.camera_stage'],
  storyboard: ['workspace.canvas'],
  image_edit: ['tool.image_edit'],
  assets: ['workspace.assets', 'overlay.assets'],
  workflows: ['workspace.canvas'],
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

function capabilityKindMatches(
  facet: ApplicationCapabilityDiscoveryFacet,
  indexed: IndexedCapability
): boolean {
  if (facet.capabilityKinds.length === 0) return true
  return facet.capabilityKinds.some((kind) => {
    const impacts = indexed.definition.capability?.control?.impacts ?? []
    if (kind === 'observe' || kind === 'query') {
      return indexed.entry.readOnly && impacts.some((impact) => impact.effect === 'observe')
    }
    if (kind === 'navigate') return impacts.some((impact) => impact.effect === 'navigate')
    if (kind === 'plan') {
      return indexed.entry.readOnly && (
        indexed.entry.supportsPreview
        || /^(?:plan|prepare|search|get|list)_/.test(indexed.entry.name)
      )
    }
    if (kind === 'mutate') return impacts.some((impact) => (
      ['create', 'update', 'delete'].includes(impact.effect)
    ))
    return impacts.some((impact) => impact.effect === 'execute')
  })
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
 * 留下；其余交给 requiredEffectScore / entityTypeScore / capabilityKindMatches / targetSurfaceScore
 * 排序——排错顺序只是慢一点，过滤错了是直接没有。
 *
 * 见 capability-reachability.test.ts：那条门禁会枚举全部能力 × 全部 kind 组合，任何一处
 * 重新变成硬过滤都会当场变红。
 */
function structuralMatch(
  facet: ApplicationCapabilityDiscoveryFacet,
  indexed: IndexedCapability
): boolean {
  /*
   * 目标 Surface 命中时放宽域要求（仅限导航 Facet）——这是放宽，不是过滤。
   *
   * "打开三维编辑器"这个 Facet 的 domain 是 navigation，而真正能打开它的
   * open_camera_stage_project 的 domain 是 camera_stage：不放宽就永远租不到，模型只剩通用的
   * switch_workspace，切到工具工作区就停了。
   */
  const surfaceIsTheGoal = facet.capabilityKinds.includes('navigate')
  const surfaceMatches = facet.targetSurfaceIds.length > 0
    && facet.targetSurfaceIds.some((surfaceId) => indexed.match.surfaceIds.includes(surfaceId))
  return facet.domains.length === 0
    || facet.domains.includes(indexed.entry.domain)
    || facet.domains.includes(indexed.entry.category)
    || (surfaceIsTheGoal && surfaceMatches)
}

/** Facet 点名的实体是否被这个能力覆盖；命中的排在前面。 */
function entityTypeScore(
  facet: ApplicationCapabilityDiscoveryFacet,
  indexed: IndexedCapability
): boolean {
  return facet.entityTypes.length > 0
    && facet.entityTypes.some((entityType) => indexed.match.entityTypes.includes(entityType))
}

/**
 * 租约名额（每个 Facet 只有 AGENT_FACET_LEASE_TOOL_LIMIT 个）按这个分数发放。
 *
 * 除了"能直接产生所需 effect"的写入能力，**能观察同一实体的只读能力同样必须进租约**：带
 * verificationRequired 的 Effect 只有拿到观察证据才算完成，Facet 完成才轮到下游前沿。实测里
 * 只读的 observe/verify 因为 0 分被字母序挤进 deferred，于是 camera_project 永远停在 active、
 * 依赖前沿再也不推进，整次运行卡死在"允许：无"。
 */
function requiredEffectScore(
  facet: ApplicationCapabilityDiscoveryFacet,
  indexed: IndexedCapability
): number {
  const requiredEffects = facet.requiredEffects ?? []
  if (requiredEffects.length === 0) return 0
  return requiredEffects.reduce((total, required) => {
    const quality = (indexed.definition.capability?.control?.impacts ?? []).reduce((best, impact) => {
      const entityMatch = required.entityTypes.length === 0
        || impact.entityTypes.length === 0
        || required.entityTypes.some((entityType) => impact.entityTypes.includes(entityType))
      if (!entityMatch) return best
      if (impact.effect === 'observe' && required.effect !== 'observe') {
        // 验证观察能力：排在直接写入能力之后、无关能力之前。
        return Math.max(best, indexed.entry.readOnly ? 2 : 0)
      }
      if (impact.effect !== required.effect) return best
      const propertyMatch = required.propertyIds.length === 0
        || impact.propertyIds.length === 0
        || required.propertyIds.some((propertyId) => impact.propertyIds.includes(propertyId))
      if (!propertyMatch) return best
      // 明确声明实体/属性的正式能力优先于开放世界通用动词；后者仍可作为兜底。
      return Math.max(best, impact.entityTypes.length > 0 ? 3 : 1)
    }, 0)
    return total + quality
  }, 0)
}

function targetSurfaceScore(
  facet: ApplicationCapabilityDiscoveryFacet,
  indexed: IndexedCapability
): boolean {
  return facet.targetSurfaceIds.length > 0
    && facet.targetSurfaceIds.some((surfaceId) => indexed.match.surfaceIds.includes(surfaceId))
}

function observationSuggestions(facet: ApplicationCapabilityDiscoveryFacet): string[] {
  return unique([
    ...(facet.entityTypes.length > 0
      ? [`先按 schemaRef 读取 ${facet.entityTypes.join('、')} 的控制结构，再观察当前实体 revision。`]
      : []),
    ...(facet.targetSurfaceIds.length > 0
      ? [`仅在用户要求查看或定位时打开 ${facet.targetSurfaceIds.join('、')}。`]
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
    if (cached) return applicationCapabilityDiscoveryOutputSchema.parse({ ...cached, reused: true })

    const indexed = this.index(context)
    const facetResults = input.facets.map((facet) => this.matchFacet(facet, indexed, context))
    const capabilityNames = unique(facetResults.flatMap((item) => item.names))
    const allMatches = capabilityNames.flatMap((name) => {
      const item = indexed.find((candidate) => candidate.entry.name === name)
      return item ? [item.match] : []
    })
    const capabilities = allMatches.slice(input.cursor, input.cursor + input.limit)
    const nextCursor = input.cursor + capabilities.length < allMatches.length
      ? input.cursor + capabilities.length
      : null
    /*
     * 发现范围可以放宽，租约名额不能跟着稀释——但也不能反过来把别的域饿死。
     *
     * entityTypes 从硬过滤降级成排序信号之后，一个 Facet 匹配到的能力从"只有实体命中的"变成
     * "整个域的"，直接 slice(0, 12) 会把同域里不相干的能力也塞满租约（实测租约数 15 → 17）。
     * 但反过来"只发给实体命中的"同样错：diagnose Facet 的实体是 diagnostics.event，被放宽进来的
     * camera_stage 能力一个都命中不了，于是又回到 0 个 camera_stage 租约——换个地方复现同一个
     * 死锁。
     *
     * 所以是"优先 + 有限补位"：实体命中的先占，剩下的按排序补至多 LEASE_TAIL_LIMIT 个。放宽域
     * 至少拿得到几个能用的能力，又不会挤掉别的 Facet。
     */
    const leaseCandidates = unique(facetResults.flatMap((item) => {
      if (item.facet.entityTypes.length === 0) return item.names.slice(0, AGENT_FACET_LEASE_TOOL_LIMIT)
      const matched = item.names.filter((name) => item.entityMatchedNames.has(name))
      // 补位只发给被放宽进来的域。Facet 自己的域已经由实体命中覆盖，再补进来的都是同域里
      // 不相干的能力（改名、删除工程之类），白占名额。
      const widened = item.names.filter((name) => (
        !item.entityMatchedNames.has(name) && item.widenedDomainNames.has(name)
      ))
      return [
        ...matched.slice(0, AGENT_FACET_LEASE_TOOL_LIMIT),
        ...widened.slice(0, LEASE_TAIL_LIMIT),
      ].slice(0, AGENT_FACET_LEASE_TOOL_LIMIT)
    })).slice(0, AGENT_DISCOVERY_LEASE_TOOL_LIMIT)
    const leaseSelection = selectLeaseableToolNames(this.registry, context, leaseCandidates)
    const leasedToolNames = leaseSelection.leasedToolNames
    const leasedNameSet = new Set(leasedToolNames)
    const deferredToolNames = unique([
      ...leaseSelection.deferredToolNames,
      ...capabilityNames.filter((name) => !leasedNameSet.has(name)),
    ])
    const output = applicationCapabilityDiscoveryOutputSchema.parse({
      discoveryVersion: APPLICATION_CAPABILITY_DISCOVERY_VERSION,
      catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
      fingerprint,
      reused: false,
      capabilities,
      facets: facetResults.map((item) => ({
        facetId: item.facet.facetId,
        capabilityNames: item.names.filter((name) => leasedNameSet.has(name)),
        schemaRefs: item.names.flatMap((name, index) => (
          leasedNameSet.has(name) ? [item.schemaRefs[index]] : []
        )).filter((ref): ref is ApplicationSchemaRef => Boolean(ref)),
        observationSuggestions: [
          ...observationSuggestions(item.facet),
          ...(item.kindsRelaxed
            ? [`返回的能力里没有一个属于 ${item.facet.capabilityKinds.join('、')}，已放宽能力类型过滤；`
              + '这批能力可能不是该 Facet 最贴切的类型，提交写入前请确认它的 effect 与目标一致。']
            : []),
        ].slice(0, 16),
      })),
      missing: facetResults.flatMap((item) => item.names.length > 0 ? [] : [{
        facetId: item.facet.facetId,
        reason: item.missingReason,
        requestedDomains: item.facet.domains,
        requestedEntityTypes: item.facet.entityTypes,
      }]),
      leasedToolNames: leasedToolNames.filter((name) => ![
        'discover_application_capabilities', 'search_application_capabilities',
      ].includes(name)),
      deferredToolNames: deferredToolNames.slice(0, 100),
      deferredCount: deferredToolNames.length,
      page: {
        returnedItems: capabilities.length,
        nextCursor,
        hasMore: nextCursor !== null,
      },
    })
    this.cache.set(cacheKey, output)
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

  private matchFacet(
    facet: ApplicationCapabilityDiscoveryFacet,
    indexed: IndexedCapability[],
    context: HostContextSnapshot | null
  ): {
    facet: ApplicationCapabilityDiscoveryFacet
    names: string[]
    /** 其中真正覆盖了 Facet 点名实体的能力；租约名额优先发给它们。 */
    entityMatchedNames: Set<string>
    /**
     * 来自「被放宽进来的域」的能力，即 Facet 自身领域之外的那些。
     *
     * `buildCapabilityDiscoveryInputForFacets` 按 `[facet.domain, ...extraDomains]` 构造 domains，
     * 首项恒为 Facet 自身领域；其余都是延续证据、路由域或模型自报带进来的。
     */
    widenedDomainNames: Set<string>
    /** 返回的能力里没有一个符合声明的 capabilityKinds。要如实告诉模型。 */
    kindsRelaxed: boolean
    schemaRefs: ApplicationSchemaRef[]
    missingReason: 'no_matching_capability' | 'permission_filtered' | 'unsupported_domain'
  } {
    const semanticNames = new Set(facet.queries.flatMap((query) => (
      this.registry.search(query, undefined, context, 100).map((entry) => entry.name)
    )))
    /*
     * capabilityKinds 不再算「结构过滤」：它已经降级成排序信号（见 structuralMatch），
     * 留在这里会让「只声明了 queries + kinds」的 Facet 变成完全不过滤。
     */
    const hasStructuralFilter = facet.domains.length > 0
      || facet.entityTypes.length > 0
      || facet.targetSurfaceIds.length > 0
    const passes = (item: IndexedCapability): boolean => (
      structuralMatch(facet, item)
      && (facet.queries.length === 0 || hasStructuralFilter || semanticNames.has(item.entry.name))
    )
    const candidates = indexed.filter(passes)
    /*
     * kind 不再决定去留，但仍要如实告诉模型「这批能力里没有一个是你声明的类型」——
     * 它多半意味着这个 Facet 的 kinds 或域填错了，提交写入前该自己核对一遍 effect。
     */
    const kindsRelaxed = facet.capabilityKinds.length > 0
      && candidates.length > 0
      && !candidates.some((item) => capabilityKindMatches(facet, item))
    const matches = candidates
      .sort((left, right) => (
      requiredEffectScore(facet, right) - requiredEffectScore(facet, left)
      // entityTypes 从硬过滤降级成排序信号后，命中实体的能力必须仍然排在最前，否则租约名额
      // 会被同域里不相干的能力占掉。
      || Number(entityTypeScore(facet, right)) - Number(entityTypeScore(facet, left))
      // kind 从准入降级到这里：类型对得上的排在前面，对不上的仍然拿得到名额。
      || Number(capabilityKindMatches(facet, right)) - Number(capabilityKindMatches(facet, left))
      // 能真正到达目标 Surface 的能力优先于通用导航，否则"打开三维编辑器"会退化成切工作区。
      || Number(targetSurfaceScore(facet, right)) - Number(targetSurfaceScore(facet, left))
      || Number(semanticNames.has(right.entry.name)) - Number(semanticNames.has(left.entry.name))
      || left.entry.name.localeCompare(right.entry.name)
    ))
    const knownDomains = new Set(this.registry.allDefinitions().flatMap((definition) => [
      definition.category,
      definition.capability?.domain ?? definition.category,
    ]))
    const unsupported = facet.domains.length > 0 && facet.domains.every((domain) => !knownDomains.has(domain))
    /*
     * permission_filtered 必须真的是权限造成的。
     *
     * 旧判定是"本轮没匹配到 && 存在同域定义"——只要那个域有任何能力存在就报权限过滤。实测
     * 一次 diagnose Facet 因为 entityTypes 不匹配而 0 命中，被报成 permission_filtered，助手照着
     * 这个标签给用户编出了"需要先授权 3D 对象写入能力"这个根本不存在的原因，还建议用户去授权。
     * 错误标签比没有标签更贵：它会被当成事实写进答复。
     *
     * 正确判定只有一种：忽略宿主可用性重新匹配一遍，能匹配上就说明确实是被过滤掉了。
     */
    const permissionFiltered = matches.length === 0
      && this.indexAll().some((candidate) => structuralMatch(facet, candidate))
    return {
      facet,
      kindsRelaxed,
      names: matches.map((item) => item.entry.name),
      entityMatchedNames: new Set(matches
        .filter((item) => entityTypeScore(facet, item))
        .map((item) => item.entry.name)),
      widenedDomainNames: new Set(matches
        .filter((item) => facet.domains.length > 1
          && item.entry.domain !== facet.domains[0]
          && item.entry.category !== facet.domains[0])
        .map((item) => item.entry.name)),
      schemaRefs: matches.map((item) => item.match.schemaRef),
      missingReason: unsupported
        ? 'unsupported_domain'
        : permissionFiltered ? 'permission_filtered' : 'no_matching_capability',
    }
  }
}
