import {
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

export function potentialEffectsForCall(
  registry: AgentToolRegistry,
  call: ModelStepToolCall,
): AgentObservedEffect[] {
  const declaredImpacts = (toolName: string) => registry.get(toolName)?.capability?.control?.impacts ?? []
  const impacts = declaredImpacts(call.toolName)
  return impacts.map((impact) => ({
    effect: impact.effect,
    entityTypes: impact.entityTypes,
    propertyIds: impact.propertyIds,
    targetRefs: [],
    count: 1,
    verified: false,
    evidence: [],
  }))
}

export function resolveActionGroupForCall(input: {
  call: ModelStepToolCall
  taskGraph: AgentTaskGraph
  matchingFacets: AgentTaskFacet[]
  registry: AgentToolRegistry
}): Pick<AgentTaskActionGroup, 'actionGroupId' | 'mode'> | null {
  const effects = potentialEffectsForCall(input.registry, input.call)
  if (effects.length === 0) return null
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
  // 单次原子写入已经能由下方的 effect/entity/property 匹配精确约束，不能仅因任务是
  // multi_step 且当前只剩一个 Facet，就强迫模型再声明一遍同义计划。
  if (writeCallCount <= 1) return true
  if (requiresExplicitActionPlan && totalPlannedEffects <= 1) return false
  const plannedWrites = activeEffects
    // 导航能力在工具元数据中是一次真实写调用（会改变当前工作区/焦点），因此上面的
    // writeCallCount 会把它计入。这里也必须按同一口径计数，否则同一响应里的
    // “打开工程 → 修改工程”即使两个 Effect 都已规划，仍会被误判少了一项计划。
    .filter((effect) => effect.effect !== 'observe')
    .reduce((count, effect) => count + effect.minimumCount, 0)
  return plannedWrites >= writeCallCount
}
