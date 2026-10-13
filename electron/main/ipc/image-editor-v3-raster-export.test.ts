import { EventEmitter } from 'node:events'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown, event: IpcMainInvokeEvent) => Promise<unknown>>(),
  showSaveDialog: vi.fn(),
}))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => ({}) },
  dialog: { showSaveDialog: mocks.showSaveDialog },
}))
vi.mock('./registry', async (importOriginal) => ({
  ...await importOriginal<typeof import('./registry')>(),
  registerIpcHandler: (name: string, parse: (value: unknown) => unknown,
    handler: (payload: unknown, event: IpcMainInvokeEvent) => Promise<unknown>) => {
    mocks.handlers.set(name, (payload, event) => handler(parse(payload), event))
  },
}))
vi.mock('../services/image-editor-v3', async () => {
  const { toDocumentRef, parseDocumentRef } = await import('../services/image-editor-v3/document-repository')
  return { toDocumentRef, parseDocumentRef }
})

import { registerImageEditorV3RasterExportIpc, type RegisterRasterExportIpcOptions } from './image-editor-v3-raster-export'

let root = ''
beforeEach(async () => {
  vi.resetAllMocks()
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-export-dialog-'))
})
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }) })

function fixture() {
  const manager = {
    start: vi.fn(async () => ({ sessionId: 'session', documentId: 'photo', revision: 0,
      sourceFingerprint: `sha256:${'a'.repeat(64)}`, format: 'jpeg' })),
    onClosed: vi.fn(() => () => undefined),
  }
  registerImageEditorV3RasterExportIpc({
    manager: manager as unknown as RegisterRasterExportIpcOptions['manager'],
    materializer: {} as RegisterRasterExportIpcOptions['materializer'],
    guard: (() => true) as RegisterRasterExportIpcOptions['guard'],
    runRequest: async (_operation, _requestId, _senderId, work) => work(new AbortController().signal),
  })
  const sender = Object.assign(new EventEmitter(), { id: 7 })
  const event = { sender } as unknown as IpcMainInvokeEvent
  const payload = { requestId: 'export-photo', documentRef: 'image-edit-v3:photo', revision: 0,
    sourceFingerprint: `sha256:${'a'.repeat(64)}`, format: 'jpeg',
    description: { width: 1, height: 1, bitDepth: 8, sampleFormat: 'uint',
      colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight' } }
  return { manager, start: () => mocks.handlers.get('imageEditorV3:rasterExport:start')!(payload, event) }
}

describe('栅格导出路径与覆盖确认', () => {
  it.each(['photo.png', 'photo'])('改写 %s 到已存在 JPEG 时拒绝覆盖不启动导出', async (name) => {
    const { manager, start } = fixture()
    const target = path.join(root, 'photo.jpg')
    await fsp.writeFile(target, 'original')
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(root, name) })
      .mockResolvedValueOnce({ canceled: true })
    await expect(start()).resolves.toEqual({ status: 'cancelled' })
    expect(manager.start).not.toHaveBeenCalled()
    expect(mocks.showSaveDialog).toHaveBeenCalledTimes(2)
    expect(mocks.showSaveDialog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ defaultPath: target }))
    expect(await fsp.readFile(target, 'utf8')).toBe('original')
  })

  it('改写后显式确认覆盖才启动导出', async () => {
    const { manager, start } = fixture()
    const target = path.join(root, 'photo.jpg')
    await fsp.writeFile(target, 'original')
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(root, 'photo.png') })
      .mockResolvedValueOnce({ canceled: false, filePath: target })
    await expect(start()).resolves.toMatchObject({ status: 'completed' })
    expect(mocks.showSaveDialog).toHaveBeenCalledTimes(2)
    expect(manager.start).toHaveBeenCalledWith(expect.objectContaining({ targetPath: target }))
  })

  it('匹配扩展名的覆盖沿用保存对话框授权', async () => {
    const { manager, start } = fixture()
    const target = path.join(root, 'photo.JPEG')
    await fsp.writeFile(target, 'original')
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    await expect(start()).resolves.toMatchObject({ status: 'completed' })
    expect(manager.start).toHaveBeenCalledWith(expect.objectContaining({ targetPath: target }))
    expect(mocks.showSaveDialog).toHaveBeenCalledOnce()
  })

  it('改写后的目标不存在时直接导出；取消原对话框不启动', async () => {
    const { manager, start } = fixture()
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path.join(root, 'new.png') })
    await expect(start()).resolves.toMatchObject({ status: 'completed' })
    expect(manager.start).toHaveBeenCalledWith(expect.objectContaining({ targetPath: path.join(root, 'new.jpg') }))
    expect(mocks.showSaveDialog).toHaveBeenCalledOnce()
    manager.start.mockClear()
    mocks.showSaveDialog.mockResolvedValueOnce({ canceled: true })
    await expect(start()).resolves.toEqual({ status: 'cancelled' })
    expect(manager.start).not.toHaveBeenCalled()
  })
})
