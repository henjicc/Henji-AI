import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { WEB_REPLAY_CHANNELS } from '../../../src/platform/contracts/webReplay'
import { recordingEncodingFields } from '../../../src/core/screenRecording/encoding'
import { registerIpcHandler, parseVoid } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { webRecordingEditSource } from '../services/web-replay/editSource'
import { backupAudioDirectory, exportWebRecordingVideos, importWebRecordingToProject, mixWebRecordingAudio, renameWebRecordings, listWebRecordings, readWebRecording, removeWebRecording, restoreWebRecording, revealWebRecording, setWebReplayEnabled, onWebReplayStateChanged, renderWebRecording, startWebRecording, stopWebRecording, webReplayState } from '../services/web-replay/runtime'

const uuid = z.string().uuid()
const fps = z.union([z.literal(30), z.literal(60)])
const backupSchema = z.union([
  z.object({ ...recordingEncodingFields, fps, target: z.literal('window') }).strict(),
  z.object({ ...recordingEncodingFields, fps, target: z.literal('screen'), sourceId: z.string().regex(/^screen:\d+:\d+$/), width: z.number().int().min(2).max(3840).multipleOf(2), height: z.number().int().min(2).max(2160).multipleOf(2) }).strict(),
]).nullable()
const destinationSchema = z.object({ projectId: z.string().min(1).max(200), name: z.string().trim().min(1).max(120).optional() }).strict()
const renderSchema = z.object({ recordingId: uuid, output: z.string().min(1).optional(), fps: z.number().int().min(1).max(120).optional() }).strict()

export function registerWebReplayIpc(): void {
  registerIpcHandler(WEB_REPLAY_CHANNELS.setEnabled, raw => z.object({ enabled: z.boolean() }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); return setWebReplayEnabled(input.enabled) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.apps, parseVoid, async (_input, event) => { assertTrustedApplicationSender(event); return webReplayState() })
  registerIpcHandler(WEB_REPLAY_CHANNELS.start, raw => z.object({ connectionId: uuid, backup: backupSchema, destination: destinationSchema.optional() }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); return startWebRecording(input.connectionId, input.backup, input.destination ?? null) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.stop, raw => z.object({ recordingId: uuid }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); return stopWebRecording(input.recordingId) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.recordings, parseVoid, async (_input, event) => { assertTrustedApplicationSender(event); return listWebRecordings() })
  registerIpcHandler(WEB_REPLAY_CHANNELS.render, raw => renderSchema.parse(raw), async (input, event) => {
    assertTrustedApplicationSender(event)
    const sender = event.sender
    return renderWebRecording(input, undefined, progress => { if (!sender.isDestroyed()) sender.send(WEB_REPLAY_CHANNELS.renderProgress, progress) })
  })
  registerIpcHandler(WEB_REPLAY_CHANNELS.remove, raw => z.object({ recordingId: uuid }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); await removeWebRecording(input.recordingId) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.restore, raw => z.object({ recordingId: uuid }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); await restoreWebRecording(input.recordingId) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.read, raw => z.object({ recordingId: uuid, track: z.enum(['data', 'behavior']), offset: z.number().int().nonnegative(), limit: z.number().int().min(1).max(500) }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); return readWebRecording(input) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.reveal, raw => z.object({ recordingId: uuid, file: z.string().min(1).optional() }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); await revealWebRecording(input.recordingId, input.file) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.rename, raw => z.object({ items: z.array(z.object({ recordingId: uuid, title: z.string().trim().min(1).max(120).nullable() }).strict()).min(1).max(500) }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); await renameWebRecordings(input.items) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.exportVideos, raw => z.object({ recordingIds: z.array(uuid).min(1).max(500), directory: z.string().min(1) }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); return exportWebRecordingVideos(input.recordingIds, input.directory) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.backupAudioDirectory, raw => z.object({ recordingId: uuid }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); return backupAudioDirectory(input.recordingId) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.mixBackupAudio, raw => z.object({ recordingId: uuid }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); return mixWebRecordingAudio(input.recordingId) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.importToProject, raw => z.object({ projectId: z.string().min(1).max(200), recordingId: uuid.optional(), source: z.string().min(1).max(32768).optional(), name: z.string().trim().min(1).max(120).optional() }).strict().refine(value => Boolean(value.recordingId) !== Boolean(value.source), '给录制编号或录制文件夹二者之一').parse(raw), async (input, event) => { assertTrustedApplicationSender(event); return importWebRecordingToProject(input) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.editSource, raw => z.object({ recordingId: uuid, prefer: z.enum(['replay', 'backup', 'auto']).optional() }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); return webRecordingEditSource(input.recordingId, input.prefer) })
  onWebReplayStateChanged(state => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isOffscreen()) window.webContents.send(WEB_REPLAY_CHANNELS.appsChanged, state)
  })
}
