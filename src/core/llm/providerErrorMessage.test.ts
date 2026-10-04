import { describe, expect, it } from 'vitest'
import { describeLlmProviderError } from './providerErrorMessage'

describe('大语言模型失败文案', () => {
  it('供应商错误只展示面向用户的 message，不带请求 ID 与 JSON', () => {
    const raw = '[provider_error]{"code":"PROVIDER_ERROR","category":"server","status":500,"retryable":true,"retryAfterMs":null,'
      + '"providerId":"p","modelId":"m","requestId":"prompt-optimizer-1","message":"模型供应商服务暂时不可用"}'
    expect(describeLlmProviderError(raw)).toBe('模型供应商服务暂时不可用')
  })

  it('不是供应商错误或解析失败时原样返回', () => {
    expect(describeLlmProviderError('网络连接失败')).toBe('网络连接失败')
    expect(describeLlmProviderError('[provider_error]{broken')).toBe('[provider_error]{broken')
  })
})
