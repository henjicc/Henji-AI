// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import StateKeyframeTimelinePanel from './StateKeyframeTimelinePanel'

vi.mock('../timeline/TimeRuler', () => ({ default: () => null }))
vi.mock('./timeline/StateKeyframeClipTrack', () => ({ default: () => null }))
vi.mock('../timeline/PlaybackControls', () => ({ PlaybackButtons: () => null }))
vi.mock('./timeline/StateKeyframeTimecodeText', () => ({ default: () => null }))

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it.each([false, true])('缩放定位合并最新样本，执行一次，卸载后不再滚动（浮窗=%s）', popout => {
  const iframe = document.createElement('iframe'); document.body.append(iframe)
  const owner = popout ? iframe.contentWindow! : window
  const frames = new Map<number, FrameRequestCallback>(); let id = 0
  vi.spyOn(owner, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++id, callback); return id })
  vi.spyOn(owner, 'cancelAnimationFrame').mockImplementation(handle => { frames.delete(handle) })
  const view = render(createPortal(<StateKeyframeTimelinePanel />, owner.document.body))
  const scroller = owner.document.querySelector<HTMLDivElement>('[tabindex="0"]')!
  scroller.scrollLeft = 100
  fireEvent.wheel(scroller, { altKey: true, deltaY: -100, clientX: 120 })
  fireEvent.wheel(scroller, { altKey: true, deltaY: -100, clientX: 120 })
  expect(frames.size).toBe(1)
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(16)) })
  expect(scroller.scrollLeft).toBeCloseTo(220 * Math.pow(1.0018, 100) - 120)
  expect(frames.size).toBe(0)
  fireEvent.wheel(scroller, { altKey: true, deltaY: -100, clientX: 120 })
  const before = scroller.scrollLeft
  view.unmount()
  expect(frames.size).toBe(0)
  act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(32)) })
  expect(scroller.scrollLeft).toBe(before)
  iframe.remove()
})

it('主窗口卸载取消尚未执行的缩放定位', () => {
  const frames = new Map<number, FrameRequestCallback>()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(1, callback); return 1 })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(handle => { frames.delete(handle) })
  const view = render(<StateKeyframeTimelinePanel />)
  const scroller = view.container.querySelector<HTMLDivElement>('[tabindex="0"]')!
  fireEvent.wheel(scroller, { altKey: true, deltaY: -100, clientX: 120 })
  expect(frames.size).toBe(1)
  view.unmount()
  expect(frames.size).toBe(0)
})
