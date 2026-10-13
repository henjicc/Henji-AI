// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDefaultLlmConfig } from '@/core/llm/defaults'
const mocks = vi.hoisted(() => ({ commit: vi.fn(), getConfig: vi.fn() }))
vi.mock('@/services/llm', () => ({ llmConfigService: { getConfig: mocks.getConfig, commitProviderSettings: mocks.commit } }))
vi.mock('@/commands/llmRuntime', () => ({ llmGetProviderKeyStatus: async () => [], llmGetProviderApiKey: async () => '' }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn() }) }))
import { useLlmSettings } from './useLlmSettings'
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); mocks.getConfig.mockResolvedValue(createDefaultLlmConfig()); mocks.commit.mockResolvedValue({}) })
afterEach(() => { cleanup(); vi.useRealTimers() })
it.each(['key', ''])('LLM 密钥保存/删除失败可见并可重试：%s', async value => {
  mocks.commit.mockRejectedValueOnce(new Error('Invalid keystore file format'))
  const { result } = renderHook(useLlmSettings)
  await act(async () => {})
  const providerId = result.current.config.providers[0].providerId
  act(() => result.current.updateKey(providerId, value))
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(result.current).toMatchObject({ keyErrors: { [providerId]: 'apiKeys.errors.unreadable' } })
  act(() => result.current.updateKey(providerId, 'retry'))
  expect(result.current.keyErrors[providerId]).toBeUndefined()
})
it.each(['key', ''])('LLM 卸载时 flush 保存/删除：%s', async value => {
  const { result, unmount } = renderHook(useLlmSettings)
  await act(async () => {})
  const provider = result.current.config.providers[0]
  act(() => result.current.updateKey(provider.providerId, value))
  unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(mocks.commit).toHaveBeenCalledTimes(1)
  expect(mocks.commit).toHaveBeenCalledWith(provider, [], value ? { kind: 'set', apiKey: value } : { kind: 'remove' })
})
