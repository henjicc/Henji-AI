/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getAppMenus, findAppMenuCommand } from '@/core/appMenu/appMenu'
import { CameraStageAppMenus } from './CameraStageAppMenus'

vi.mock('./store/cameraStageStore', () => ({ useCameraStageStore: (selector: (state: { selectedId: string | null }) => unknown) => selector({ selectedId: null }) }))
vi.mock('./store/useCameraStageHistory', () => ({ useCameraStageHistory: () => ({ canUndo: true, canRedo: false, undo: vi.fn(), redo: vi.fn() }) }))
afterEach(cleanup)
it('声明编辑与场景菜单，缺选择时不可用，卸载撤回', () => {
  const view = render(<CameraStageAppMenus />)
  expect(getAppMenus().map(menu => menu.id)).toEqual(['edit', 'cameraStage'])
  expect(findAppMenuCommand('cameraStage.undo')?.disabledReason).toBeUndefined()
  expect(findAppMenuCommand('cameraStage.focus')?.disabledReason).toBeTruthy()
  view.unmount()
  expect(getAppMenus()).toEqual([])
})
