import { describe, expect, it, vi } from 'vitest'
const storage = vi.hoisted(() => ({ readConfig: vi.fn() }))
vi.mock('../llm/provider-settings-storage', () => ({ createProviderSettingsFileStorage: () => storage }))
vi.mock('../keystore', () => ({ getLlmProviderApiKey: () => 'fixture-key' }))
import { listEmbeddedModels } from './models'

describe('内置助手跟随设置主模型', () => {
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
