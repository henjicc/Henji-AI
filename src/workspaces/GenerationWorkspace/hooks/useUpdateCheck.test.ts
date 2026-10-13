// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdaterEvent } from '@/platform/contracts/updater'
const mocks = vi.hoisted(() => ({ listener: null as ((event: UpdaterEvent) => void) | null, check: vi.fn() }))
vi.mock('@/platform/runtime', () => ({ detectShell: () => 'electron', getPlatform: () => ({ updater: { onEvent: (listener: (event: UpdaterEvent) => void) => { mocks.listener = listener; return () => { mocks.listener = null } } } }) }))
vi.mock('@/services/updateChecker', () => ({ getCurrentVersion: () => '1.0.0', checkForUpdates: mocks.check }))
vi.mock('@/core/development/developmentLaunch', () => ({ readDevelopmentLaunchOptions: () => ({ updatePreview: null }) }))
import { addIgnoredVersion } from '@/utils/updateConfig'
import { useUpdateCheck } from './useUpdateCheck'

const releaseInfo = { version: '2.0.0', name: 'v2', body: '', publishedAt: '2026-10-01', htmlUrl: '' }
function emit(status: 'available' | 'downloading' | 'downloaded', latestVersion?: string) {
  mocks.listener!({ type: status === 'downloading' ? 'download-progress' : status, result: { status, hasUpdate: true, currentVersion: '1.0.0', latestVersion, releaseInfo } })
}
beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); mocks.check.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })
describe('更新事件与忽略版本', () => {
  it('事件先于检查返回时，已忽略版本仍不打开弹窗', async () => {
    addIgnoredVersion('2.0.0')
    mocks.check.mockImplementation(async () => { emit('available'); return { hasUpdate: true, releaseInfo } })
    const { result } = renderHook(useUpdateCheck)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(result.current.showUpdateDialog).toBe(false)
  })
  it('手动检查的 available 事件同样尊重最新版本忽略列表', () => {
    addIgnoredVersion('2.1.0')
    const { result } = renderHook(useUpdateCheck)
    act(() => emit('available', '2.1.0'))
    expect(result.current.showUpdateDialog).toBe(false)
    act(() => emit('available', '2.2.0'))
    expect(result.current.showUpdateDialog).toBe(true)
  })
  it.each(['downloading', 'downloaded'] as const)('用户主动更新的 %s 状态继续显示', (status) => {
    addIgnoredVersion('2.0.0')
    const { result } = renderHook(useUpdateCheck)
    act(() => emit(status))
    expect(result.current.showUpdateDialog).toBe(true)
  })
})
