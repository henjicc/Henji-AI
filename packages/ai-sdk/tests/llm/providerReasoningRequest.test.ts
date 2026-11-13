import { describe, expect, it } from 'vitest'

import {
  applyProviderReasoningRequestBody,
  hasProviderReasoningRule,
} from '../../src/llm/providerReasoningRequest'

function apply(
  providerId: string,
  reasoning: { enabled: boolean; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' },
  adapter?: string,
): Record<string, unknown> {
  return applyProviderReasoningRequestBody(providerId, adapter, { model: providerId === 'kimi' ? 'kimi-k3' : 'm' }, reasoning)
}

describe('applyProviderReasoningRequestBody', () => {
  it('Kimi按模型区分字段并删除残留的错误字段，保留输出预算', () => {
    for (const enabled of [true, false]) {
      const body = { max_tokens: 4096, reasoning_effort: 'max', thinking: { type: 'disabled' } }
      const config = { enabled, effort: 'max' as const }
      expect(applyProviderReasoningRequestBody('kimi', undefined, { ...body, model: 'kimi-k2.6' }, config))
        .toEqual({ model: 'kimi-k2.6', max_tokens: 4096, thinking: { type: enabled ? 'enabled' : 'disabled' } })
      expect(applyProviderReasoningRequestBody('kimi', undefined, { ...body, model: 'kimi-k2.7-code' }, config))
        .toEqual({ model: 'kimi-k2.7-code', max_tokens: 4096, thinking: { type: 'enabled', keep: 'all' } })
      expect(applyProviderReasoningRequestBody('kimi', undefined, { ...body, model: 'kimi-k3' }, config))
        .toEqual({ model: 'kimi-k3', max_tokens: 4096, reasoning_effort: enabled ? 'max' : 'low' })
    }
  })
  it('DeepSeek Chat 同时发 thinking 与 reasoning_effort，按官方映射表落到 low / high / max', () => {
    expect(apply('deepseek', { enabled: true, effort: 'low' })).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'low',
    })
    expect(apply('deepseek', { enabled: true, effort: 'medium' })).toMatchObject({ reasoning_effort: 'high' })
    expect(apply('deepseek', { enabled: true, effort: 'xhigh' })).toMatchObject({ reasoning_effort: 'high' })
    expect(apply('deepseek', { enabled: true, effort: 'max' })).toMatchObject({
      reasoning_effort: 'max',
    })
    expect(apply('deepseek', { enabled: false, effort: 'high' })).toEqual({ model: 'm', thinking: { type: 'disabled' } })
  })

  describe('Responses 协议只认 reasoning.effort，Chat 写法会被静默忽略', () => {
    const responses = (providerId: string, model: string, reasoning: { enabled: boolean; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }) =>
      applyProviderReasoningRequestBody(providerId, undefined, { model, reasoning_effort: 'high', thinking: { type: 'enabled' } }, reasoning, 'openai-responses')

    it('DeepSeek 用 reasoning.effort 调强度，none 关闭思考，且不残留 Chat 字段', () => {
      expect(responses('deepseek', 'deepseek-flash', { enabled: true, effort: 'low' })).toEqual({ model: 'deepseek-flash', reasoning: { effort: 'low' } })
      expect(responses('deepseek', 'deepseek-flash', { enabled: true, effort: 'max' })).toEqual({ model: 'deepseek-flash', reasoning: { effort: 'max' } })
      expect(responses('deepseek', 'deepseek-flash', { enabled: false, effort: 'high' })).toEqual({ model: 'deepseek-flash', reasoning: { effort: 'none' } })
    })

    it('智谱 GLM-5.3 在 Responses 下能关闭思考', () => {
      expect(responses('bigmodel', 'glm-5.3', { enabled: false, effort: 'high' })).toEqual({ model: 'glm-5.3', reasoning: { effort: 'none' } })
      expect(responses('bigmodel', 'glm-5.3', { enabled: true, effort: 'xhigh' })).toEqual({ model: 'glm-5.3', reasoning: { effort: 'max' } })
      expect(responses('bigmodel', 'glm-5.3', { enabled: true, effort: 'low' })).toEqual({ model: 'glm-5.3', reasoning: { effort: 'high' } })
    })

    it('火山引擎开关用 thinking、强度用 reasoning.effort，关闭时不发强度', () => {
      expect(responses('volcengine', 'doubao-seed-2-1-pro-260915', { enabled: true, effort: 'medium' }))
        .toEqual({ model: 'doubao-seed-2-1-pro-260915', thinking: { type: 'enabled' }, reasoning: { effort: 'medium' } })
      expect(responses('volcengine', 'doubao-seed-2-1-pro-260915', { enabled: false, effort: 'high' }))
        .toEqual({ model: 'doubao-seed-2-1-pro-260915', thinking: { type: 'disabled' } })
    })

    it('MiniMax M3 默认不思考，开启时必须发 reasoning.effort', () => {
      expect(responses('minimax', 'MiniMax-M3', { enabled: true, effort: 'high' })).toEqual({ model: 'MiniMax-M3', reasoning: { effort: 'high' } })
      expect(responses('minimax', 'MiniMax-M3', { enabled: false, effort: 'high' })).toEqual({ model: 'MiniMax-M3' })
    })

    it('百炼在两种协议下都用 enable_thinking', () => {
      expect(responses('bailian', 'qwen3.8-max', { enabled: false, effort: 'high' })).toEqual({ model: 'qwen3.8-max', enable_thinking: false })
    })

    it('未登记供应商在 Responses 下走 reasoning.effort 通用写法', () => {
      expect(responses('openai', 'gpt', { enabled: true, effort: 'medium' })).toEqual({ model: 'gpt', reasoning: { effort: 'medium' } })
      expect(responses('openai', 'gpt', { enabled: false, effort: 'medium' })).toEqual({ model: 'gpt' })
    })
  })

  it('Kimi 没有关闭开关，关闭时退到最低档而不是假装关掉', () => {
    expect(apply('kimi', { enabled: false, effort: 'max' })).toMatchObject({ reasoning_effort: 'low' })
    expect(apply('kimi', { enabled: true, effort: 'medium' })).toMatchObject({ reasoning_effort: 'low' })
    expect(apply('kimi', { enabled: true, effort: 'xhigh' })).toMatchObject({ reasoning_effort: 'high' })
    expect(apply('kimi', { enabled: true, effort: 'max' })).toMatchObject({ reasoning_effort: 'max' })
    expect(apply('kimi', { enabled: true, effort: 'low' })).not.toHaveProperty('thinking')
    for (const model of ['kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed']) {
      expect(applyProviderReasoningRequestBody('kimi', undefined, { model }, { enabled: false, effort: 'max' })).toEqual({ model, reasoning_effort: 'low' })
    }
  })

  it('MiniMax M3.1 Flash 五档透传，关闭退到 low；M3 仍走通用写法', () => {
    const flash = (reasoning: { enabled: boolean; effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }) =>
      applyProviderReasoningRequestBody('minimax', undefined, { model: 'MiniMax-M3.1-Flash' }, reasoning)
    expect(flash({ enabled: true, effort: 'xhigh' })).toMatchObject({ reasoning_effort: 'xhigh' })
    expect(flash({ enabled: false, effort: 'max' })).toMatchObject({ reasoning_effort: 'low' })
    expect(applyProviderReasoningRequestBody('minimax', undefined, { model: 'MiniMax-M3' }, { enabled: false, effort: 'high' })).toEqual({ model: 'MiniMax-M3' })
  })

  it('GLM 关闭思考时整段不发，避免 GLM-5.3 因 thinking.disabled 直接失败', () => {
    expect(apply('bigmodel', { enabled: false, effort: 'high' })).toEqual({ model: 'm' })
    expect(apply('bigmodel', { enabled: true, effort: 'xhigh' })).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    })
  })

  it('火山引擎透传与项目档位重合的五档，关闭走 thinking 开关', () => {
    expect(apply('volcengine', { enabled: true, effort: 'medium' })).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'medium',
    })
    expect(apply('volcengine', { enabled: false, effort: 'high' })).toMatchObject({
      thinking: { type: 'disabled' },
    })
  })

  it('百炼只有布尔开关，没有强度分级', () => {
    expect(apply('bailian', { enabled: true, effort: 'max' })).toMatchObject({ enable_thinking: true })
    expect(apply('bailian', { enabled: false, effort: 'max' })).toMatchObject({ enable_thinking: false })
  })

  it('Groq GPT-OSS 只发三档 reasoning_effort 与 include_reasoning，不发送 reasoning_format', () => {
    const enabled = apply('groq', { enabled: true, effort: 'max' })
    expect(enabled).toMatchObject({ reasoning_effort: 'high', include_reasoning: true })
    expect(enabled).not.toHaveProperty('reasoning_format')
    expect(apply('groq', { enabled: true, effort: 'low' })).toMatchObject({ reasoning_effort: 'low' })
    expect(apply('groq', { enabled: false, effort: 'high' })).toEqual({
      model: 'm',
      include_reasoning: false,
    })
  })

  it('Groq Qwen3.8-27B 关闭思考时发 reasoning_effort: none，真正关掉思考', () => {
    const off = applyProviderReasoningRequestBody('groq', undefined, { model: 'qwen/qwen3.8-27b' }, { enabled: false, effort: 'high' })
    expect(off).toEqual({ model: 'qwen/qwen3.8-27b', reasoning_effort: 'none' })
    expect(applyProviderReasoningRequestBody('groq', undefined, { model: 'qwen/qwen3.8-27b' }, { enabled: true, effort: 'medium' }))
      .toMatchObject({ reasoning_effort: 'medium', include_reasoning: true })
  })

  it('文档没给出请求侧开关的供应商走通用兜底，不编造私有字段', () => {
    const mimo = apply('mimo', { enabled: true, effort: 'high' })
    expect(mimo).toMatchObject({ thinking: { type: 'enabled' } })
    expect(mimo).not.toHaveProperty('reasoning_effort')
    expect(apply('minimax', { enabled: false, effort: 'high' })).toEqual({ model: 'm' })
  })

  it('供应商 id 改名后仍按 adapter 兜住既有 DeepSeek 行为', () => {
    expect(hasProviderReasoningRule('my-deepseek')).toBe(false)
    expect(hasProviderReasoningRule('my-deepseek', 'deepseek')).toBe(true)
    expect(apply('my-deepseek', { enabled: true, effort: 'high' }, 'deepseek')).toMatchObject({
      thinking: { type: 'enabled' },
    })
  })

  it('没有思考配置时原样返回请求体', () => {
    expect(applyProviderReasoningRequestBody('deepseek', undefined, { model: 'm' }, undefined))
      .toEqual({ model: 'm' })
  })

  it('MiMo 两种协议使用各自思考开关并移除冲突采样字段', () => {
    const body = { model: 'mimo-v2.6-pro', temperature: 0.2, top_p: 0.5, reasoning_effort: 'max', thinking: { type: 'enabled' } }
    expect(applyProviderReasoningRequestBody('mimo', 'openai', body, { enabled: true, effort: 'max' }, 'openai-responses'))
      .toEqual({ model: 'mimo-v2.6-pro', reasoning: { effort: 'high' } })
    expect(applyProviderReasoningRequestBody('mimo', 'openai', body, { enabled: false, effort: 'max' }, 'openai-responses'))
      .toEqual({ model: 'mimo-v2.6-pro', temperature: 0.2, top_p: 0.5, reasoning: { effort: 'none' } })
    expect(apply('mimo', { enabled: false, effort: 'high' })).toEqual({ model: 'm', thinking: { type: 'disabled' } })
    expect(applyProviderReasoningRequestBody('mimo', 'openai', { temperature: 0.1 }, undefined))
      .toEqual({ thinking: { type: 'enabled' } })
  })
})
