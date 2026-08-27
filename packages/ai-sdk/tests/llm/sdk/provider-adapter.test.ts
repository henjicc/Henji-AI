import { describe, expect, it, vi } from 'vitest'

import { ModelStepProviderAdapterRegistry } from '../../../src/llm/sdk/providerAdapter'

describe('ModelStepProviderAdapterRegistry', () => {
  it('按 API protocol 分派且拒绝重复注册', () => {
    const registry = new ModelStepProviderAdapterRegistry()
    const adapter = {
      protocol: 'openai-compatible' as const,
      supportedInputModalities: ['image', 'audio'] as const,
      createLanguageModel: vi.fn(),
    }
    registry.register(adapter)
    expect(registry.resolve('openai-compatible')).toBe(adapter)
    expect(() => registry.register(adapter)).toThrow('[MODEL_PROTOCOL_DUPLICATE]')
  })

  it('在供应商协议边界阻断无法表达的视频，不把地址降级成文本', () => {
    const registry = new ModelStepProviderAdapterRegistry()
    registry.register({
      protocol: 'openai-compatible',
      supportedInputModalities: ['image', 'audio'],
      createLanguageModel: vi.fn(),
    })
    expect(() => registry.assertInputModalities('openai-compatible', {
      messages: [{ role: 'user', content: [{ type: 'file', data: 'https://example.com/a.mp4', mediaType: 'video/mp4' }] }],
    })).toThrow('[unsupported_provider_modality]')
  })
})
