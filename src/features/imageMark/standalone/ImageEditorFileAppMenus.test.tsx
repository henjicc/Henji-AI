/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { findAppMenuCommand, getAppMenus } from '@/core/appMenu/appMenu'
import { ImageEditorFileAppMenus } from './ImageEditorFileAppMenus'

afterEach(cleanup)
it('文件菜单调用宿主保存、另存为与导出，不重新实现导出流程', async () => {
  const onSave = vi.fn(async () => undefined); const onSaveAs = vi.fn(async () => undefined)
  const host = { isHostBusy: false, rasterExportOptions: [{ format: 'png8' as const, readiness: { state: 'ready' as const } }], handleRasterExport: vi.fn(async () => undefined) }
  const exportOptions = [{ format: 'png8' as const, label: 'PNG' }]
  const view = render(<ImageEditorFileAppMenus host={host} onSave={onSave} onSaveAs={onSaveAs} exportOptions={exportOptions} />)
  expect(getAppMenus().map(menu => menu.id)).toEqual(['file'])
  await findAppMenuCommand('imageEdit.saveAs')?.run()
  await findAppMenuCommand('imageEdit.export.png8')?.run()
  expect(onSaveAs).toHaveBeenCalledOnce()
  expect(host.handleRasterExport).toHaveBeenCalledWith('png8')
  view.rerender(<ImageEditorFileAppMenus host={{ ...host, isHostBusy: true }} onSave={onSave} onSaveAs={onSaveAs} exportOptions={exportOptions} />)
  expect(findAppMenuCommand('imageEdit.export.png8')?.disabledReason).toBeTruthy()
  view.unmount()
  expect(getAppMenus()).toEqual([])
})
