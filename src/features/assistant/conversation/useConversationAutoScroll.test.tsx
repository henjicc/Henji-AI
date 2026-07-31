// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  distanceFromScrollBottom,
  useConversationAutoScroll,
} from './useConversationAutoScroll'

let resizeCallback: ResizeObserverCallback
let nextFrameId = 1
let scheduledFrames = new Map<number, FrameRequestCallback>()

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function flushAnimationFrames(): void {
  const frames = [...scheduledFrames.values()]
  scheduledFrames.clear()
  for (const callback of frames) callback(performance.now())
}

function ScrollHarness({ resetKey = 'run-1' }: { resetKey?: string }): JSX.Element {
  const scroll = useConversationAutoScroll(resetKey)
  return (
    <div
      ref={scroll.viewportRef}
      data-testid="viewport"
      onScroll={scroll.onScroll}
      onWheel={scroll.onWheel}
    >
      <div ref={scroll.contentRef} data-testid="content" />
    </div>
  )
}

function setScrollMetrics(
  element: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }
): void {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: metrics.scrollHeight },
    clientHeight: { configurable: true, value: metrics.clientHeight },
    scrollTop: { configurable: true, writable: true, value: metrics.scrollTop },
  })
}

describe('useConversationAutoScroll', () => {
  beforeEach(() => {
    scheduledFrames = new Map()
    nextFrameId = 1
    vi.stubGlobal('ResizeObserver', TestResizeObserver)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextFrameId
      nextFrameId += 1
      scheduledFrames.set(frameId, callback)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => {
      scheduledFrames.delete(frameId)
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('计算滚动视口距底部的剩余距离', () => {
    expect(distanceFromScrollBottom({ scrollHeight: 600, scrollTop: 350, clientHeight: 200 })).toBe(50)
    expect(distanceFromScrollBottom({ scrollHeight: 300, scrollTop: 200, clientHeight: 200 })).toBe(0)
  })

  it('内容增长时贴底，用户上翻后停止抢占，回到底部后恢复', () => {
    render(<ScrollHarness />)
    const viewport = screen.getByTestId('viewport')
    setScrollMetrics(viewport, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 })

    act(() => flushAnimationFrames())
    expect(viewport.scrollTop).toBe(400)

    fireEvent.wheel(viewport, { deltaY: -120 })
    viewport.scrollTop = 180
    fireEvent.scroll(viewport)
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 720 })
    act(() => {
      resizeCallback([], {} as ResizeObserver)
      flushAnimationFrames()
    })
    expect(viewport.scrollTop).toBe(180)

    viewport.scrollTop = 520
    fireEvent.scroll(viewport)
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 800 })
    act(() => {
      resizeCallback([], {} as ResizeObserver)
      flushAnimationFrames()
    })
    expect(viewport.scrollTop).toBe(600)
  })
})
