import { app, BrowserWindow } from 'electron'
import { registerDbIpc } from './ipc/db'
import { registerKeystoreIpc } from './ipc/keystore'
import { registerPingIpc } from './ipc/registry'
import { registerStreamIpc } from './ipc/stream'
import { registerWindowIpc } from './ipc/window'
import { createWindow } from './window'

app.whenReady().then(() => {
  registerDbIpc()
  registerKeystoreIpc()
  registerPingIpc()
  registerStreamIpc()
  registerWindowIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
