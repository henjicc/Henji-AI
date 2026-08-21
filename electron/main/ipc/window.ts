import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { isUiScaleFactor, type UiScaleFactor } from '../../../src/core/theme/uiScale'
import { parseRecord, parseVoid, registerIpcHandler } from './registry'

const WINDOW_MINIMIZE = 'window:minimize'
const WINDOW_TOGGLE_MAXIMIZE = 'window:toggleMaximize'
const WINDOW_CLOSE = 'window:close'
const WINDOW_IS_MAXIMIZED = 'window:isMaximized'
const WINDOW_GET_CONTENT_SIZE = 'window:getContentSize'
const WINDOW_SET_ZOOM_FACTOR = 'window:setZoomFactor'
const WINDOW_TOGGLE_DEVTOOLS = 'window:toggleDevTools'
const WINDOW_STATE_CHANGED = 'window:stateChanged'

interface WindowStatePayload {
  isMaximized: boolean
}

export function parseZoomFactor(input: unknown): UiScaleFactor {
  const factor = parseRecord(input)['factor']
  if (!isUiScaleFactor(factor)) {
    throw new Error('Expected zoom factor to be one of 0.9, 1, or 1.1')
  }
  return factor
}

function getEventWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) {
    throw new Error('Unable to resolve BrowserWindow for IPC sender')
  }
  return win
}

function sendWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return

  const payload: WindowStatePayload = {
    isMaximized: win.isMaximized(),
  }
  win.webContents.send(WINDOW_STATE_CHANGED, payload)
}

function toggleMaximizeWindow(win: BrowserWindow): void {
  if (win.isMaximized()) {
    win.unmaximize()
  } else {
    win.maximize()
  }
}

export function bindWindowStateEvents(win: BrowserWindow): void {
  const emit = (): void => {
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
    return getEventWindow(event).isMaximized()
  })

  registerIpcHandler(WINDOW_GET_CONTENT_SIZE, parseVoid, (_input, event) => {
    const [width, height] = getEventWindow(event).getContentSize()
    return { width, height }
  })

  registerIpcHandler(WINDOW_SET_ZOOM_FACTOR, parseZoomFactor, (factor, event) => {
    getEventWindow(event).webContents.setZoomFactor(factor)
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
