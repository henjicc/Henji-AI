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

  it('把结构化配置转换为 DeepSeek 接口要求的 boolean reasoning', () => {
    const payload = buildOpenAiCompatiblePayload(createRequest({
      reasoning: { enabled: true, effort: 'high' },
    }))

    expect(payload.reasoning).toBe(true)
  })

  it('OpenAI 兼容网关不声明 DeepSeek adapter 时不发送 reasoning', () => {
    const payload = buildOpenAiCompatiblePayload(createRequest({
      providerId: 'ppio',
      adapter: 'openai',
      reasoning: { enabled: true, effort: 'high' },
    }))

    expect(payload).not.toHaveProperty('reasoning')
  })
})
