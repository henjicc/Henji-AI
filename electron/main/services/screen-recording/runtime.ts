import { globalShortcut, type WebContents } from 'electron'
import type { RecordingControlSnapshot } from '../../../../src/core/screenRecording/contracts'
import { RecordingControlService, type RecordingControlBackend } from './control'
import { createMainLogger } from '../logging'
import { mediaPermissions } from '../media-permissions'
import { createRecordingControlWindow } from '../../windows/recording-control'
import { isTrustedMainRendererUrl } from '../../security/main-renderer-url'

const logger = createMainLogger('main.screen_recording')
let owner: WebContents | null = null
let controlWindow: ReturnType<typeof createRecordingControlWindow> | null = null
let closing: Promise<void> | null = null
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
export function openRecordingControl(ownerContents: WebContents, sessionId: string, backend: RecordingControlBackend): RecordingControlSnapshot {
  if (!isTrustedMainRendererUrl(ownerContents.getURL())) throw new Error('录制宿主来源不可信')
  if (owner) throw new Error('已有录制会话，请先关闭当前录制')
  owner = ownerContents
  let snapshot: RecordingControlSnapshot
  try { snapshot = recordingControl.create(sessionId, backend) } catch (error) { owner = null; throw error }
  try {
    controlWindow = createRecordingControlWindow(ownerContents, () => recordingControl.snapshot(), async () => {
      await recordingControl.command('stop')
      await closeRecordingControl()
    })
    const opened = controlWindow
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

export function closeRecordingControl(): Promise<void> {
  if (closing) return closing
  closing = Promise.resolve().then(async () => {
    const previousOwner = owner
    const previousSession = recordingControl.snapshot()?.sessionId
    if (previousOwner && previousSession) mediaPermissions.revoke(previousOwner, previousSession)
    try { await recordingControl.dispose() } finally {
      if (controlWindow && !controlWindow.isDestroyed()) controlWindow.destroy()
      controlWindow = null; owner = null
    }
  }).finally(() => { closing = null })
  return closing
}
