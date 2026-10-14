import { BrowserWindow, screen, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { isUiScaleFactor, type UiScaleFactor } from '../../../src/core/theme/uiScale'
import { parseWindowAppearance, windowAppearance } from '../services/window-appearance'
import { parseRecord, parseVoid, registerIpcHandler } from './registry'
import { controlVideoEditPopout } from '../windows/video-edit-popout'
import { parseVideoEditPopoutControl } from '../windows/video-edit-popout-policy'
import { mediaRecycleLifecycle } from '../services/media-recycle/lifecycle'

const WINDOW_MINIMIZE = 'window:minimize'
const WINDOW_TOGGLE_MAXIMIZE = 'window:toggleMaximize'
const WINDOW_CLOSE = 'window:close'
const WINDOW_IS_MAXIMIZED = 'window:isMaximized'
const WINDOW_GET_CONTENT_SIZE = 'window:getContentSize'
const WINDOW_GET_DISPLAY_WORK_AREA = 'window:getDisplayWorkArea'
const WINDOW_SET_ZOOM_FACTOR = 'window:setZoomFactor'
const WINDOW_SET_APPEARANCE = 'window:setAppearance'
const WINDOW_TOGGLE_DEVTOOLS = 'window:toggleDevTools'
const WINDOW_STATE_CHANGED = 'window:stateChanged'
const WINDOW_CLOSE_REQUESTED = 'window:closeRequested'
const WINDOW_CONFIRM_CLOSE = 'window:confirmClose'
const WINDOW_CONTROL_POPOUT = 'window:controlPopout'

const approvedCloseWindows = new WeakSet<BrowserWindow>()
const requestedZoomFactors = new WeakMap<WebContents, UiScaleFactor>()

/** 不经渲染层保存屏障直接批准全部窗口关闭；只给已完成保存的流程用（如更换作品目录后重启）。 */
export function approveAllWindowsClose(): void {
  for (const win of BrowserWindow.getAllWindows()) approvedCloseWindows.add(win)
}

interface WindowStatePayload {
  isMaximized: boolean
}

export function parseZoomFactor(input: unknown): UiScaleFactor {
  const factor = parseRecord(input)['factor']
  if (!isUiScaleFactor(factor)) {
    throw new Error('Expected zoom factor to be one of 0.9, 1, 1.1, 1.25, or 1.5')
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

/** 无文档状态的辅助窗口只需要广播，不参加保存屏障与媒体回收。 */
export function bindWindowStateBroadcast(win: BrowserWindow): void {
  const emit = (): void => sendWindowState(win)
  win.on('maximize', emit)
  win.on('unmaximize', emit)
  win.on('resize', emit)
  // 拖到另一块显示器后，自动界面缩放需要按新显示器重新判断。
  win.on('moved', emit)
  win.on('enter-full-screen', emit)
  win.on('leave-full-screen', emit)
}

export function bindWindowStateEvents(win: BrowserWindow, deferSession = false): () => void {
  bindWindowStateBroadcast(win)
  let sessionOpened = false
  const openSession = (): void => {
    if (sessionOpened || win.isDestroyed()) return
    mediaRecycleLifecycle.opened(win.id)
    sessionOpened = true
  }
  if (!deferSession) openSession()
  win.once('closed', () => { if (sessionOpened) mediaRecycleLifecycle.closed(win.id) })
  win.on('close', (event) => {
    // The startup shell has no renderer or document state to save yet.
    if (!sessionOpened) return
    if (approvedCloseWindows.has(win)) {
      approvedCloseWindows.delete(win)
      mediaRecycleLifecycle.saved(win.id)
      return
    }
    event.preventDefault()
    if (!win.webContents.isDestroyed()) win.webContents.send(WINDOW_CLOSE_REQUESTED)
  })
  return openSession
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

  registerIpcHandler(WINDOW_GET_DISPLAY_WORK_AREA, parseVoid, (_input, event) => {
    const { width, height } = screen.getDisplayMatching(getEventWindow(event).getBounds()).workAreaSize
    return { width, height }
  })

  registerIpcHandler(WINDOW_SET_ZOOM_FACTOR, parseZoomFactor, (factor, event) => {
    const contents = getEventWindow(event).webContents
    if (!requestedZoomFactors.has(contents)) {
      // Chromium 按完整 file URL 记录缩放。replaceState 改 query 后原生读数可能回到
      // 默认值，而渲染帧仍用旧比例；同步当前窗口的比例，防止后续 resize 真正跳回默认值。
      const syncNavigationZoom = (_event: unknown, _url: string, isMainFrame: boolean): void => {
        const requestedFactor = requestedZoomFactors.get(contents)
        if (isMainFrame && requestedFactor !== undefined) contents.setZoomFactor(requestedFactor)
      }
      contents.on('did-navigate-in-page', syncNavigationZoom)
      contents.once('destroyed', () => {
        contents.removeListener('did-navigate-in-page', syncNavigationZoom)
        requestedZoomFactors.delete(contents)
      })
    }
    requestedZoomFactors.set(contents, factor)
    contents.setZoomFactor(factor)
  })

  // 渲染层应用主题后同步窗口底色与 color-scheme：更新已开窗口并持久化，供下次创建窗口使用
  registerIpcHandler(WINDOW_SET_APPEARANCE, parseWindowAppearance, async (appearance) => {
    await windowAppearance.update(appearance)
  })

  registerIpcHandler(WINDOW_TOGGLE_DEVTOOLS, parseVoid, (_input, event) => {
    const win = getEventWindow(event)
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools()
    } else {
      win.webContents.openDevTools({ mode: 'detach' })
    }
  })

  registerIpcHandler(WINDOW_CONFIRM_CLOSE, parseVoid, (_input, event) => {
    const win = getEventWindow(event)
    approvedCloseWindows.add(win)
    win.close()
  })

  // 剪辑独立面板窗口无 preload，标题栏拖动/最大化由打开它的主窗口代为请求；只能控制发送方自己的浮窗。
  registerIpcHandler(WINDOW_CONTROL_POPOUT, parseVideoEditPopoutControl, (request, event) => {
    controlVideoEditPopout(event.sender, request)
  })
}
