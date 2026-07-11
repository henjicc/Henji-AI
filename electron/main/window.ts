import { BrowserWindow } from 'electron'
import path from 'node:path'
import { bindWindowStateEvents } from './ipc/window'
import { createMainLogger } from './services/logging/main-logger'
import { cleanupAllVideoFrameExports } from './services/video/frame-export'
import { closeLogWindow } from './windows/log-window'
import { APP_WINDOW_BACKGROUND_HEX } from '../../src/core/theme/colorTokens'

const logger = createMainLogger('main.window')

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: APP_WINDOW_BACKGROUND_HEX,
    title: '痕迹AI',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

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
    void cleanupAllVideoFrameExports('window_closed')
    closeLogWindow()
  })

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    win.maximize()
    win.show()
  })

  if (!win.isVisible()) {
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) {
        win.maximize()
        win.show()
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
