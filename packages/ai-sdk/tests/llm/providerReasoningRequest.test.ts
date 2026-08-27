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
  return applyProviderReasoningRequestBody(providerId, adapter, { model: 'm' }, reasoning)
}

describe('applyProviderReasoningRequestBody', () => {
  it('DeepSeek 同时发 thinking 与 reasoning_effort，且只用官方示例里的两档', () => {
    expect(apply('deepseek', { enabled: true, effort: 'low' })).toMatchObject({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    })
    expect(apply('deepseek', { enabled: true, effort: 'max' })).toMatchObject({
      reasoning_effort: 'max',
    })
    expect(apply('deepseek', { enabled: false, effort: 'high' })).toMatchObject({
      thinking: { type: 'disabled' },
    })
  })

  it('Kimi 没有关闭开关，关闭时退到最低档而不是假装关掉', () => {
    expect(apply('kimi', { enabled: false, effort: 'max' })).toMatchObject({ reasoning_effort: 'low' })
    expect(apply('kimi', { enabled: true, effort: 'medium' })).toMatchObject({ reasoning_effort: 'low' })
    expect(apply('kimi', { enabled: true, effort: 'xhigh' })).toMatchObject({ reasoning_effort: 'high' })
    expect(apply('kimi', { enabled: true, effort: 'max' })).toMatchObject({ reasoning_effort: 'max' })
    expect(apply('kimi', { enabled: true, effort: 'low' })).not.toHaveProperty('thinking')
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

  it('文档没给出请求侧开关的供应商走通用兜底，不编造私有字段', () => {
    const mimo = apply('mimo', { enabled: true, effort: 'high' })
    expect(mimo).toMatchObject({ reasoning_effort: 'high' })
    expect(mimo).not.toHaveProperty('thinking')
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
})
