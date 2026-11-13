import { describe, expect, it } from 'vitest'
import type { LlmConfigState } from '@henjicc/ai-sdk'

import { userSelectedApiProtocol } from './userSelectedApiProtocol'

function config(provider: Record<string, unknown>, modelProtocol?: string): LlmConfigState {
  return {
    providers: [{ providerId: 'p', displayName: 'P', adapter: 'openai', enabled: true, ...provider }],
    models: [{ providerId: 'p', modelId: 'm', displayName: 'M', adapter: 'openai', enabled: true, apiProtocol: modelProtocol }],
  } as unknown as LlmConfigState
}

describe('userSelectedApiProtocol', () => {
  const request = { providerId: 'p', modelId: 'm' }

  it('预设供应商只认连接设置里的覆盖，按预设推导写回的协议交给 SDK', () => {
    const preset = { kind: 'preset', presetId: 'mimo', lifecycle: 'builtin' }
    expect(userSelectedApiProtocol(config({ setup: preset, apiProtocol: 'openai-responses' }, 'openai-responses'), request)).toBeUndefined()
    expect(userSelectedApiProtocol(config({ setup: { ...preset, connectionOverrides: { apiProtocol: 'openai-compatible' } } }, 'openai-responses'), request))
      .toBe('openai-compatible')
  })

  it('自定义供应商用保存的协议，模型的优先；设置里没有就不补', () => {
    const custom = { setup: { kind: 'custom' }, apiProtocol: 'openai-compatible' }
    expect(userSelectedApiProtocol(config(custom, 'openai-responses'), request)).toBe('openai-responses')
    expect(userSelectedApiProtocol(config(custom), request)).toBe('openai-compatible')
    expect(userSelectedApiProtocol(config(custom), { providerId: 'other', modelId: 'm' })).toBeUndefined()
    expect(userSelectedApiProtocol(null, request)).toBeUndefined()
  })
})
