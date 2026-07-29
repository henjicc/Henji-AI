import { app, BrowserWindow } from 'electron'
import path from 'node:path'
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
import { configureChromiumDevelopmentCache } from './chromium-development-cache'
import { configureWebGpuRuntime, registerWebGpuDiagnostics } from './webgpu-runtime'
import { registerMediaProtocolHandler, registerMediaProtocolScheme, restoreAllowedMediaRoots } from './protocol'
import { disposeAgentRuntimeService } from './services/agent-runtime/runtime'
import { runLogRetention } from './services/logging'
import { initializeUpdater } from './services/updater'
import { createWindow } from './window'
import {
  formatAssistantCliHelp,
  isAssistantCliMode,
  parseAssistantCliArguments,
} from './assistant-cli/arguments'
import { runAssistantCli } from './assistant-cli/runner'

registerMediaProtocolScheme()
if (!isAssistantCliMode()) {
  configureChromiumDevelopmentCache()
}
configureWebGpuRuntime()
registerWebGpuDiagnostics()

if (isAssistantCliMode()) {
  // safeStorage 依赖既有的 userData/sessionData；助手 CLI 只隔离纯 Chromium 磁盘缓存。
  app.commandLine.appendSwitch('disk-cache-dir', path.join(app.getPath('temp'), 'henji-assistant-cli-cache'))
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
}

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
  if (isAssistantCliMode()) {
    let assistantCliOptions
    try {
      assistantCliOptions = parseAssistantCliArguments()
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知参数错误'
      process.stdout.write(`${JSON.stringify({ type: 'error', message: '命令行参数无效', detail })}\n`)
      process.exitCode = 1
      app.quit()
      return
    }
    if ('help' in assistantCliOptions) {
      process.stdout.write(`${formatAssistantCliHelp()}\n`)
      app.quit()
      return
    }
    const cliWindow = createWindow({ headless: true })
    void runAssistantCli(cliWindow.webContents, assistantCliOptions).then((exitCode) => {
      process.exitCode = exitCode
      app.quit()
    })
    return
  }

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
