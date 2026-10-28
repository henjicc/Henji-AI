import { expect, it, vi } from 'vitest'
import { createDefaultLlmConfig } from '@/core/llm/defaults'
import { redactRegisteredSecretText } from '@/core/logging/sanitize'
import { aiRemoveProviderApiKey, aiSetProviderApiKey } from './aiRuntime'
import { llmCommitProviderSettings } from './llmRuntime'

const platform = vi.hoisted(() => ({
  aiRuntime: { setProviderApiKey: vi.fn(), removeProviderApiKey: vi.fn() },
  llmRuntime: { commitProviderSettings: vi.fn() },
}))
vi.mock('@/platform/runtime', () => ({ isDesktopRuntime: () => true, getPlatform: () => platform }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn() }) }))
vi.mock('@/services/paidApproval', () => ({ withPaidOperation: vi.fn() }))

it('生成凭据仅在 IPC 保存成功后登记，失败不替换，清除后注销', async () => {
  const original = 'opaque-command-original'
  const replacement = 'opaque-command-replacement'
  await aiSetProviderApiKey('command-fixture', original)
  platform.aiRuntime.setProviderApiKey.mockRejectedValueOnce(new Error('save failed'))
  await expect(aiSetProviderApiKey('command-fixture', replacement)).rejects.toThrow('save failed')
  expect(redactRegisteredSecretText(`${original} ${replacement}`)).toBe(`*** ${replacement}`)
  await aiSetProviderApiKey('command-fixture', replacement)
  expect(redactRegisteredSecretText(`${original} ${replacement}`)).toBe(`${original} ***`)
  await aiRemoveProviderApiKey('command-fixture')
  expect(redactRegisteredSecretText(replacement)).toBe(replacement)
})

it('LLM 事务失败不登记，成功与删除按实际凭据槽更新登记', async () => {
  const key = 'opaque-llm-command-credential'
  const config = createDefaultLlmConfig()
  const provider = { ...config.providers[0], credentialId: 'llm-command-fixture' }
  const request = { provider, seedModels: [], baselineConfig: config, credential: { kind: 'set' as const, apiKey: key } }
  platform.llmRuntime.commitProviderSettings.mockRejectedValueOnce(new Error('save failed'))
  await expect(llmCommitProviderSettings(request)).rejects.toThrow('save failed')
  expect(redactRegisteredSecretText(key)).toBe(key)
  const result = { config, providerId: provider.providerId, credentialId: provider.credentialId, configured: true, apiKeyUrl: null, credentialAction: 'set', rollbackStatus: 'not-needed' }
  platform.llmRuntime.commitProviderSettings.mockResolvedValueOnce(result)
  await llmCommitProviderSettings(request)
  expect(redactRegisteredSecretText(key)).toBe('***')
  platform.llmRuntime.commitProviderSettings.mockResolvedValueOnce({ ...result, configured: false, credentialAction: 'removed' })
  await llmCommitProviderSettings({ ...request, credential: { kind: 'remove' } })
  expect(redactRegisteredSecretText(key)).toBe(key)
})
