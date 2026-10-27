import { beforeEach, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
type Handler = (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>
const boundary = vi.hoisted(() => ({ handlers: new Map<string, Handler>(), trusted: vi.fn(), content: vi.fn(), iconSearch: vi.fn(), iconSave: vi.fn() }))
vi.mock('../services/app-store-icons/runtime', () => ({ appStoreIconService: { search: boundary.iconSearch, save: boundary.iconSave } }))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: Handler) => boundary.handlers.set(channel, handler) } }))
vi.mock('./application-control', () => ({ assertTrustedApplicationSender: boundary.trusted }))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({ info: vi.fn() }) }))
vi.mock('../services/asset-library', () => ({
  ...Object.fromEntries(['addAssetToLibrary', 'checkAssetPaths', 'createAsset', 'createLibrary', 'deleteAsset', 'deleteLibrary', 'inspectAsset', 'inspectAssets', 'inspectLibrary', 'listLibraries', 'listTags', 'queryAssets', 'relocateAsset', 'removeAssetFromLibrary', 'renameLibrary', 'restoreLibrary', 'setAssetTags', 'touchAsset', 'updateAsset'].map(name => [name, vi.fn()])),
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
it('图标 IPC 沿用可信 sender 与统一 schema，拒绝任意路径并保留写前错误类型', async () => {
  const search = boundary.handlers.get('assetLibrary:searchAppStoreIcons')!
  const save = boundary.handlers.get('assetLibrary:saveAppStoreIcon')!
  boundary.trusted.mockImplementationOnce(() => { throw new Error('非应用主帧') })
  expect(await search(event, { query: '元宝' })).toMatchObject({ ok: false })
  expect(boundary.iconSearch).not.toHaveBeenCalled()
  expect(await save(event, { appId: '6480446430', path: 'D:/bad.png' })).toMatchObject({ ok: false })
  expect(boundary.iconSave).not.toHaveBeenCalled()
  boundary.iconSearch.mockResolvedValue({ country: 'cn', candidates: [] })
  await search(event, { query: '腾讯元宝' })
  expect(boundary.iconSearch).toHaveBeenCalledWith({ query: '腾讯元宝', country: 'cn', platform: 'iphone', limit: 8 })
  const error = new Error('没有当前项目，请使用 list_projects'); error.name = 'DocumentLocationError'
  boundary.iconSave.mockRejectedValue(error)
  expect(await save(event, { appId: '6480446430' })).toMatchObject({ ok: false, error: { name: 'DocumentLocationError', message: error.message } })
})
