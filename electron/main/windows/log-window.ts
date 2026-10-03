import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { bindWindowStateEvents } from '../ipc/window'
import { windowAppearance } from '../services/window-appearance'
import { resolveAppIconPath } from '../app-icon'
import { resolveInitialWindowPosition } from '../window-presentation'
import { resolveSecondaryWindowLaunchQuery } from '../development-launch'

let logWindowInstance: BrowserWindow | null = null

/**
 * 打开独立日志窗口，单例管理：已存在且未销毁时聚焦并置前，不重复创建。
 * 渲染层通过 `?view=logs` 查询参数区分加载"日志壳"（`src/features/logs/LogsShell.tsx`）
 * 而非主界面（同一份渲染产物，入口分流见 `src/main.tsx`）。
 */
export function openLogWindow(): void {
  const existing = logWindowInstance
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) {
      existing.restore()
    }
    existing.focus()
    return
  }

  const iconPath = resolveAppIconPath()
  const initialSize = { width: 1040, height: 720 }
  const win = new BrowserWindow({
    ...initialSize,
    ...(process.platform === 'darwin'
      ? resolveInitialWindowPosition(initialSize, screen.getPrimaryDisplay().workArea)
      : {}),
    minWidth: 720,
    minHeight: 420,
    show: false,
    frame: false,
    backgroundColor: windowAppearance.getBackgroundColor(),
    title: '痕迹AI - 日志',
    ...(iconPath ? { icon: iconPath } : {}),
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
    if (!win.isDestroyed()) {
      win.show()
    }
  })

  if (!process.env['ELECTRON_RENDERER_URL']) {
    win.setMenuBarVisibility(false)
  }

  // 日志壳与主窗口共用 useApplyRuntimeTheme；开发主题预设也要随查询参数带过去，否则只有主窗口换预设。
  const query = { view: 'logs', ...resolveSecondaryWindowLaunchQuery() }
  if (!process.env['ELECTRON_RENDERER_URL']) {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
  } else {
    const rendererUrl = new URL(process.env['ELECTRON_RENDERER_URL'])
    Object.entries(query).forEach(([key, value]) => rendererUrl.searchParams.set(key, value))
    void win.loadURL(rendererUrl.toString())
  }

  win.on('closed', () => {
    if (logWindowInstance === win) {
      logWindowInstance = null
    }
  })

  logWindowInstance = win
}

/** 主窗口关闭时一并关闭日志窗口，避免主窗口关闭后应用仍因日志窗口存活而不退出。 */
export function closeLogWindow(): void {
  if (logWindowInstance && !logWindowInstance.isDestroyed()) {
    logWindowInstance.close()
  }
}
