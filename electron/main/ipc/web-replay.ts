import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { WEB_REPLAY_CHANNELS } from '../../../src/platform/contracts/webReplay'
import { recordingEncodingFields } from '../../../src/core/screenRecording/encoding'
import { registerIpcHandler, parseVoid } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { listWebRecordings, readWebRecording, removeWebRecording, restoreWebRecording, revealWebRecording, setWebReplayEnabled, onWebReplayStateChanged, renderWebRecording, startWebRecording, stopWebRecording, webReplayState } from '../services/web-replay/runtime'

const uuid = z.string().uuid()
const fps = z.union([z.literal(30), z.literal(60)])
const backupSchema = z.union([
  z.object({ ...recordingEncodingFields, fps, target: z.literal('window') }).strict(),
  z.object({ ...recordingEncodingFields, fps, target: z.literal('screen'), sourceId: z.string().regex(/^screen:\d+:\d+$/), width: z.number().int().min(2).max(3840).multipleOf(2), height: z.number().int().min(2).max(2160).multipleOf(2) }).strict(),
]).nullable()
const renderSchema = z.object({ recordingId: uuid, output: z.string().min(1).optional(), fps: z.number().int().min(1).max(120).optional() }).strict()

export function registerWebReplayIpc(): void {
  registerIpcHandler(WEB_REPLAY_CHANNELS.setEnabled, raw => z.object({ enabled: z.boolean() }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); return setWebReplayEnabled(input.enabled) })
  registerIpcHandler(WEB_REPLAY_CHANNELS.apps, parseVoid, async (_input, event) => { assertTrustedApplicationSender(event); return webReplayState() })
  registerIpcHandler(WEB_REPLAY_CHANNELS.start, raw => z.object({ connectionId: uuid, backup: backupSchema }).strict().parse(raw), async (input, event) => { assertTrustedApplicationSender(event); return startWebRecording(input.connectionId, input.backup) })
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
  onWebReplayStateChanged(state => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed() && !window.webContents.isOffscreen()) window.webContents.send(WEB_REPLAY_CHANNELS.appsChanged, state)
  })
}
