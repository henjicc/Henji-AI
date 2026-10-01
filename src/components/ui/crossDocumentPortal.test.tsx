// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import PanelTrigger from './PanelTrigger'
import Dropdown from './Dropdown'
import Tooltip from './Tooltip'
import { UiModal } from './UiModal'

/**
 * 剪辑系统浮窗：主窗口 React 把面板 portal 进另一个同源文档（另一 realm）。
 * 浮层必须挂到触发元素所在文档，并在该文档里监听外部点击；主窗口行为不变。
 */
class StubResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
let frame: HTMLIFrameElement
let popout: Document

beforeEach(() => {
  vi.useFakeTimers()
  frame = document.createElement('iframe'); document.body.append(frame)
  popout = frame.contentDocument!
  Object.assign(frame.contentWindow!, { ResizeObserver: StubResizeObserver })
  vi.stubGlobal('ResizeObserver', StubResizeObserver)
})
afterEach(() => { cleanup(); frame.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })

function inPopout(node: React.ReactNode): ReturnType<typeof render> {
  return render(<>{createPortal(node, popout.body)}</>)
}
const press = (target: EventTarget): void => { act(() => { target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })) }) }

it('PanelTrigger 在浮窗中打开时面板挂到浮窗文档，浮窗内外部点击关闭；主窗口点击不影响', () => {
  inPopout(<PanelTrigger display="菜单" renderPanel={() => <div>面板内容</div>} />)
  const button = popout.querySelector<HTMLElement>('[data-panel-trigger-button]')!
  expect(button instanceof HTMLElement).toBe(false)
  act(() => { button.click() })
  expect(popout.body.textContent).toContain('面板内容')
  expect(document.body.textContent).not.toContain('面板内容')
  press(document.body)
  act(() => { vi.advanceTimersByTime(250) })
  expect(popout.body.textContent).toContain('面板内容')
  press(popout.body)
  act(() => { vi.advanceTimersByTime(250) })
  expect(popout.body.textContent).not.toContain('面板内容')
})

it('PanelTrigger 在主窗口保持原行为：面板挂到主文档 body', () => {
  render(<PanelTrigger display="菜单" renderPanel={() => <div>主窗口面板</div>} />)
  act(() => { document.querySelector<HTMLElement>('[data-panel-trigger-button]')!.click() })
  expect(document.body.querySelector('[data-panel-scroll-region]')?.textContent).toBe('主窗口面板')
})

it('Dropdown 在浮窗中把选项挂到浮窗文档，浮窗内外部点击关闭', () => {
  inPopout(<Dropdown value="a" options={[{ value: 'a', label: '选项甲' }, { value: 'b', label: '选项乙' }]} onSelect={vi.fn()} />)
  act(() => { popout.querySelector<HTMLElement>('[data-dropdown-button]')!.click() })
  const panel = popout.querySelector('[data-dropdown-portal="true"]')
  expect(panel?.textContent).toContain('选项乙')
  expect(document.querySelector('[data-dropdown-portal="true"]')).toBeNull()
  press(popout.body)
  act(() => { vi.advanceTimersByTime(250) })
  expect(popout.querySelector('[data-dropdown-portal="true"]')).toBeNull()
})

it('Tooltip 悬停后挂到触发元素所在的浮窗文档', () => {
  inPopout(<Tooltip content="提示内容" delay={0}><span>名称</span></Tooltip>)
  const trigger = popout.body.querySelector('span')!
  act(() => { trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); vi.advanceTimersByTime(10) })
  expect(popout.querySelector('[role="tooltip"]')?.textContent).toBe('提示内容')
  expect(document.querySelector('[role="tooltip"]')).toBeNull()
})

it('UiModal 在浮窗中挂到浮窗文档并由浮窗内 Esc 关闭；主窗口仍挂到主文档', () => {
  const onClose = vi.fn()
  inPopout(<UiModal isOpen title="浮窗弹窗" onClose={onClose}><div>弹窗正文</div></UiModal>)
  expect(popout.querySelector('[role="dialog"]')?.textContent).toContain('弹窗正文')
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(onClose).not.toHaveBeenCalled()
  act(() => { popout.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(onClose).toHaveBeenCalledOnce()
  cleanup()

  render(<UiModal isOpen title="主窗口弹窗" onClose={vi.fn()}><div>主窗口正文</div></UiModal>)
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('主窗口正文')
})
