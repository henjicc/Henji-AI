// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ set: vi.fn(), remove: vi.fn(), status: vi.fn(), emit: vi.fn() }))
vi.mock('@/commands/aiRuntime', () => ({ aiSetProviderApiKey: mocks.set, aiRemoveProviderApiKey: mocks.remove, aiGetProviderApiKey: vi.fn() }))
vi.mock('@/services/providerKeyStatus', () => ({ syncProviderKeyStatuses: async () => ({}) }))
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: (select: (state: { setProviderKeyStatus: typeof mocks.status }) => unknown) => select({ setProviderKeyStatus: mocks.status }) }))
vi.mock('@/core/events/applicationEvents', () => ({ emitApplicationEvent: mocks.emit }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn() }) }))
import { useApiKeys } from './useApiKeys'
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); mocks.set.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined) })
afterEach(() => { cleanup(); vi.useRealTimers() })
describe('生成密钥写入', () => {
  it.each([
    ['set', 'key', 'Electron safeStorage encryption is not available on this device', 'apiKeys.errors.encryptionUnavailable'],
    ['remove', '', 'Invalid keystore file format', 'apiKeys.errors.unreadable'],
    ['set', 'key', "ENOSPC: no space left on device, open 'provider-keys.enc.json'", 'apiKeys.errors.saveFailed'],
    ['remove', '', "EACCES: permission denied, open 'provider-keys.enc.json'", 'apiKeys.errors.saveFailed'],
    ['set', 'key', 'Unexpected end of JSON input', 'apiKeys.errors.unreadable'],
  ] as const)('暴露 %s 失败并在重新输入和成功后清除', async (operation, value, message, errorKey) => {
    mocks[operation].mockRejectedValueOnce(new Error(message))
    const { result } = renderHook(useApiKeys)
    await act(async () => {})
    act(() => result.current.updateKey('fal', value))
    await act(async () => { await vi.advanceTimersByTimeAsync(450) })
    expect(result.current).toMatchObject({ errors: { fal: errorKey } })
    expect(mocks.status).not.toHaveBeenCalled()
    act(() => result.current.updateKey('fal', 'retry'))
    expect(result.current).toMatchObject({ errors: { fal: undefined } })
    await act(async () => { await vi.advanceTimersByTimeAsync(450) })
    expect(mocks.status).toHaveBeenCalledWith('fal', true)
  })
  it.each(['new-key', ''])('卸载立即写入待保存值 %s，且只写一次', async value => {
    const { result, unmount } = renderHook(useApiKeys)
    await act(async () => {})
    act(() => result.current.updateKey('fal', value))
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(450) })
    expect(value ? mocks.set : mocks.remove).toHaveBeenCalledTimes(1)
    expect(value ? mocks.set : mocks.remove).toHaveBeenCalledWith(...(value ? ['fal', value] : ['fal']))
  })
})
