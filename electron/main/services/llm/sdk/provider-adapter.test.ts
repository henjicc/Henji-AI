import { describe, expect, it, vi } from 'vitest'

import { ModelStepProviderAdapterRegistry } from './provider-adapter'

describe('ModelStepProviderAdapterRegistry', () => {
  it('按 API protocol 分派且拒绝重复注册', () => {
    const registry = new ModelStepProviderAdapterRegistry()
    const adapter = {
      protocol: 'openai-compatible' as const,
      createLanguageModel: vi.fn(),
    }
    registry.register(adapter)
    expect(registry.resolve('openai-compatible')).toBe(adapter)
    expect(() => registry.register(adapter)).toThrow('[MODEL_PROTOCOL_DUPLICATE]')
  })
})
