// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmProviderConfig } from '@henjicc/ai-sdk'
import type { UseLlmSettingsResult } from '../hooks/useLlmSettings'

const mocks = vi.hoisted(() => ({ fetchModels: vi.fn() }))

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key, currentLanguage: 'zh-CN' }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('@/config/providers', () => ({ getProviders: () => [] }))
vi.mock('../hooks/useApiKeys', () => ({ useApiKeys: () => ({ keys: {}, visibility: {}, updateKey: vi.fn(), toggleVisibility: vi.fn() }) }))
vi.mock('../hooks/useExternalLink', () => ({ useExternalLink: () => ({ openExternal: vi.fn() }) }))
vi.mock('./useGenerationModelVisibility', () => ({
  useGenerationModelVisibility: () => ({
    hiddenProviders: new Set<string>(), hiddenModels: new Set<string>(),
    setProviderEnabled: vi.fn(), setModelEnabled: vi.fn(), setModelsEnabled: vi.fn(),
  }),
}))
vi.mock('@/services/llm/llmDiscoveryService', () => ({
  fetchOpenAiCompatibleModels: mocks.fetchModels,
  createModelFromInput: vi.fn(),
}))
// 弹窗本身不在这里核对；只留空壳，避免拉起完整的供应商表单
vi.mock('./LlmProviderDialog', () => ({ default: () => null }))
vi.mock('./LlmModelDialog', () => ({ default: () => null }))
vi.mock('./ModelSyncDialog', () => ({ ModelSyncDialog: () => null }))

import ProviderCenterSection from './ProviderCenterSection'

const provider: LlmProviderConfig = {
  providerId: 'custom-relay', credentialId: 'custom-relay',
  setup: { kind: 'custom' },
  displayName: '测试中转', adapter: 'openai', enabled: true, baseUrl: 'http://127.0.0.1:9/v1',
}

const llm = {
  loading: false,
  config: { providers: [provider], models: [], agentProfiles: [], selectedAgentProfileId: '' },
  keys: {}, visibility: {},
  updateKey: vi.fn(), toggleVisibility: vi.fn(),
  saveConfig: vi.fn(), commitProviderSettings: vi.fn(), deleteProviderSettings: vi.fn(),
} as unknown as UseLlmSettingsResult

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

describe('供应商中心：同步模型（5.6 第二批）', () => {
  it('同步中有进行中文案；失败后留在原位说明原因，按钮恢复可再试', async () => {
    let reject!: (reason: unknown) => void
    mocks.fetchModels.mockReturnValueOnce(new Promise((_, no) => { reject = no }))
    render(<ProviderCenterSection llm={llm} />)

    fireEvent.click(await screen.findByRole('button', { name: 'providerCenter.actions.syncModels' }))
    const syncing = await screen.findByRole('button', { name: 'providerCenter.actions.syncingModels' })
    expect(syncing.hasAttribute('disabled')).toBe(true)

    reject(new Error('401 密钥无效'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('providerCenter.syncFailed')
    expect(alert.textContent).toContain('401 密钥无效')
    await waitFor(() => expect(screen.getByRole('button', { name: 'providerCenter.actions.syncModels' }).hasAttribute('disabled')).toBe(false))
  })
})
