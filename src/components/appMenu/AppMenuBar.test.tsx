/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { contributeAppMenus } from '@/core/appMenu/appMenu'
import { Z_LAYERS } from '@/core/theme/zLayers'
import { UiModal } from '@/components/ui/UiModal'
import { AppMenuBar } from './AppMenuBar'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }))
const disposers: Array<() => void> = []
afterEach(() => { cleanup(); disposers.splice(0).forEach(dispose => dispose()); vi.useRealTimers() })

it('点开菜单执行命令；不可用项不执行；指针移到其他菜单名直接切换；方向键左右切换菜单', () => {
  vi.useFakeTimers()
  const undo = vi.fn(), settings = vi.fn()
  disposers.push(contributeAppMenus('test', [
    { menu: 'file', items: [{ kind: 'action', id: 'settings', label: '设置…', run: settings }] },
    { menu: 'edit', items: [
      { kind: 'action', id: 'undo', label: '撤销', shortcut: 'Ctrl+Z', run: undo },
      { kind: 'action', id: 'redo', label: '重做', disabledReason: '没有可重做的操作', run: vi.fn() },
    ] },
  ]))
  render(<AppMenuBar />)
  fireEvent.click(screen.getByRole('menuitem', { name: '编辑' }))
  expect(screen.getByText('Ctrl+Z')).toBeTruthy()
  fireEvent.click(screen.getByRole('menuitem', { name: '重做' }))
  act(() => vi.advanceTimersByTime(50))
  fireEvent.pointerEnter(screen.getByRole('menuitem', { name: '文件' }))
  expect(screen.getByRole('menu', { name: '文件' })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('menu', { name: '文件' }), { key: 'ArrowRight' })
  expect(screen.getByRole('menu', { name: '编辑' })).toBeTruthy()
  fireEvent.click(screen.getByRole('menuitem', { name: /撤销/ }))
  act(() => vi.advanceTimersByTime(50))
  expect(undo).toHaveBeenCalledOnce()
  expect(settings).not.toHaveBeenCalled()
})

it('展开的菜单压在弹窗与查看器之上：弹窗里的编辑器也要能从窗口菜单重开面板', () => {
  disposers.push(contributeAppMenus('test', [{ menu: 'window', items: [{ kind: 'action', id: 'panel', label: '图层', checked: false, run: vi.fn() }] }]))
  render(<AppMenuBar />)
  fireEvent.click(screen.getByRole('menuitem', { name: '窗口' }))
  const layer = screen.getByRole('menu', { name: '窗口' }).closest<HTMLElement>('[data-ui-overlay-id]')
  expect(Number(layer?.style.zIndex)).toBeGreaterThan(Z_LAYERS.viewer)
})

it('弹窗开着时在菜单里按 Esc 只收起菜单，不关弹窗', () => {
  const closeModal = vi.fn()
  disposers.push(contributeAppMenus('test', [{ menu: 'window', items: [{ kind: 'action', id: 'panel', label: '图层', checked: false, run: vi.fn() }] }]))
  render(<><AppMenuBar /><UiModal isOpen title="编辑" onClose={closeModal}><button type="button">内容</button></UiModal></>)
  fireEvent.click(screen.getByRole('menuitem', { name: '窗口' }))
  const menu = screen.getByRole('menu', { name: '窗口' })
  fireEvent.keyDown(document.activeElement && menu.contains(document.activeElement) ? document.activeElement : menu, { key: 'Escape' })
  expect(screen.queryByRole('menu', { name: '窗口' })).toBeNull()
  expect(closeModal).not.toHaveBeenCalled()
})
