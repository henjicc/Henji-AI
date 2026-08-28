import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { warmApiMartEndpointPreference, warmGrsaiEndpointPreference } from '@henjicc/ai-sdk'
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
import { registerLlmProviderSettingsIpc } from './ipc/llm-provider-settings'
import { registerLoggingIpc } from './ipc/logging'
import { registerMediaIpc } from './ipc/media'
import { registerPingIpc } from './ipc/registry'
import { registerProjectCoversIpc } from './ipc/project-covers'
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
import { configureMacDockIcon } from './app-icon'
import { disposeAgentRuntimeService } from './services/agent-runtime/runtime'
import { sdkRuntimeContext } from './services/ai-runtime/sdk-runtime'
import { getAiProviderApiKey } from './services/keystore'
import { runLogRetention } from './services/logging'
import { initializeUpdater } from './services/updater'
import { createWindow } from './window'
import { resolveWindowPresentationMode } from './window-presentation'
import {
  formatAssistantCliHelp,
  isAssistantCliMode,
  parseAssistantCliArguments,
} from './assistant-cli/arguments'
import { runAssistantCli } from './assistant-cli/runner'
import { runAssistantModelVerification } from './assistant-cli/verify-model'

/*
 * 自动化隔离的唯一开关。
 *
 * `--user-data-dir` 只改 userData，而本应用的数据库、日志、媒体目录全部挂在
 * `app.getPath('appData')` 下；Windows 上启动脚本还能靠覆盖 LOCALAPPDATA 兜住，
 * macOS / Linux 没有等价环境变量，"隔离临时数据"会直接写用户真实资料。
 * 在 ready 之前重定向 appData，四处数据目录调用点自动跟随，无需各自加分支。
 */
const isolatedAppData = process.env['HENJI_ISOLATED_APP_DATA']
if (isolatedAppData) {
  app.setPath('appData', isolatedAppData)
}

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
  configureMacDockIcon()
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
  registerLlmProviderSettingsIpc()
  registerLoggingIpc()
  registerMediaIpc()
  registerPingIpc()
  registerProjectCoversIpc()
  registerProjectPackageIpc()
  registerStreamIpc()
  registerStoryboardProjectsIpc()
  registerSystemIpc()
  registerUpdaterIpc()
  registerVideoIpc()
  registerWindowIpc()
  initializeUpdater()
  void runLogRetention()
  // 后台预热 APIMart 域名连通性，不阻塞启动；没配置 Key 的用户没有意义，跳过。
  if (getAiProviderApiKey('apimart')) {
    void warmApiMartEndpointPreference(sdkRuntimeContext.transport)
  }
  // 后台预热 Grsai 全球/国内节点连通性，同上不阻塞启动。
  if (getAiProviderApiKey('grsai')) {
    void warmGrsaiEndpointPreference(sdkRuntimeContext.transport)
  }
  // 无界面模型能力验证：接新供应商时请求体常要试几轮，不该每轮都让人去点设置界面。
  if (process.argv.includes('--verify-model')) {
    void runAssistantModelVerification(process.argv.slice(1)).then((code) => { app.exit(code) })
    return
  }

  if (isAssistantCliMode()) {
    let assistantCliOptions
    try {
      assistantCliOptions = parseAssistantCliArguments()
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知参数错误'
      process.stdout.write(`${JSON.stringify({ type: 'error', message: '命令行参数无效', detail })}\n`)
      app.exit(1)
      return
    }
    if ('help' in assistantCliOptions) {
      process.stdout.write(`${formatAssistantCliHelp()}\n`)
      app.quit()
      return
    }
    const cliWindow = createWindow({ headless: !assistantCliOptions.visible })
    void runAssistantCli(cliWindow.webContents, assistantCliOptions).then(async (exitCode) => {
      // CLI 必须有确定的进程终点。供应商请求取消后极少数 SDK 会迟迟不释放连接，
      // 不能让已经产出终态的真实验收命令永远挂住。
      await Promise.race([
        disposeAgentRuntimeService(),
        new Promise<void>((resolve) => { setTimeout(resolve, 5_000) }),
      ])
      app.exit(exitCode)
    })
    return
  }

  createWindow({ presentation: resolveWindowPresentationMode() })

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
