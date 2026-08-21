/** @vitest-environment jsdom */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  let resizedHandler: (() => void) | null = null
  return {
    loggerError: vi.fn(),
    getContentSize: vi.fn(),
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
      getContentSize: mocks.getContentSize,
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
    mocks.getContentSize.mockReset()
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

  it('首次挂载按窗口逻辑尺寸应用自动缩放', async () => {
    mocks.getContentSize.mockResolvedValue({ width: 1280, height: 800 })
    mocks.setZoomFactor.mockResolvedValue(undefined)

    renderHook(() => useApplyUiScale())

    await waitFor(() => expect(mocks.setZoomFactor).toHaveBeenCalledWith(0.9))
    expect(document.documentElement.dataset.uiScale).toBe('90')
  })

  it('设置变化后立即应用手动缩放', async () => {
    mocks.getContentSize.mockResolvedValue({ width: 1280, height: 800 })
    mocks.setZoomFactor.mockResolvedValue(undefined)
    renderHook(() => useApplyUiScale())
    await waitFor(() => expect(mocks.setZoomFactor).toHaveBeenCalledWith(0.9))

    act(() => useSettingsStore.getState().setUiScaleMode('110'))

    await waitFor(() => expect(mocks.setZoomFactor).toHaveBeenLastCalledWith(1.1))
    expect(document.documentElement.dataset.uiScale).toBe('110')
  })

  it('窗口连续变化时延迟合并，并跳过重复比例', async () => {
    vi.useFakeTimers()
    mocks.getContentSize.mockResolvedValue({ width: 1920, height: 1080 })
    mocks.setZoomFactor.mockResolvedValue(undefined)
    renderHook(() => useApplyUiScale())
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mocks.setZoomFactor).toHaveBeenCalledTimes(1)

    mocks.getContentSize.mockResolvedValue({ width: 1280, height: 800 })
    act(() => {
      mocks.emitResized()
      mocks.emitResized()
      vi.advanceTimersByTime(149)
    })
    expect(mocks.getContentSize).toHaveBeenCalledTimes(1)

    await act(async () => {
      vi.advanceTimersByTime(1)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.setZoomFactor).toHaveBeenLastCalledWith(0.9)
    expect(mocks.getContentSize).toHaveBeenCalledTimes(2)

    act(() => {
      mocks.emitResized()
      vi.advanceTimersByTime(150)
    })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(mocks.setZoomFactor).toHaveBeenCalledTimes(2)
  })

  it('窗口能力失败时记录错误且不改写缩放', async () => {
    mocks.getContentSize.mockRejectedValue(new Error('window unavailable'))
    renderHook(() => useApplyUiScale())

    await waitFor(() => expect(mocks.loggerError).toHaveBeenCalledTimes(1))
    expect(mocks.setZoomFactor).not.toHaveBeenCalled()
    expect(document.documentElement.dataset.uiScale).toBeUndefined()
  })
})
