import { app, BrowserWindow } from 'electron'
import { registerAiRuntimeIpc } from './ipc/ai-runtime'
import { registerCanvasProjectsIpc } from './ipc/canvas-projects'
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
import { registerUpdaterIpc } from './ipc/updater'
import { registerVideoIpc } from './ipc/video'
import { registerWindowIpc } from './ipc/window'
import { registerMediaProtocolHandler, registerMediaProtocolScheme } from './protocol'
import { initializeUpdater } from './services/updater'
import { createWindow } from './window'

registerMediaProtocolScheme()

const remoteDebuggingPort = process.env['HENJI_ELECTRON_REMOTE_DEBUGGING_PORT']
if (remoteDebuggingPort) {
  app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort)
}

app.whenReady().then(() => {
  registerMediaProtocolHandler()
  registerAiRuntimeIpc()
  registerCanvasProjectsIpc()
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
  registerUpdaterIpc()
  registerVideoIpc()
  registerWindowIpc()
  initializeUpdater()
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
