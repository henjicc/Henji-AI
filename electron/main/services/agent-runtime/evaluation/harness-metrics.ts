import type {
  MinimalEvaluationCapture,
  MinimalEvaluationCase,
} from './minimal-evaluator'
import type {
  MinimalEvaluationCaseResult,
  MinimalEvaluationSummary,
} from './minimal-evaluation-results'

export function collectHarnessRunMetrics(capture: MinimalEvaluationCapture): Pick<
  MinimalEvaluationCaseResult['metrics'],
  | 'modelTurns'
  | 'writeToolCalls'
  | 'capabilityDiscoveryCalls'
  | 'batchRate'
  | 'toolNotActiveCount'
  | 'effectSatisfactionRate'
> {
  const requestedTools = capture.events.filter((event) => event.type === 'ToolRequested')
  const writeToolCalls = requestedTools.filter((event) => event.readOnly === false).length
  const batchedWrites = requestedTools.filter((event) => (
    ['change_application_entities', 'commit_canvas_batch'].includes(event.toolName)
  )).length
  const latestGraph = [...capture.events].reverse().find((event) => (
    event.type === 'PlanUpdated' && event.taskGraph
  ))
  const graph = (latestGraph?.type === 'PlanUpdated' ? latestGraph.taskGraph : undefined)
    ?? capture.state.workingSummary?.route?.taskGraph
  const requiredEffects = graph?.facets.reduce(
    (count, facet) => count + facet.requiredEffects.length,
    0
  ) ?? 0
  const ledger = new Map((capture.state.workingSummary?.effectLedger ?? []).map(
    (entry) => [entry.effectId, entry]
  ))
  const satisfiedEffects = graph?.facets.reduce((count, facet) => (
    count + facet.requiredEffects.filter((effect) => {
      const entry = ledger.get(effect.effectId)
      return entry
        ? entry.count >= effect.minimumCount && (!effect.verificationRequired || entry.verified)
        : facet.status === 'completed'
    }).length
  ), 0) ?? 0
  return {
    modelTurns: capture.state.usage.turns,
    writeToolCalls,
    capabilityDiscoveryCalls: requestedTools.filter((event) => (
      ['discover_application_capabilities', 'search_application_capabilities'].includes(event.toolName)
    )).length,
    batchRate: writeToolCalls === 0 ? 1 : batchedWrites / writeToolCalls,
    toolNotActiveCount: capture.events.filter((event) => (
      event.type === 'ToolFailed' && event.error.code === 'TOOL_NOT_ACTIVE'
    )).length,
    effectSatisfactionRate: requiredEffects === 0 ? 1 : satisfiedEffects / requiredEffects,
  }
}

export function summarizeHarnessMetrics(
  results: MinimalEvaluationCaseResult[],
  cases: MinimalEvaluationCase[]
): Pick<
  MinimalEvaluationSummary,
  | 'withinSoftTurnBudgetRate'
  | 'ordinaryEfficiencyPassRate'
  | 'averageBatchRate'
  | 'totalToolNotActiveCount'
  | 'averageEffectSatisfactionRate'
> {
  const normalCaseIds = new Set(cases.flatMap((testCase) => (
    ['golden', 'historical'].includes(testCase.category) ? [testCase.id] : []
  )))
  const normalResults = results.filter((result) => normalCaseIds.has(result.caseId))
  const rate = (
    matching: MinimalEvaluationCaseResult[],
    predicate: (result: MinimalEvaluationCaseResult) => boolean
  ): number => matching.length === 0 ? 1 : matching.filter(predicate).length / matching.length
  return {
    withinSoftTurnBudgetRate: rate(normalResults, (result) => result.metrics.modelTurns <= 20),
    ordinaryEfficiencyPassRate: rate(normalResults, (result) => (
      result.metrics.modelTurns <= 10
      && result.metrics.toolCalls <= 12
      && result.metrics.capabilityDiscoveryCalls <= 1
    )),
    averageBatchRate: results.length === 0 ? 1 : results.reduce(
      (total, result) => total + result.metrics.batchRate,
      0
    ) / results.length,
    totalToolNotActiveCount: results.reduce(
      (total, result) => total + result.metrics.toolNotActiveCount,
      0
    ),
    averageEffectSatisfactionRate: results.length === 0 ? 1 : results.reduce(
      (total, result) => total + result.metrics.effectSatisfactionRate,
      0
    ) / results.length,
  }
}
