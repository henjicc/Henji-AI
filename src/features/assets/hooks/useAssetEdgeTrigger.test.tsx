/** @vitest-environment jsdom */

import { fireEvent, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAssetEdgeTrigger } from './useAssetEdgeTrigger'

describe('资产悬浮面板边缘触发', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('鼠标在边缘停留达到延迟后打开', () => {
    const onOpen = vi.fn()
    renderHook(() => useAssetEdgeTrigger({
      enabled: true,
      edge: 'right',
      delayMs: 650,
      dragDelayMs: 180,
      open: false,
      onOpen,
    }))

    fireEvent.pointerMove(document.body, { clientX: 999, buttons: 0 })
    vi.advanceTimersByTime(649)
    expect(onOpen).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('窗口标题栏操作区不会误触边缘打开', () => {
    const onOpen = vi.fn()
    const windowControls = document.createElement('div')
    windowControls.dataset.windowNodrag = ''
    document.body.appendChild(windowControls)
    renderHook(() => useAssetEdgeTrigger({
      enabled: true,
      edge: 'right',
      delayMs: 650,
      dragDelayMs: 180,
      open: false,
      onOpen,
    }))

    fireEvent.pointerMove(windowControls, { clientX: 999, buttons: 0 })
    vi.advanceTimersByTime(650)
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('拖拽到边缘达到拖拽延迟后打开', () => {
    const onOpen = vi.fn()
    renderHook(() => useAssetEdgeTrigger({
      enabled: true,
      edge: 'right',
      delayMs: 650,
      dragDelayMs: 180,
      open: false,
      onOpen,
    }))

    fireEvent(document.body, new MouseEvent('dragover', { bubbles: true, clientX: 999 }))
    vi.advanceTimersByTime(180)
    expect(onOpen).toHaveBeenCalledOnce()
  })
})
