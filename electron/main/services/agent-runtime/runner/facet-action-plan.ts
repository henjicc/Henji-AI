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

export function prepareDeclaredActionPlan(input: {
  declaration: unknown
  taskGraph: AgentTaskGraph
  facets: Map<string, AgentTaskFacet>
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
      issues.push({
        code: 'UNKNOWN_FACET', path: `facets.${index}.facetId`,
        message: `Facet ${facetDeclaration.facetId} 不存在；当前可声明：${available.join('、') || '无'}`,
      })
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
  const mergedFacets = input.taskGraph.facets.map((facet) => (
    replacements.get(facet.facetId) ?? input.facets.get(facet.facetId) ?? facet
  ))
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
