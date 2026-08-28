import { BrowserWindow } from 'electron'
import path from 'node:path'
import { resolveAppIconPath } from './app-icon'
import { bindWindowStateEvents } from './ipc/window'
import { createMainLogger } from './services/logging/main-logger'
import { cleanupAllVideoFrameExports } from './services/video/frame-export'
import { closeLogWindow } from './windows/log-window'
import { closeCameraStageRenderWindow } from './services/camera-stage-render'
import { APP_WINDOW_BACKGROUND_HEX } from '../../src/core/theme/colorTokens'
import { warmupMediaImportPipeline } from './services/media-import'
import { presentWindow, type WindowPresentationMode } from './window-presentation'

const logger = createMainLogger('main.window')
let mainWindow: BrowserWindow | null = null

export interface CreateWindowOptions {
  headless?: boolean
  presentation?: WindowPresentationMode
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function createWindow(options: CreateWindowOptions = {}): BrowserWindow {
  const headless = options.headless === true
  const presentation = options.presentation ?? 'foreground'
  const allowOversizeForInspection = process.env['HENJI_UI_INSPECTION_ALLOW_OVERSIZE'] === '1'
  const iconPath = resolveAppIconPath()
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    enableLargerThanScreen: allowOversizeForInspection,
    show: false,
    frame: false,
    backgroundColor: APP_WINDOW_BACKGROUND_HEX,
    title: '痕迹AI',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow = win

  bindWindowStateEvents(win)
  win.webContents.on('did-start-loading', () => {
    void cleanupAllVideoFrameExports('renderer_reloading')
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    // 渲染进程崩溃/被杀时渲染层日志通道已断，主进程必须记录原因，否则白屏无迹可查
    logger.error('渲染进程异常退出', {
      event: 'window.render_process.gone',
      context: { reason: details.reason, exitCode: details.exitCode },
    })
    void cleanupAllVideoFrameExports('renderer_process_gone')
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
    presentWindow(win, presentation)
    setTimeout(() => {
      if (!win.isDestroyed()) void warmupMediaImportPipeline()
    }, 1500)
  })

  if (!headless && !win.isVisible()) {
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) {
        presentWindow(win, presentation)
      }
    }, 3000)
  }

  if (!process.env['ELECTRON_RENDERER_URL']) {
    win.setMenuBarVisibility(false)
  }

  if (!win.isDestroyed()) {
    if (!process.env['ELECTRON_RENDERER_URL']) {
      void win.loadFile(path.join(__dirname, '../renderer/index.html'))
    } else {
      void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    }
  }

  return win
}
