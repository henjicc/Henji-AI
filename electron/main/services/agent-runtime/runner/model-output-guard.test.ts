import { describe, expect, it } from 'vitest'

import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import {
  modelStepResultSchema,
  type ModelStepFinishReason,
  type ModelStepResult,
  type ModelStepToolCall,
} from '../../../../../src/core/llm/modelStep'
import { AgentToolRegistry } from '../tools/registry'
import {
  AgentModelOutputGuard,
  MODEL_OUTPUT_INCOMPLETE_CODE,
} from './model-output-guard'

const usage: ModelStepResult['usage'] = {
  inputTokens: 1,
  inputNoCacheTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 1,
  textTokens: 1,
  reasoningTokens: 0,
  totalTokens: 2,
}

function toolCall(index = 1): ModelStepToolCall {
  return {
    toolCallId: `call-${index}`,
    toolName: `tool-${index}`,
    input: { value: index },
    dynamic: false,
  }
}

function modelResult(
  finishReason: ModelStepFinishReason,
  toolCalls: ModelStepToolCall[]
): ModelStepResult {
  return {
    requestId: 'request-1',
    runId: 'run-1',
    stepId: 'step-1',
    providerId: 'provider',
    modelId: 'model',
    text: '',
    reasoningText: '',
    structuredOutput: null,
    toolCalls,
    responseMessages: toolCalls.length > 0
      ? [{ role: 'assistant', content: toolCalls.map((call) => ({ type: 'tool-call', ...call })) }]
      : [{ role: 'assistant', content: '' }],
    finishReason,
    usage,
    providerMetadataSummary: {},
    warnings: [],
    elapsedMs: 1,
  }
}

function createGuardCapture(): {
  guard: AgentModelOutputGuard
  events: AgentEventInput[]
  observations: AgentToolObservation[]
  recoveryMessages: string[]
} {
  const events: AgentEventInput[] = []
  const observations: AgentToolObservation[] = []
  const recoveryMessages: string[] = []
  return {
    guard: new AgentModelOutputGuard({
      registry: new AgentToolRegistry(),
      emit: (event) => events.push(event),
      onObservation: (_call, observation) => observations.push(observation),
      onRecoveryMessage: (message) => recoveryMessages.push(message),
    }),
    events,
    observations,
    recoveryMessages,
  }
}

describe('AgentModelOutputGuard', () => {
  it('模型步骤契约拒绝 AI SDK 统一枚举之外的结束原因', () => {
    const unknownResult = {
      ...modelResult('stop', []),
      finishReason: 'future-provider-reason',
    }
    expect(modelStepResultSchema.safeParse(unknownResult).success).toBe(false)
    const capture = createGuardCapture()
    expect(capture.guard.accept(unknownResult as unknown as ModelStepResult)).toBe(false)
    expect(capture.recoveryMessages[0]).toContain('契约未识别')
  })

  it.each<ModelStepFinishReason>([
    'length',
    'content-filter',
    'error',
    'other',
  ])('%s 结束时拒绝单个工具调用并生成结构化恢复观察', (finishReason) => {
    const capture = createGuardCapture()

    expect(capture.guard.accept(modelResult(finishReason, [toolCall()]))).toBe(false)
    expect(capture.events.map((event) => event.type)).toEqual([
      'ToolRequested',
      'ToolFailed',
    ])
    expect(capture.events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'ToolStarted' }),
    ]))
    expect(capture.events[1]).toMatchObject({
      type: 'ToolFailed',
      error: {
        code: MODEL_OUTPUT_INCOMPLETE_CODE,
        retryable: true,
        recovery: 'none',
      },
    })
    expect(capture.observations).toHaveLength(1)
    expect(capture.observations[0]).toMatchObject({
      source: { toolCallId: 'call-1', toolName: 'tool-1' },
      output: {
        ok: false,
        finishReason,
        executed: false,
        error: { code: MODEL_OUTPUT_INCOMPLETE_CODE },
      },
    })
    expect(capture.recoveryMessages[0]).toContain('不得声称它们已经执行')
  })

  it('截断的多个工具调用全部失败且保持请求/失败成对顺序', () => {
    const capture = createGuardCapture()

    expect(capture.guard.accept(modelResult('length', [
      toolCall(1),
      toolCall(2),
      toolCall(3),
    ]))).toBe(false)
    expect(capture.events.map((event) => event.type)).toEqual([
      'ToolRequested',
      'ToolFailed',
      'ToolRequested',
      'ToolFailed',
      'ToolRequested',
      'ToolFailed',
    ])
    expect(capture.observations.map((item) => item.source.toolCallId)).toEqual([
      'call-1',
      'call-2',
      'call-3',
    ])
  })

  it.each([
    ['tool-calls', [toolCall()]],
    ['stop', []],
    ['stop', [toolCall()]],
  ] as const)('%s 的完整兼容形态允许继续处理', (finishReason, toolCalls) => {
    const capture = createGuardCapture()

    expect(capture.guard.accept(modelResult(finishReason, [...toolCalls]))).toBe(true)
    expect(capture.events).toEqual([])
    expect(capture.observations).toEqual([])
    expect(capture.recoveryMessages).toEqual([])
  })

  it.each(['stop', 'tool-calls'] as const)(
    '%s 的工具调用与 assistant 消息不一致时拒绝兼容执行',
    (finishReason) => {
      const capture = createGuardCapture()
      const inconsistent = modelResult(finishReason, [toolCall()])
      inconsistent.responseMessages = [{ role: 'assistant', content: '' }]

      expect(capture.guard.accept(inconsistent)).toBe(false)
      expect(capture.observations[0]).toMatchObject({
        output: { error: { code: MODEL_OUTPUT_INCOMPLETE_CODE } },
      })
      expect(capture.recoveryMessages[0]).toContain('assistant 响应消息不一致')
    }
  )

  it('tool-calls 未返回调用时按不完整输出恢复且不伪造工具观察', () => {
    const capture = createGuardCapture()

    expect(capture.guard.accept(modelResult('tool-calls', []))).toBe(false)
    expect(capture.events).toEqual([])
    expect(capture.observations).toEqual([])
    expect(capture.recoveryMessages[0]).toContain('没有返回任何完整的工具调用')
  })

  it('length 没有工具调用时也拒绝把截断文本当作完整结果', () => {
    const capture = createGuardCapture()

    expect(capture.guard.accept(modelResult('length', []))).toBe(false)
    expect(capture.events).toEqual([])
    expect(capture.observations).toEqual([])
    expect(capture.recoveryMessages[0]).toContain('达到输出长度上限')
  })

  it('拒绝把供应商泄漏到普通文本中的 DSML 工具协议当作最终答复', () => {
    const capture = createGuardCapture()
    const leaked = modelResult('stop', [])
    leaked.text = '继续验证。<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="verify_scene">...'
    leaked.responseMessages = [{ role: 'assistant', content: leaked.text }]

    expect(capture.guard.accept(leaked)).toBe(false)
    expect(capture.events).toEqual([])
    expect(capture.observations).toEqual([])
    expect(capture.recoveryMessages[0]).toContain('序列化成了普通文本')
  })
})
