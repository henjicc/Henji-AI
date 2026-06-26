import { BrowserWindow, screen, type IpcMainInvokeEvent, type Rectangle } from 'electron'
import { parseVoid, registerIpcHandler } from './registry'

const WINDOW_MINIMIZE = 'window:minimize'
const WINDOW_TOGGLE_MAXIMIZE = 'window:toggleMaximize'
const WINDOW_CLOSE = 'window:close'
const WINDOW_IS_MAXIMIZED = 'window:isMaximized'
const WINDOW_TOGGLE_DEVTOOLS = 'window:toggleDevTools'
const WINDOW_STATE_CHANGED = 'window:stateChanged'

interface WindowStatePayload {
  isMaximized: boolean
}

const normalBoundsByWindow = new WeakMap<BrowserWindow, Rectangle>()
const maximizedByWindow = new WeakMap<BrowserWindow, boolean>()

function getEventWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    throw new Error('Unable to resolve BrowserWindow for IPC sender')
  }
  return win
}

function isWindowMaximized(win: BrowserWindow): boolean {
  return maximizedByWindow.get(win) === true || win.isMaximized()
}

function sendWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return

  const payload: WindowStatePayload = {
    isMaximized: isWindowMaximized(win),
  }
  win.webContents.send(WINDOW_STATE_CHANGED, payload)
}

export function maximizeWindow(win: BrowserWindow): void {
  if (isWindowMaximized(win)) return

  normalBoundsByWindow.set(win, win.getBounds())
  const display = screen.getDisplayMatching(win.getBounds())
  win.setBounds(display.workArea)
  maximizedByWindow.set(win, true)
  sendWindowState(win)
}

function restoreWindow(win: BrowserWindow): void {
  if (!isWindowMaximized(win)) return

  const normalBounds = normalBoundsByWindow.get(win)
  maximizedByWindow.set(win, false)
  if (win.isMaximized()) {
    win.unmaximize()
  }
  if (normalBounds) {
    win.setBounds(normalBounds)
  }
  sendWindowState(win)
}

function toggleMaximizeWindow(win: BrowserWindow): void {
  if (isWindowMaximized(win)) {
    restoreWindow(win)
  } else {
    maximizeWindow(win)
  }
}

export function bindWindowStateEvents(win: BrowserWindow): void {
  const emit = (): void => {
    if (!isWindowMaximized(win)) {
      normalBoundsByWindow.set(win, win.getBounds())
    }
    sendWindowState(win)
  }

  win.on('maximize', emit)
  win.on('unmaximize', emit)
  win.on('resize', emit)
  win.on('enter-full-screen', emit)
  win.on('leave-full-screen', emit)
}

export function registerWindowIpc(): void {
  registerIpcHandler(WINDOW_MINIMIZE, parseVoid, (_input, event) => {
    getEventWindow(event).minimize()
  })

  registerIpcHandler(WINDOW_TOGGLE_MAXIMIZE, parseVoid, (_input, event) => {
    toggleMaximizeWindow(getEventWindow(event))
  })

  registerIpcHandler(WINDOW_CLOSE, parseVoid, (_input, event) => {
    getEventWindow(event).close()
  })

  registerIpcHandler(WINDOW_IS_MAXIMIZED, parseVoid, (_input, event): boolean => {
    return isWindowMaximized(getEventWindow(event))
  })

  registerIpcHandler(WINDOW_TOGGLE_DEVTOOLS, parseVoid, (_input, event) => {
    const win = getEventWindow(event)
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools()
    } else {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  })
}
