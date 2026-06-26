import { app, BrowserWindow } from 'electron'
import { registerAiRuntimeIpc } from './ipc/ai-runtime'
import { registerClipboardIpc } from './ipc/clipboard'
import { registerDbIpc } from './ipc/db'
import { registerDragIpc } from './ipc/drag'
import { registerImageIpc } from './ipc/image'
import { registerKeystoreIpc } from './ipc/keystore'
import { registerLlmRuntimeIpc } from './ipc/llm-runtime'
import { registerLoggingIpc } from './ipc/logging'
import { registerMediaIpc } from './ipc/media'
import { registerPingIpc } from './ipc/registry'
import { registerProjectPackageIpc } from './ipc/project-package'
import { registerStreamIpc } from './ipc/stream'
import { registerSystemIpc } from './ipc/system'
import { registerWindowIpc } from './ipc/window'
import { registerMediaProtocolHandler, registerMediaProtocolScheme } from './protocol'
import { createWindow } from './window'

registerMediaProtocolScheme()

app.whenReady().then(() => {
  registerMediaProtocolHandler()
  registerAiRuntimeIpc()
  registerClipboardIpc()
  registerDbIpc()
  registerDragIpc()
  registerImageIpc()
  registerKeystoreIpc()
  registerLlmRuntimeIpc()
  registerLoggingIpc()
  registerMediaIpc()
  registerPingIpc()
  registerProjectPackageIpc()
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
