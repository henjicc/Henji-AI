import { registerApplicationControlIpc } from './ipc/application-control'
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { warmApiMartEndpointPreference, warmGrsaiEndpointPreference } from '@henjicc/ai-sdk'
import { registerAiRuntimeIpc } from './ipc/ai-runtime'
import { registerAudioIpc } from './ipc/audio'
import { registerAssetLibraryIpc } from './ipc/asset-library'
import { registerAssistantIpc } from './ipc/assistant'
import { registerCameraStageRenderIpc } from './ipc/camera-stage-render'
import { registerClipboardIpc } from './ipc/clipboard'
import { registerCustomModelsIpc } from './ipc/custom-models'
import { registerLocalRecordsIpc } from './ipc/local-records'
import { registerFontsIpc } from './ipc/fonts'
import { registerTestFixturesIpc } from './ipc/test-fixtures'
import { configureDatabaseMigrations } from './services/db'
import { databaseMigrationOptions } from './services/db-locations'
import { registerDocumentsIpc } from './ipc/documents'
import { registerWorkRootIpc } from './ipc/work-root'
import { registerLocalModelsIpc } from './ipc/local-models'
import { registerSmartRegionsIpc } from './ipc/smart-regions'
import { registerVideoProxyHandlers } from './ipc/video-proxy'
import { registerSceneDetectionHandlers } from './ipc/scene-detection'
import { registerTrackingIpc } from './ipc/tracking'
import { disposeLocalModels } from './services/local-models/runtime'
import { disposeSmartRegions } from './services/smart-regions/runtime'
import { disposeTracking } from './services/tracking/runtime'
import { disposeWorkRootChange } from './services/work-root/runtime'
import { registerDragIpc } from './ipc/drag'
import { registerImageIpc } from './ipc/image'
import { disposeImageEditorV3Ipc, registerImageEditorV3Ipc } from './ipc/image-editor-v3'
import { registerKeystoreIpc } from './ipc/keystore'
import { registerLlmRuntimeIpc } from './ipc/llm-runtime'
import { registerLlmProviderSettingsIpc } from './ipc/llm-provider-settings'
import { registerLoggingIpc } from './ipc/logging'
import { registerMediaIpc } from './ipc/media'
import { registerPingIpc } from './ipc/registry'
import { registerStreamIpc } from './ipc/stream'
import { registerSystemIpc } from './ipc/system'
import { registerUpdaterIpc } from './ipc/updater'
import { registerVideoIpc } from './ipc/video'
import { registerVideoDecoderIpc } from './ipc/video-decoder'
import { registerVideoFramesIpc } from './ipc/video-frames'
import { registerWindowIpc } from './ipc/window'
import { registerEmbeddedAgentIpc, disposeEmbeddedAgent } from './ipc/embedded-agent'
import { registerMcpIpc, disposeMcp } from './ipc/mcp'
import { configureChromiumDevelopmentCache } from './chromium-development-cache'
import { configureWebGpuRuntime, registerWebGpuDiagnostics } from './webgpu-runtime'
import { registerMediaProtocolHandler, registerMediaProtocolScheme, restoreAllowedMediaRoots } from './protocol'
import { configureMacDockIcon } from './app-icon'
import { sdkRuntimeContext } from './services/ai-runtime/sdk-runtime'
import { getAiProviderApiKey } from './services/keystore'
import { createMainLogger, runLogRetention } from './services/logging'
import { bindApplicationShutdown } from './application-shutdown'
import { initializeUpdater } from './services/updater'
import { scheduleStartupDocumentIndexScan } from './services/documents/runtime'
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

// henji.db 第一次打开时执行迁移账本；位置换算与备份目录在这里登记（数据库模块本身不依赖作品目录）。
configureDatabaseMigrations(databaseMigrationOptions)

registerMediaProtocolScheme()
if (!isAssistantCliMode()) {
  configureChromiumDevelopmentCache()
}
configureWebGpuRuntime()
registerWebGpuDiagnostics()

if (isAssistantCliMode()) {
  // safeStorage 依赖既有的 userData/sessionData；助手 CLI 只隔离纯 Chromium 磁盘缓存。
  app.commandLine.appendSwitch('disk-cache-dir', path.join(app.getPath('temp'), 'henji-assistant-cli-cache'))
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
  // 剪辑渲染与代码素材试渲染都要 WebGPU：只在无窗口运行时关 GPU，--visible 端到端验证保留显卡。
  if (!process.argv.includes('--visible')) app.commandLine.appendSwitch('disable-gpu')
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
  registerAudioIpc()
  registerAssetLibraryIpc()
  registerAssistantIpc()
  registerCameraStageRenderIpc()
  registerClipboardIpc()
  registerCustomModelsIpc()
  registerLocalRecordsIpc()
  registerFontsIpc()
  registerTestFixturesIpc()
  registerDocumentsIpc()
  registerWorkRootIpc()
  registerLocalModelsIpc()
  registerSmartRegionsIpc()
  registerVideoProxyHandlers()
  registerSceneDetectionHandlers()
  registerTrackingIpc()
  registerDragIpc()
  registerImageIpc()
  registerImageEditorV3Ipc()
  registerKeystoreIpc()
  registerLlmRuntimeIpc()
  registerLlmProviderSettingsIpc()
  registerLoggingIpc()
  registerMediaIpc()
  registerPingIpc()
  registerStreamIpc()
  registerSystemIpc()
  registerUpdaterIpc()
  registerVideoIpc()
  registerVideoDecoderIpc()
  registerVideoFramesIpc()
  registerWindowIpc()
  registerApplicationControlIpc()
  registerMcpIpc()
  registerEmbeddedAgentIpc()
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
        new Promise<void>((resolve) => { setTimeout(resolve, 5_000) }),
      ])
      app.exit(exitCode)
    })
    return
  }

  createWindow({ presentation: resolveWindowPresentationMode() })
  // 作品索引在后台扫描，不阻塞启动（文件才是唯一真相，索引随时可以重建）。
  scheduleStartupDocumentIndexScan()

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

bindApplicationShutdown(app, [disposeWorkRootChange, disposeTracking, disposeSmartRegions, disposeLocalModels, disposeEmbeddedAgent, disposeMcp, disposeImageEditorV3Ipc], (error) => {
  createMainLogger('application.shutdown').error('应用服务退出清理失败', { event: 'application.shutdown.failed', error })
})
