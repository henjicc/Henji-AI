import { BrowserWindow } from 'electron'
import path from 'node:path'
import { bindWindowStateEvents } from './ipc/window'
import { APP_WINDOW_BACKGROUND_HEX } from '../../src/core/theme/colorTokens'

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
