import {
  AGENT_SETTLEMENT_EVIDENCE_LIMIT,
  agentProgressSettlementSchema,
  type AgentProgressSettlement,
} from '../../../../../src/core/assistant/progress'
import {
  AGENT_TASK_FACET_LIMIT,
  type AgentTaskFacet,
} from '../../../../../src/core/assistant/taskGraph'
import { createMainLogger } from '../../logging'
import { isTerminal } from './facet-effect-ledger'

const logger = createMainLogger('main.agent_runtime')

function unsatisfiedDependencies(
  facet: AgentTaskFacet,
  facets: Map<string, AgentTaskFacet>
): string[] {
  return facet.dependsOn.flatMap((dependency) => {
    const target = facets.get(dependency)
    if (!target) return [`${dependency}（该 Facet 不存在）`]
    return target.status === 'completed' ? [] : [`${dependency}（${target.status}）`]
  })
}

export function buildAgentProgressSettlement(
  facetValues: AgentTaskFacet[]
): AgentProgressSettlement {
  const facetsById = new Map(facetValues.map((facet) => [facet.facetId, facet]))
  const completed = facetValues.filter((facet) => facet.status === 'completed')
  const blocked = facetValues.filter((facet) => facet.status === 'blocked')
  const waiting = facetValues.filter((facet) => facet.status === 'waiting_user')
  const remaining = facetValues.filter((facet) => !isTerminal(facet.status))
  const hasRunnableFacet = remaining.some((facet) => facet.dependsOn.every(
    (dependency) => facetsById.get(dependency)?.status === 'completed'
  ))
  const deadlocked = remaining.length > 0 && !hasRunnableFacet && waiting.length === 0
  const status: AgentProgressSettlement['status'] = remaining.length > 0 && hasRunnableFacet
    ? 'active'
    : remaining.length > 0 && waiting.length > 0
      ? 'waiting_user'
      : remaining.length === 0 && blocked.length === 0 && waiting.length === 0
        ? 'completed'
        : completed.length > 0
          ? 'partial'
          : waiting.length > 0 && blocked.length === 0 ? 'waiting_user' : 'blocked'
  const deadlockedBlocks = deadlocked
    ? remaining.map((facet) => ({
        facetId: facet.facetId,
        reason: `依赖未完成，无法开始：${unsatisfiedDependencies(facet, facetsById).join('、') || '未知依赖'}。`,
      }))
    : []
  return agentProgressSettlementSchema.parse({
    status,
    completedFacetIds: completed.map((facet) => facet.facetId),
    blockedFacets: [
      ...blocked.map((facet) => ({
        facetId: facet.facetId,
        reason: facet.statusReason || '没有满足完成条件。',
      })),
      ...deadlockedBlocks,
    ].slice(0, AGENT_TASK_FACET_LIMIT),
    waitingFacetIds: waiting.map((facet) => facet.facetId),
    remainingFacetIds: remaining.map((facet) => facet.facetId),
    evidence: facetValues.flatMap((facet) => facet.evidence)
      .slice(-AGENT_SETTLEMENT_EVIDENCE_LIMIT),
    summary: status === 'active'
      ? `任务图仍有 ${remaining.length} 个 Facet 未结算。`
      : `任务图结算为 ${status}：完成 ${completed.length}，受阻 ${blocked.length}，等待用户 ${waiting.length}，未开始 ${remaining.length}。`
        + (deadlocked ? '未开始的 Facet 全部卡在未完成的依赖上，任务图无法自行推进。' : ''),
    suggestedNextStep: waiting.length > 0
      ? '向用户提出一个最小且具体的问题，然后进入现有 waiting_user。'
      : deadlocked
        ? '如实说明哪些 Facet 因依赖未完成而没有开始，并给出继续所需的最小动作，不要声称任务已完成。'
        : blocked.length > 0
          ? '如实说明已完成部分、阻塞原因和继续所需的最小条件。'
          : null,
  })
}

export function buildSettlementGuidance(
  settlement: AgentProgressSettlement
): string | null {
  if (settlement.status === 'active') return null
  logger.info('任务图结算并下发停止指令', {
    event: 'agent_task_graph.settlement.stop',
    context: {
      status: settlement.status,
      completedCount: settlement.completedFacetIds.length,
      blockedCount: settlement.blockedFacets.length,
      waitingCount: settlement.waitingFacetIds.length,
      remainingCount: settlement.remainingFacetIds.length,
      remainingFacetIds: settlement.remainingFacetIds,
      blockedReasons: settlement.blockedFacets.map((facet) => `${facet.facetId}:${facet.reason}`),
    },
  })
  return [
    '[任务图结构化结算]',
    JSON.stringify(settlement),
    settlement.status === 'waiting_user'
      ? '停止调用工具，只向用户提出一个最小具体问题。'
      : '停止调用工具；最终答复必须列出已完成部分、未完成部分、证据、阻塞原因和继续所需的最小动作。',
  ].join('\n')
}
