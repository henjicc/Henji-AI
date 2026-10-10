/** @vitest-environment jsdom */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { repairImageEditRegionV3 } from '../application/imageEditRepairServiceV3'
import { useImageEditorSessionStoreV3 } from '../store'
import type { ImageEditorV3Controller } from './types'
import { ImageEditorRepairProviderV3, useImageEditorRepairV3 } from './ImageEditorRepairContextV3'

vi.mock('../application/imageEditRepairServiceV3', () => ({ repairImageEditRegionV3: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks(); useImageEditorSessionStoreV3.setState({ sessions: {} }) })

it('取消立刻隐藏失效预览，清理完成前保持忙碌；再次运行使用新的确认', async () => {
  const document = createImageEditDocumentV3({ width: 32, height: 32 })
  document.layers = [createImageEditRasterLayerV3('base', '照片')]
  const bus = new ImageEditCommandBusV3(document)
  const controller = { sessionId: 'cancel-repair' } as ImageEditorV3Controller
  useImageEditorSessionStoreV3.getState().ensureSession(controller.sessionId, ['remove'], document.layers[0].id, 'remove')
  let current: ReturnType<typeof useImageEditorRepairV3> = null
  function Probe(): null { current = useImageEditorRepairV3(); return null }
  render(<ImageEditorRepairProviderV3 bus={bus} controller={controller}><Probe /></ImageEditorRepairProviderV3>)
  let releaseCleanup = (): void => undefined
  const cleanupWait = new Promise<void>(resolve => { releaseCleanup = resolve })
  vi.mocked(repairImageEditRegionV3).mockImplementationOnce(async (_bus, _layer, options) => {
    try { await options.confirm!(options.signal!) }
    finally { await cleanupWait }
    throw new Error('取消')
  }).mockImplementationOnce(async (_bus, layerId, options) => {
    await options.confirm!(options.signal!)
    return { layerId, commandId: 'retry', durationMs: 1, patchCount: 1 }
  })
  const view = (): NonNullable<typeof current> => { if (!current) throw new Error('缺少修复状态'); return current }
  let first: Promise<void> | undefined
  act(() => { first = view().run({ action: 'remove' }) })
  await waitFor(() => expect(view().previewReady).toBe(true))
  act(() => view().cancel())
  expect(view().previewReady).toBe(false)
  expect(view().busy).toBe(true)
  act(() => view().apply())
  await act(async () => { releaseCleanup(); await first })
  expect(view().busy).toBe(false)
  expect(view().error).toBeNull()
  let retry: Promise<void> | undefined
  act(() => { retry = view().run({ action: 'remove' }) })
  await waitFor(() => expect(view().previewReady).toBe(true))
  await act(async () => { view().apply(); await retry })
  expect(view().busy).toBe(false)
  expect(view().previewReady).toBe(false)
  expect(repairImageEditRegionV3).toHaveBeenCalledTimes(2)
  bus.dispose()
})
