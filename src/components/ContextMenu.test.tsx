// @vitest-environment jsdom
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ContextMenu from './ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'
import { UI_DURATION } from '@/components/ui/motion'

class StubResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
beforeEach(() => { vi.stubGlobal('ResizeObserver', StubResizeObserver) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

const panelOf = (menu: Element): HTMLElement => menu.closest<HTMLElement>('[data-panel-placement]')!

it('右键菜单走共享浮层：挂到顶层、登记浮层层、按视口限高滚动，尾部命令仍可键盘执行', async () => {
  const invoke = vi.fn()
  const result = render(<div style={{ overflow: 'hidden', transform: 'translateX(1px)' }}><ContextMenu visible onClose={() => {}} position={{ x: 10, y: 10 }} items={Array.from({ length: 40 }, (_, index) => ({ id: `item${index}`, label: `命令${index}`, icon: null, onClick: invoke }))} /></div>)
  const menu = screen.getByRole('menu')
  const panel = panelOf(menu)
  expect(panel.parentElement).toBe(document.body); expect(result.container.contains(menu)).toBe(false)
  expect(panel.hasAttribute('data-ui-overlay-id')).toBe(true)
  // 视口限高由共享定位给出，滚动在共享内容区
  expect(panel.style.maxHeight).not.toBe('')
  expect(menu.closest('[data-panel-scroll-region]')?.className).toContain('overflow-y-auto')
  fireEvent.keyDown(screen.getByRole('menuitem', { name: '命令39' }), { key: 'Enter' })
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
})

it('菜单项是共享菜单选项：禁用项不执行，Enter 执行一次并收起；方向键在可用项间移动', async () => {
  const invoke = vi.fn(); const close = vi.fn()
  render(<ContextMenu visible onClose={close} position={{ x: 200, y: 100 }} items={[{ id: 'open', label: '打开', icon: null, onClick: invoke }, { id: 'disabled', label: '移除', icon: null, disabled: true, onClick: invoke }, { id: 'copy', label: '复制', icon: null, onClick: invoke }]} />)
  const menu = screen.getByRole('menu')
  expect(document.activeElement).toBe(menu)
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '打开' }))
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: '复制' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '移除' })); expect(invoke).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('menuitem', { name: '打开' }), { key: 'Enter' })
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1)); expect(close).toHaveBeenCalledTimes(1)
})

it('文本框里右键（全局粘贴菜单）时不抢走输入焦点', () => {
  const host = (visible: boolean) => <><textarea data-testid="input" /><ContextMenu visible={visible} onClose={() => {}} position={{ x: 20, y: 20 }} items={[{ id: 'paste', label: '粘贴', icon: null, onClick: () => {} }]} /></>
  const view = render(host(false))
  const input = screen.getByTestId('input'); input.focus()
  view.rerender(host(true))
  expect(screen.getByRole('menu')).toBeTruthy()
  expect(document.activeElement).toBe(input)
})

it('Escape 收起菜单，收起动画结束后回调 onClose', () => {
  vi.useFakeTimers()
  const close = vi.fn()
  render(<ContextMenu visible onClose={close} position={{ x: 20, y: 20 }} items={[{ id: 'a', label: '甲', icon: null, onClick: () => {} }]} />)
  act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
  act(() => { vi.advanceTimersByTime(UI_DURATION.base + 10) })
  expect(close).toHaveBeenCalledTimes(1)
})

function MenuHost(): React.ReactElement {
  const menu = useContextMenu()
  return <div>
    <span data-testid="menu-target" onContextMenu={event => menu.showMenu(event, [{ id: 'copy', label: '复制', icon: null, onClick: () => {} }])}>右键目标</span>
    <ContextMenu visible={menu.menuVisible} position={menu.menuPosition} items={menu.menuItems} onClose={menu.hideMenu} />
  </div>
}

it('剪辑系统浮窗（另一 realm 文档）中右键：菜单挂到浮窗文档、按浮窗视口定位，并只由浮窗内外部点击关闭', async () => {
  vi.useFakeTimers()
  const frame = document.createElement('iframe'); document.body.append(frame)
  const popout = frame.contentWindow as Window & typeof globalThis
  Object.assign(popout, { ResizeObserver: StubResizeObserver })
  Object.defineProperty(popout, 'innerWidth', { configurable: true, value: 300 })
  Object.defineProperty(popout, 'innerHeight', { configurable: true, value: 240 })
  render(<>{createPortal(<MenuHost />, popout.document.body)}</>)
  const target = popout.document.querySelector('[data-testid="menu-target"]')!
  expect(target instanceof HTMLElement).toBe(false)
  act(() => { target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 290, clientY: 230 })) })
  const menu = popout.document.querySelector<HTMLElement>('[role="menu"]')!
  const panel = panelOf(menu)
  expect(panel.parentElement).toBe(popout.document.body)
  expect(document.querySelector('[role="menu"]')).toBeNull()
  // 视口取浮窗尺寸：靠右缘的右键收回浮窗内（jsdom 不排版，高度为 0，上下翻转由 floatingPanelPosition 单测覆盖）
  expect(parseFloat(panel.style.left)).toBeLessThanOrEqual(300 - 8)
  act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
  act(() => { vi.advanceTimersByTime(UI_DURATION.base + 10) })
  expect(popout.document.querySelector('[role="menu"]')).not.toBeNull()
  act(() => { popout.document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
  act(() => { vi.advanceTimersByTime(UI_DURATION.base + 10) })
  expect(popout.document.querySelector('[role="menu"]')).toBeNull()
  cleanup(); frame.remove()
})

it('文本框上的粘贴菜单打开时按 Escape：只收起菜单，文本框自己的 Escape 处理不执行', () => {
  vi.useFakeTimers()
  const inputEscape = vi.fn()
  const close = vi.fn()
  const host = (visible: boolean) => <><input data-testid="name" onKeyDown={(event) => { if (event.key === 'Escape') inputEscape() }} /><ContextMenu visible={visible} onClose={close} position={{ x: 20, y: 20 }} items={[{ id: 'paste', label: '粘贴', icon: null, onClick: () => {} }]} /></>
  const view = render(host(false))
  const input = screen.getByTestId('name'); input.focus()
  view.rerender(host(true))
  act(() => { fireEvent.keyDown(input, { key: 'Escape' }) })
  act(() => { vi.advanceTimersByTime(UI_DURATION.base + 10) })
  expect(inputEscape).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1)
})

it('浮层内的输入框阻止按键冒泡时，Escape 仍能收起浮层', () => {
  vi.useFakeTimers()
  const close = vi.fn()
  render(<ContextMenu visible onClose={close} position={{ x: 20, y: 20 }} items={[{ id: 'a', label: '甲', icon: null, onClick: () => {} }]} />)
  const item = screen.getByRole('menuitem', { name: '甲' })
  item.addEventListener('keydown', (event) => event.stopPropagation())
  act(() => { fireEvent.keyDown(item, { key: 'Escape' }) })
  act(() => { vi.advanceTimersByTime(UI_DURATION.base + 10) })
  expect(close).toHaveBeenCalledTimes(1)
})
