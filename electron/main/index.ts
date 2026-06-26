import { app, BrowserWindow } from 'electron'
import { registerDbIpc } from './ipc/db'
import { registerKeystoreIpc } from './ipc/keystore'
import { registerLoggingIpc } from './ipc/logging'
import { registerPingIpc } from './ipc/registry'
import { registerStreamIpc } from './ipc/stream'
import { registerSystemIpc } from './ipc/system'
import { registerWindowIpc } from './ipc/window'
import { createWindow } from './window'

app.whenReady().then(() => {
  registerDbIpc()
  registerKeystoreIpc()
  registerLoggingIpc()
  registerPingIpc()
  registerStreamIpc()
  registerSystemIpc()
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
