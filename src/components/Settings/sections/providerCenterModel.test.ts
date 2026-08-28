import { describe, expect, it } from 'vitest'
import type { LlmModelConfig, LlmProviderConfig } from '@henjicc/ai-sdk'
import type { Provider } from '@/config/providers'
import { buildProviderCenterGroups, migrateLegacyTypeVisibility } from './providerCenterModel'

const generation: Provider = {
  id: 'ppio',
  name: '派欧云',
  type: 'api',
  models: [{
    id: 'image-one', canonicalModelId: 'image-one', name: '图片模型', originalName: '图片模型',
    type: 'image', description: '', functions: ['text-to-image', 'supports-image-editing'],
  }],
}

const llmProvider = (patch: Partial<LlmProviderConfig> = {}): LlmProviderConfig => ({
  providerId: 'ppio', credentialId: 'ppio',
  setup: { kind: 'preset', presetId: 'ppio', lifecycle: 'builtin' },
  displayName: '派欧云', adapter: 'openai', enabled: true, ...patch,
})

const llmModel: LlmModelConfig = {
  providerId: 'ppio', modelId: 'text-one', displayName: '语言模型', adapter: 'openai', enabled: true,
  capabilities: {
    text: true, image: true, video: false, audio: false, streaming: true, toolCall: true,
    parallelTools: false, jsonOutput: true, structuredOutputMode: 'json', reasoning: false,
    sampling: true, contextWindow: 128_000, maxOutputTokens: 8_192, usage: true,
  },
}

describe('providerCenterModel', () => {
  it('把同一预设供应商的生成模型与 LLM 合并到一个凭据槽', () => {
    const [group] = buildProviderCenterGroups({
      generationProviders: [generation], llmProviders: [llmProvider()], llmModels: [llmModel],
      hiddenProviders: new Set(), hiddenModels: new Set(),
    })
    expect(group.credentialId).toBe('ppio')
    expect(group.models.map(model => model.source)).toEqual(['generation', 'llm'])
    expect(group.models[0].capabilityIds).toEqual(['image-generation', 'image-edit'])
    expect(group.models[1].capabilityIds).toContain('image-input')
  })

  it('LLM 停用但生成模型仍可用时，供应商总状态保持启用', () => {
    const [group] = buildProviderCenterGroups({
      generationProviders: [generation], llmProviders: [llmProvider({ enabled: false })], llmModels: [llmModel],
      hiddenProviders: new Set(), hiddenModels: new Set(),
    })
    expect(group.enabled).toBe(true)
  })

  it('自定义实例与独立凭据不会错误并入固定生成供应商', () => {
    const groups = buildProviderCenterGroups({
      generationProviders: [generation],
      llmProviders: [llmProvider({ providerId: 'ppio-private', credentialId: 'ppio-private', setup: { kind: 'custom' } })],
      llmModels: [{ ...llmModel, providerId: 'ppio-private' }], hiddenProviders: new Set(), hiddenModels: new Set(),
    })
    expect(groups).toHaveLength(2)
    expect(groups[1]).toMatchObject({ id: 'llm:ppio-private', credentialId: 'ppio-private', isCustom: true })
  })

  it('把旧的按类型隐藏展开成逐模型隐藏，迁移后不改变可见结果', () => {
    expect([...migrateLegacyTypeVisibility([generation], new Set(['image']), new Set())])
      .toEqual(['ppio-image-one'])
  })
})
