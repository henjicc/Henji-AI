import { BrowserWindow, globalShortcut, type WebContents } from 'electron'
import { notifyRecording } from '../recording-notice'
import type { RecordingControlSnapshot } from '../../../../src/core/screenRecording/contracts'
import { RecordingControlService, type RecordingControlBackend } from './control'
import { createMainLogger } from '../logging'
import { mediaPermissions } from '../media-permissions'
import { createRecordingControlWindow } from '../../windows/recording-control'
import { createRecordingFrameWindow } from '../../windows/recording-frame'
import type { CaptureRect } from '../../../../src/core/captureLog/coordinates'
import { isTrustedMainRendererUrl } from '../../security/main-renderer-url'
import { RecordingEventSession, type RecordingEventOptions } from './events'
import type { CapabilityCapture } from '../../../../src/core/captureLog/events'
import type { RecordingSensitiveDom } from '../../../../src/core/screenRecording/contracts'
import { bindCaptureCapabilitySink } from '../../../../src/core/captureLog/capability'
import type { RecordingTrackStatus } from '../../../../src/core/screenRecording/contracts'
import { holdRecordingWakeLock } from '../recording-power'

const logger = createMainLogger('main.screen_recording')
let releaseWakeLock: (() => void) | null = null
let owner: WebContents | null = null
let controlWindow: ReturnType<typeof createRecordingControlWindow> | null = null
let frameWindow: BrowserWindow | null = null
let restoreOwnerWindow: (() => void) | null = null
let closing: Promise<void> | null = null
let eventSession: RecordingEventSession | null = null
let detachCapabilitySink: (() => void) | undefined
/** 当前会话处理宿主界面重载或崩溃的方式；没有时整次录制随宿主关闭。 */
let ownerLostHandler: (() => void) | null = null
const watched = new WeakSet<WebContents>()

/** 录制时主窗口通常最小化着，界面里的提示看不到：与录音共用系统通知。 */
export function notifyRecordingProblem(contents: WebContents | null, body: string): void { notifyRecording(contents, '痕迹AI 录屏', body) }
export function recordingEventBacklog(): number { return eventSession?.peakBacklog ?? 0 }

function broadcast(snapshot: RecordingControlSnapshot | null): void {
  for (const contents of [owner, controlWindow?.webContents, frameWindow?.webContents]) {
    if (contents && !contents.isDestroyed()) contents.send('screenRecording:changed', snapshot)
  }
}

export const recordingControl = new RecordingControlService({
  now: () => Number(process.hrtime.bigint() / 1_000_000n),
  register: (key, callback) => globalShortcut.register(key, callback),
  unregister: key => globalShortcut.unregister(key),
  changed: broadcast,
  released: () => {
    // 停止、失败、取消都会走到这里：录制资源已放开，系统可以睡眠了。
    releaseWakeLock?.(); releaseWakeLock = null
    const snapshot = recordingControl.snapshot()
    if (owner && snapshot) mediaPermissions.revoke(owner, snapshot.sessionId)
  },
  log: (event, error) => error ? logger.error('录制控制操作失败', { event, error }) : logger.info('录制控制状态更新', { event }),
})

export function isRecordingControlSender(contents: WebContents): boolean {
  return contents === owner || contents === controlWindow?.webContents
}
/** The range frame only reads the snapshot; it can never control the session. */
export function isRecordingFrameSender(contents: WebContents): boolean {
  return Boolean(frameWindow) && contents === frameWindow?.webContents
}

/** 正式采集协调器准备完资源后调用；UI/Pi/MCP 不各建状态机。1.5 负责公开会话实体。 */
export function openRecordingControl(ownerContents: WebContents, sessionId: string, backend: RecordingControlBackend, events?: RecordingEventOptions, settled?: () => Promise<void>, frameBounds?: () => CaptureRect | undefined, ownerLost?: () => void): RecordingControlSnapshot {
  if (!isTrustedMainRendererUrl(ownerContents.getURL())) throw new Error('录制宿主来源不可信')
  if (owner) throw new Error('已有录制会话，请先关闭当前录制')
  owner = ownerContents
  ownerLostHandler = ownerLost ?? null
  const excludedWindowIds = [...events?.excludedWindowIds ?? []]
  eventSession = events ? new RecordingEventSession({ ...events, excludedWindowIds,
    excludedRegions: () => [...events.excludedRegions?.() ?? [], ...(controlWindow && !controlWindow.isDestroyed() ? [controlWindow.getBounds()] : [])], onFailure: error => {
    // 先让协调器记下这是采集失败，收尾时才不会当成用户取消。
    events.onFailure(error)
    void recordingControl.captureFailed(sessionId, error).catch(cleanup => logger.error('采集失败后清理失败', { event: 'recording.events.cancel.failed', error: cleanup }))
  } }) : null
  let snapshot: RecordingControlSnapshot
  const wrapped = eventSession ? eventSession.wrap(backend) : backend
  const coordinated = settled ? { ...wrapped,
    stop: async (signal: AbortSignal) => { await wrapped.stop(signal); await settled() },
    cancel: async () => { try { await wrapped.cancel() } finally { await settled() } },
  } : wrapped
  try { snapshot = recordingControl.create(sessionId, coordinated) } catch (error) { owner = null; eventSession = null; throw error }
  releaseWakeLock ??= holdRecordingWakeLock('录屏')
  const capture = eventSession
  if (capture) detachCapabilitySink = bindCaptureCapabilitySink(fact => capture.capability(fact))
  try {
    controlWindow = createRecordingControlWindow(ownerContents, () => recordingControl.snapshot(), async () => {
      await recordingControl.command('stop')
      await closeRecordingControl()
    })
    const opened = controlWindow
    if (process.platform === 'win32') {
      const handle = opened.getNativeWindowHandle()
      excludedWindowIds.push(String(handle.length >= 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()))
    }
    opened.once('closed', () => {
      if (controlWindow !== opened || !owner) return
      void closeRecordingControl().catch(error => logger.error('控制条关闭后清理失败', { event: 'recording.control.closed_cleanup.failed', error }))
    })
  } catch (error) { void closeRecordingControl().catch(failure => logger.error('录制控制清理失败', { event: 'recording.control.cleanup.failed', error: failure })); throw error }
  if (frameBounds) {
    // A missing frame is only a lost visual cue; recording continues without it.
    try { frameWindow = createRecordingFrameWindow(frameBounds, () => recordingControl.snapshot()?.phase) } catch (error) { logger.warn('录制范围提示创建失败', { event: 'recording.frame.create.failed', error }) }
  }
  if (!watched.has(ownerContents)) {
    watched.add(ownerContents)
    const lost = (): void => {
      if (owner !== ownerContents) return
      // 录制状态与数据在主进程：界面重载或崩溃只断开它写的声音轨，界面回来后重新接上。
      if (ownerLostHandler) { ownerLostHandler(); return }
      void closeRecordingControl().catch(error => logger.error('采集宿主关闭后清理失败', { event: 'recording.control.owner_lost.failed', error }))
    }
    // 同一文档内的地址变化（replaceState、锚点）不换页面，录制轨道仍在原页面里。
    ownerContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) lost() })
    ownerContents.on('render-process-gone', lost)
    ownerContents.once('destroyed', lost)
  }
  return snapshot
}

/**
 * 录别的内容时把主窗口让开：最小化，会话结束时还原。只有主窗口挡在被录范围里才让开；
 * 窗口在另一块屏上就留着，用户能一边录一边看实时画面。被录范围查不到时照旧让开。
 */
export function minimizeOwnerWhileRecording(window: BrowserWindow | null, captured?: CaptureRect): void {
  if (!window || window.isDestroyed() || window.isMinimized()) return
  if (captured) {
    const own = window.getBounds()
    const overlaps = own.x < captured.x + captured.width && captured.x < own.x + own.width && own.y < captured.y + captured.height && captured.y < own.y + own.height
    if (!overlaps) return
  }
  window.minimize()
  restoreOwnerWindow = () => { if (!window.isDestroyed()) { window.restore(); window.focus() } }
}

/** Existing request channel, owner-bound, no raw input or output payload accepted. */
export function recordRecordingCapability(contents: WebContents, sessionId: string, fact: CapabilityCapture): void {
  if (owner !== contents || recordingControl.snapshot()?.sessionId !== sessionId) return
  eventSession?.capability(fact)
}
export function recordRecordingSensitiveDom(contents: WebContents, sessionId: string, regions: RecordingSensitiveDom): void {
  if (owner !== contents || recordingControl.snapshot()?.sessionId !== sessionId) return
  const window = BrowserWindow.fromWebContents(contents)
  if (!window || window.isDestroyed() || !window.isVisible()) return
  const bounds = window.getContentBounds(), zoom = contents.getZoomFactor()
  eventSession?.sensitive(regions.flatMap(rect => {
    const x = rect.x * zoom, y = rect.y * zoom, width = Math.min(bounds.width - x, rect.width * zoom), height = Math.min(bounds.height - y, rect.height * zoom)
    return width > 0 && height > 0 ? [{ id: rect.id, bounds: { x: bounds.x + x, y: bounds.y + y, width, height } }] : []
  }))
}

export function updateRecordingTracks(contents: WebContents, sessionId: string, status: RecordingTrackStatus): void {
  if (owner !== contents || recordingControl.snapshot()?.sessionId !== sessionId) throw new Error('录制轨道不属于当前宿主')
  recordingControl.setTrackStatus(sessionId, status)
}

export function closeRecordingControl(): Promise<void> {
  if (closing) return closing
  closing = Promise.resolve().then(async () => {
    const previousOwner = owner
    const previousSession = recordingControl.snapshot()?.sessionId
    if (previousOwner && previousSession) mediaPermissions.revoke(previousOwner, previousSession)
    try { await recordingControl.dispose() } finally {
      detachCapabilitySink?.(); detachCapabilitySink = undefined
      if (controlWindow && !controlWindow.isDestroyed()) controlWindow.destroy()
      if (frameWindow && !frameWindow.isDestroyed()) frameWindow.destroy()
      controlWindow = null; frameWindow = null; owner = null; eventSession = null; ownerLostHandler = null
      restoreOwnerWindow?.(); restoreOwnerWindow = null
    }
  }).finally(() => { closing = null })
  return closing
}
