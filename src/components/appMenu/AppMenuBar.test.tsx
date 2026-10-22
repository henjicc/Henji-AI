/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { contributeAppMenus } from '@/core/appMenu/appMenu'
import { AppMenuBar } from './AppMenuBar'

vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }))
const disposers: Array<() => void> = []
afterEach(() => { cleanup(); disposers.splice(0).forEach(dispose => dispose()); vi.useRealTimers() })

it('点开菜单执行命令；不可用项不执行；指针移到其他菜单名直接切换；方向键左右切换菜单', () => {
  vi.useFakeTimers()
  const undo = vi.fn(), settings = vi.fn()
  disposers.push(contributeAppMenus('test', [
    { menu: 'file', items: [{ kind: 'command', id: 'settings', label: '设置…', run: settings }] },
    { menu: 'edit', items: [
      { kind: 'command', id: 'undo', label: '撤销', shortcut: 'Ctrl+Z', run: undo },
      { kind: 'command', id: 'redo', label: '重做', disabledReason: '没有可重做的操作', run: vi.fn() },
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
