import { BrowserWindow, screen } from 'electron'
import { release } from 'node:os'
import path from 'node:path'
import type { CaptureRect } from '../../../src/core/captureLog/coordinates'
import { installRendererNavigationGuards } from '../security/main-renderer-url'
import { createMainLogger } from '../services/logging'
import { mediaPermissions } from '../services/media-permissions'
import { resolveSecondaryWindowLaunchQuery } from '../development-launch'

const FOLLOW_INTERVAL_MS = 250
/** Sources smaller than this are minimized or collapsed; hide the frame instead of drawing a dot. */
const MIN_VISIBLE_SIZE = 48

/**
 * Only systems that drop protected windows from every capture path may show the frame.
 * Older Windows paints protected windows black, which would cover the whole recording.
 */
export function recordingFrameSupported(platform: NodeJS.Platform = process.platform, systemRelease: string = release()): boolean {
  if (platform === 'darwin') return true
  return platform === 'win32' && Number(systemRelease.split('.')[2]) >= 19041
}

/** Click-through highlight around the recorded area; follows window sources as they move. */
export function createRecordingFrameWindow(bounds: () => CaptureRect | undefined): BrowserWindow | null {
  if (!recordingFrameSupported()) return null
  const initial = bounds()
  if (!initial) return null
  const logger = createMainLogger('main.recording_frame_window')
  const win = new BrowserWindow({
    ...rounded(initial), frame: false, transparent: true, hasShadow: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true,
    show: false, alwaysOnTop: true, title: '录制范围',
    webPreferences: { preload: path.join(__dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false },
  })
  win.setContentProtection(true)
  const unprotectSource = mediaPermissions.protectSource(win.getMediaSourceId())
  win.once('closed', unprotectSource)
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'screen-saver')
  installRendererNavigationGuards(win.webContents, 'recording-frame')
  let last = rounded(initial)
  // Windows can drop the capture exclusion of this transparent window once it is shown or moved (seen on a
  // secondary display), and then the frame is recorded into the video. Re-assert it after every show and move;
  // a frame that still cannot be excluded is hidden rather than recorded.
  const show = (): void => {
    win.setContentProtection(true)
    if (!win.isContentProtected()) { if (win.isVisible()) win.hide(); return }
    if (!win.isVisible()) { win.showInactive(); win.setContentProtection(true); if (!win.isContentProtected()) win.hide() }
  }
  const follow = setInterval(() => {
    if (win.isDestroyed()) return
    const next = bounds()
    if (!next || next.width < MIN_VISIBLE_SIZE || next.height < MIN_VISIBLE_SIZE) { if (win.isVisible()) win.hide(); return }
    const target = rounded(next)
    if (target.x !== last.x || target.y !== last.y || target.width !== last.width || target.height !== last.height) { win.setBounds(target); last = target }
    if (!win.isVisible() || !win.isContentProtected()) show()
  }, FOLLOW_INTERVAL_MS)
  follow.unref?.()
  win.once('closed', () => clearInterval(follow))
  win.once('ready-to-show', () => { if (!win.isDestroyed()) show() })
  const query = { ...resolveSecondaryWindowLaunchQuery(), view: 'recording-frame' }
  const developmentUrl = process.env.ELECTRON_RENDERER_URL ? new URL(process.env.ELECTRON_RENDERER_URL) : null
  if (developmentUrl) for (const [key, value] of Object.entries(query)) developmentUrl.searchParams.set(key, value)
  const loaded = developmentUrl ? win.loadURL(developmentUrl.toString()) : win.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
  // The frame is a visual cue only; failing to draw it must never stop the recording.
  void loaded.catch(error => { logger.warn('录制范围提示加载失败', { event: 'recording.frame.load.failed', error }); if (!win.isDestroyed()) win.destroy() })
  return win
}

function rounded(rect: CaptureRect): Electron.Rectangle {
  const display = screen.getDisplayMatching({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) })
  const area = display.bounds
  // Keep the frame on the captured display: full-screen captures draw just inside the screen edge.
  const x = Math.max(area.x, Math.floor(rect.x)), y = Math.max(area.y, Math.floor(rect.y))
  const right = Math.min(area.x + area.width, Math.ceil(rect.x + rect.width)), bottom = Math.min(area.y + area.height, Math.ceil(rect.y + rect.height))
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}
