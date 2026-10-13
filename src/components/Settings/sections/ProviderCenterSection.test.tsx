// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LlmProviderConfig } from '@henjicc/ai-sdk'
import type { UseLlmSettingsResult } from '../hooks/useLlmSettings'
import type { Provider } from '@/config/providers'
import i18n from '@/i18n/config'

const mocks = vi.hoisted(() => ({ fetchModels: vi.fn(), providers: [] as Provider[], errors: {} as Record<string, string>, language: '' }))

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: mocks.language ? i18n.getFixedT(mocks.language, 'settings') : (key: string) => key, currentLanguage: mocks.language || 'zh-CN' }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('@/config/providers', () => ({ getProviders: () => mocks.providers }))
vi.mock('../hooks/useApiKeys', () => ({ useApiKeys: () => ({ keys: {}, visibility: {}, errors: mocks.errors, updateKey: vi.fn(), toggleVisibility: vi.fn() }) }))
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
  keys: {}, visibility: {}, keyErrors: {},
  updateKey: vi.fn(), toggleVisibility: vi.fn(),
  saveConfig: vi.fn(), commitProviderSettings: vi.fn(), deleteProviderSettings: vi.fn(),
} as unknown as UseLlmSettingsResult

beforeEach(() => { vi.clearAllMocks(); mocks.providers = []; mocks.errors = {}; mocks.language = '' })
afterEach(cleanup)

describe('供应商中心密钥错误', () => {
  it.each([
    ['zh-CN', 'encryptionUnavailable', '系统加密'],
    ['en-US', 'encryptionUnavailable', 'secure key storage'],
    ['zh-CN', 'unreadable', '无法读取'],
    ['en-US', 'unreadable', 'could not be read'],
    ['zh-CN', 'saveFailed', '可用空间'],
    ['en-US', 'saveFailed', 'free space'],
  ])('%s 密钥失败显示分类原因和恢复提示：%s', async (language, category, reason) => {
    mocks.language = language
    render(<ProviderCenterSection llm={{ ...llm, keyErrors: { 'custom-relay': `apiKeys.errors.${category}` } }} />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(reason)
    expect(alert.textContent).not.toContain('apiKeys.errors.')
    expect(alert.textContent).not.toContain('safeStorage')
  })
  it('LLM 凭据错误通过现有 alert 显示', async () => {
    render(<ProviderCenterSection llm={{ ...llm, keyErrors: { 'custom-relay': 'apiKeys.errors.saveFailed' } }} />)
    expect((await screen.findByRole('alert')).textContent).toBe('apiKeys.errors.saveFailed')
  })
  it.each([['fal'], ['volcengine', 'volcengine-speech']])('生成凭据 %s 分别显示错误', async (...ids) => {
    mocks.providers = ids.map(id => ({ id, name: id, type: 'image', models: [] }))
    mocks.errors = Object.fromEntries(ids.map(id => [id, `error-${id}`]))
    render(<ProviderCenterSection llm={{ ...llm, config: { ...llm.config, providers: [] } }} />)
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map(alert => alert.textContent)).toEqual(ids.map(id => `error-${id}`))
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0)
  })
})

describe('供应商中心：同步模型（5.6 第二批）', () => {
  it('同步中有进行中文案；失败后留在原位说明原因，按钮恢复可再试', async () => {
    let reject!: (reason: unknown) => void
    mocks.fetchModels.mockReturnValueOnce(new Promise((_, no) => { reject = no }))
    render(<ProviderCenterSection llm={llm} />)

    fireEvent.click(await screen.findByRole('button', { name: 'providerCenter.actions.syncModels' }))
    const syncing = await screen.findByRole('button', { name: 'providerCenter.actions.syncModels' })
    expect(syncing.getAttribute('aria-busy')).toBe('true')
    expect(syncing.getAttribute('aria-disabled')).toBe('true')

    reject(new Error('401 密钥无效'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('providerCenter.syncFailed')
    expect(alert.textContent).toContain('401 密钥无效')
    await waitFor(() => expect(screen.getByRole('button', { name: 'providerCenter.actions.syncModels' }).hasAttribute('disabled')).toBe(false))
  })
})

describe('供应商中心：右键编辑与删除', () => {
  it('自定义供应商右键出现编辑连接与删除；确认后删除', async () => {
    render(<ProviderCenterSection llm={llm} />)
    fireEvent.contextMenu(await screen.findByRole('button', { name: '测试中转' }))
    expect(await screen.findByRole('menuitem', { name: /providerCenter.actions.editConnection/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: /providerCenter.actions.deleteProvider/ }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'providerCenter.actions.deleteProvider' }))
    await waitFor(() => expect(llm.deleteProviderSettings).toHaveBeenCalledWith('custom-relay'))
  })
})

describe('供应商中心：内置供应商右键', () => {
  it('内置供应商右键也有反馈：一条灰掉的说明', async () => {
    const builtin = { ...provider, providerId: 'deepseek', displayName: '内置DS', setup: { kind: 'preset', presetId: 'deepseek', lifecycle: 'builtin' } } as LlmProviderConfig
    render(<ProviderCenterSection llm={{ ...llm, config: { ...llm.config, providers: [builtin] } } as UseLlmSettingsResult} />)
    fireEvent.contextMenu(await screen.findByRole('button', { name: '内置DS' }))
    const item = await screen.findByRole('menuitem', { name: /providerCenter.builtinNoEdit/ })
    expect((item as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('menuitem', { name: /deleteProvider/ })).toBeNull()
  })
})
