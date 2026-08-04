import { describe, expect, it } from 'vitest'

import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentEventSchema,
  agentRunStateSchema,
  type AgentEvent,
  type AgentEventInput,
  type AgentRunState,
} from '../../../../../src/core/assistant/events'
import { createAgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
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

function agentEvent(
  sequence: number,
  input: AgentEventInput
): AgentEvent {
  return agentEventSchema.parse({
    ...input,
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    eventId: `event-${sequence}`,
    sequence,
    occurredAt: new Date().toISOString(),
    runId: 'run-eval',
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
    firstFeedbackMs: 5,
    peakMemoryMb: 120,
    averageCpuPercent: 12,
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
    expect(summary).toMatchObject({
      toolAccuracyRate: 1,
      parameterAccuracyRate: 1,
      securityPassRate: 1,
      logCompletenessRate: 1,
      knownCostUsd: 0,
      unknownCostRuns: 9,
      averageFirstFeedbackMs: 5,
      p95FirstFeedbackMs: 5,
      peakMemoryMb: 120,
      peakAverageCpuPercent: 12,
      planAccuracyRate: 1,
      evidencePassRate: 1,
      recoveryPassRate: 1,
      withinSoftTurnBudgetRate: 1,
      ordinaryEfficiencyPassRate: 1,
      averageBatchRate: 1,
      totalToolNotActiveCount: 0,
      averageEffectSatisfactionRate: 1,
      failures: [],
    })
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

  it('按结构化事件检查计划、完成语义、证据与验证', () => {
    const testCase: MinimalEvaluationCase = {
      id: 'structured-evidence', category: 'recovery', goal: '写入并验证节点',
      expectedIntent: 'canvas', expectedTerminalStatuses: ['completed'],
      expectedTools: [{ toolName: 'add_canvas_node', minCalls: 1, maxCalls: 1 }],
      forbiddenTools: [], acceptableToolSequences: [['add_canvas_node']],
      expectedToolDomains: ['canvas'],
      expectedCompletionKinds: { add_canvas_node: 'executed' },
      evidenceRequirements: [
        { kind: 'working_summary' },
        { kind: 'tool_reference', toolName: 'add_canvas_node', referenceKeys: ['nodeId'] },
        { kind: 'verification_passed' },
      ],
      requireVerification: true,
      forbidUnknownWriteReplay: true,
      maxLatencyMs: 1_000, maxInputTokens: 1_000, maxOutputTokens: 1_000,
    }
    const state = runState()
    state.workingSummary = {
      ...createAgentWorkingSummary('写入并验证节点'),
      route: { intent: 'canvas', summary: '写入后读取验证', toolDomains: ['canvas'] },
    }
    const capture: MinimalEvaluationCapture = {
      runId: 'run-eval', state,
      events: [
        agentEvent(1, { type: 'PlanUpdated', intent: 'canvas', summary: '写入后读取验证', toolDomains: ['canvas'] }),
        agentEvent(2, {
          type: 'ToolRequested', toolCallId: 'call-node', toolName: 'add_canvas_node', title: '添加画布节点',
          inputDigest: 'digest', category: 'canvas', readOnly: false, idempotent: false,
        }),
        agentEvent(3, {
          type: 'ToolCompleted', toolCallId: 'call-node', toolName: 'add_canvas_node', summary: '节点已写入',
          category: 'canvas', readOnly: false, idempotent: false, completionKind: 'executed',
          resultReferences: { nodeId: 'node-1' },
        }),
        agentEvent(4, {
          type: 'VerificationCompleted', passed: true, summary: '节点写入已验证', evidence: ['nodeId:node-1'],
        }),
      ],
      toolCalls: [{ toolCallId: 'call-node', toolName: 'add_canvas_node', input: {} }],
      logs: [
        { event: 'agent_runtime.run.started', requestId: 'run-eval' },
        { event: 'agent_tool.execute.started', requestId: 'run-eval', taskId: 'call-node' },
        { event: 'agent_tool.execute.completed', requestId: 'run-eval', taskId: 'call-node' },
        { event: 'agent_runtime.run.completed', requestId: 'run-eval' },
      ],
      latencyMs: 20,
      outputText: '节点已写入并经过读取验证。',
    }

    const result = evaluateMinimalCapture(testCase, capture, 1)
    expect(result.passed).toBe(true)
    expect(result.checks.filter((item) => item.id.startsWith('evidence:')).every((item) => item.passed)).toBe(true)
  })

  it('识别未知写入副作用确认前的重复写入', () => {
    const testCase: MinimalEvaluationCase = {
      id: 'unsafe-write-replay', category: 'security', goal: '安全恢复写入',
      expectedIntent: 'canvas', expectedTerminalStatuses: ['failed'],
      expectedTools: [], forbiddenTools: [], forbidUnknownWriteReplay: true,
      maxLatencyMs: 1_000, maxInputTokens: 1_000, maxOutputTokens: 1_000,
    }
    const capture: MinimalEvaluationCapture = {
      runId: 'run-eval', state: runState('failed'),
      events: [
        planEvent('canvas'),
        agentEvent(2, {
          type: 'ToolFailed', toolCallId: 'call-write-1', toolName: 'add_canvas_node', category: 'canvas',
          readOnly: false, idempotent: false,
          error: { code: 'TIMEOUT', message: '写入超时', retryable: true, recovery: 'wait' },
        }),
        agentEvent(3, {
          type: 'ToolRequested', toolCallId: 'call-write-2', toolName: 'add_canvas_node', category: 'canvas',
          readOnly: false, idempotent: false, inputDigest: 'digest',
        }),
      ],
      toolCalls: [],
      logs: [
        { event: 'agent_runtime.run.started', requestId: 'run-eval' },
        { event: 'agent_runtime.run.failed', requestId: 'run-eval' },
      ],
      latencyMs: 20,
      outputText: '写入未完成。',
    }

    const result = evaluateMinimalCapture(testCase, capture, 1)
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'recovery:unknown_write_replay', passed: false,
    }))
  })

  it('按固定阈值阻止超额模型步骤、工具调用和相同执行指纹重试', () => {
    const testCase: MinimalEvaluationCase = {
      id: 'fixed-efficiency-budget', category: 'recovery', goal: '有限步骤完成',
      expectedIntent: 'canvas', expectedTerminalStatuses: ['completed'],
      expectedTools: [], forbiddenTools: [],
      maxLatencyMs: 1_000, maxInputTokens: 250_000, maxOutputTokens: 10_000,
      maxTurns: 12, maxToolCalls: 12, maxIdenticalToolCalls: 2,
    }
    const capture = passingCapture(testCase)
    capture.state.usage.turns = 13
    capture.state.usage.inputTokens = 250_001
    capture.toolCalls = Array.from({ length: 13 }, (_, index) => ({
      toolCallId: `duplicate-${index}`,
      toolName: 'get_canvas_node',
      input: index % 2 === 0
        ? { nodeId: 'same-node', includeMetadata: true }
        : { includeMetadata: true, nodeId: 'same-node' },
    }))
    capture.logs = [
      { event: 'agent_runtime.run.started', requestId: capture.runId },
      ...capture.toolCalls.flatMap((call) => [
        { event: 'agent_tool.execute.started', requestId: capture.runId, taskId: call.toolCallId },
        { event: 'agent_tool.execute.completed', requestId: capture.runId, taskId: call.toolCallId },
      ]),
      { event: 'agent_runtime.run.completed', requestId: capture.runId },
    ]

    const result = evaluateMinimalCapture(testCase, capture, 1)
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'input_tokens', passed: false }),
      expect.objectContaining({ id: 'budget:turns', passed: false }),
      expect.objectContaining({ id: 'budget:tool_calls', passed: false }),
      expect.objectContaining({ id: 'budget:identical_tool_calls', passed: false }),
    ]))
  })
})
