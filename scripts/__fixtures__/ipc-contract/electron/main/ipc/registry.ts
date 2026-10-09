import { CHANNELS as c } from '../../../channels'
export function registerIpcHandler(channel: string): void { ipcMain.handle(channel, () => undefined) }
registerIpcHandler(c.read)
ipcMain.on(c.port, () => undefined)
window.webContents.send(c.changed, {})
