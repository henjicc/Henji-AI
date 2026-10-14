/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  let resizedHandler: (() => void) | null = null
  return {
    loggerError: vi.fn(),
    getDisplayWorkArea: vi.fn(),
    setZoomFactor: vi.fn(),
    onResized: vi.fn((handler: () => void) => {
      resizedHandler = handler
      return vi.fn()
    }),
    emitResized: () => resizedHandler?.(),
    resetResized: () => { resizedHandler = null },
  }
})

vi.mock('@/core/logging', () => ({
  createLogger: () => ({ error: mocks.loggerError }),
}))

vi.mock('@/platform/runtime', () => ({
  isDesktopRuntime: () => true,
  getPlatform: () => ({
    window: {
      getDisplayWorkArea: mocks.getDisplayWorkArea,
      setZoomFactor: mocks.setZoomFactor,
      onResized: mocks.onResized,
    },
  }),
}))

import { useSettingsStore } from '@/stores/settingsStore'
import { useApplyUiScale } from './useApplyUiScale'

describe('useApplyUiScale', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mocks.loggerError.mockReset()
    mocks.getDisplayWorkArea.mockReset()
    mocks.setZoomFactor.mockReset()
    mocks.onResized.mockClear()
    mocks.resetResized()
    useSettingsStore.getState().setUiScaleMode('auto')
    delete document.documentElement.dataset.uiScale
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('首次挂载按显示器工作区应用自动缩放', async () => {
    mocks.getDisplayWorkArea.mockResolvedValue({ width: 1280, height: 800 })
    mocks.setZoomFactor.mockResolvedValue(undefined)

    renderHook(() => useApplyUiScale())

    await waitFor(() => expect(mocks.setZoomFactor).toHaveBeenCalledWith(0.9))
    expect(document.documentElement.dataset.uiScale).toBe('90')
  })

  it('设置变化后立即应用手动缩放', async () => {
    mocks.getDisplayWorkArea.mockResolvedValue({ width: 1280, height: 800 })
    mocks.setZoomFactor.mockResolvedValue(undefined)
    renderHook(() => useApplyUiScale())
    await waitFor(() => expect(mocks.setZoomFactor).toHaveBeenCalledWith(0.9))

    act(() => useSettingsStore.getState().setUiScaleMode('110'))

    await waitFor(() => expect(mocks.setZoomFactor).toHaveBeenLastCalledWith(1.1))
    expect(document.documentElement.dataset.uiScale).toBe('110')
  })

  it('窗口变化事件延迟合并后重读显示器工作区，并跳过重复比例', async () => {
    vi.useFakeTimers()
    mocks.getDisplayWorkArea.mockResolvedValue({ width: 1920, height: 1080 })
    mocks.setZoomFactor.mockResolvedValue(undefined)
    renderHook(() => useApplyUiScale())
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mocks.setZoomFactor).toHaveBeenCalledTimes(1)

    mocks.getDisplayWorkArea.mockResolvedValue({ width: 1280, height: 800 })
    act(() => {
      mocks.emitResized()
      mocks.emitResized()
      vi.advanceTimersByTime(149)
    })
    expect(mocks.getDisplayWorkArea).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.setZoomFactor).toHaveBeenLastCalledWith(0.9)
    expect(mocks.getDisplayWorkArea).toHaveBeenCalledTimes(2)

    act(() => {
      mocks.emitResized()
      vi.advanceTimersByTime(150)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mocks.setZoomFactor).toHaveBeenCalledTimes(2)
  })

  it('同一显示器上调整窗口大小不改变界面比例', async () => {
    vi.useFakeTimers()
    mocks.getDisplayWorkArea.mockResolvedValue({ width: 1920, height: 1040 })
    mocks.setZoomFactor.mockResolvedValue(undefined)
    renderHook(() => useApplyUiScale())
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mocks.setZoomFactor).toHaveBeenCalledTimes(1)
    expect(mocks.setZoomFactor).toHaveBeenLastCalledWith(1)

    // 从最大化还原到小窗口：只有窗口变了，显示器工作区不变
    act(() => {
      mocks.emitResized()
      vi.advanceTimersByTime(150)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mocks.setZoomFactor).toHaveBeenCalledTimes(1)
    expect(document.documentElement.dataset.uiScale).toBe('100')
  })

  it('窗口能力失败时记录错误且不改写缩放', async () => {
    mocks.getDisplayWorkArea.mockRejectedValue(new Error('window unavailable'))
    renderHook(() => useApplyUiScale())

    await waitFor(() => expect(mocks.loggerError).toHaveBeenCalledTimes(1))
    expect(mocks.setZoomFactor).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.uiScale).toBeUndefined()
  })
})
