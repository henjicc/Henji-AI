import { createLogger } from '@/core/logging'
import type { CaptureKind } from '@/core/screenRecording/contracts'
import { getPlatform } from '@/platform'
import { orderedScreens, type WebAppBackupSetup } from '@/services/recordingSetupModel'
import { RecordingTracksSession } from '../tracks/session'

const logger = createLogger('features.screenRecording.web_app_backup_audio')
const active = new Map<string, { tracks: RecordingTracksSession; controller: AbortController }>()
let watching: (() => void) | null = null

/**
 * The backup screen recording's sound: the same microphone and system sound recorder as screen
 * recording, writing beside the web recording. Main lays it into backup.mp4 when the recording is saved.
 */
export async function startWebAppBackupAudio(recordingId: string, backup: WebAppBackupSetup): Promise<void> {
  const microphone = backup.microphone ?? true, systemAudio = backup.systemAudio ?? false
  if (!backup.enabled || (!microphone && !systemAudio)) return
  const platform = getPlatform()
  const screens = orderedScreens(await platform.screenRecording.sources())
  const screen = screens.find(item => item.display?.primary) ?? screens[0]
  if (!screen) throw new Error('没有找到可用的屏幕，无法录制备份录屏的声音')
  const kinds: CaptureKind[] = ['screen', ...(microphone ? ['microphone' as const] : []), ...(systemAudio ? ['systemAudio' as const] : [])]
  // System sound comes through the screen-capture permission; the picture itself is discarded.
  await platform.screenRecording.grant({ sessionId: recordingId, userReceipt: crypto.randomUUID(), kinds, selection: { sourceId: screen.id, excludedSourceIds: [] } })
  const directory = await platform.webReplay.backupAudioDirectory(recordingId)
  const controller = new AbortController()
  const tracks = new RecordingTracksSession({
    sessionId: recordingId, originUs: await platform.screenRecording.clock(), directory, tracks: { ...(microphone ? { microphone: {} } : {}), systemAudio },
    // No control bar shows this sound's level; the screen recorder's status channel belongs to its own session.
    status: async () => undefined,
    onFailure: error => logger.warn('备份录屏的声音录制中断', { event: 'web_replay.backup_audio.failed', context: { recordingId }, error: String(error) }),
  })
  await tracks.start(controller.signal)
  active.set(recordingId, { tracks, controller })
  watching ??= platform.webReplay.onAppsChanged(state => {
    // The recording may end without this page stopping it (the app closed, the assistant stopped it).
    for (const id of active.keys()) if (!state.apps.some(app => app.recordingId === id)) void finishWebAppBackupAudio(id).then(saved => saved && platform.webReplay.mixBackupAudio(id))
  })
  logger.info('备份录屏的声音开始录制', { event: 'web_replay.backup_audio.started', context: { recordingId, microphone, systemAudio } })
}

/** Saves the sound files; true when there was sound to save. Call before stopping the recording. */
export async function finishWebAppBackupAudio(recordingId: string): Promise<boolean> {
  const entry = active.get(recordingId)
  if (!entry) return false
  active.delete(recordingId)
  if (!active.size) { watching?.(); watching = null }
  try {
    await entry.tracks.stop(entry.controller.signal)
    return true
  } catch (error) {
    logger.warn('备份录屏的声音保存失败', { event: 'web_replay.backup_audio.save_failed', context: { recordingId }, error: String(error) })
    return false
  } finally {
    await getPlatform().screenRecording.revoke(recordingId).catch(() => undefined)
  }
}
