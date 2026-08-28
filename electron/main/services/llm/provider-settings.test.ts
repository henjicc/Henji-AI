import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LlmConfigState, LlmProviderConfig } from '@henjicc/ai-sdk'

import type { EncryptedKeySnapshot } from '../keystore'
import {
  LlmProviderSettingsService,
  type LlmProviderSettingsDependencies,
} from './provider-settings'
import type { ProviderSettingsJournal, ProviderSettingsStorage } from './provider-settings-storage'

vi.mock('../logging', () => ({
  createMainLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(),
  }),
}))

function emptyConfig(): LlmConfigState {
  return {
    providers: [],
    models: [],
    promptProfiles: [],
    textProcessingPromptTemplates: [],
    agentProfiles: [],
    tools: [],
    policy: { allowedTools: [], requireHumanConfirmation: false },
    memory: {},
  }
}

function customProvider(
  providerId = 'custom-one',
  credentialId = `${providerId}-credential`,
): LlmProviderConfig {
  return {
    providerId,
    providerFamilyId: 'openai-compatible',
    endpointProfile: 'default',
    credentialId,
    setup: { kind: 'custom', apiKeyManagementUrl: 'https://example.com/keys' },
    displayName: 'Custom One',
    adapter: 'openai',
    baseUrl: 'https://api.example.com/v1',
    enabled: true,
  }
}

interface MemoryState {
  config: LlmConfigState | null
  journal: ProviderSettingsJournal | null
  credentials: Map<string, string>
  failNextConfigWrite: boolean
  failNextCredentialSet: boolean
}

function createHarness(initialConfig: LlmConfigState | null = null): {
  state: MemoryState
  service: LlmProviderSettingsService
} {
  const state: MemoryState = {
    config: initialConfig,
    journal: null,
    credentials: new Map(),
    failNextConfigWrite: false,
    failNextCredentialSet: false,
  }
  const storage: ProviderSettingsStorage = {
    readConfig: async () => structuredClone(state.config),
    writeConfig: async config => {
      if (state.failNextConfigWrite) {
        state.failNextConfigWrite = false
        throw new Error('fault: config write')
      }
      state.config = structuredClone(config)
    },
    removeConfig: async () => { state.config = null },
    readJournal: async () => structuredClone(state.journal),
    writeJournal: async journal => { state.journal = structuredClone(journal) },
    removeJournal: async () => { state.journal = null },
  }
  const dependencies: LlmProviderSettingsDependencies = {
    storage,
    credentials: {
      capture: credentialId => ({
        storeKey: `llm:${credentialId}`,
        encrypted: state.credentials.get(credentialId) ?? null,
      }),
      set: (credentialId, apiKey) => {
        if (state.failNextCredentialSet) {
          state.failNextCredentialSet = false
          throw new Error('fault: credential set')
        }
        state.credentials.set(credentialId, `encrypted:${apiKey}`)
      },
      remove: credentialId => { state.credentials.delete(credentialId) },
      restore: (snapshot: EncryptedKeySnapshot) => {
        const credentialId = snapshot.storeKey.slice('llm:'.length)
        if (snapshot.encrypted === null) state.credentials.delete(credentialId)
        else state.credentials.set(credentialId, snapshot.encrypted)
      },
      configured: credentialId => state.credentials.has(credentialId),
    },
  }
  return { state, service: new LlmProviderSettingsService(dependencies) }
}

describe('LlmProviderSettingsService', () => {
  let baseline: LlmConfigState

  beforeEach(() => {
    baseline = emptyConfig()
  })

  it('一次提交创建供应商、模型和独立凭据，并返回安全的密钥页面 URL', async () => {
    const { service, state } = createHarness()
    const provider = customProvider()
    const result = await service.commit({
      provider,
      seedModels: [{
        providerId: provider.providerId,
        modelId: 'model-one',
        displayName: 'Model One',
        adapter: 'openai',
        capabilities: {
          text: true, image: false, video: false, audio: false, streaming: true,
          toolCall: false, parallelTools: false, jsonOutput: false,
          structuredOutputMode: 'none', reasoning: false, sampling: true,
          contextWindow: null, maxOutputTokens: null, usage: true,
        },
        enabled: true,
      }],
      baselineConfig: baseline,
      credential: { kind: 'set', apiKey: 'secret-value' },
    })

    expect(state.config?.providers).toHaveLength(1)
    expect(state.config?.models[0]).toMatchObject({ credentialId: 'custom-one-credential' })
    expect(state.credentials.get('custom-one-credential')).toBe('encrypted:secret-value')
    expect(result).toMatchObject({
      providerId: 'custom-one',
      credentialId: 'custom-one-credential',
      configured: true,
      apiKeyUrl: 'https://example.com/keys',
      credentialAction: 'set',
    })
    expect(state.journal).toBeNull()
  })

  it('更新配置时可显式保留旧密钥', async () => {
    const provider = customProvider()
    const initial = { ...baseline, providers: [provider] }
    const { service, state } = createHarness(initial)
    state.credentials.set('custom-one-credential', 'encrypted:old-secret')

    const result = await service.commit({
      provider: { ...provider, displayName: 'Renamed' },
      seedModels: [],
      baselineConfig: initial,
      credential: { kind: 'unchanged' },
    })

    expect(state.config?.providers[0].displayName).toBe('Renamed')
    expect(state.credentials.get('custom-one-credential')).toBe('encrypted:old-secret')
    expect(result.credentialAction).toBe('unchanged')
  })

  it('配置落盘失败时恢复旧配置和旧密钥', async () => {
    const provider = customProvider()
    const initial = { ...baseline, providers: [provider] }
    const { service, state } = createHarness(initial)
    state.credentials.set('custom-one-credential', 'encrypted:old-secret')
    state.failNextConfigWrite = true

    await expect(service.commit({
      provider: { ...provider, displayName: 'Should Roll Back' },
      seedModels: [],
      baselineConfig: initial,
      credential: { kind: 'set', apiKey: 'new-secret' },
    })).rejects.toThrow('previous settings were restored')

    expect(state.config).toEqual(initial)
    expect(state.credentials.get('custom-one-credential')).toBe('encrypted:old-secret')
    expect(state.journal).toBeNull()
  })

  it('凭据写入失败时不落新配置并清理事务日志', async () => {
    const { service, state } = createHarness()
    state.failNextCredentialSet = true

    await expect(service.commit({
      provider: customProvider(),
      seedModels: [],
      baselineConfig: baseline,
      credential: { kind: 'set', apiKey: 'new-secret' },
    })).rejects.toThrow('previous settings were restored')

    expect(state.config).toBeNull()
    expect(state.credentials.size).toBe(0)
    expect(state.journal).toBeNull()
  })

  it('删除自定义供应商时删除其模型和独占凭据', async () => {
    const provider = customProvider()
    const initial = {
      ...baseline,
      providers: [provider],
      models: [{
        providerId: provider.providerId,
        modelId: 'model-one',
        displayName: 'Model One',
        adapter: 'openai',
        capabilities: {
          text: true, image: false, video: false, audio: false, streaming: true,
          toolCall: false, parallelTools: false, jsonOutput: false,
          structuredOutputMode: 'none' as const, reasoning: false, sampling: true,
          contextWindow: null, maxOutputTokens: null, usage: true,
        },
        enabled: true,
      }],
    }
    const { service, state } = createHarness(initial)
    state.credentials.set('custom-one-credential', 'encrypted:secret')

    const result = await service.delete({ providerId: provider.providerId, baselineConfig: initial })
    expect(state.config?.providers).toEqual([])
    expect(state.config?.models).toEqual([])
    expect(state.credentials.has('custom-one-credential')).toBe(false)
    expect(result.credentialAction).toBe('removed')
  })

  it('共享 credential 被其他供应商使用时只删配置并保留密钥', async () => {
    const first = customProvider('custom-one', 'shared-slot')
    const second = customProvider('custom-two', 'shared-slot')
    const initial = { ...baseline, providers: [first, second] }
    const { service, state } = createHarness(initial)
    state.credentials.set('shared-slot', 'encrypted:secret')

    const result = await service.delete({ providerId: first.providerId, baselineConfig: initial })
    expect(state.config?.providers.map(item => item.providerId)).toEqual(['custom-two'])
    expect(state.credentials.get('shared-slot')).toBe('encrypted:secret')
    expect(result.credentialAction).toBe('preserved_shared')
  })

  it('拒绝永久删除内置 preset，并给出禁用或重置指引', async () => {
    const provider: LlmProviderConfig = {
      ...customProvider('ppio', 'ppio'),
      setup: { kind: 'preset', presetId: 'ppio', lifecycle: 'builtin' },
    }
    const initial = { ...baseline, providers: [provider] }
    const { service } = createHarness(initial)
    await expect(service.delete({ providerId: 'ppio', baselineConfig: initial }))
      .rejects.toThrow('set enabled=false to disable it or save its preset defaults to reset it')
  })

  it('内置 preset 通过同一提交入口禁用或恢复默认值，不需要删除记录', async () => {
    const provider: LlmProviderConfig = {
      ...customProvider('ppio', 'ppio'),
      setup: { kind: 'preset', presetId: 'ppio', lifecycle: 'builtin' },
    }
    const initial = { ...baseline, providers: [provider] }
    const { service, state } = createHarness(initial)

    await service.commit({
      provider: { ...provider, enabled: false }, seedModels: [], baselineConfig: initial,
      credential: { kind: 'unchanged' },
    })
    expect(state.config?.providers[0].enabled).toBe(false)
    expect(state.config?.providers[0].baseUrl).toBe('https://api.ppio.com/openai')

    await service.commit({
      provider: { ...provider, displayName: '派欧云', enabled: true }, seedModels: [], baselineConfig: initial,
      credential: { kind: 'unchanged' },
    })
    expect(state.config?.providers[0]).toMatchObject({ displayName: '派欧云', enabled: true })
  })

  it('供应商仍被提示词或 Agent profile 引用时拒绝删除', async () => {
    const provider = customProvider()
    const initial = {
      ...baseline,
      providers: [provider],
      promptProfiles: [{
        id: 'prompt', name: 'Prompt', providerId: provider.providerId, modelId: 'm',
        systemPrompt: '', userTemplate: '', capabilities: { text: true, image: false, video: false },
        isDefault: true, enabled: true, createdAt: 'now', updatedAt: 'now',
      }],
    }
    const { service } = createHarness(initial)
    await expect(service.delete({ providerId: provider.providerId, baselineConfig: initial }))
      .rejects.toThrow('promptProfiles:prompt')
  })

  it('凭据槽严格隔离，更新一个区域不会覆盖另一区域', async () => {
    const cn = customProvider('bigmodel-cn', 'bigmodel-cn-key')
    const global = customProvider('bigmodel-global', 'bigmodel-global-key')
    const initial = { ...baseline, providers: [cn, global] }
    const { service, state } = createHarness(initial)
    state.credentials.set('bigmodel-cn-key', 'encrypted:cn-secret')

    await service.commit({
      provider: global,
      seedModels: [],
      baselineConfig: initial,
      credential: { kind: 'set', apiKey: 'global-secret' },
    })

    expect(state.credentials.get('bigmodel-cn-key')).toBe('encrypted:cn-secret')
    expect(state.credentials.get('bigmodel-global-key')).toBe('encrypted:global-secret')
  })

  it('拒绝把明文凭据伪装成 provider 配置字段持久化', async () => {
    const { service, state } = createHarness()
    const provider = { ...customProvider(), api_key: 'must-not-persist' } as LlmProviderConfig
    await expect(service.commit({
      provider, seedModels: [], baselineConfig: baseline, credential: { kind: 'unchanged' },
    })).rejects.toThrow('must use the credential mutation field instead')
    expect(JSON.stringify(state.config)).not.toContain('must-not-persist')
    expect(state.journal).toBeNull()
  })

  it('启动时先恢复遗留 journal，再进行下一次读取', async () => {
    const current = { ...baseline, providers: [customProvider('new-state')] }
    const restored = { ...baseline, providers: [customProvider('old-state')] }
    const { service, state } = createHarness(current)
    state.credentials.set('slot', 'encrypted:new')
    state.journal = {
      version: 1,
      configBefore: restored,
      credentialBefore: { storeKey: 'llm:slot', encrypted: 'encrypted:old' },
    }

    expect(await service.readConfig()).toEqual(restored)
    expect(state.credentials.get('slot')).toBe('encrypted:old')
    expect(state.journal).toBeNull()
  })
})
