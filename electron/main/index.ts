import { app, BrowserWindow } from 'electron'
import { registerDbIpc } from './ipc/db'
import { registerKeystoreIpc } from './ipc/keystore'
import { registerLoggingIpc } from './ipc/logging'
import { registerMediaIpc } from './ipc/media'
import { registerPingIpc } from './ipc/registry'
import { registerStreamIpc } from './ipc/stream'
import { registerSystemIpc } from './ipc/system'
import { registerWindowIpc } from './ipc/window'
import { registerMediaProtocolHandler, registerMediaProtocolScheme } from './protocol'
import { createWindow } from './window'

registerMediaProtocolScheme()

app.whenReady().then(() => {
  registerMediaProtocolHandler()
  registerDbIpc()
  registerKeystoreIpc()
  registerLoggingIpc()
  registerMediaIpc()
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
