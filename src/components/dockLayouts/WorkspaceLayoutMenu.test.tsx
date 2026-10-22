/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppMenuVisibilityContext } from '@/components/appMenu/appMenuVisibility'
import { findAppMenuCommand, getAppMenus } from '@/core/appMenu/appMenu'
import { WorkspaceLayoutMenu } from './WorkspaceLayoutMenu'

vi.mock('./useWorkspaceLayoutPresets', () => ({ useWorkspaceLayoutPresets: () => ({
  presets: [{ id: 'default', name: '默认', builtin: true }], activeId: 'default', ready: true, dirty: false,
  apply: vi.fn(async () => undefined), resetActive: vi.fn(async () => undefined),
}) }))
afterEach(cleanup)
it('工作区布局菜单随可见性撤回和恢复，卸载不残留', () => {
  const view = render(<AppMenuVisibilityContext.Provider value><WorkspaceLayoutMenu workspaceId="test" /></AppMenuVisibilityContext.Provider>)
  expect(findAppMenuCommand('layout.test.apply.default')).toBeDefined()
  view.rerender(<AppMenuVisibilityContext.Provider value={false}><WorkspaceLayoutMenu workspaceId="test" /></AppMenuVisibilityContext.Provider>)
  expect(getAppMenus()).toEqual([])
  view.rerender(<AppMenuVisibilityContext.Provider value><WorkspaceLayoutMenu workspaceId="test" /></AppMenuVisibilityContext.Provider>)
  expect(findAppMenuCommand('layout.test.reset')?.disabledReason).toBeTruthy()
  view.unmount()
  expect(getAppMenus()).toEqual([])
})
