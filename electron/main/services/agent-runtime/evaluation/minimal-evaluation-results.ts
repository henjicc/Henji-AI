export interface MinimalEvaluationCheck {
  id: string
  passed: boolean
  detail: string
}

export interface MinimalEvaluationCaseResult {
  caseId: string
  repetition: number
  passed: boolean
  checks: MinimalEvaluationCheck[]
  metrics: {
    latencyMs: number
    firstFeedbackMs: number | null
    peakMemoryMb: number | null
    averageCpuPercent: number | null
    inputTokens: number
    outputTokens: number
    modelTurns: number
    toolCalls: number
    writeToolCalls: number
    capabilityDiscoveryCalls: number
    batchRate: number
    toolNotActiveCount: number
    effectSatisfactionRate: number
    knownCostUsd: number | null
  }
}

export interface MinimalEvaluationSummary {
  caseCount: number
  runCount: number
  passedRuns: number
  successRate: number
  averageLatencyMs: number
  p95LatencyMs: number
  averageFirstFeedbackMs: number | null
  p95FirstFeedbackMs: number | null
  peakMemoryMb: number | null
  peakAverageCpuPercent: number | null
  totalInputTokens: number
  totalOutputTokens: number
  knownCostUsd: number
  unknownCostRuns: number
  withinSoftTurnBudgetRate: number
  ordinaryEfficiencyPassRate: number
  averageBatchRate: number
  totalToolNotActiveCount: number
  averageEffectSatisfactionRate: number
  toolAccuracyRate: number
  parameterAccuracyRate: number
  planAccuracyRate: number
  evidencePassRate: number
  recoveryPassRate: number
  securityPassRate: number
  logCompletenessRate: number
  failures: Array<{
    caseId: string
    repetition: number
    failedChecks: string[]
  }>
  results: MinimalEvaluationCaseResult[]
}
