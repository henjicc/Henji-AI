// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createDefaultLlmConfig } from '@/core/llm/defaults'
const mocks = vi.hoisted(() => ({ commit: vi.fn(), getConfig: vi.fn(), status: vi.fn() }))
vi.mock('@/services/llm', () => ({ llmConfigService: { getConfig: mocks.getConfig, commitProviderSettings: mocks.commit } }))
vi.mock('@/commands/llmRuntime', () => ({ llmGetProviderKeyStatus: mocks.status }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn() }) }))
import { useLlmSettings } from './useLlmSettings'
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); mocks.getConfig.mockResolvedValue(createDefaultLlmConfig()); mocks.commit.mockResolvedValue({}); mocks.status.mockResolvedValue([]) })
afterEach(() => { cleanup(); vi.useRealTimers() })
it.each(['key', ''])('LLM 密钥保存/删除失败可见并可重试：%s', async value => {
  mocks.commit.mockRejectedValueOnce(new Error('Invalid keystore file format'))
  const { result } = renderHook(useLlmSettings)
  await act(async () => {})
  const providerId = result.current.config.providers[0].providerId
  act(() => value ? result.current.updateKey(providerId, value) : result.current.clearKey(providerId))
  if (value) await act(async () => result.current.saveKey(providerId))
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(result.current).toMatchObject({ keyErrors: { [providerId]: 'apiKeys.errors.unreadable' } })
  act(() => result.current.updateKey(providerId, 'retry'))
  expect(result.current.keyErrors[providerId]).toBeUndefined()
})
it.each(['unfinished-key', ''])('LLM 输入停顿和卸载不保存草稿，删除只走清除按钮：%j', async value => {
  const { result, unmount } = renderHook(useLlmSettings)
  await act(async () => {})
  const provider = result.current.config.providers[0]
  act(() => value ? result.current.updateKey(provider.providerId, value) : result.current.clearKey(provider.providerId))
  await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
  unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(mocks.commit).toHaveBeenCalledTimes(value ? 0 : 1)
  if (!value) expect(mocks.commit).toHaveBeenCalledWith(provider, [], { kind: 'remove' })
})

it('LLM 只展示共享凭据摘要，替换和清除走原子设置入口', async () => {
  const config = createDefaultLlmConfig()
  const provider = config.providers[0]
  const credentialId = provider.credentialId ?? provider.providerId
  mocks.status.mockResolvedValue([{ credentialId, configured: true, maskedHint: '••••5678' }])
  const { result } = renderHook(useLlmSettings)
  await act(async () => {})
  expect(result.current.keys[provider.providerId]).toBeUndefined()
  expect(result.current.hints[provider.providerId]).toBe('••••5678')
  act(() => result.current.updateKey(provider.providerId, 'replacement'))
  await act(async () => result.current.saveKey(provider.providerId))
  expect(mocks.commit).toHaveBeenCalledWith(provider, [], { kind: 'set', apiKey: 'replacement' })
  expect(result.current.keys[provider.providerId]).toBe('')
  mocks.status.mockResolvedValue([{ credentialId, configured: false, maskedHint: null }])
  act(() => result.current.clearKey(provider.providerId))
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(mocks.commit).toHaveBeenLastCalledWith(provider, [], { kind: 'remove' })
  expect(result.current.hints[provider.providerId]).toBe('')
  expect(result.current.status[provider.providerId]).toBe(false)
})

it.each(['', '   '])('LLM 清空草稿不改已保存密钥，提交空值与卸载也不写入：%j', async empty => {
  const provider = createDefaultLlmConfig().providers[0]
  mocks.status.mockResolvedValue([{ credentialId: provider.credentialId ?? provider.providerId, configured: true, maskedHint: '••••5678' }])
  const { result, unmount } = renderHook(useLlmSettings)
  await act(async () => {})
  act(() => result.current.updateKey(provider.providerId, 'unfinished-replacement'))
  act(() => result.current.updateKey(provider.providerId, empty))
  await act(async () => result.current.saveKey(provider.providerId))
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(result.current.status[provider.providerId]).toBe(true)
  act(() => result.current.updateKey(provider.providerId, 'another-draft'))
  act(() => result.current.updateKey(provider.providerId, empty))
  unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(mocks.commit).not.toHaveBeenCalled()
})

it('LLM 清除按钮取消待保存草稿，卸载不会重新保存', async () => {
  const { result, unmount } = renderHook(useLlmSettings)
  await act(async () => {})
  const provider = result.current.config.providers[0]
  act(() => result.current.updateKey(provider.providerId, 'pending-replacement'))
  await act(async () => result.current.clearKey(provider.providerId))
  unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(mocks.commit).toHaveBeenCalledTimes(1)
  expect(mocks.commit).toHaveBeenCalledWith(provider, [], { kind: 'remove' })
})
