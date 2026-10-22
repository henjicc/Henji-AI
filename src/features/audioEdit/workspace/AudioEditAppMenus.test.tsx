/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppMenuVisibilityContext } from '@/components/appMenu/appMenuVisibility'
import { findAppMenuCommand, getAppMenus } from '@/core/appMenu/appMenu'
import { AudioEditAppMenus } from './AudioEditAppMenus'

vi.mock('./audioEditWorkspaceContext', () => ({ useAudioEditWorkspace: () => ({
  history: { past: [], future: [], undo: vi.fn(), redo: vi.fn() }, waveSelection: null, disabled: false,
  editSelection: vi.fn(), textSearch: { open: vi.fn() },
}) }))
afterEach(cleanup)
it('保活的音频工作区隐藏时撤回，重新显示和卸载保持正确归属', () => {
  const onExport = vi.fn()
  const view = render(<AppMenuVisibilityContext.Provider value><AudioEditAppMenus onExport={onExport} /></AppMenuVisibilityContext.Provider>)
  expect(findAppMenuCommand('audioEdit.undo')).toMatchObject({ editRole: 'undo' })
  expect(getAppMenus().some(menu => menu.id === 'audio')).toBe(true)
  view.rerender(<AppMenuVisibilityContext.Provider value={false}><AudioEditAppMenus onExport={onExport} /></AppMenuVisibilityContext.Provider>)
  expect(getAppMenus()).toEqual([])
  view.rerender(<AppMenuVisibilityContext.Provider value><AudioEditAppMenus onExport={onExport} /></AppMenuVisibilityContext.Provider>)
  expect(findAppMenuCommand('audioEdit.export')).toBeDefined()
  view.unmount()
  expect(getAppMenus()).toEqual([])
})
