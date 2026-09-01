/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useImageEditorViewportWheelV3 } from './useImageEditorViewportWheelV3'

describe('useImageEditorViewportWheelV3', () => {
  afterEach(cleanup)

  it('用非被动监听拦截缩放滚轮并按指针位置更新视口', () => {
    const surface = document.createElement('main')
    const zoomAroundClientPoint = vi.fn()
    renderHook(() => useImageEditorViewportWheelV3(
      { current: surface },
      'zoom',
      2,
      zoomAroundClientPoint,
    ))
    const event = new WheelEvent('wheel', {
      cancelable: true,
      clientX: 120,
      clientY: 80,
      deltaY: -1,
    })

    act(() => { surface.dispatchEvent(event) })

    expect(event.defaultPrevented).toBe(true)
    expect(zoomAroundClientPoint).toHaveBeenCalledWith(120, 80, 2.3)
  })
})
