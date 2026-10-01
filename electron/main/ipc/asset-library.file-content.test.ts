import { beforeEach, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
type Handler = (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>
const boundary = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), trusted: vi.fn(), content: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: Handler) => boundary.handlers.set(channel, handler) } }))
vi.mock('./application-control', () => ({ assertTrustedApplicationSender: boundary.trusted }))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({ info: vi.fn() }) }))
vi.mock('../services/asset-library', () => ({
  ...Object.fromEntries(['addAssetToLibrary', 'checkAssetPaths', 'createAsset', 'createLibrary', 'deleteAsset', 'deleteLibrary', 'inspectAsset', 'inspectAssets', 'inspectLibrary', 'listLibraries', 'listTags', 'queryAssets', 'rebaseAssetDataRoot', 'relocateAsset', 'removeAssetFromLibrary', 'renameLibrary', 'restoreLibrary', 'setAssetTags', 'touchAsset', 'updateAsset'].map(name => [name, vi.fn()])),
  inspectAssetFileContent: boundary.content,
}))
import { registerAssetLibraryIpc } from './asset-library'
const event = {} as IpcMainInvokeEvent
beforeEach(() => { vi.resetAllMocks(); boundary.handlers.clear(); registerAssetLibraryIpc() })
it('新增固定文件核验沿用可信sender并验证类型，拒绝调用时不读取文件', async () => {
  const handler = boundary.handlers.get('assetLibrary:inspectFileContent')!
  boundary.trusted.mockImplementationOnce(() => { throw new Error('非应用主帧') })
  expect(await handler(event, { filePath: 'D:/allowed.png', mediaType: 'image' })).toMatchObject({ ok: false, error: { message: '非应用主帧' } })
  expect(boundary.content).not.toHaveBeenCalled()
  for (const input of [{ filePath: 'D:/allowed.png', mediaType: 'unknown' }, { filePath: '', mediaType: 'image' }]) expect(await handler(event, input)).toMatchObject({ ok: false })
  expect(boundary.content).not.toHaveBeenCalled()
  const content = { sizeBytes: 10, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64) }; boundary.content.mockResolvedValue(content)
  expect(await handler(event, { filePath: 'D:/allowed.png', mediaType: 'image' })).toEqual({ ok: true, data: content })
  expect(boundary.content).toHaveBeenCalledWith('D:/allowed.png', 'image'); expect(boundary.trusted).toHaveBeenCalledTimes(4)
})
