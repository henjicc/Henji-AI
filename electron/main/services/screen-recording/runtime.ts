import { BrowserWindow, globalShortcut, type WebContents } from 'electron'
import type { RecordingControlSnapshot } from '../../../../src/core/screenRecording/contracts'
import { RecordingControlService, type RecordingControlBackend } from './control'
import { createMainLogger } from '../logging'
import { mediaPermissions } from '../media-permissions'
import { createRecordingControlWindow } from '../../windows/recording-control'
import { isTrustedMainRendererUrl } from '../../security/main-renderer-url'
import { RecordingEventSession, type RecordingEventOptions } from './events'
import type { CapabilityCapture } from '../../../../src/core/captureLog/events'
import type { RecordingSensitiveDom } from '../../../../src/core/screenRecording/contracts'
import { bindCaptureCapabilitySink } from '../../../../src/core/captureLog/capability'
import type { RecordingTrackStatus } from '../../../../src/core/screenRecording/contracts'

const logger = createMainLogger('main.screen_recording')
let owner: WebContents | null = null
let controlWindow: ReturnType<typeof createRecordingControlWindow> | null = null
let closing: Promise<void> | null = null
let eventSession: RecordingEventSession | null = null
let detachCapabilitySink: (() => void) | undefined
const watched = new WeakSet<WebContents>()

function broadcast(snapshot: RecordingControlSnapshot | null): void {
  for (const contents of [owner, controlWindow?.webContents]) {
    if (contents && !contents.isDestroyed()) contents.send('screenRecording:changed', snapshot)
  }
}

export const recordingControl = new RecordingControlService({
  now: () => Number(process.hrtime.bigint() / 1_000_000n),
  register: (key, callback) => globalShortcut.register(key, callback),
  unregister: key => globalShortcut.unregister(key),
  changed: broadcast,
  released: () => {
    const snapshot = recordingControl.snapshot()
    if (owner && snapshot) mediaPermissions.revoke(owner, snapshot.sessionId)
  },
  log: (event, error) => error ? logger.error('录制控制操作失败', { event, error }) : logger.info('录制控制状态更新', { event }),
})

export function isRecordingControlSender(contents: WebContents): boolean {
  return contents === owner || contents === controlWindow?.webContents
}

/** 正式采集协调器准备完资源后调用；UI/Pi/MCP 不各建状态机。1.5 负责公开会话实体。 */
export function openRecordingControl(ownerContents: WebContents, sessionId: string, backend: RecordingControlBackend, events?: RecordingEventOptions, settled?: () => Promise<void>): RecordingControlSnapshot {
  if (!isTrustedMainRendererUrl(ownerContents.getURL())) throw new Error('录制宿主来源不可信')
  if (owner) throw new Error('已有录制会话，请先关闭当前录制')
  owner = ownerContents
  const excludedWindowIds = [...events?.excludedWindowIds ?? []]
  eventSession = events ? new RecordingEventSession({ ...events, excludedWindowIds,
    excludedRegions: () => [...events.excludedRegions?.() ?? [], ...(controlWindow && !controlWindow.isDestroyed() ? [controlWindow.getBounds()] : [])], onFailure: error => {
    void recordingControl.captureFailed(sessionId, error).catch(cleanup => logger.error('采集失败后清理失败', { event: 'recording.events.cancel.failed', error: cleanup }))
    events.onFailure(error)
  } }) : null
  let snapshot: RecordingControlSnapshot
  const wrapped = eventSession ? eventSession.wrap(backend) : backend
  const coordinated = settled ? { ...wrapped,
    stop: async (signal: AbortSignal) => { await wrapped.stop(signal); await settled() },
    cancel: async () => { try { await wrapped.cancel() } finally { await settled() } },
  } : wrapped
  try { snapshot = recordingControl.create(sessionId, coordinated) } catch (error) { owner = null; eventSession = null; throw error }
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
  if (!watched.has(ownerContents)) {
    watched.add(ownerContents)
    const lost = (): void => {
      if (owner !== ownerContents) return
      void closeRecordingControl().catch(error => logger.error('采集宿主关闭后清理失败', { event: 'recording.control.owner_lost.failed', error }))
    }
    ownerContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) lost() })
    ownerContents.on('render-process-gone', lost)
    ownerContents.once('destroyed', lost)
  }
  return snapshot
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
      controlWindow = null; owner = null; eventSession = null
    }
  }).finally(() => { closing = null })
  return closing
}
