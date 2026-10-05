// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useDataPath } from './useDataPath'

/*
 * 作品目录设置（任务 4.2）：更换在应用关闭屏障里进行，完成后在冻结期间重启；
 * 屏障拒绝（有操作在进行）、主进程失败、取消都给出对应提示且不重启。
 */

const mocks = vi.hoisted(() => {
  class ApplicationCloseBusyError extends Error {}
  return {
    ApplicationCloseBusyError,
    openDialog: vi.fn(),
    getWorkRootInfo: vi.fn(),
    inspectWorkRootTarget: vi.fn(),
    changeWorkRoot: vi.fn(),
    cancelWorkRootChange: vi.fn(),
    openWorkRoot: vi.fn(),
    relaunchAfterWorkRootChange: vi.fn(),
    closeApplication: vi.fn(),
  }
})

vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('@/platform/desktopApi', () => ({ openDialog: mocks.openDialog }))
vi.mock('@/commands/workRoot', () => ({
  getWorkRootInfo: mocks.getWorkRootInfo,
  inspectWorkRootTarget: mocks.inspectWorkRootTarget,
  changeWorkRoot: mocks.changeWorkRoot,
  cancelWorkRootChange: mocks.cancelWorkRootChange,
  openWorkRoot: mocks.openWorkRoot,
  relaunchAfterWorkRootChange: mocks.relaunchAfterWorkRootChange,
}))
vi.mock('@/features/application-control/applicationCloseService', () => ({
  ApplicationCloseBusyError: mocks.ApplicationCloseBusyError,
  closeApplication: mocks.closeApplication,
}))

const order: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  order.length = 0
  mocks.getWorkRootInfo.mockResolvedValue({ root: '/docs/痕迹AI', defaultRoot: '/docs/痕迹AI', isCustom: false })
  mocks.openDialog.mockResolvedValue('/d/作品')
  mocks.inspectWorkRootTarget.mockResolvedValue({ root: '/d/作品', status: 'ok' })
  mocks.closeApplication.mockImplementation(async (confirm: () => Promise<void>) => {
    order.push('saved-and-frozen')
    await confirm()
    order.push('unfrozen')
  })
  mocks.changeWorkRoot.mockImplementation(async () => {
    order.push('moved')
    return { changed: true, root: '/d/作品', mode: 'rename', oldRootRemoved: true, requiresRestart: true }
  })
  mocks.relaunchAfterWorkRootChange.mockImplementation(async () => { order.push('relaunch') })
})

async function selectAndConfirm(result: { current: ReturnType<typeof useDataPath> }): Promise<void> {
  await act(async () => { await result.current.selectDirectory() })
  expect(result.current.confirm).toEqual({ open: true, mode: 'change', targetPath: '/d/作品' })
  await act(async () => { await result.current.confirmMove() })
}

describe('useDataPath', () => {
  it('确认后先保存并冻结，再移动，冻结期间重启', async () => {
    const { result } = renderHook(() => useDataPath())
    await waitFor(() => expect(result.current.currentPath).toBe('/docs/痕迹AI'))
    await selectAndConfirm(result)
    expect(mocks.changeWorkRoot).toHaveBeenCalledWith({ kind: 'custom', folder: '/d/作品' }, expect.any(Function))
    expect(order).toEqual(['saved-and-frozen', 'moved', 'relaunch', 'unfrozen'])
    expect(result.current.isMigrating).toBe(false)
  })

  it('目标不可用时直接提示，不打开确认框', async () => {
    mocks.inspectWorkRootTarget.mockResolvedValue({ root: '/d/作品/痕迹AI', status: 'notEmpty' })
    const { result } = renderHook(() => useDataPath())
    await act(async () => { await result.current.selectDirectory() })
    expect(result.current.confirm.open).toBe(false)
    expect(result.current.alert).toEqual({ open: true, message: { key: 'alerts.workRoot.notEmpty', params: { path: '/d/作品/痕迹AI' } } })
  })

  it('有操作在进行时屏障拒绝：不移动、不重启，提示稍后再试', async () => {
    mocks.closeApplication.mockRejectedValue(new mocks.ApplicationCloseBusyError('还有操作正在进行'))
    const { result } = renderHook(() => useDataPath())
    await selectAndConfirm(result)
    expect(mocks.changeWorkRoot).not.toHaveBeenCalled()
    expect(mocks.relaunchAfterWorkRootChange).not.toHaveBeenCalled()
    expect(result.current.alert.message.key).toBe('alerts.workRoot.busy')
  })

  it('主进程失败或取消：不重启，按原因提示', async () => {
    mocks.changeWorkRoot.mockRejectedValueOnce(new Error('in_use:作品目录里有文件正被其他程序使用'))
    const { result } = renderHook(() => useDataPath())
    await selectAndConfirm(result)
    expect(result.current.alert.message.key).toBe('alerts.workRoot.inUse')

    mocks.changeWorkRoot.mockRejectedValueOnce(new Error('cancelled:已取消更换作品目录'))
    await selectAndConfirm(result)
    expect(result.current.alert.message.key).toBe('alerts.workRoot.cancelled')
    expect(mocks.relaunchAfterWorkRootChange).not.toHaveBeenCalled()
  })
})
