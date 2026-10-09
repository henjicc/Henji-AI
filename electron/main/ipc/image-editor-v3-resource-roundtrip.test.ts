import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { ImageEditCommandHistoryV3 } from '../../../src/core/imageEdit/v3/commandHistory'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../../../src/core/imageEdit/v3/documentFactory'
import type { ImageEditorV3DocumentSnapshot } from '../../../src/platform/contracts/imageEditorV3'
import { ContentAddressedResourceStore } from '../services/image-editor-v3/resource-store'

const state = vi.hoisted(() => ({
  root: '',
  handlers: new Map<string, (input: unknown, event: IpcMainInvokeEvent) => unknown>(),
}))
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => state.root) },
  BrowserWindow: { fromWebContents: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))
vi.mock('../window', () => ({ getMainWindow: vi.fn() }))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(),
}) }))
vi.mock('../services/appPaths', () => ({
  getProgramStoreDir: () => state.root,
  getUserDataLayout: () => ({ root: state.root, locale: 'zh' }),
}))
vi.mock('../services/appBasePaths', () => ({ getProgramStoreDir: () => state.root }))
// 只替代 Electron 传输/发送者边界，保留正式 parser、IPC 装配和全部资源/文档服务。
vi.mock('./registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('./registry')>(),
  registerIpcHandler: <T>(channel: string, parse: (input: unknown) => T,
    handler: (input: T, event: IpcMainInvokeEvent) => unknown): void => {
    state.handlers.set(channel, (input, event) => handler(parse(input), event))
  },
}))

import { disposeImageEditorV3Ipc, registerImageEditorV3Ipc } from './image-editor-v3'

afterEach(async () => {
  await disposeImageEditorV3Ipc()
  vi.restoreAllMocks()
  state.handlers.clear()
  if (state.root) await fsp.rm(state.root, { recursive: true, force: true })
})

it('正式 IPC 装配共享资源库：历史独占瓦片与分页在 GC、运行时关闭及新实例重开后仍可重做', async () => {
  state.root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-ipc-resource-roundtrip-'))
  registerImageEditorV3Ipc()
  const event = { sender: { id: 1 } } as IpcMainInvokeEvent
  const invoke = async <T>(channel: string, input: unknown): Promise<T> => {
    const handler = state.handlers.get(`imageEditorV3:${channel}`)
    if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
    return await handler(input, event) as T
  }
  const persisted = await invoke<{ tiles: Array<{ resource: { resourceRef: `sha256:${string}`; byteSize: number } }> }>(
    'brushTiles:persist', { requestId: 'persist', tiles: [{ tileKey: '0/0/0', tile: {
      storage: 'rgba-float32', width: 1, height: 1, data: new Float32Array([1, 0, 0, 1]).buffer,
      colorDomain: 'linear-light', workingSpace: 'srgb', transferFunction: 'linear', referenceWhiteNits: 203, alpha: 'premultiplied',
    } }] })
  const resource = persisted.tiles[0].resource
  const initial = createImageEditDocumentV3({ width: 1, height: 1, documentId: 'ipc-roundtrip' })
  initial.layers = [createImageEditRasterLayerV3('paint', '画笔')]
  const history = new ImageEditCommandHistoryV3()
  const painted = history.execute(initial, { type: 'raster.apply-tile-delta', commandId: 'paint', expectedRevision: 0,
    layerId: initial.layers[0].id, changes: [{ tileKey: '0/0/0', previousResourceId: null, previousByteSize: 0,
      resourceId: resource.resourceRef, byteSize: resource.byteSize }] })
  const undone = history.undo(painted).document
  await invoke('document:save', { requestId: 'save', document: undone, expectedRevision: 0,
    resourceRefs: [resource.resourceRef], history: history.createSnapshot() })
  const raw = JSON.parse(await fsp.readFile(path.join(state.root, 'documents/ipc-roundtrip.json'), 'utf8')) as Record<string, unknown>
  expect(raw).toHaveProperty('historyCheckpoint')
  expect(raw).not.toHaveProperty('history')

  // 强制使用零最低年龄，避免“资源太新”掩盖正式 GC 根装配缺失。
  const collect = ContentAddressedResourceStore.prototype.garbageCollect
  vi.spyOn(ContentAddressedResourceStore.prototype, 'garbageCollect').mockImplementation(function (this: ContentAddressedResourceStore, roots, options) {
    return collect.call(this, roots, { ...options, minimumAgeMs: 0 })
  })
  expect(await invoke('resource:collectGarbage', { requestId: 'gc', retainedResourceRefs: [] }))
    .toMatchObject({ deletedResourceRefs: [] })
  await disposeImageEditorV3Ipc()
  registerImageEditorV3Ipc()
  const reopened = await invoke<ImageEditorV3DocumentSnapshot>('document:load', {
    requestId: 'load', documentRef: 'image-edit-v3:ipc-roundtrip',
  })
  expect(reopened.resourceRefs).toContain(resource.resourceRef)
  expect(reopened.resources.find(item => item.resourceRef === resource.resourceRef)?.mediaType)
    .toBe('application/x-henji-brush-tile-v3')
  const restored = new ImageEditCommandHistoryV3()
  restored.restore(reopened.document, reopened.history)
  expect(restored.redo(reopened.document).document.layers[0]).toMatchObject({ tiles: { '0/0/0': resource.resourceRef } })
  const read = await invoke<{ tiles: Array<{ tile: { data: ArrayBuffer } }> }>('brushTiles:read', {
    requestId: 'read', tiles: [{ tileKey: '0/0/0', resource }],
  })
  expect([...new Float32Array(read.tiles[0].tile.data)]).toEqual([1, 0, 0, 1])
})
