import type { AgentEvent, AgentRunState, AgentRunStatus } from '../../../../../src/core/assistant/events'

export interface MinimalEvaluationToolExpectation {
  toolName: string
  minCalls: number
  maxCalls?: number
  requiredInputKeys?: string[]
}

export interface MinimalEvaluationCase {
  id: string
  category: 'golden' | 'boundary' | 'security' | 'recovery'
  goal: string
  expectedIntent: string
  expectedTerminalStatuses: AgentRunStatus[]
  expectedTools: MinimalEvaluationToolExpectation[]
  forbiddenTools: string[]
  maxLatencyMs: number
  maxInputTokens: number
  maxOutputTokens: number
  sensitiveProbes?: string[]
}

export interface MinimalEvaluationToolCall {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

export interface MinimalEvaluationLogEvent {
  event: string
  requestId?: string
  taskId?: string
  payload?: unknown
}

export interface MinimalEvaluationCapture {
  runId: string
  state: AgentRunState
  events: AgentEvent[]
  toolCalls: MinimalEvaluationToolCall[]
  logs: MinimalEvaluationLogEvent[]
  latencyMs: number
  outputText: string
}

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
    inputTokens: number
    outputTokens: number
    toolCalls: number
  }
}

export interface MinimalEvaluationSummary {
  caseCount: number
  runCount: number
  passedRuns: number
  successRate: number
  averageLatencyMs: number
  p95LatencyMs: number
  totalInputTokens: number
  totalOutputTokens: number
  results: MinimalEvaluationCaseResult[]
}

export type MinimalEvaluationExecutor = (
  testCase: MinimalEvaluationCase,
  repetition: number
) => Promise<MinimalEvaluationCapture>

function check(id: string, passed: boolean, detail: string): MinimalEvaluationCheck {
  return { id, passed, detail }
}

function findIntent(events: AgentEvent[]): string | null {
  return events.find((event) => event.type === 'PlanUpdated')?.intent ?? null
}

function checkToolExpectations(
  expectations: MinimalEvaluationToolExpectation[],
  calls: MinimalEvaluationToolCall[]
): MinimalEvaluationCheck[] {
  return expectations.flatMap((expectation) => {
    const matching = calls.filter((call) => call.toolName === expectation.toolName)
    const withinCount = matching.length >= expectation.minCalls
      && (expectation.maxCalls === undefined || matching.length <= expectation.maxCalls)
    const countCheck = check(
      `tool:${expectation.toolName}:count`,
      withinCount,
      `调用 ${matching.length} 次，期望 ${expectation.minCalls}～${expectation.maxCalls ?? '不限'} 次`
    )
    if (!expectation.requiredInputKeys?.length) return [countCheck]
    const keysValid = matching.every((call) => expectation.requiredInputKeys?.every((key) => key in call.input))
    return [
      countCheck,
      check(
        `tool:${expectation.toolName}:input`,
        matching.length > 0 && keysValid,
        `必需参数：${expectation.requiredInputKeys.join(', ')}`
      ),
    ]
  })
}

function checkLogPairs(testCase: MinimalEvaluationCase, capture: MinimalEvaluationCapture): MinimalEvaluationCheck[] {
  const runStarted = capture.logs.some((event) => (
    event.requestId === capture.runId && event.event === 'agent_runtime.run.started'
  ))
  const runTerminal = capture.logs.some((event) => (
    event.requestId === capture.runId
    && ['agent_runtime.run.completed', 'agent_runtime.run.failed', 'agent_runtime.run.cancelled'].includes(event.event)
  ))
  const toolPairs = capture.toolCalls.every((call) => {
    const relevant = capture.logs.filter((event) => (
      event.requestId === capture.runId && event.taskId === call.toolCallId
    ))
    return relevant.some((event) => event.event === 'agent_tool.execute.started')
      && relevant.some((event) => (
        event.event === 'agent_tool.execute.completed' || event.event === 'agent_tool.execute.failed'
      ))
  })
  return [
    check('logs:run_pair', runStarted && runTerminal, 'run start/terminal 日志必须成对'),
    check('logs:tool_pairs', toolPairs, `${testCase.id} 的每个 toolCallId 必须有 start/terminal 日志`),
  ]
}

export function evaluateMinimalCapture(
  testCase: MinimalEvaluationCase,
  capture: MinimalEvaluationCapture,
  repetition: number
): MinimalEvaluationCaseResult {
  const terminalPassed = testCase.expectedTerminalStatuses.includes(capture.state.status)
  const intent = findIntent(capture.events)
  const forbidden = capture.toolCalls.filter((call) => testCase.forbiddenTools.includes(call.toolName))
  const serializedOutput = JSON.stringify({ outputText: capture.outputText, logs: capture.logs })
  const leaked = (testCase.sensitiveProbes ?? []).filter((probe) => probe && serializedOutput.includes(probe))
  const checks: MinimalEvaluationCheck[] = [
    check('terminal', terminalPassed, `终态 ${capture.state.status}`),
    check('intent', intent === testCase.expectedIntent, `意图 ${intent ?? 'missing'}`),
    ...checkToolExpectations(testCase.expectedTools, capture.toolCalls),
    check('forbidden_tools', forbidden.length === 0, `禁止工具命中 ${forbidden.map((item) => item.toolName).join(', ') || '无'}`),
    check('latency', capture.latencyMs <= testCase.maxLatencyMs, `耗时 ${capture.latencyMs}ms`),
    check('input_tokens', capture.state.usage.inputTokens <= testCase.maxInputTokens, `输入 token ${capture.state.usage.inputTokens}`),
    check('output_tokens', capture.state.usage.outputTokens <= testCase.maxOutputTokens, `输出 token ${capture.state.usage.outputTokens}`),
    check('sensitive_probe', leaked.length === 0, `敏感探针泄漏 ${leaked.length} 项`),
    ...checkLogPairs(testCase, capture),
  ]
  return {
    caseId: testCase.id,
    repetition,
    passed: checks.every((item) => item.passed),
    checks,
    metrics: {
      latencyMs: capture.latencyMs,
      inputTokens: capture.state.usage.inputTokens,
      outputTokens: capture.state.usage.outputTokens,
      toolCalls: capture.toolCalls.length,
    },
  }
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]
}

export async function runMinimalEvaluation(
  cases: MinimalEvaluationCase[],
  executor: MinimalEvaluationExecutor,
  repetitions = 1
): Promise<MinimalEvaluationSummary> {
  const results: MinimalEvaluationCaseResult[] = []
  for (const testCase of cases) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      const capture = await executor(testCase, repetition)
      results.push(evaluateMinimalCapture(testCase, capture, repetition))
    }
  }
  const latencies = results.map((result) => result.metrics.latencyMs)
  const passedRuns = results.filter((result) => result.passed).length
  return {
    caseCount: cases.length,
    runCount: results.length,
    passedRuns,
    successRate: results.length === 0 ? 0 : passedRuns / results.length,
    averageLatencyMs: latencies.length === 0
      ? 0
      : Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length),
    p95LatencyMs: percentile95(latencies),
    totalInputTokens: results.reduce((total, result) => total + result.metrics.inputTokens, 0),
    totalOutputTokens: results.reduce((total, result) => total + result.metrics.outputTokens, 0),
    results,
  }
}
