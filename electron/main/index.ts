import { app, BrowserWindow } from 'electron'
import { registerAiRuntimeIpc } from './ipc/ai-runtime'
import { registerAgentRuntimeIpc } from './ipc/agent-runtime'
import { registerAudioIpc } from './ipc/audio'
import { registerAssetLibraryIpc } from './ipc/asset-library'
import { registerAssistantIpc } from './ipc/assistant'
import { registerCameraStageProjectsIpc } from './ipc/camera-stage-projects'
import { registerCameraStageRenderIpc } from './ipc/camera-stage-render'
import { registerCanvasProjectsIpc } from './ipc/canvas-projects'
import { registerClipboardIpc } from './ipc/clipboard'
import { registerCustomModelsIpc } from './ipc/custom-models'
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
import { registerStoryboardProjectsIpc } from './ipc/storyboard-projects'
import { registerSystemIpc } from './ipc/system'
import { registerUpdaterIpc } from './ipc/updater'
import { registerVideoIpc } from './ipc/video'
import { registerWindowIpc } from './ipc/window'
import { registerMediaProtocolHandler, registerMediaProtocolScheme, restoreAllowedMediaRoots } from './protocol'
import { disposeAgentRuntimeService } from './services/agent-runtime/runtime'
import { runLogRetention } from './services/logging'
import { initializeUpdater } from './services/updater'
import { createWindow } from './window'

registerMediaProtocolScheme()

const remoteDebuggingPort = process.env['HENJI_ELECTRON_REMOTE_DEBUGGING_PORT']
if (remoteDebuggingPort) {
  app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort)
}

app.whenReady().then(() => {
  registerMediaProtocolHandler()
  restoreAllowedMediaRoots()
  registerAiRuntimeIpc()
  registerAgentRuntimeIpc()
  registerAudioIpc()
  registerAssetLibraryIpc()
  registerAssistantIpc()
  registerCameraStageProjectsIpc()
  registerCameraStageRenderIpc()
  registerCanvasProjectsIpc()
  registerClipboardIpc()
  registerCustomModelsIpc()
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
  registerStoryboardProjectsIpc()
  registerSystemIpc()
  registerUpdaterIpc()
  registerVideoIpc()
  registerWindowIpc()
  initializeUpdater()
  void runLogRetention()
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

app.on('before-quit', () => {
  void disposeAgentRuntimeService()
})
