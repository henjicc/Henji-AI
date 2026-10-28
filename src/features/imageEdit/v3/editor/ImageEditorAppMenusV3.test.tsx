/** @vitest-environment jsdom */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getAppMenus, findAppMenuCommand } from '@/core/appMenu/appMenu'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditorAppMenusV3 } from './ImageEditorAppMenusV3'
import type { ImageEditorV3Controller } from './types'
import { useImageEditorSessionStoreV3 } from '../store'
import { AppMenuVisibilityContext } from '@/components/appMenu/appMenuVisibility'

afterEach(() => { cleanup(); useImageEditorSessionStoreV3.getState().disposeSession('menu-test') })
it('图片菜单使用图层锁定与历史状态，执行现有控制器，隐藏及卸载撤回', () => {
  const layer = createImageEditRasterLayerV3('layer', '图层')
  const controller = {
    sessionId: 'menu-test', document: { ...createImageEditDocumentV3({ width: 100, height: 100 }), layers: [layer] },
    profile: { layerKinds: ['raster', 'group'] }, canUndo: true, canRedo: false,
    undo: vi.fn(), redo: vi.fn(), deleteLayer: vi.fn(), duplicateLayer: vi.fn(() => 'copy'), groupLayers: vi.fn(), ungroupLayer: vi.fn(),
  } as unknown as ImageEditorV3Controller
  const clipboard = vi.fn(async () => undefined)
  useImageEditorSessionStoreV3.getState().ensureSession('menu-test', ['move'])
  useImageEditorSessionStoreV3.getState().setSelectedLayerIds('menu-test', ['layer'])
  const view = render(<ImageEditorAppMenusV3 controller={controller} clipboard={clipboard} busy={false} />)
  expect(getAppMenus().length).toBeGreaterThan(0)
  expect(findAppMenuCommand('imageEdit.redo')?.disabledReason).toBeTruthy()
  expect(findAppMenuCommand('imageEdit.delete')?.disabledReason).toBeUndefined()
  act(() => { findAppMenuCommand('imageEdit.delete')?.run() })
  expect(controller.deleteLayer).toHaveBeenCalledWith('layer')
  const locked = { ...controller, document: { ...controller.document, layers: [{ ...layer, locked: true }] } }
  view.rerender(<ImageEditorAppMenusV3 controller={locked} clipboard={clipboard} busy={false} />)
  expect(findAppMenuCommand('imageEdit.delete')?.disabledReason).toBeTruthy()
  view.rerender(<AppMenuVisibilityContext.Provider value={false}><ImageEditorAppMenusV3 controller={controller} clipboard={clipboard} busy={false} /></AppMenuVisibilityContext.Provider>)
  expect(getAppMenus()).toEqual([])
  view.rerender(<ImageEditorAppMenusV3 controller={controller} clipboard={clipboard} busy={false} />)
  view.unmount()
  expect(getAppMenus()).toEqual([])
})
