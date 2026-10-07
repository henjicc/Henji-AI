import { app, BrowserWindow, dialog } from 'electron'
import { z } from 'zod'
import { FONTS_IPC } from '../../../src/platform/contracts/fonts'
import { getFontService, disposeFonts } from '../services/fonts/service'
import { assertTrustedApplicationSender } from './application-control'
import { parseVoid, registerIpcHandler } from './registry'
const id = (value: unknown): string => z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(value).id
export function registerFontsIpc(): void {
  registerIpcHandler(FONTS_IPC.list, parseVoid, () => getFontService().list(), assertTrustedApplicationSender)
  registerIpcHandler(FONTS_IPC.readFace, id, value => getFontService().readFace(value), assertTrustedApplicationSender)
  registerIpcHandler(FONTS_IPC.remove, id, value => getFontService().remove(value), assertTrustedApplicationSender)
  registerIpcHandler(FONTS_IPC.importFiles, parseVoid, async (_value, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { title: '导入字体', properties: ['openFile', 'multiSelections'], filters: [{ name: '字体', extensions: ['ttf', 'otf', 'ttc', 'woff2'] }] }
    const selected = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    return selected.canceled ? getFontService().list() : getFontService().importFiles(selected.filePaths)
  }, assertTrustedApplicationSender)
  app.once('will-quit', disposeFonts)
  // Work begins after startup; never block the first application window.
  setImmediate(() => { void getFontService().list().catch(() => undefined) })
}
