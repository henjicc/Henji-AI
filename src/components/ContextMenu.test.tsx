// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ContextMenu from './ContextMenu'
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
  const result = render(<div style={{ overflow: 'hidden', transform: 'translateX(1px)' }}><ContextMenu owner="assets" visible onClose={close} position={{ x: 200, y: 100 }} items={[{ id: 'open', label: '打开', icon: null, onClick: invoke }, { id: 'disabled', label: '移除', icon: null, disabled: true, onClick: invoke }]} /></div>)
  const menu = screen.getByRole('menu')
  expect(menu.parentElement).toBe(document.body); expect(result.container.contains(menu)).toBe(false)
  expect(menu.getAttribute('data-asset-context-menu')).toBe('true')
  fireEvent.click(screen.getByRole('menuitem', { name: '移除' })); expect(invoke).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled()
  fireEvent.keyDown(screen.getByRole('menuitem', { name: '打开' }), { key: 'Enter' })
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1)); expect(close).toHaveBeenCalledTimes(1)
})
