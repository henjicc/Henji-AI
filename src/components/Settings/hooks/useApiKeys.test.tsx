// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ set: vi.fn(), remove: vi.fn(), status: vi.fn(), emit: vi.fn(), info: vi.fn(), statuses: vi.fn() }))
vi.mock('@/commands/aiRuntime', () => ({ aiSetProviderApiKey: mocks.set, aiRemoveProviderApiKey: mocks.remove, aiGetProviderKeyInfo: mocks.info }))
vi.mock('@/services/providerKeyStatus', () => ({ syncProviderKeyStatuses: mocks.statuses }))
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: (select: (state: { setProviderKeyStatus: typeof mocks.status }) => unknown) => select({ setProviderKeyStatus: mocks.status }) }))
vi.mock('@/core/events/applicationEvents', () => ({ emitApplicationEvent: mocks.emit }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn() }) }))
import { useApiKeys } from './useApiKeys'
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); mocks.set.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined); mocks.statuses.mockResolvedValue({}); mocks.info.mockResolvedValue({ configured: true, maskedHint: '••••1234' }) })
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
    act(() => value ? result.current.updateKey('fal', value) : result.current.clearKey('fal'))
    if (value) await act(async () => result.current.saveKey('fal'))
    await act(async () => { await vi.advanceTimersByTimeAsync(450) })
    expect(result.current).toMatchObject({ errors: { fal: errorKey } })
    expect(mocks.status).not.toHaveBeenCalled()
    act(() => result.current.updateKey('fal', 'retry'))
    expect(result.current).toMatchObject({ errors: { fal: undefined } })
    await act(async () => result.current.saveKey('fal'))
    expect(mocks.status).toHaveBeenCalledWith('fal', true)
    expect(result.current.keys.fal).toBe('')
    expect(result.current.hints.fal).toBe('••••1234')
  })
  it.each(['unfinished-key', ''])('输入停顿和卸载不保存草稿，只有清除按钮删除：%j', async value => {
    const { result, unmount } = renderHook(useApiKeys)
    await act(async () => {})
    act(() => value ? result.current.updateKey('fal', value) : result.current.clearKey('fal'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(mocks.set).not.toHaveBeenCalled()
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(450) })
    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.remove).toHaveBeenCalledTimes(value ? 0 : 1)
  })
})

it('已配置密钥只回填摘要，替换和清除不把掩码当作密钥写入', async () => {
  mocks.statuses.mockResolvedValue({ fal: true })
  const { result } = renderHook(useApiKeys)
  await act(async () => {})
  expect(result.current.keys.fal).toBe('')
  expect(result.current.hints.fal).toBe('••••1234')
  expect(mocks.set).not.toHaveBeenCalled()
  act(() => result.current.updateKey('fal', 'replacement'))
  await act(async () => result.current.saveKey('fal'))
  expect(mocks.set).toHaveBeenCalledWith('fal', 'replacement')
  expect(result.current.keys.fal).toBe('')
  mocks.info.mockResolvedValue({ configured: false, maskedHint: null })
  act(() => result.current.clearKey('fal'))
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(mocks.remove).toHaveBeenCalledWith('fal')
  expect(result.current.hints.fal).toBeUndefined()
  expect(mocks.status).toHaveBeenLastCalledWith('fal', false)
})

it.each(['', '   '])('清空替换草稿不改已保存密钥，提交空值与卸载也不写入：%j', async empty => {
  mocks.statuses.mockResolvedValue({ fal: true })
  const { result, unmount } = renderHook(useApiKeys)
  await act(async () => {})
  act(() => result.current.updateKey('fal', 'unfinished-replacement'))
  act(() => result.current.updateKey('fal', empty))
  await act(async () => result.current.saveKey('fal'))
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(result.current.hints.fal).toBe('••••1234')
  act(() => result.current.updateKey('fal', 'another-draft'))
  act(() => result.current.updateKey('fal', empty))
  unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(mocks.set).not.toHaveBeenCalled()
  expect(mocks.remove).not.toHaveBeenCalled()
  expect(mocks.status).not.toHaveBeenCalled()
})

it('清除按钮取消待保存草稿，卸载不会重新保存', async () => {
  const { result, unmount } = renderHook(useApiKeys)
  await act(async () => {})
  act(() => result.current.updateKey('fal', 'pending-replacement'))
  await act(async () => result.current.clearKey('fal'))
  unmount()
  await act(async () => { await vi.advanceTimersByTimeAsync(450) })
  expect(mocks.remove).toHaveBeenCalledTimes(1)
  expect(mocks.set).not.toHaveBeenCalled()
})

it('摘要尚未返回时编辑再清空草稿，仍保留已保存凭据的摘要', async () => {
  mocks.statuses.mockResolvedValue({ fal: true })
  let finish!: (info: { configured: boolean; maskedHint: string }) => void
  mocks.info.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { result } = renderHook(useApiKeys)
  await act(async () => {})
  act(() => result.current.updateKey('fal', 'unfinished-replacement'))
  act(() => result.current.updateKey('fal', ''))
  await act(async () => { finish({ configured: true, maskedHint: '••••1234' }); await vi.advanceTimersByTimeAsync(450) })
  expect(result.current.hints.fal).toBe('••••1234')
  expect(mocks.set).not.toHaveBeenCalled()
  expect(mocks.remove).not.toHaveBeenCalled()
})
