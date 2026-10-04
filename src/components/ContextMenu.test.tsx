// @vitest-environment jsdom
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, expect, it, vi } from 'vitest'
import ContextMenu from './ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'
afterEach(cleanup)
it('长菜单保持视口内滚动，尾部命令仍可键盘执行', async () => {
  const invoke = vi.fn()
  render(<ContextMenu visible onClose={() => {}} position={{ x: 10, y: 10 }} items={Array.from({ length: 40 }, (_, index) => ({ id: `item${index}`, label: `命令${index}`, icon: null, onClick: invoke }))} />)
  const menu = screen.getByRole('menu')
  expect(menu.style.maxHeight).toBe('calc(100vh - 20px)'); expect(menu.style.overflowY).toBe('auto')
  fireEvent.keyDown(screen.getByRole('menuitem', { name: '命令39' }), { key: 'Enter' })
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
})
it('嵌入裁切面板时仍挂到顶层，保留资产归属、禁用与菜单执行', async () => {
  const invoke = vi.fn(); const close = vi.fn()
  const result = render(<div style={{ overflow: 'hidden', transform: 'translateX(1px)' }}><ContextMenu visible onClose={close} position={{ x: 200, y: 100 }} items={[{ id: 'open', label: '打开', icon: null, onClick: invoke }, { id: 'disabled', label: '移除', icon: null, disabled: true, onClick: invoke }]} /></div>)
  const menu = screen.getByRole('menu')
  expect(menu.parentElement).toBe(document.body); expect(result.container.contains(menu)).toBe(false)
  expect(menu.hasAttribute('data-ui-overlay-id')).toBe(true)
  fireEvent.click(screen.getByRole('menuitem', { name: '移除' })); expect(invoke).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('menuitem', { name: '打开' }), { key: 'Enter' })
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1)); expect(close).toHaveBeenCalledTimes(1)
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
  Object.defineProperty(popout, 'innerWidth', { configurable: true, value: 300 })
  Object.defineProperty(popout, 'innerHeight', { configurable: true, value: 240 })
  render(<>{createPortal(<MenuHost />, popout.document.body)}</>)
  const target = popout.document.querySelector('[data-testid="menu-target"]')!
  expect(target instanceof HTMLElement).toBe(false)
  act(() => { target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 290, clientY: 230 })) })
  const menu = popout.document.querySelector<HTMLElement>('[role="menu"]')!
  expect(menu.parentElement).toBe(popout.document.body)
  expect(document.querySelector('[role="menu"]')).toBeNull()
  // 视口取浮窗尺寸：靠右下角的右键被收回浮窗内。
  expect(menu.style.left).toBe('90px'); expect(menu.style.top).toBe('182px')
  act(() => { vi.advanceTimersByTime(20) })
  act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
  expect(popout.document.querySelector('[role="menu"]')).not.toBeNull()
  act(() => { popout.document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
  expect(popout.document.querySelector('[role="menu"]')).toBeNull()
  cleanup(); frame.remove(); vi.useRealTimers()
})
