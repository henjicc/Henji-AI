import { describe, expect, it } from 'vitest'

import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentEventSchema,
  agentRunStateSchema,
  type AgentEvent,
  type AgentRunState,
} from '../../../../../src/core/assistant/events'
import { MINIMAL_ASSISTANT_EVALUATION_CASES } from './minimal-cases'
import {
  evaluateMinimalCapture,
  runMinimalEvaluation,
  type MinimalEvaluationCapture,
  type MinimalEvaluationCase,
  type MinimalEvaluationToolCall,
} from './minimal-evaluator'

function runState(status: AgentRunState['status'] = 'completed'): AgentRunState {
  const now = new Date().toISOString()
  return agentRunStateSchema.parse({
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    runId: 'run-eval',
    threadId: 'thread-eval',
    status,
    sequence: 2,
    turn: 2,
    currentStepId: null,
    currentToolCallId: null,
    waitingApprovalId: null,
    startedAt: now,
    updatedAt: now,
    finalText: status === 'completed' ? '已完成' : null,
    error: null,
    budget: {
      maxTurns: 12, maxToolCalls: 24, maxDurationMs: 600_000,
      maxInputTokens: 120_000, maxOutputTokens: 32_000,
      maxConsecutiveFailures: 3, maxRepeatedToolCalls: 2, maxNoProgressTurns: 3,
    },
    usage: {
      turns: 2, toolCalls: 1, inputTokens: 120, outputTokens: 30,
      reasoningTokens: 0, totalTokens: 150, knownCostUsd: null,
      consecutiveFailures: 0, noProgressTurns: 0, elapsedMs: 20,
    },
    lastScopeRevisions: null,
  })
}

function planEvent(intent: string): AgentEvent {
  return agentEventSchema.parse({
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    eventId: 'event-plan',
    sequence: 1,
    occurredAt: new Date().toISOString(),
    runId: 'run-eval',
    type: 'PlanUpdated',
    intent,
    summary: '评测路由',
    toolDomains: [intent],
  })
}

function callsFor(testCase: MinimalEvaluationCase): MinimalEvaluationToolCall[] {
  let index = 0
  return testCase.expectedTools.flatMap((expectation) => (
    Array.from({ length: expectation.minCalls }, () => {
      index += 1
      return {
        toolCallId: `call-${index}`,
        toolName: expectation.toolName,
        input: Object.fromEntries((expectation.requiredInputKeys ?? []).map((key) => [key, `${key}-value`])),
      }
    })
  ))
}

function passingCapture(testCase: MinimalEvaluationCase): MinimalEvaluationCapture {
  const toolCalls = callsFor(testCase)
  return {
    runId: 'run-eval',
    state: runState(),
    events: [planEvent(testCase.expectedIntent)],
    toolCalls,
    logs: [
      { event: 'agent_runtime.run.started', requestId: 'run-eval' },
      ...toolCalls.flatMap((call) => [
        { event: 'agent_tool.execute.started', requestId: 'run-eval', taskId: call.toolCallId },
        { event: 'agent_tool.execute.completed', requestId: 'run-eval', taskId: call.toolCallId },
      ]),
      { event: 'agent_runtime.run.completed', requestId: 'run-eval' },
    ],
    latencyMs: 20,
    outputText: '仅包含脱敏后的评测结果。',
  }
}

describe('minimal assistant evaluator', () => {
  it('对生成、诊断和画布黄金用例重复聚合成功率与 p95', async () => {
    const summary = await runMinimalEvaluation(
      MINIMAL_ASSISTANT_EVALUATION_CASES,
      async (testCase) => passingCapture(testCase),
      3
    )

    expect(summary).toMatchObject({ caseCount: 3, runCount: 9, passedRuns: 9, successRate: 1 })
    expect(summary.p95LatencyMs).toBe(20)
    expect(summary.results.every((result) => result.passed)).toBe(true)
  })

  it('缺失工具终态日志或泄漏敏感探针时明确失败', () => {
    const testCase = MINIMAL_ASSISTANT_EVALUATION_CASES[1]
    const capture = passingCapture(testCase)
    capture.logs = capture.logs.filter((event) => event.event !== 'agent_tool.execute.completed')
    capture.outputText = '错误输出 sk-stage5-sensitive-probe'

    const result = evaluateMinimalCapture(testCase, capture, 1)

    expect(result.passed).toBe(false)
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'logs:tool_pairs', passed: false }),
      expect.objectContaining({ id: 'sensitive_probe', passed: false }),
    ]))
  })
})
