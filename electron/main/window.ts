import { app, BrowserWindow, dialog, screen } from 'electron'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveAppIconPath } from './app-icon'
import { bindWindowStateEvents } from './ipc/window'
import { bindAppMenuWindow } from './ipc/app-menu'
import { createMainLogger } from './services/logging/main-logger'
import { cleanupAllVideoFrameExports } from './services/video/frame-export'
import { closeLogWindow } from './windows/log-window'
import { createVideoEditPopoutHost } from './windows/video-edit-popout'
import { closeCameraStageRenderWindow } from './services/camera-stage-render'
import { windowAppearance } from './services/window-appearance'
import { warmupMediaImportPipeline } from './services/media-import'
import {
  presentWindow,
  resolveBackgroundThrottling,
  resolveInitialWindowPosition,
  resolveDevelopmentWindowPosition,
  type WindowPresentationMode,
} from './window-presentation'
import { installRendererNavigationGuards } from './security/main-renderer-url'
import { resolveDevelopmentLaunchQuery } from './development-launch'
import { RENDERER_RECOVERY_QUERY, RENDERER_SAFE_RECOVERY } from '../../src/core/applicationLifecycle/rendererRecovery'
import { DEVELOPMENT_LAUNCH_QUERY_KEYS } from '../../src/core/development/developmentLaunchContract'

const logger = createMainLogger('main.window')
let mainWindow: BrowserWindow | null = null

const CRASH_WINDOW_MS = 5 * 60_000
/** 留一点时间给正在关闭的窗口完成销毁，退出途中的异常退出不会被误当成需要恢复。 */
const CRASH_RELOAD_DELAY_MS = 500
/** Crashpad 写完转储比 render-process-gone 晚，稍等再找。 */
const CRASH_DUMP_SCAN_DELAY_MS = 3000

export type RendererCrashDecision = 'reload' | 'reload_safe' | 'ask'

/**
 * 5 分钟内第一次崩溃直接重载；第二次以安全恢复重载；第三次起不再自动重载，交给用户决定。
 * 计数用单调时钟，系统改时间不会让计数提前清零或一直不清零。
 */
export function createRendererCrashPolicy(now: () => number = () => performance.now()): () => { decision: RendererCrashDecision; recentCrashes: number } {
  let crashes: number[] = []
  return () => {
    const at = now()
    crashes = [...crashes.filter(time => at - time < CRASH_WINDOW_MS), at]
    const decision = crashes.length === 1 ? 'reload' : crashes.length === 2 ? 'reload_safe' : 'ask'
    return { decision, recentCrashes: crashes.length }
  }
}

/** 只记文件名与大小：转储在用户数据目录里，路径本身带用户名，不进日志。 */
async function reportLatestCrashDump(since: number): Promise<void> {
  try {
    const directory = app.getPath('crashDumps')
    const names = (await readdir(directory, { recursive: true })).filter(name => name.toLowerCase().endsWith('.dmp'))
    const dumps = await Promise.all(names.map(async name => ({ name, info: await stat(path.join(directory, name)) })))
    // 时钟与文件系统时间精度不完全一致，放宽几秒。
    const latest = dumps.filter(dump => dump.info.mtimeMs >= since - 10_000).sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)[0]
    if (latest) logger.info('已生成崩溃转储', { event: 'window.render_process.crash_dump', context: { fileName: path.basename(latest.name), sizeBytes: latest.info.size } })
    else logger.warn('没有找到这次崩溃的转储', { event: 'window.render_process.crash_dump_missing' })
  } catch (error) {
    logger.warn('读取崩溃转储目录失败', { event: 'window.render_process.crash_dump_failed', error })
  }
}

export interface CreateWindowOptions {
  headless?: boolean
  presentation?: WindowPresentationMode
  /** Show the native shell first; admit the renderer only after startup I/O settles. */
  beforeRendererLoad?: () => Promise<void>
  /** 渲染进程异常退出后是否自动重载；默认开启，助手命令行关闭。 */
  recoverRendererCrash?: boolean
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function createWindow(options: CreateWindowOptions = {}): BrowserWindow {
  const headless = options.headless === true
  const presentation = options.presentation ?? 'foreground'
  const allowOversizeForInspection = process.env['HENJI_UI_INSPECTION_ALLOW_OVERSIZE'] === '1'
  const iconPath = resolveAppIconPath()
  const initialSize = { width: 1200, height: 800 }
  const developmentPosition = resolveDevelopmentWindowPosition(process.env['HENJI_DEV_DISPLAY_POINT'], initialSize, screen.getAllDisplays())
  const win = new BrowserWindow({
    ...initialSize,
    ...(developmentPosition ?? (process.platform === 'darwin'
      ? resolveInitialWindowPosition(initialSize, screen.getPrimaryDisplay().workArea)
      : {})),
    minWidth: 960,
    minHeight: 640,
    enableLargerThanScreen: allowOversizeForInspection,
    show: false,
    frame: false,
    backgroundColor: windowAppearance.getBackgroundColor(),
    title: '痕迹AI',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: resolveBackgroundThrottling(presentation),
    },
  })
  mainWindow = win
  bindAppMenuWindow(win)

  const openSession = bindWindowStateEvents(win, Boolean(options.beforeRendererLoad))
  // 只有剪辑系统浮窗的受控 about:blank 请求放行，其余开窗一律拒绝。
  const videoEditPopouts = createVideoEditPopoutHost(win)
  installRendererNavigationGuards(win.webContents, 'main', details => videoEditPopouts.handleWindowOpen(details))
  win.webContents.on('did-start-loading', () => {
    void cleanupAllVideoFrameExports('renderer_reloading')
  })
  const crashPolicy = createRendererCrashPolicy()
  let askingManualReload = false
  const recoverRenderer = (safe: boolean): void => {
    if (win.isDestroyed()) return
    logger.info('重新加载应用界面', { event: 'window.render_process.recovery.reload', context: { safe } })
    loadRenderer(safe)
  }
  const askManualReload = async (recentCrashes: number): Promise<void> => {
    if (askingManualReload) return
    askingManualReload = true
    try {
      // 窗口没有系统边框，标题栏和关闭按钮都画在已经退出的界面里，所以对话框里必须给出关闭窗口的出口。
      const { response } = await dialog.showMessageBox(win, {
        type: 'error', title: '痕迹AI', message: '应用界面多次崩溃',
        detail: `5 分钟内已崩溃 ${recentCrashes} 次，已停止自动重新加载。重新加载时不会自动打开上次的文档。`,
        buttons: ['重新加载', '关闭窗口'], defaultId: 0, cancelId: 0, noLink: true,
      })
      if (win.isDestroyed()) return
      logger.info('用户处理多次崩溃', { event: 'window.render_process.recovery.manual', context: { action: response === 1 ? 'close' : 'reload' } })
      // 界面已退出，关闭前的保存确认收不到回应；直接销毁窗口，否则会一直挡在关闭流程里。
      if (response === 1) win.destroy()
      else recoverRenderer(true)
    } finally { askingManualReload = false }
  }
  win.webContents.on('render-process-gone', (_event, details) => {
    // 渲染进程崩溃/被杀时渲染层日志通道已断，主进程必须记录原因，否则白屏无迹可查
    logger.error('渲染进程异常退出', {
      event: 'window.render_process.gone',
      context: { reason: details.reason, exitCode: details.exitCode },
    })
    void cleanupAllVideoFrameExports('renderer_process_gone')
    // 正常退出（关窗、退出应用）不恢复。
    if (details.reason === 'clean-exit' || win.isDestroyed()) return
    // 转储文件的修改时间是墙上时间，这里也取墙上时间比对。
    const goneAt = Date.now()
    setTimeout(() => { void reportLatestCrashDump(goneAt) }, CRASH_DUMP_SCAN_DELAY_MS)
    // 助手命令行（无论是否显示窗口）不重载：宿主进入“界面已崩溃”，之后的工具调用直接返回 renderer_crashed，
    // 由助手会话自己收尾；命令行运行器本身不检测崩溃。
    if (options.recoverRendererCrash === false) return
    const { decision, recentCrashes } = crashPolicy()
    logger.warn('应用界面崩溃，准备恢复', { event: 'window.render_process.recovery.start', context: { decision, recentCrashes } })
    if (decision === 'ask') { void askManualReload(recentCrashes); return }
    setTimeout(() => recoverRenderer(decision === 'reload_safe'), CRASH_RELOAD_DELAY_MS)
  })
  win.webContents.once('destroyed', () => {
    void cleanupAllVideoFrameExports('web_contents_destroyed')
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    void cleanupAllVideoFrameExports('window_closed')
    closeLogWindow()
    closeCameraStageRenderWindow()
  })

  if (!headless) win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    if (!options.beforeRendererLoad) presentWindow(win, presentation)
    setTimeout(() => {
      if (!win.isDestroyed()) void warmupMediaImportPipeline()
    }, 1500)
  })

  if (!headless && !win.isVisible()) {
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible() && !win.isMinimized()) {
        presentWindow(win, presentation)
      }
    }, 3000)
  }

  if (!process.env['ELECTRON_RENDERER_URL']) {
    win.setMenuBarVisibility(false)
  }

  function loadRenderer(safeRecovery = false): void {
    if (win.isDestroyed()) return
    const developmentLaunch = resolveDevelopmentLaunchQuery()
    developmentLaunch.warnings.forEach((message) => {
      logger.warn(message, { event: 'window.development_launch.invalid' })
    })
    const query: Record<string, string> = { ...developmentLaunch.query }
    if (safeRecovery) {
      // 开发启动参数指定的页面和素材同样会在加载后自动打开，安全恢复时一并去掉。
      delete query[DEVELOPMENT_LAUNCH_QUERY_KEYS.surface]
      delete query[DEVELOPMENT_LAUNCH_QUERY_KEYS.media]
      query[RENDERER_RECOVERY_QUERY] = RENDERER_SAFE_RECOVERY
    }
    const loaded = !process.env['ELECTRON_RENDERER_URL']
      ? win.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
      : (() => {
        const rendererUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
        Object.entries(query).forEach(([key, value]) => {
          rendererUrl.searchParams.set(key, value)
        })
        return win.loadURL(rendererUrl.toString())
      })()
    loaded.catch((error: unknown) => {
      logger.error('加载应用界面失败', { event: 'window.renderer.load_failed', error, context: { safeRecovery } })
    })
  }

  if (options.beforeRendererLoad) {
    if (!headless) presentWindow(win, presentation)
    // Yield to the native window before starting the census. No renderer can
    // create unsaved media references while this gate is closed.
    setImmediate(() => {
      void options.beforeRendererLoad!().then(() => {
        if (win.isDestroyed()) return
        openSession()
        loadRenderer()
      }).catch(error => {
        logger.error('启动准备失败', { event: 'window.startup.failed', error })
        if (!win.isDestroyed()) win.destroy()
      })
    })
  } else loadRenderer()

  return win
}
