import { BrowserWindow } from 'electron'
import path from 'node:path'
import { bindWindowStateEvents, maximizeWindow } from './ipc/window'

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: 'transparent',
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
    maximizeWindow(win)
    win.show()
  })

  if (!win.isVisible()) {
    setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) {
        maximizeWindow(win)
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
