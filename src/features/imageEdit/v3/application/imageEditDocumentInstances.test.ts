// @vitest-environment jsdom
import '@/tests/imageEditDocumentFixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import type { ImageEditDocumentRepositoryV3 } from '@/core/imageEdit/v3/serviceContracts'
import {
  attachImageEditDocumentInstanceV3, getOrCreateImageEditDocumentInstanceV3,
  getOrCreateImageEditPersistenceQueueV3, releaseImageEditDocumentInstanceV3,
  requireImageEditDocumentInstanceV3, saveImageEditDocumentInstanceV3,
} from './imageEditDocumentInstances'
import { useImageEditorControllerV3 } from '../editor/useImageEditorControllerV3'

afterEach(() => { cleanup(); vi.useRealTimers() })

function setup(id: string, save?: ImageEditDocumentRepositoryV3['save']) {
  const document = createImageEditDocumentV3({ width: 8, height: 8, documentId: id })
  document.layers = [createImageEditRasterLayerV3('layer', '初始')]
  const initial = new ImageEditCommandBusV3(document).getPersistenceSnapshot()
  const write = vi.fn(save ?? (async (next) => ({ documentId: next.id, revision: next.revision, previewRef: null })))
  const options = { repository: { save: write }, initialReference: { documentId: id, revision: 0, previewRef: null }, initialHistory: initial.history }
  const queue = getOrCreateImageEditPersistenceQueueV3(options)
  const host = { getQueue: () => queue }
  const instance = getOrCreateImageEditDocumentInstanceV3(document, { historySnapshot: initial.history }, host)
  const rename = (name: string) => instance.bus.dispatch({ type: 'layer.update-common', commandId: crypto.randomUUID(),
    expectedRevision: instance.bus.getSnapshot().document.revision, layerId: 'layer', patch: { name } })
  return { document, initial, write, options, queue, host, instance, rename }
}

describe('图片文档应用实例', () => {
  it('手势预览不进入保存队列，清除历史即使未改文档版本也会保存', async () => {
    vi.useFakeTimers()
    const state = setup('preview')
    const onPersistence = vi.fn()
    const unsubscribe = state.instance.bus.subscribePersistence(onPersistence)
    state.instance.bus.setPreview({ id: 'gesture', kind: 'parameter', targetId: 'layer', baseRevision: 0, value: 0.2 })
    state.instance.bus.clearPreview('gesture')
    await vi.advanceTimersByTimeAsync(500)
    expect(state.instance.dirty).toBe(false)
    expect(state.write).not.toHaveBeenCalled()
    expect(onPersistence).not.toHaveBeenCalled()
    state.rename('修改')
    await saveImageEditDocumentInstanceV3('preview')
    state.instance.bus.clearHistory()
    await vi.advanceTimersByTimeAsync(500)
    expect(state.write).toHaveBeenCalledTimes(2)
    expect(state.write.mock.calls[1][0].revision).toBe(1)
    expect(state.write.mock.calls[1][1].history?.undo).toEqual([])
    unsubscribe()
  })
  it('关闭界面后仍自动保存，同文档复用总线、队列与撤销历史，其他文档不受影响', async () => {
    vi.useFakeTimers()
    const a = setup('A')
    const b = setup('B')
    const detach = attachImageEditDocumentInstanceV3('B')
    b.rename('后台修改')
    detach()
    expect(releaseImageEditDocumentInstanceV3('B')).toBe(false)
    await vi.advanceTimersByTimeAsync(500)
    expect(b.write).toHaveBeenCalledTimes(1)
    expect(a.write).not.toHaveBeenCalled()
    expect(a.instance.bus.getSnapshot().document.layers[0].name).toBe('初始')
    expect(getOrCreateImageEditPersistenceQueueV3(b.options)).toBe(b.queue)
    expect(getOrCreateImageEditDocumentInstanceV3(b.document, {}, b.host)).toBe(b.instance)
    expect(b.instance.bus.getSnapshot().history.undoCount).toBe(1)
    b.instance.bus.undo()
    expect(b.instance.bus.getSnapshot().document.layers[0].name).toBe('初始')
    await saveImageEditDocumentInstanceV3('B')
    expect(releaseImageEditDocumentInstanceV3('B')).toBe(true)
  })

  it('失败保存保留脏状态，重试只保存同一文档和历史，不重新执行命令', async () => {
    const write = vi.fn<Parameters<ImageEditDocumentRepositoryV3['save']>, ReturnType<ImageEditDocumentRepositoryV3['save']>>()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockImplementation(async (document) => ({ documentId: document.id, revision: document.revision, previewRef: null }))
    const state = setup('failed', write)
    state.rename('保留我')
    const snapshot = state.instance.bus.getPersistenceSnapshot()
    await expect(saveImageEditDocumentInstanceV3('failed')).rejects.toThrow('保存未确认')
    expect(state.instance.dirty).toBe(true)
    expect(releaseImageEditDocumentInstanceV3('failed')).toBe(false)
    const same = getOrCreateImageEditDocumentInstanceV3(state.document, {}, state.host)
    expect(same.bus.getPersistenceSnapshot()).toEqual(snapshot)
    await saveImageEditDocumentInstanceV3('failed')
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[0][0]).toBe(write.mock.calls[1][0])
    expect(same.bus.getSnapshot().history.undoCount).toBe(1)
    expect(same.dirty).toBe(false)
  })

  it('保存等待中不释放实例，新修改在同一保存确认中落盘', async () => {
    let finish!: () => void
    const wait = new Promise<void>((resolve) => { finish = resolve })
    const state = setup('saving', async (document) => {
      await wait
      return { documentId: document.id, revision: document.revision, previewRef: null }
    })
    state.rename('first')
    const pending = saveImageEditDocumentInstanceV3('saving')
    state.rename('second')
    expect(releaseImageEditDocumentInstanceV3('saving')).toBe(false)
    finish()
    await pending
    expect(state.queue.getReference().revision).toBe(2)
    expect(state.write).toHaveBeenCalledTimes(2)
    // 确认期间出现的新版本保守保留脏状态，后续确认无需重复落盘。
    await saveImageEditDocumentInstanceV3('saving')
    expect(state.write).toHaveBeenCalledTimes(2)
    expect(releaseImageEditDocumentInstanceV3('saving')).toBe(true)
  })

  it('React 解除挂载后不销毁总线，重挂载旧 props 显示当前状态并继续撤销', async () => {
    const state = setup('ui')
    const props = { document: state.document, profileId: 'full' as const,
      onDocumentChange: vi.fn(), persistenceHost: state.host }
    const first = renderHook(() => useImageEditorControllerV3(props))
    act(() => first.result.current.controller.updateLayerCommon('layer', { name: '界面修改' }))
    const bus = first.result.current.bus
    first.unmount()
    state.rename('离屏修改')
    const second = renderHook(() => useImageEditorControllerV3(props))
    expect(second.result.current.bus).toBe(bus)
    expect(second.result.current.controller.document.layers[0].name).toBe('离屏修改')
    act(() => second.result.current.controller.undo())
    expect(second.result.current.controller.document.layers[0].name).toBe('界面修改')
    second.unmount()
    await saveImageEditDocumentInstanceV3('ui')
    expect(requireImageEditDocumentInstanceV3('ui').views).toBe(0)
  })
})
