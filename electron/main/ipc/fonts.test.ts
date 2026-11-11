import { expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { FONTS_IPC } from '../../../src/platform/contracts/fonts'
const state = vi.hoisted(() => ({
  handlers: new Map<string, (event: IpcMainInvokeEvent, value: unknown) => Promise<{ ok: boolean }>>(),
  trusted: vi.fn(), list: vi.fn(async () => ({ faces: [], revision: 0 })), read: vi.fn(async () => ({})), remove: vi.fn(async () => ({})), import: vi.fn(async () => ({})), dialog: vi.fn(async () => ({ canceled: false, filePaths: ['native-selected.ttf'] })),
}))
vi.mock('electron', () => ({ app: { once: vi.fn() }, ipcMain: { handle: (channel: string, handler: (event: IpcMainInvokeEvent, value: unknown) => Promise<{ ok: boolean }>) => state.handlers.set(channel, handler) }, BrowserWindow: { fromWebContents: () => null }, dialog: { showOpenDialog: state.dialog } }))
vi.mock('./application-control', () => ({ assertTrustedApplicationSender: state.trusted }))
vi.mock('../services/fonts/service', () => ({ disposeFonts: vi.fn(), getFontService: () => ({ list: state.list, readFace: state.read, remove: state.remove, importFiles: state.import }) }))
import { registerFontsIpc } from './fonts'
it('所有字体 IPC 校验本应用来源；只接受已知 ID；拖进来的字体按路径导入，不带路径才弹选择器', async () => {
  registerFontsIpc(); const event = {} as IpcMainInvokeEvent
  const read = state.handlers.get(FONTS_IPC.readFace)!
  expect((await read(event, { id: '../secret.ttf' })).ok).toBe(false); expect(state.read).not.toHaveBeenCalled()
  expect((await read(event, { id: 'a'.repeat(64), path: 'secret.ttf' })).ok).toBe(false)
  expect((await read(event, { id: 'a'.repeat(64) })).ok).toBe(true); expect(state.read).toHaveBeenCalledWith('a'.repeat(64), undefined)
  const importFont = state.handlers.get(FONTS_IPC.importFiles)!
  expect((await importFont(event, { paths: ['D:/fonts/dropped.ttf'] })).ok).toBe(true); expect(state.dialog).not.toHaveBeenCalled()
  expect(state.import).toHaveBeenLastCalledWith(['D:/fonts/dropped.ttf'])
  expect((await importFont(event, { paths: [] })).ok).toBe(false)
  expect((await importFont(event, undefined)).ok).toBe(true); expect(state.import).toHaveBeenLastCalledWith(['native-selected.ttf'])
  state.trusted.mockImplementation(() => { throw new Error('untrusted') })
  for (const handler of state.handlers.values()) expect((await handler(event, undefined)).ok).toBe(false)
})
