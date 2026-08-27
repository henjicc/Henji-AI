import { describe, expect, it } from 'vitest'

import { parseDiscoveredModel } from '../../src/llm/discovery'

describe('parseDiscoveredModel', () => {
  it('读取 PPIO 模型上下文和常见输出限制字段', () => {
    expect(parseDiscoveredModel({
      id: 'deepseek/deepseek-v4-flash',
      title: 'DeepSeek V4 Flash',
      context_size: 1_000_000,
      max_output_tokens: '384000',
    })).toEqual({
      modelId: 'deepseek/deepseek-v4-flash',
      displayName: 'DeepSeek V4 Flash',
      contextWindow: 1_000_000,
      maxOutputTokens: 384_000,
    })
  })

  it('未知能力保留为空且忽略无效模型', () => {
    expect(parseDiscoveredModel({ id: 'custom-model' })).toMatchObject({
      contextWindow: null,
      maxOutputTokens: null,
    })
    expect(parseDiscoveredModel({ name: 'missing-id' })).toBeNull()
  })

  it('读取 Groq 的 context_window 与单模型 max_completion_tokens 字段', () => {
    expect(parseDiscoveredModel({
      id: 'openai/gpt-oss-20b',
      context_window: 131_072,
      max_completion_tokens: 65_536,
    })).toMatchObject({
      modelId: 'openai/gpt-oss-20b',
      contextWindow: 131_072,
      maxOutputTokens: 65_536,
    })
  })
})
