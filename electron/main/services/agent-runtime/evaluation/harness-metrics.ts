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
  | 'verifiedEffectRate'
> {
  const requestedTools = capture.events.filter((event) => event.type === 'ToolRequested')
  const writeToolCalls = requestedTools.filter((event) => event.readOnly === false).length
  const batchedWrites = requestedTools.filter((event) => (
    ['change_application_entities', 'commit_canvas_batch'].includes(event.toolName)
  )).length
  /*
   * 「写入里有多少带正式状态源读回证据」。
   *
   * 这里曾经是 effectSatisfactionRate：拿运行前那张任务图声明的 requiredEffects 当分母，对
   * Effect Ledger 逐条比 minimumCount。分母是猜的，猜多了永远不到 1，猜少了永远是 1——它
   * 度量的其实是"路由猜得准不准"，不是"助手做没做成"。现在分子分母都取自真实发生的 Effect。
   */
  const effects = capture.state.executionOutcome.effects
  const verifiedEffects = effects.filter((effect) => effect.verified).length
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
    verifiedEffectRate: effects.length === 0 ? 1 : verifiedEffects / effects.length,
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
  | 'averageVerifiedEffectRate'
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
    averageVerifiedEffectRate: results.length === 0 ? 1 : results.reduce(
      (total, result) => total + result.metrics.verifiedEffectRate,
      0
    ) / results.length,
  }
}
