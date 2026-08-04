import {
  agentTaskGraphSchema,
  type AgentObservedEffect,
  type AgentTaskActionGroup,
  type AgentTaskFacet,
  type AgentTaskGraph,
} from '../../../../../src/core/assistant/taskGraph'
import type { ModelStepToolCall } from '../../../../../src/core/llm/modelStep'
import type { AgentToolRegistry } from '../tools/registry'
import {
  asRecord,
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

export function parseDeclaredActionPlan(input: {
  output: unknown
  taskGraph: AgentTaskGraph
  facets: Map<string, AgentTaskFacet>
}): { taskGraph: AgentTaskGraph; declaredFacetIds: Set<string> } | null {
  const record = asRecord(input.output)
  if (record?.accepted !== true
    || !Array.isArray(record.facets)
    || !Array.isArray(record.actionGroups)) return null
  const replacements = new Map<string, AgentTaskFacet>()
  for (const rawFacet of record.facets) {
    const declaration = asRecord(rawFacet)
    if (typeof declaration?.facetId !== 'string'
      || !Array.isArray(declaration.requiredEffects)) return null
    const current = input.facets.get(declaration.facetId)
    if (!current || isTerminal(current.status)) return null
    replacements.set(declaration.facetId, {
      ...current,
      requiredEffects: declaration.requiredEffects,
    } as AgentTaskFacet)
  }
  const declaredFacetIds = new Set(replacements.keys())
  const candidate = agentTaskGraphSchema.safeParse({
    ...input.taskGraph,
    facets: input.taskGraph.facets.map((facet) => replacements.get(facet.facetId) ?? facet),
    actionGroups: [
      ...input.taskGraph.actionGroups.filter((group) => !declaredFacetIds.has(group.facetId)),
      ...record.actionGroups,
    ],
  })
  return candidate.success
    ? { taskGraph: candidate.data, declaredFacetIds }
    : null
}
