import { describe, expect, it } from 'vitest'

import { parseLlmReasoningConfig } from '../../src/llm/requestContract'
import { buildOpenAiCompatiblePayload } from '../../src/llm/streaming'
import type { LlmChatRequestDto } from '../../src/llm/chatTypes'

function createRequest(overrides: Partial<LlmChatRequestDto> = {}): LlmChatRequestDto {
  return {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    adapter: 'deepseek',
    messages: [{ role: 'user', content: '测试' }],
    ...overrides,
  }
}

describe('LLM chat request contract', () => {
  it('接受 renderer 的结构化推理配置，并兼容旧版布尔值', () => {
    expect(parseLlmReasoningConfig({ enabled: true, effort: 'xhigh' })).toEqual({
      enabled: true,
      effort: 'xhigh',
    })
    expect(parseLlmReasoningConfig(false)).toEqual({ enabled: false, effort: 'high' })
  })

  it('按供应商翻译思考参数，DeepSeek 发官方要求的 thinking 与 reasoning_effort', () => {
    const payload = buildOpenAiCompatiblePayload(createRequest({
      capabilities: { reasoning: true },
      reasoning: { enabled: true, effort: 'high' },
    }))

    expect(payload.thinking).toEqual({ type: 'enabled' })
    expect(payload.reasoning_effort).toBe('high')
    // 旧实现发的 `reasoning: true` 不是官方文档里的字段，已经去掉。
    expect(payload).not.toHaveProperty('reasoning')
  })

  it('模型没标"支持思考"时一个思考字段都不发', () => {
    const payload = buildOpenAiCompatiblePayload(createRequest({
      reasoning: { enabled: true, effort: 'high' },
    }))

    expect(payload).not.toHaveProperty('thinking')
    expect(payload).not.toHaveProperty('reasoning_effort')
  })

  it('未登记的供应商只发通用 reasoning_effort，不发任何私有开关', () => {
    const payload = buildOpenAiCompatiblePayload(createRequest({
      providerId: 'custom-gateway',
      adapter: 'openai',
      capabilities: { reasoning: true },
      reasoning: { enabled: true, effort: 'xhigh' },
    }))

    expect(payload.reasoning_effort).toBe('xhigh')
    expect(payload).not.toHaveProperty('thinking')
  })

  it('把文本、JSON Object 与 JSON Schema 映射到 Chat Completions response_format', () => {
    expect(buildOpenAiCompatiblePayload(createRequest({
      structuredOutput: { type: 'text' },
    })).response_format).toEqual({ type: 'text' })

    expect(buildOpenAiCompatiblePayload(createRequest({
      capabilities: { structuredOutputMode: 'json' },
      structuredOutput: { type: 'json_object' },
    })).response_format).toEqual({ type: 'json_object' })

    const schema = {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    }
    expect(buildOpenAiCompatiblePayload(createRequest({
      capabilities: { structuredOutputMode: 'schema' },
      structuredOutput: { type: 'json_schema', name: 'subtitle', schema, strict: false },
    })).response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'subtitle', schema, strict: false },
    })
  })

  it('拒绝未声明能力或未明确核实思考兼容性的结构化输出组合', () => {
    expect(() => buildOpenAiCompatiblePayload(createRequest({
      structuredOutput: { type: 'json_object' },
    }))).toThrow('not declared to support JSON Object')

    expect(() => buildOpenAiCompatiblePayload(createRequest({
      capabilities: { reasoning: true, structuredOutputMode: 'schema' },
      reasoning: { enabled: true, effort: 'high' },
      structuredOutput: {
        type: 'json_schema',
        name: 'subtitle',
        schema: { type: 'object' },
        strict: true,
      },
    }))).toThrow('must explicitly declare structuredOutputWithReasoning')
  })

  it('使用显式输出上限、兼容旧 policy，并且不再强行写入 4096', () => {
    expect(buildOpenAiCompatiblePayload(createRequest())).not.toHaveProperty('max_tokens')
    expect(buildOpenAiCompatiblePayload(createRequest({ maxOutputTokens: 12_000 })).max_tokens).toBe(12_000)
    expect(buildOpenAiCompatiblePayload(createRequest({ policy: { max_tokens: 8_000 } })).max_tokens).toBe(8_000)
    expect(() => buildOpenAiCompatiblePayload(createRequest({
      maxOutputTokens: 12_001,
      capabilities: { maxOutputTokens: 12_000 },
    }))).toThrow('declares a limit of 12000')
  })

  it('Groq 的流式 JSON Schema 在发请求前返回明确错误', () => {
    expect(() => buildOpenAiCompatiblePayload(createRequest({
      providerId: 'groq',
      adapter: 'groq',
      capabilities: { structuredOutputMode: 'schema' },
      structuredOutput: {
        type: 'json_schema',
        name: 'subtitle',
        schema: { type: 'object' },
        strict: true,
      },
    }))).toThrow('does not support JSON Schema structured output with streaming')
  })
})
