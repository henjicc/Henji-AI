import { describe, expect, it } from 'vitest'

import { parseLlmReasoningConfig } from './request-contract'
import { buildOpenAiCompatiblePayload } from './streaming'
import type { LlmChatRequestDto } from './types'

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
})
