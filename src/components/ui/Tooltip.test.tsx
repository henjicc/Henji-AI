/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UiIconButton } from './primitives'
import Tooltip from './Tooltip'
import { ownerWindowOf } from '@/utils/crossRealmDom'

function measure(width = 200, height = 40): void {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'tooltip' ? Math.min(width, Number.parseFloat(this.style.maxWidth) || width) : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'tooltip' ? Math.min(height, Number.parseFloat(this.style.maxHeight) || height) : 0
  })
}
function setRect(element: HTMLElement, left: number, top = 100): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ left, top, right: left + 40, bottom: top + 20, width: 40, height: 20, x: left, y: top, toJSON: () => ({}) })
}

describe('Tooltip', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

  it('工具栏模式跟随指针并按测量尺寸收回右下角', () => {
    vi.useFakeTimers(); measure()
    render(<Tooltip content="较长的工具名称" delay={180} anchor="pointer-start"><UiIconButton aria-label="工具" /></Tooltip>)
    const button = screen.getByRole('button', { name: '工具' })
    fireEvent.mouseEnter(button, { clientX: 24, clientY: 120 })
    act(() => vi.advanceTimersByTime(180))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.style.top).toBe('128px'); expect(tooltip.style.left).toBe('32px')
    fireEvent.mouseMove(button, { clientX: window.innerWidth - 1, clientY: window.innerHeight - 1 })
    expect(tooltip.style.left).toBe(`${window.innerWidth - 208}px`)
    expect(tooltip.getAttribute('data-tooltip-placement')).toBe('top')
    expect(tooltip.className).not.toContain('translate')
  })

  it('left 组件按真实宽高定位，不再依赖位移类', () => {
    vi.useFakeTimers(); measure()
    render(<Tooltip content="参数说明" delay={200} placement="left"><span>版本</span></Tooltip>)
    const trigger = screen.getByText('版本').parentElement!
    setRect(trigger, 400)
    fireEvent.mouseEnter(trigger); act(() => vi.advanceTimersByTime(200))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.getAttribute('data-tooltip-placement')).toBe('left')
    expect(tooltip.className).not.toContain('translate')
    expect(tooltip.style.left).toBe('192px'); expect(tooltip.style.top).toBe('90px')
  })

  it('聚焦时测量靠左且靠上的提示，翻到下方并夹紧', () => {
    measure()
    render(<Tooltip content="完整说明"><UiIconButton aria-label="说明" /></Tooltip>)
    const button = screen.getByRole('button')
    setRect(button.parentElement!, 0, 0); fireEvent.focus(button)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.style.left).toBe('8px'); expect(tooltip.style.top).toBe('28px')
    expect(tooltip.getAttribute('data-tooltip-placement')).toBe('bottom')
  })

  it('显示后的内容尺寸变化会重新测量并翻转位置', () => {
    let height = 40
    measure()
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height)
    let notifyResize: (() => void) | undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback }
      observe(): void {} disconnect(): void {}
    })
    try {
      render(<Tooltip content="动态说明"><UiIconButton aria-label="动态触发器" /></Tooltip>)
      const button = screen.getByRole('button')
      setRect(button.parentElement!, 200, 100); fireEvent.focus(button)
      expect(screen.getByRole('tooltip').style.top).toBe('52px')
      height = 160
      act(() => notifyResize?.())
      expect(screen.getByRole('tooltip').getAttribute('data-tooltip-placement')).toBe('bottom')
      expect(screen.getByRole('tooltip').style.top).toBe('128px')
    } finally { vi.unstubAllGlobals() }
  })

  it('超长内容限制视口宽高、断词、不拦截下方控件，Esc 关闭', () => {
    vi.useFakeTimers(); measure(2000, 3000)
    const content = '长内容'.repeat(1000)
    render(<Tooltip content={content} delay={0}><span>长说明</span></Tooltip>)
    const trigger = screen.getByText('长说明').parentElement!
    setRect(trigger, 0, 0); fireEvent.mouseEnter(trigger); act(() => vi.advanceTimersByTime(0))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip.textContent).toBe(content)
    expect(tooltip.style.maxWidth).toBe('320px')
    expect(tooltip.style.maxHeight).toBe(`${window.innerHeight - 16}px`)
    expect(tooltip.style.top).toBe('8px')
    expect(tooltip.className).toContain('overflow-auto')
    expect(tooltip.className).toContain('[overflow-wrap:anywhere]')
    expect(tooltip.className).toContain('pointer-events-none')
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(tooltip.getAttribute('aria-hidden')).toBe('true')
  })

  it('浮窗按自身视口限制尺寸并在缩放后重新测量', () => {
    const frame = document.createElement('iframe'); document.body.append(frame)
    const popout = frame.contentDocument!; const ownerWindow = ownerWindowOf(popout)
    Object.defineProperties(ownerWindow, { innerWidth: { value: 240, configurable: true }, innerHeight: { value: 160, configurable: true } })
    // 另一个 realm 的元素不继承主窗口 HTMLElement 的尺寸替身。
    vi.spyOn(ownerWindow.HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(180)
    vi.spyOn(ownerWindow.HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40)
    render(<>{createPortal(<Tooltip content="浮窗说明"><UiIconButton aria-label="浮窗触发器" /></Tooltip>, popout.body)}</>)
    const button = popout.querySelector('button')!
    setRect(button.parentElement!, 210, 2); fireEvent.focus(button)
    const tooltip = popout.querySelector<HTMLElement>('[role="tooltip"]')!
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(tooltip.style.left).toBe('52px'); expect(tooltip.style.top).toBe('30px')
    expect(tooltip.style.maxWidth).toBe('224px'); expect(tooltip.style.maxHeight).toBe('144px')
    Object.defineProperty(ownerWindow, 'innerWidth', { value: 200, configurable: true })
    fireEvent(ownerWindow, new Event('resize'))
    expect(tooltip.style.left).toBe('12px'); expect(tooltip.style.maxWidth).toBe('184px')
    cleanup(); frame.remove()
  })
})
