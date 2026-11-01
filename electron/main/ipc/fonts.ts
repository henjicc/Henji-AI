import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { FONTS_IPC } from '../../../src/platform/contracts/fonts'
import { getFontService } from '../services/fonts/service'
import { assertTrustedApplicationSender } from './application-control'
import { parseVoid, registerIpcHandler } from './registry'
import { showOpenDialog } from '../services/dialogs'
const id = (value: unknown): string => z.object({ id: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(value).id
export function registerFontsIpc(): void {
  const source = z.object({ path: z.string().min(1), index: z.number().int().nonnegative(), signature: z.string(), face: z.object({
    id: z.string(), family: z.string(), localizedFamily: z.string(), fullName: z.string(), postscriptName: z.string(), style: z.string(),
    weight: z.number(), italic: z.boolean(), imported: z.boolean(), supportsCjk: z.boolean(), category: z.enum(['serif', 'sans-serif', 'monospace', 'handwriting', 'unknown']), aliases: z.array(z.string()), variation: z.record(z.string(), z.number()).optional(),
  }).strict() }).strict()
  registerIpcHandler(FONTS_IPC.list, value => z.object({ fixed: z.boolean().optional() }).strict().optional().parse(value), value => value?.fixed ? getFontService().captureSnapshot() : getFontService().list(), assertTrustedApplicationSender)
  registerIpcHandler(FONTS_IPC.readFace, value => z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), source: source.optional() }).strict().parse(value), value => getFontService().readFace(value.id, value.source), assertTrustedApplicationSender)
  registerIpcHandler(FONTS_IPC.remove, id, value => getFontService().remove(value), assertTrustedApplicationSender)
  registerIpcHandler(FONTS_IPC.importFiles, parseVoid, async (_value, event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { title: '导入字体', properties: ['openFile', 'multiSelections'], filters: [{ name: '字体', extensions: ['ttf', 'otf', 'ttc', 'woff2'] }] }
    const selected = await showOpenDialog(window, options)
    return selected.canceled ? getFontService().list() : getFontService().importFiles(selected.filePaths)
  }, assertTrustedApplicationSender)
  // Work begins after startup; never block the first application window.
  setImmediate(() => { void getFontService().list().catch(() => undefined) })
}
