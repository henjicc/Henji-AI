import { describe, expect, it } from 'vitest'

import {
  applyProviderRequestBodyQuirks,
  resolveProviderExtraAuthHeaders,
} from '../../src/llm/providerProtocol'

describe('resolveProviderExtraAuthHeaders', () => {
  /*
   * mimo 官方文档的认证头是 `api-key`，通用 OpenAI 兼容实现只发 `Authorization: Bearer`。
   * 见 https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call
   */
  it('mimo 补发 api-key 头', () => {
    expect(resolveProviderExtraAuthHeaders('mimo', 'sk-test')).toEqual({ 'api-key': 'sk-test' })
  })

  it('providerId 大小写与空白不影响匹配', () => {
    expect(resolveProviderExtraAuthHeaders('  MiMo  ', 'sk-test')).toEqual({ 'api-key': 'sk-test' })
  })

  it('没有声明差异的供应商不加任何头', () => {
    for (const providerId of ['deepseek', 'ppio', 'openai', '']) {
      expect(resolveProviderExtraAuthHeaders(providerId, 'sk-test'), providerId).toEqual({})
    }
  })

  // 没有密钥时不能发出一个空值头，那会让网关把请求判成凭据错误而不是缺凭据。
  it('密钥为空时不加头', () => {
    expect(resolveProviderExtraAuthHeaders('mimo', '')).toEqual({})
  })
})

describe('applyProviderRequestBodyQuirks', () => {
  /*
   * 实测：发 `max_tokens` 时 mimo 六项能力探测全部 400 Invalid request parameters，
   * 连最基础的 text 也失败——不是能力不支持，是请求根本不被接受。
   */
  it('mimo 把 max_tokens 改名为 max_completion_tokens', () => {
    const body = { model: 'mimo-v2.5', messages: [], max_tokens: 4096, stream: true }
    expect(applyProviderRequestBodyQuirks('mimo', body)).toEqual({
      model: 'mimo-v2.5', messages: [], max_completion_tokens: 4096, stream: true,
    })
  })

  // 是改名不是并存：max_tokens 既然被判为非法参数，留着它就还是 400。
  it('改名后不再保留 max_tokens', () => {
    const result = applyProviderRequestBodyQuirks('mimo', { max_tokens: 100 })
    expect(result).not.toHaveProperty('max_tokens')
  })

  it('mimo 没有 max_tokens 时原样返回', () => {
    const body = { model: 'mimo-v2.5', messages: [] }
    expect(applyProviderRequestBodyQuirks('mimo', body)).toEqual(body)
  })

  it('其他供应商的请求体不被改动', () => {
    const body = { model: 'deepseek-v4-flash', max_tokens: 4096 }
    for (const providerId of ['deepseek', 'ppio', 'openai']) {
      expect(applyProviderRequestBodyQuirks(providerId, body), providerId).toEqual(body)
    }
  })

  it('groq 统一改用 max_completion_tokens 并剔除不支持的 messages[].name', () => {
    expect(applyProviderRequestBodyQuirks('groq', {
      model: 'openai/gpt-oss-20b',
      max_tokens: 256,
      messages: [
        { role: 'user', name: 'unsupported', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ],
    })).toEqual({
      model: 'openai/gpt-oss-20b',
      max_completion_tokens: 256,
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'world' },
      ],
    })
  })
})
