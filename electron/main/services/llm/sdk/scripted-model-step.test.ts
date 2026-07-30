import { describe, expect, it, vi } from 'vitest'

import type { ModelStepInput } from '../../../../../src/core/llm/modelStep'
import { createScriptedModelStepExecutor } from './scripted-model-step'

function createInput(): ModelStepInput {
  return {
    requestId: 'request-1', runId: 'run-1', stepId: 'step-1',
    providerId: 'scripted', modelId: 'scripted-model',
    messages: [{ role: 'user', content: '测试' }],
    output: { mode: 'text' },
    capabilities: {
      streaming: true, toolCall: true, parallelTools: true,
      structuredOutputMode: 'json', reasoning: true, sampling: true, usage: true,
    },
  }
}

describe('createScriptedModelStepExecutor', () => {
  it('以正式事件产生文本、reasoning、多个工具、length 与 usage', async () => {
    let clock = 100
    const events: string[] = []
    const executor = createScriptedModelStepExecutor([
      { type: 'reasoning', value: '分析' },
      { type: 'text', value: '结果' },
      { type: 'delay', ms: 20 },
      { type: 'tool_call', toolCall: {
        toolCallId: 'call-1', toolName: 'read_one', input: {}, dynamic: false,
      } },
      { type: 'tool_call', toolCall: {
        toolCallId: 'call-2', toolName: 'read_two', input: {}, dynamic: false,
      } },
      { type: 'finish', reason: 'length', usage: {
        inputTokens: 10, outputTokens: 4, totalTokens: 14, knownCostUsd: 0.01,
      } },
    ], {
      now: () => clock,
      sleep: vi.fn(async (ms) => { clock += ms }),
    })
    const result = await executor(createInput(), (event) => events.push(event.type))
    expect(events).toEqual(['ReasoningDelta', 'TextDelta', 'ToolCall', 'ToolCall'])
    expect(result).toMatchObject({
      text: '结果', reasoningText: '分析', finishReason: 'length', elapsedMs: 20,
      usage: { totalTokens: 14, knownCostUsd: 0.01 },
    })
    expect(result.toolCalls).toHaveLength(2)
  })

  it('支持结构化 overflow/error 和非法事件故障注入', async () => {
    const overflow = createScriptedModelStepExecutor([{
      type: 'error', code: 'context_length_exceeded', category: 'context_overflow',
    }])
    await expect(overflow(createInput(), vi.fn())).rejects.toMatchObject({
      details: { category: 'context_overflow' },
    })
    const invalid = createScriptedModelStepExecutor([{
      type: 'invalid_event', event: { type: 'UnknownDelta' },
    }])
    await expect(invalid(createInput(), vi.fn())).rejects.toThrow()
  })

  it('延迟期间响应 AbortSignal', async () => {
    const controller = new AbortController()
    const executor = createScriptedModelStepExecutor([{ type: 'delay', ms: 1_000 }], {
      sleep: (_ms, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }),
    })
    const pending = executor(createInput(), vi.fn(), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
