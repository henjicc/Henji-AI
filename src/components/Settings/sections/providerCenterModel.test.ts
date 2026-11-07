import { describe, expect, it } from 'vitest'
import type { LlmModelConfig, LlmProviderConfig } from '@henjicc/ai-sdk'
import type { Provider } from '@/config/providers'
import { buildProviderCenterGroups, migrateLegacyTypeVisibility, setLlmModelsEnabled } from './providerCenterModel'

const generation: Provider = {
  id: 'ppio',
  name: '派欧云',
  type: 'api',
  models: [{
    id: 'image-one', canonicalModelId: 'image-one', name: '图片模型', originalName: '图片模型',
    type: 'image', description: '', functions: ['text-to-image', 'image-to-image'],
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
  it('groups Volcengine services without mixing model routing, credentials or hidden state', () => {
    const [group] = buildProviderCenterGroups({
      generationProviders: [
        { ...generation, id: 'volcengine-speech', models: [{ ...generation.models[0], id: 'voice', type: 'audio' }] },
        { ...generation, id: 'volcengine', name: '火山引擎' },
      ], llmProviders: [], llmModels: [], hiddenProviders: new Set(['volcengine']), hiddenModels: new Set(),
    })
    expect(group.id).toBe('provider:volcengine')
    expect(group.credentialId).toBe('volcengine')
    expect(group.generationProviders?.map(provider => provider.id)).toEqual(['volcengine-speech', 'volcengine'])
    expect(group.models.map(model => [model.providerId, model.enabled])).toEqual([['volcengine-speech', true], ['volcengine', false]])
    expect(group.enabled).toBe(true)
  })
  it('把同一预设供应商的生成模型与 LLM 合并到一个凭据槽', () => {
    const [group] = buildProviderCenterGroups({
      generationProviders: [generation], llmProviders: [llmProvider()], llmModels: [llmModel],
      hiddenProviders: new Set(), hiddenModels: new Set(),
    })
    expect(group.credentialId).toBe('ppio')
    expect(group.models.slice(0, 2).map(model => model.source)).toEqual(['generation', 'llm'])
    expect(group.models[0]).toMatchObject({ category: 'image-generation', capabilityIds: ['image-generation'] })
    expect(group.models[1]).toMatchObject({ category: 'text-generation', capabilityIds: ['text-generation'] })
  })

  it('预设后来新增、配置里没有的模型也列出，显示为未启用，打开时加入配置', () => {
    const [group] = buildProviderCenterGroups({
      generationProviders: [generation], llmProviders: [llmProvider()], llmModels: [llmModel],
      hiddenProviders: new Set(), hiddenModels: new Set(),
    })
    const notAdded = group.models.find(model => model.source === 'llm' && model.modelId === 'zai-org/glm-5.3')
    expect(notAdded).toMatchObject({ enabled: false })
    // 预设里已过时的不列
    expect(group.models.some(model => model.modelId === 'moonshotai/kimi-k2.6')).toBe(false)
    const next = setLlmModelsEnabled([llmModel], [notAdded!], true)
    expect(next.map(model => [model.modelId, model.enabled])).toEqual([['text-one', true], ['zai-org/glm-5.3', true]])
    expect(setLlmModelsEnabled([llmModel], [group.models[1]], false)).toEqual([{ ...llmModel, enabled: false }])
    // 停用时不把未加入的预设模型写进配置；预设模型只能开关，不提供删除。
    expect(setLlmModelsEnabled([llmModel], [notAdded!], false)).toEqual([llmModel])
    expect(notAdded?.presetModel).toBe(true)
    expect(group.models[1].presetModel).toBe(false)
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
