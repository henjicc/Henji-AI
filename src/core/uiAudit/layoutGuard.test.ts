// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const warn = vi.hoisted(() => vi.fn())
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
import { startLayoutGuard } from './layoutGuard'

beforeEach(() => {
  vi.useFakeTimers()
  warn.mockClear()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const [left, top, right, bottom] = (this.getAttribute('data-rect') ?? '0 0 1440 900').split(' ').map(Number)
    return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) } as DOMRect
  })
  document.elementFromPoint = () => document.body
  document.body.innerHTML = '<div style="overflow-x: hidden; overflow-y: hidden" data-rect="0 0 100 40"><button aria-label="被裁的按钮" data-rect="80 10 140 30"></button></div>'
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = '' })

it('界面安静后检查一次：描边、记一条日志；同一问题不重复记；停止后移除描边层', () => {
  const stop = startLayoutGuard('outline')
  vi.advanceTimersByTime(1500)
  const layer = document.querySelector('[data-layout-guard-layer]')
  expect(layer?.children).toHaveLength(1)
  expect(layer?.textContent).toBe('裁切')
  expect(warn).toHaveBeenCalledTimes(1)
  expect(warn.mock.calls[0][1]).toMatchObject({ event: 'ui.layout_issue.detected', rule: 'controlClipped', element: 'button「被裁的按钮」' })
  window.dispatchEvent(new Event('resize'))
  vi.advanceTimersByTime(1500)
  expect(warn).toHaveBeenCalledTimes(1)
  stop()
  expect(document.querySelector('[data-layout-guard-layer]')).toBeNull()
})

it('只记日志模式不画描边；按住鼠标时不检查', () => {
  const stop = startLayoutGuard('log')
  window.dispatchEvent(new Event('pointerdown'))
  vi.advanceTimersByTime(1500)
  expect(warn).not.toHaveBeenCalled()
  window.dispatchEvent(new Event('pointerup'))
  vi.advanceTimersByTime(1500)
  expect(warn).toHaveBeenCalledTimes(1)
  expect(document.querySelector('[data-layout-guard-layer]')).toBeNull()
  stop()
})
