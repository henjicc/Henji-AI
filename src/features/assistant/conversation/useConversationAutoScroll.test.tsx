// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
      onKeyDown={scroll.onKeyDown}
    >
      <div ref={scroll.contentRef} data-testid="content">
        <details data-testid="collapsible">
          <summary>思考过程</summary>
          <div>展开后的正文</div>
        </details>
      </div>
      {!scroll.isFollowing ? (
        <button type="button" onClick={scroll.scrollToBottom}>
          {scroll.hasNewContent ? '有新内容' : '回到底部'}
        </button>
      ) : null}
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
    cleanup()
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
      resizeCallback([
        { target: screen.getByTestId('content') } as unknown as ResizeObserverEntry,
      ], {} as ResizeObserver)
      flushAnimationFrames()
    })
    expect(viewport.scrollTop).toBe(180)
    expect(screen.getByRole('button', { name: '有新内容' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '有新内容' }))
    expect(viewport.scrollTop).toBe(520)
    expect(screen.queryByRole('button')).toBeNull()

    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 800 })
    act(() => {
      resizeCallback([], {} as ResizeObserver)
      flushAnimationFrames()
    })
    expect(viewport.scrollTop).toBe(600)
  })

  /*
   * 回归：流式输出时自动贴底失效，必须手动滚。
   *
   * 程序化滚到底之后会异步触发一次 scroll 事件，而这一帧之间内容还在增高：事件里 scrollHeight
   * 已经变大、scrollTop 还是我们设的值，距底距离一超过 32px 的粘附阈值就把 isFollowing 打成
   * false；而重新吸附要求 4px 内，于是再也回不去。
   */
  it('程序化滚动后内容继续增高，不会被误判成用户上翻', () => {
    render(<ScrollHarness />)
    const viewport = screen.getByTestId('viewport')
    setScrollMetrics(viewport, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 })

    act(() => flushAnimationFrames())
    expect(viewport.scrollTop).toBe(400)

    // 滚动事件到达之前，流式增量又把内容顶高了 300px。
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 900 })
    fireEvent.scroll(viewport)

    // 仍然处于跟随状态：没有"回到底部"按钮。
    expect(screen.queryByRole('button')).toBeNull()

    // 后续增长继续自动贴底。
    act(() => {
      resizeCallback([], {} as ResizeObserver)
      flushAnimationFrames()
    })
    expect(viewport.scrollTop).toBe(700)
  })

  it('用户真的上翻仍然接管，回到底部后恢复跟随', () => {
    render(<ScrollHarness />)
    const viewport = screen.getByTestId('viewport')
    setScrollMetrics(viewport, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 })
    act(() => flushAnimationFrames())
    expect(viewport.scrollTop).toBe(400)

    // 位置与我们设的值不同 => 是用户滚的，正常判定脱离。
    viewport.scrollTop = 100
    fireEvent.scroll(viewport)
    expect(screen.getByRole('button', { name: '回到底部' })).toBeTruthy()

    viewport.scrollTop = 400
    fireEvent.scroll(viewport)
    expect(screen.queryByRole('button')).toBeNull()
  })

  /*
   * 回归：展开折叠块时内容"向上展开"。
   *
   * details 展开本身只在其内部向下撑开，浏览器不会移动已有元素；把视口拽走的是自动贴底——
   * 内容变高触发 ResizeObserver，仍在跟随状态就被拉到底部，用户刚点的那一行于是往上跑。
   */
  it('展开折叠块不把视口拽到底部，点击位置保持不动', () => {
    render(<ScrollHarness />)
    const viewport = screen.getByTestId('viewport')
    setScrollMetrics(viewport, { scrollHeight: 600, clientHeight: 200, scrollTop: 0 })
    act(() => flushAnimationFrames())
    expect(viewport.scrollTop).toBe(400)

    // 用户点开中间某个折叠块：toggle 不冒泡，靠捕获阶段拿到。
    act(() => {
      screen.getByTestId('collapsible').dispatchEvent(new Event('toggle'))
    })

    // 展开使内容变高，但视口不得被拉到底部。
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 900 })
    act(() => {
      resizeCallback([
        { target: screen.getByTestId('content') } as unknown as ResizeObserverEntry,
      ], {} as ResizeObserver)
      flushAnimationFrames()
    })
    expect(viewport.scrollTop).toBe(400)
    expect(screen.getByRole('button')).toBeTruthy()
  })

  it('键盘上翻会接管，新运行恢复自动跟随', () => {
    const view = render(<ScrollHarness />)
    const viewport = screen.getByTestId('viewport')
    setScrollMetrics(viewport, { scrollHeight: 600, clientHeight: 200, scrollTop: 400 })
    act(() => flushAnimationFrames())

    fireEvent.keyDown(viewport, { key: 'PageUp' })
    expect(screen.getByRole('button', { name: '回到底部' })).toBeTruthy()

    view.rerender(<ScrollHarness resetKey="run-2" />)
    act(() => flushAnimationFrames())
    expect(screen.queryByRole('button')).toBeNull()
    expect(viewport.scrollTop).toBe(400)
  })
})
