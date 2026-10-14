import { BrowserWindow, screen, type WebContents } from 'electron'
import path from 'node:path'
import type { RecordingControlSnapshot } from '../../../src/core/screenRecording/contracts'
import { installRendererNavigationGuards } from '../security/main-renderer-url'
import { createMainLogger } from '../services/logging'
import { mediaPermissions } from '../services/media-permissions'
import { resolveSecondaryWindowLaunchQuery } from '../development-launch'

/** 专用视图，加载同一 renderer/preload；保护在首次显示前设置。 */
export function createRecordingControlWindow(owner: WebContents, snapshot: () => RecordingControlSnapshot | null, stop: () => Promise<void>): BrowserWindow {
  const parent = BrowserWindow.fromWebContents(owner)
  const display = screen.getDisplayMatching(parent?.getBounds() ?? screen.getPrimaryDisplay().workArea)
  // The window is exactly the pill drawn by RecordingControlBar; transparent corners keep it a floating capsule.
  const size = { width: 440, height: 44 }
  const win = new BrowserWindow({
    ...size, x: Math.round(display.workArea.x + (display.workArea.width - size.width) / 2), y: display.workArea.y + 16,
    frame: false, transparent: true, hasShadow: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    show: false, alwaysOnTop: true, skipTaskbar: true, title: '录制控制',
    webPreferences: { preload: path.join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false },
  })
  const logger = createMainLogger('main.recording_control_window')
  win.setContentProtection(true)
  const unprotectSource = mediaPermissions.protectSource(win.getMediaSourceId())
  win.once('closed', unprotectSource)
  win.setAlwaysOnTop(true, 'floating')
  installRendererNavigationGuards(win.webContents, 'recording-control')
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive() })
  win.on('close', event => {
    const state = snapshot()
    if (!state || state.phase === 'stopped') return
    event.preventDefault()
    void stop().catch(error => logger.error('关闭控制条时停止录制失败', { event: 'recording.control.window_stop.failed', error }))
  })
  win.webContents.on('render-process-gone', () => { void stop().catch(error => logger.error('控制条异常退出后停止失败', { event: 'recording.control.window_gone.failed', error })) })
  const query = { ...resolveSecondaryWindowLaunchQuery(), view: 'recording-control' }
  const developmentUrl = process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL) : null
  if (developmentUrl) for (const [key, value] of Object.entries(query)) developmentUrl.searchParams.set(key, value)
  const loaded = developmentUrl
    ? win.loadURL(developmentUrl.toString())
    : win.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
  void loaded.catch(error => {
    logger.error('录制控制条加载失败', { event: 'recording.control.window_load.failed', error })
    void stop().catch(failure => logger.error('控制条加载失败后停止失败', { event: 'recording.control.window_load_cleanup.failed', error: failure }))
  })
  return win
}
