/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AppMenuVisibilityContext } from '@/components/appMenu/appMenuVisibility'
import { findAppMenuCommand, getAppMenus } from '@/core/appMenu/appMenu'
import { GenerationAppMenus } from './GenerationAppMenus'

afterEach(cleanup)
it('生成菜单复用查找与清理确认入口，隐藏和卸载撤回', () => {
  const onClear = vi.fn(); const onSearch = vi.fn()
  const view = render(<GenerationAppMenus onClear={onClear} onSearch={onSearch} hasTasks />)
  expect(getAppMenus().map(menu => menu.id)).toEqual(['generation'])
  findAppMenuCommand('generation.clear')?.run()
  expect(onClear).toHaveBeenCalledOnce()
  view.rerender(<AppMenuVisibilityContext.Provider value={false}><GenerationAppMenus onClear={onClear} onSearch={onSearch} hasTasks /></AppMenuVisibilityContext.Provider>)
  expect(getAppMenus()).toEqual([])
  view.rerender(<GenerationAppMenus onClear={onClear} onSearch={onSearch} hasTasks={false} />)
  expect(findAppMenuCommand('generation.clear')?.disabledReason).toBeTruthy()
  view.unmount()
  expect(getAppMenus()).toEqual([])
})
