import { describe, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => ({ readConfig: vi.fn() }))
vi.mock('../llm/provider-settings-storage', () => ({ createProviderSettingsFileStorage: () => storage }))
vi.mock('../keystore', () => ({ getLlmProviderApiKey: () => 'fixture-key' }))
import { listEmbeddedModels, resolveEmbeddedModel } from './models'
import { embeddedModelLimits, embeddedThinkingLevel } from './modelOptions'
import type { EmbeddedModel } from './contracts'

it('注册和预算共用输出上限，未知窗口留出输入空间，思考遵从显式设置', () => {
  const selected = { model: { capabilities: { reasoning: true, contextWindow: null, maxOutputTokens: null } } } as EmbeddedModel
  expect(embeddedModelLimits(selected.model)).toEqual({ contextWindow: 128000, maxOutputTokens: 32768 })
  expect(embeddedModelLimits({ ...selected.model, capabilities: { ...selected.model.capabilities, contextWindow: 128000, maxOutputTokens: 8192 } })).toEqual({ contextWindow: 128000, maxOutputTokens: 8192 })
  expect(embeddedModelLimits({ ...selected.model, capabilities: { ...selected.model.capabilities, maxOutputTokens: 64000 } }).maxOutputTokens).toBe(32768)
  expect(embeddedThinkingLevel(selected)).toBe('high')
  expect(embeddedThinkingLevel({ ...selected, reasoning: { enabled: true, effort: 'low' } })).toBe('low')
  expect(embeddedThinkingLevel({ ...selected, reasoning: { enabled: false, effort: 'high' } })).toBe('off')
  expect(embeddedThinkingLevel({ ...selected, reasoning: { enabled: true, effort: 'max' } })).toBe('xhigh')
  expect(embeddedThinkingLevel({ ...selected, model: { ...selected.model, capabilities: { ...selected.model.capabilities, reasoning: false } } })).toBe('off')
})

describe('内置助手跟随设置主模型', () => {
  it('把供应商已有思考档位传入 Pi 配置', async () => {
    storage.readConfig.mockResolvedValue({ providers: [{ providerId: 'p', enabled: true, reasoning: { enabled: true, effort: 'low' }, baseUrl: 'https://example.test/v1', adapter: 'openai-compatible' }],
      models: [{ providerId: 'p', modelId: 'm', enabled: true, capabilities: { text: true, toolCall: true } }] })
    expect((await resolveEmbeddedModel({ providerId: 'p', modelId: 'm' })).reasoning).toEqual({ enabled: true, effort: 'low' })
  })
  it.each(['model', 'provider'])('Responses 协议来自 %s 时过滤音频并保留图片', async source => {
    storage.readConfig.mockResolvedValue({
      providers: [{ providerId: 'p', enabled: true, displayName: 'P', ...(source === 'provider' ? { apiProtocol: 'openai-responses' } : {}) }],
      models: [{ providerId: 'p', modelId: 'm', displayName: 'M', enabled: true,
        capabilities: { text: true, toolCall: true, image: true, audio: true }, ...(source === 'model' ? { apiProtocol: 'openai-responses' } : {}) }],
      agentProfiles: [],
    })
    expect((await listEmbeddedModels())[0].inputModalities).toEqual(['image'])
  })
  it('使用选中配置的主模型及其附件能力，不使用列表首项', async () => {
    storage.readConfig.mockResolvedValue({ providers: [{ providerId: 'p', enabled: true, displayName: 'P' }],
      models: ['first', 'selected'].map(modelId => ({ providerId: 'p', modelId, displayName: modelId, enabled: true,
        capabilities: { text: true, toolCall: true, image: modelId === 'selected' } })),
      agentProfiles: [{ id: 'other', primary: { providerId: 'p', modelId: 'first' } }, { id: 'active', primary: { providerId: 'p', modelId: 'selected' } }], selectedAgentProfileId: 'active' })
    expect(await listEmbeddedModels()).toEqual([{ providerId: 'p', modelId: 'selected', name: 'selected · P', inputModalities: ['image'] }])
  })
  it('已配置的主模型不可用时不偷偷换模型', async () => {
    storage.readConfig.mockResolvedValue({ providers: [], models: [], agentProfiles: [{ id: 'active', primary: { providerId: 'p', modelId: 'missing' } }] })
    expect(await listEmbeddedModels()).toEqual([])
  })
})
