// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useGenerationAutoScroll } from './useGenerationAutoScroll'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('用户离开底部后同帧的尺寸回调不拉回；回到底部后继续跟随新内容', () => {
  let resized: (() => void) | undefined
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback }
    observe() {} disconnect() {}
  })
  function Fixture() {
    const { listContainerRef, contentRef } = useGenerationAutoScroll(true, 1000)
    return <div ref={listContainerRef} data-testid="scroll"><div ref={contentRef} /></div>
  }
  const view = render(<Fixture />)
  const scroller = view.getByTestId('scroll')
  let height = 10000
  Object.defineProperty(scroller, 'scrollHeight', { get: () => height })
  Object.defineProperty(scroller, 'clientHeight', { value: 600 })
  act(() => {
    scroller.scrollTop = 4000
    fireEvent.scroll(scroller)
    resized?.()
  })
  expect(scroller.scrollTop).toBe(4000)
  act(() => {
    scroller.scrollTop = 9400
    fireEvent.scroll(scroller)
    height = 11000
    resized?.()
  })
  expect(scroller.scrollTop).toBe(11000)
})
