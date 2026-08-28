import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
  commit: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => {
      mocks.handlers.set(channel, handler)
    },
  },
}))

vi.mock('../services/llm/provider-settings', () => ({
  llmProviderSettingsService: {
    readConfig: mocks.readConfig,
    writeConfig: mocks.writeConfig,
    commit: mocks.commit,
    delete: mocks.delete,
  },
}))

import { registerLlmProviderSettingsIpc } from './llm-provider-settings'

const config = {
  providers: [], models: [], promptProfiles: [], textProcessingPromptTemplates: [],
  agentProfiles: [], tools: [], policy: { allowedTools: [], requireHumanConfirmation: false }, memory: {},
}

function handler(channel: string): (event: unknown, input: unknown) => Promise<unknown> {
  const value = mocks.handlers.get(channel)
  if (!value) throw new Error(`Missing handler: ${channel}`)
  return value
}

describe('LLM provider settings IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    vi.clearAllMocks()
    registerLlmProviderSettingsIpc()
  })

  it('高层提交完整保留 provider identity、baseline 与 credential mutation', async () => {
    const request = {
      provider: {
        providerId: 'bigmodel-global', providerFamilyId: 'bigmodel', endpointProfile: 'global',
        credentialId: 'bigmodel-global-key', setup: { kind: 'custom' }, displayName: 'Z.ai',
        adapter: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4', enabled: true,
      },
      seedModels: [],
      baselineConfig: config,
      credential: { kind: 'set', apiKey: 'secret-value' },
    }
    mocks.commit.mockResolvedValue({ config, providerId: request.provider.providerId })

    await expect(handler('llm:providerSettings:commit')({}, request)).resolves.toEqual({
      ok: true,
      data: { config, providerId: request.provider.providerId },
    })
    expect(mocks.commit).toHaveBeenCalledWith(request)
  })

  it('非法 payload 在进入领域服务前拒绝且错误不回显密钥', async () => {
    const response = await handler('llm:providerSettings:commit')({}, {
      provider: {
        providerId: 'custom', displayName: 'Custom', adapter: 'openai', apiKey: 'must-not-leak',
        setup: { kind: 'custom' }, enabled: true,
      },
      seedModels: [], baselineConfig: config,
      credential: { kind: 'set', apiKey: 'must-not-leak' },
    })

    expect(response).toMatchObject({ ok: false })
    expect(JSON.stringify(response)).not.toContain('must-not-leak')
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('嵌套明文凭据字段也在进入领域服务前拒绝', async () => {
    const response = await handler('llm:providerSettings:commit')({}, {
      provider: {
        providerId: 'custom', displayName: 'Custom', adapter: 'openai',
        setup: { kind: 'custom' }, enabled: true,
        extension: { auth: { refresh_token: 'nested-must-not-leak' } },
      },
      seedModels: [], baselineConfig: config,
      credential: { kind: 'unchanged' },
    })

    expect(response).toMatchObject({ ok: false })
    expect(JSON.stringify(response)).not.toContain('nested-must-not-leak')
    expect(mocks.commit).not.toHaveBeenCalled()
  })
})
