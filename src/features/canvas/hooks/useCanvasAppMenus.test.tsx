/** @vitest-environment jsdom */
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppMenuVisibilityContext } from '@/components/appMenu/appMenuVisibility'
import { findAppMenuCommand, getAppMenus } from '@/core/appMenu/appMenu'
import { useCanvasAppMenus, type CanvasMenuActions } from './useCanvasAppMenus'

vi.mock('@/stores/canvasStore', () => ({ useCanvasStore: (selector: (state: { history: { past: unknown[]; future: unknown[] }; nodes: unknown[] }) => unknown) => selector({ history: { past: [], future: [] }, nodes: [{}] }) }))
afterEach(cleanup)
it('挂载声明编辑与节点菜单，隐藏和卸载撤回，禁用沿用历史与选择状态', () => {
  const actions: CanvasMenuActions = { undo: vi.fn(), redo: vi.fn(), copy: vi.fn(), paste: vi.fn(async () => undefined), delete: vi.fn(async () => undefined), group: vi.fn(), assetGroup: vi.fn(), selectAll: vi.fn() }
  let visible = true
  const view = renderHook(() => useCanvasAppMenus(actions, 2, true), { wrapper: ({ children }) => <AppMenuVisibilityContext.Provider value={visible}>{children}</AppMenuVisibilityContext.Provider> })
  expect(getAppMenus().map(menu => menu.id)).toEqual(['edit', 'node'])
  expect(findAppMenuCommand('canvas.undo')?.disabledReason).toBeTruthy()
  findAppMenuCommand('canvas.group')?.run()
  expect(actions.group).toHaveBeenCalledOnce()
  visible = false; view.rerender()
  expect(getAppMenus()).toEqual([])
  visible = true; view.rerender()
  expect(findAppMenuCommand('canvas.paste')).toBeDefined()
  view.unmount()
  expect(getAppMenus()).toEqual([])
})
