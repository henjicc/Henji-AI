import {
  agentActionPlanDeclarationInputSchema,
  agentTaskGraphSchema,
  deriveActionGroups,
  normalizeDeclaredRequiredEffects,
  type AgentActionPlanDeclaration,
  type AgentObservedEffect,
  type AgentTaskActionGroup,
  type AgentTaskFacet,
  type AgentTaskGraph,
} from '../../../../../src/core/assistant/taskGraph'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { AgentToolRegistry } from '../tools/registry'
import {
  isTerminal,
  potentialEffectMatches,
} from './facet-effect-ledger'

export function resolveActionGroupForCall(input: {
  call: ModelStepToolCall
  taskGraph: AgentTaskGraph
  matchingFacets: AgentTaskFacet[]
  registry: AgentToolRegistry
}): Pick<AgentTaskActionGroup, 'actionGroupId' | 'mode'> | null {
  const impacts = input.registry.get(input.call.toolName)?.capability?.control?.impacts
  if (!impacts) return null
  const effects: AgentObservedEffect[] = impacts.map((impact) => ({
    effect: impact.effect,
    entityTypes: impact.entityTypes,
    propertyIds: impact.propertyIds,
    targetRefs: [],
    count: 1,
    verified: false,
    evidence: [],
  }))
  const groupIds = new Set(input.matchingFacets.flatMap((facet) => (
    facet.requiredEffects.flatMap((required) => (
      effects.some((effect) => potentialEffectMatches(required, effect))
        ? [required.actionGroupId]
        : []
    ))
  )))
  if (groupIds.size !== 1) return null
  const actionGroupId = [...groupIds][0]
  const group = input.taskGraph.actionGroups.find((candidate) => (
    candidate.actionGroupId === actionGroupId
  ))
  return group ? { actionGroupId: group.actionGroupId, mode: group.mode } : null
}

export function hasSufficientActionPlan(
  facets: AgentTaskFacet[],
  requiresExplicitActionPlan: boolean,
  writeCallCount: number
): boolean {
  if (writeCallCount <= 0) return true
  const activeEffects = facets
    .filter((facet) => !isTerminal(facet.status))
    .flatMap((facet) => facet.requiredEffects)
  const totalPlannedEffects = activeEffects.reduce(
    (count, effect) => count + effect.minimumCount,
    0
  )
  if (requiresExplicitActionPlan && totalPlannedEffects <= 1) return false
  if (writeCallCount <= 1) return true
  const plannedWrites = activeEffects
    .filter((effect) => !['observe', 'navigate'].includes(effect.effect))
    .reduce((count, effect) => count + effect.minimumCount, 0)
  return plannedWrites >= writeCallCount
}

export interface DeclaredActionPlanIssue {
  code: 'INVALID_SCHEMA' | 'DUPLICATE_FACET' | 'UNKNOWN_FACET' | 'TERMINAL_FACET' | 'INVALID_TASK_GRAPH'
  path: string
  message: string
}

export type PreparedDeclaredActionPlan = {
  ok: true
  declaration: AgentActionPlanDeclaration
  taskGraph: AgentTaskGraph
  declaredFacetIds: Set<string>
} | {
  ok: false
  issues: DeclaredActionPlanIssue[]
}

function issuePath(path: PropertyKey[]): string {
  return path.map(String).join('.') || 'declaration'
}

function declarableFacetIds(facets: Map<string, AgentTaskFacet>): string[] {
  return [...facets.values()]
    .filter((facet) => !isTerminal(facet.status))
    .map((facet) => facet.facetId)
}

/** 一次运行里模型最多补建几个 Facet。防跑飞，不是防误用。 */
const DECLARABLE_NEW_FACET_LIMIT = 4

/**
 * 从声明的 Effect 实体类型反推领域：`camera_stage.object` → `camera_stage`。
 *
 * 领域必须来自真实注册表，模型编不出新领域；权限仍由网关与审批把关，这里只决定
 * "这个 Facet 属于哪一块"。
 */
function inferDeclaredDomain(
  effects: AgentTaskFacet['requiredEffects'],
  knownDomains: ReadonlySet<string>
): string | null {
  for (const effect of effects) {
    for (const entityType of effect.entityTypes) {
      const domain = entityType.includes('.') ? entityType.slice(0, entityType.indexOf('.')) : entityType
      if (knownDomains.has(domain)) return domain
    }
  }
  return null
}

function declaredCapabilityKinds(
  effects: AgentTaskFacet['requiredEffects']
): AgentTaskFacet['capabilityKinds'] {
  const kinds = new Set<AgentTaskFacet['capabilityKinds'][number]>()
  for (const effect of effects) {
    if (effect.effect === 'navigate') kinds.add('navigate')
    else if (effect.effect === 'execute') kinds.add('execute')
    else if (effect.effect === 'observe') kinds.add('observe')
    else kinds.add('mutate')
  }
  if (kinds.size === 0) kinds.add('observe')
  return [...kinds]
}

/**
 * 为路由漏掉的领域补建一个 Facet。
 *
 * **这是路由结论可被推翻的唯一入口，也是本模块存在的理由。**
 *
 * 路由用一个小模型、只看当前这句话和一份被裁过的宿主快照来定 intent，而 intent 决定任务图的
 * Facet 集合，Facet 集合又决定哪些能力发现得到——于是路由判错一次，整次运行就没有出口。实测
 * 连着三次都是这样：用户说「再帮我添加一个白色的球体」判成 generate、「你这不对吧」判成
 * diagnose、「你继续」判成 canvas，而上一轮三次都在 camera_stage。三次里主模型都读懂了用户
 * （它拿得到完整会话历史，路由拿不到），却没有任何入口去纠正那个判决，只能停下来解释自己
 * 被阻塞。
 *
 * 补建之后，路由判错的代价从"整次运行卡死"降到"多烧一轮"。
 */
function buildDeclaredFacet(
  facetId: string,
  effects: AgentTaskFacet['requiredEffects'],
  domain: string,
  goal: string
): AgentTaskFacet {
  const entityTypes = [...new Set(effects.flatMap((effect) => effect.entityTypes))]
  return {
    facetId,
    domain,
    goal: goal.slice(0, 1_000),
    targetEntityTypes: entityTypes,
    requiredObservations: [],
    capabilityKinds: declaredCapabilityKinds(effects),
    targetSurfaceId: null,
    dependsOn: [],
    parallelizable: false,
    completionConditions: ['目标动作具有结构化结果或明确的受阻说明。'],
    requiredEffects: effects,
    uncertainties: [],
    // 模型现场补声明的置信度低于路由与确定性规则给出的 Facet，排序时让位。
    confidence: 0.5,
    status: 'active',
    statusReason: '模型在执行中补声明的 Facet：路由未覆盖该领域。',
    evidence: [],
  }
}

export function prepareDeclaredActionPlan(input: {
  declaration: unknown
  taskGraph: AgentTaskGraph
  facets: Map<string, AgentTaskFacet>
  /** 注册表里真实存在的领域；模型只能在这些领域里补建 Facet。 */
  knownDomains?: ReadonlySet<string>
  /** 已经有过执行痕迹的 facetId；这些不允许作废。 */
  touchedFacetIds?: ReadonlySet<string>
}): PreparedDeclaredActionPlan {
  const available = declarableFacetIds(input.facets)
  const parsedDeclaration = agentActionPlanDeclarationInputSchema.safeParse(input.declaration)
  if (!parsedDeclaration.success) return {
    ok: false,
    issues: parsedDeclaration.error.issues.slice(0, 8).map((issue) => ({
      code: 'INVALID_SCHEMA',
      path: issuePath(issue.path),
      // 只回 "Invalid input" 的错误模型无法自纠；把可用 Facet 和最小形状一并给出。
      message: `${issue.message}；可声明的 facetId：${available.join('、') || '无'}；每个 facet 至少需要 {"facetId","requiredEffects":[{"effect","entityTypes","minimumCount"}]}`,
    })),
  }
  const declaration = parsedDeclaration.data
  const issues: DeclaredActionPlanIssue[] = []
  const replacements = new Map<string, AgentTaskFacet>()
  /** 本次声明里补建出来的新 Facet；它们不在原任务图里，合并时要追加。 */
  const added: AgentTaskFacet[] = []
  for (const [index, facetDeclaration] of declaration.facets.entries()) {
    if (replacements.has(facetDeclaration.facetId)) {
      issues.push({
        code: 'DUPLICATE_FACET', path: `facets.${index}.facetId`,
        message: `Facet ${facetDeclaration.facetId} 只能声明一次`,
      })
      continue
    }
    const current = input.facets.get(facetDeclaration.facetId)
    if (!current) {
      // 路由漏掉的领域在这里补建，而不是把模型顶回去——见 buildDeclaredFacet 的说明。
      const effects = normalizeDeclaredRequiredEffects(
        facetDeclaration.facetId,
        facetDeclaration.requiredEffects
      )
      const domain = inferDeclaredDomain(effects, input.knownDomains ?? new Set())
      if (!domain || added.length >= DECLARABLE_NEW_FACET_LIMIT) {
        issues.push({
          code: 'UNKNOWN_FACET', path: `facets.${index}.facetId`,
          message: domain
            ? `本次运行补声明的 Facet 已达上限 ${DECLARABLE_NEW_FACET_LIMIT} 个；当前可声明：${available.join('、') || '无'}`
            : `Facet ${facetDeclaration.facetId} 不存在，且 requiredEffects 的 entityTypes 未指向任何已注册领域；`
              + `补声明新 Facet 时请填写真实实体类型（形如 camera_stage.object），或改用当前可声明的：${available.join('、') || '无'}`,
        })
        continue
      }
      const created = buildDeclaredFacet(
        facetDeclaration.facetId,
        effects,
        domain,
        input.taskGraph.goal
      )
      added.push(created)
      replacements.set(facetDeclaration.facetId, created)
      continue
    }
    if (isTerminal(current.status)) {
      issues.push({
        code: 'TERMINAL_FACET', path: `facets.${index}.facetId`,
        message: `Facet ${facetDeclaration.facetId} 已进入终态，不能重写；当前可声明：${available.join('、') || '无'}`,
      })
      continue
    }
    replacements.set(facetDeclaration.facetId, {
      ...current,
      requiredEffects: normalizeDeclaredRequiredEffects(
        facetDeclaration.facetId,
        facetDeclaration.requiredEffects
      ),
    })
  }
  /*
   * 作废旧 Facet：两道守卫，缺一不可。
   *
   * 1. 必须同时补建了新 Facet——作废本身不是目的，"换一个正确的来做"才是。
   * 2. 目标 Facet 必须零证据、零执行痕迹——已经动过手的东西不能一句话抹掉。
   *
   * 少了任何一道，这个字段就变成"没做完也能收工"的后门。
   */
  const touched = input.touchedFacetIds ?? new Set<string>()
  const supersededFacetIds = new Set<string>()
  for (const [index, facetId] of declaration.supersededFacetIds.entries()) {
    const target = input.facets.get(facetId)
    const reason = !target
      ? `Facet ${facetId} 不存在`
      : added.length === 0
        ? '作废旧 Facet 时必须同时用新 facetId 补声明替代它的 Facet'
        : isTerminal(target.status)
          ? `Facet ${facetId} 已进入终态 ${target.status}`
          : target.evidence.length > 0 || touched.has(facetId)
            ? `Facet ${facetId} 已经产生过执行痕迹或证据，不能作废；请把它做完或如实说明受阻`
            : null
    if (reason) {
      issues.push({ code: 'UNKNOWN_FACET', path: `supersededFacetIds.${index}`, message: reason })
      continue
    }
    supersededFacetIds.add(facetId)
  }
  if (issues.length > 0) return { ok: false, issues }
  const declaredFacetIds = new Set(replacements.keys())
  /*
   * 合并时必须以**运行时实时状态**为准，不能拿 taskGraph 里那份初始副本。
   *
   * 追踪器把活动状态放在独立的 facets Map 里，this.taskGraph.facets 始终是任务开始时的快照
   * （status 全是 pending）。旧实现对未声明的 Facet 直接回退到快照，commitDeclaredActionPlan
   * 又用合并结果重建整个 Map——于是一次 declare_action_plan 会把所有已完成 Facet 打回 pending。
   *
   * 实测：6 个 Facet 全部完成过，但补声明关键帧计划时集体重置；之后有新工具调用的五个陆续
   * 重新完成，唯独 show_target_surface 早已导航完毕、不会再被触发，永远停在 pending，
   * 整次运行因此报"任务图仍有 1 个 Facet 未结算"。
   */
  const mergedFacets = [
    ...input.taskGraph.facets.map((facet) => {
      const current = replacements.get(facet.facetId) ?? input.facets.get(facet.facetId) ?? facet
      return supersededFacetIds.has(facet.facetId)
        ? {
            ...current,
            status: 'superseded' as const,
            statusReason: '路由领域判错，已由模型补声明的 Facet 取代。',
          }
        : current
    }),
    ...added,
  ]
  const candidate = agentTaskGraphSchema.safeParse({
    ...input.taskGraph,
    facets: mergedFacets,
    // 分组一律重新推导：模型不需要（也无法可靠地）维护 Facet × Effect × Group 的交叉引用。
    actionGroups: deriveActionGroups(mergedFacets),
  })
  if (!candidate.success) return {
    ok: false,
    issues: candidate.error.issues.slice(0, 8).map((issue) => ({
      code: 'INVALID_TASK_GRAPH',
      path: issuePath(issue.path),
      message: issue.message,
    })),
  }
  const normalizedDeclaration: AgentActionPlanDeclaration = {
    facets: [...replacements.values()].map((facet) => ({
      facetId: facet.facetId,
      requiredEffects: facet.requiredEffects,
    })),
    actionGroups: candidate.data.actionGroups.filter(
      (group) => declaredFacetIds.has(group.facetId)
    ),
  }
  return {
    ok: true,
    declaration: normalizedDeclaration,
    taskGraph: candidate.data,
    declaredFacetIds,
  }
}
