import { describe, expect, it } from 'vitest'

import { modelStepInputSchema, modelStepResultSchema } from '../../../../../src/core/llm/modelStep'
import { serializedBytes } from '../../../../../src/core/assistant/traceSanitize'
import {
  AGENT_TRACE_DETAIL_MAX_BYTES,
  buildModelStepTraceDetail,
  createModelStepStreamTrace,
} from './trace'

const usage = {
  inputTokens: 120,
  inputNoCacheTokens: 100,
  cacheReadTokens: 20,
  cacheWriteTokens: 0,
  outputTokens: 30,
  textTokens: 20,
  reasoningTokens: 10,
  totalTokens: 150,
}

describe('model step trace detail', () => {
  it('保存逻辑上下文、最终请求与响应，同时脱敏凭据', () => {
    const input = modelStepInputSchema.parse({
      requestId: 'run-1:step-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      adapter: 'deepseek',
      system: '系统提示词',
      messages: [{ role: 'user', content: '请诊断问题' }],
      tools: [{ name: 'query_logs', inputSchema: { type: 'object' } }],
      output: { mode: 'text' },
      capabilities: {
        image: false,
        video: false,
        audio: false,
        streaming: true,
        toolCall: true,
        parallelTools: false,
        structuredOutputMode: 'json',
        reasoning: true,
        sampling: true,
        usage: true,
      },
      reasoning: { enabled: true, effort: 'high' },
      settings: { maxOutputTokens: 4_000 },
      trace: {
        kind: 'primary',
        turn: 1,
        contextWindowBudget: 1_000_000,
        estimatedTokens: 2_000,
      },
    })
    const result = modelStepResultSchema.parse({
      requestId: input.requestId,
      runId: input.runId,
      stepId: input.stepId,
      providerId: input.providerId,
      modelId: input.modelId,
      text: '诊断完成',
      reasoningText: '供应商返回的推理摘要',
      structuredOutput: null,
      toolCalls: [],
      responseMessages: [{ role: 'assistant', content: '诊断完成' }],
      finishReason: 'stop',
      usage,
      providerMetadataSummary: { deepseek: ['requestId'] },
      warnings: [],
      elapsedMs: 900,
    })
    const stream = createModelStepStreamTrace()
    stream.firstChunkMs = 120
    stream.textDeltaCount = 3
    stream.textCharacters = 4
    stream.totalEventCount = 5
    const detail = buildModelStepTraceDetail(input, {
      request: {
        method: 'POST',
        url: 'https://api.deepseek.com/v1/chat/completions?api_key=secret',
        headers: { Authorization: 'Bearer secret', 'Content-Type': 'application/json' },
        body: {
          model: input.modelId,
          thinking: { type: 'enabled' },
          reasoning_effort: 'high',
          max_tokens: 4_000,
        },
      },
      response: { status: 200, headers: { 'content-type': 'text/event-stream' } },
    }, stream, result)

    expect(detail.logicalRequest.system).toBe('系统提示词')
    expect(detail.logicalRequest.context?.contextWindowBudget).toBe(1_000_000)
    expect(detail.httpRequest?.headers.Authorization).toBe('***')
    expect(detail.httpRequest?.url).toContain('api_key=***')
    expect(detail.httpRequest?.body).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      max_tokens: 4_000,
    })
    expect(detail.response?.usage.inputTokens).toBe(120)
    expect(detail.response?.reasoningText).toBe('供应商返回的推理摘要')
    expect(detail.stream?.firstChunkMs).toBe(120)
  })

  it('超过体积上限时按区块截断并保持详情契约有效', () => {
    const input = modelStepInputSchema.parse({
      requestId: 'run-large:step-1',
      runId: 'run-large',
      stepId: 'step-1',
      providerId: 'provider',
      modelId: 'model',
      messages: [{ role: 'user', content: '检查超大请求' }],
      capabilities: {
        image: false,
        video: false,
        audio: false,
        streaming: true,
        toolCall: false,
        parallelTools: false,
        structuredOutputMode: 'none',
        reasoning: false,
        sampling: true,
        usage: true,
      },
    })
    const largeChunks = Array.from(
      { length: 8 },
      (_, index) => `第${index}段：${'很长的请求内容。'.repeat(60_000)}`
    )
    const detail = buildModelStepTraceDetail(
      input,
      {
        request: {
          method: 'POST',
          url: 'https://example.test/v1/chat',
          headers: {},
          body: { largeChunks },
        },
      },
      createModelStepStreamTrace()
    )

    expect(detail.capture.truncated).toBe(true)
    expect(detail.capture.sections).toContain('httpRequest')
    expect(detail.capture.storedBytes).toBeLessThanOrEqual(AGENT_TRACE_DETAIL_MAX_BYTES)
    expect(serializedBytes(detail)).toBeLessThanOrEqual(AGENT_TRACE_DETAIL_MAX_BYTES)
  })
})
