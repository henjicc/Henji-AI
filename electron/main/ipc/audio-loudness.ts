import { app, type WebContents } from 'electron'
import { z } from 'zod'
import { registerIpcHandler } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { AudioLoudnessSession } from '../services/audio/loudness'
import { createMainLogger } from '../services/logging'
import { videoEditLoudnessSettingsSchema } from '../../../src/core/videoEdit/loudness'

const id = z.string().min(1).max(128)
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), sessionId: id, sampleRate: z.union([z.literal(44100), z.literal(48000)]), channels: z.union([z.literal(1), z.literal(2)]) }).strict(),
  z.object({ action: z.literal('append'), sessionId: id, channels: z.array(z.custom<Float32Array>(value => value instanceof Float32Array && value.length <= 96000)).min(1).max(2) }).strict(),
  z.object({ action: z.literal('measure'), sessionId: id }).strict(),
  z.object({ action: z.literal('activity'), sessionId: id, sensitivity: z.number().finite().min(0).max(100) }).strict(),
  z.object({ action: z.literal('normalize'), sessionId: id, settings: videoEditLoudnessSettingsSchema }).strict(),
  z.object({ action: z.literal('read'), sessionId: id, startFrame: z.number().int().nonnegative(), frames: z.number().int().min(1).max(96000) }).strict(),
  z.object({ action: z.literal('close'), sessionId: id }).strict(),
])
const sessions = new Map<number, Map<string, AudioLoudnessSession>>()
const watched = new WeakSet<WebContents>()
const logger = createMainLogger('main.audio.loudness')
function release(sender: number): void {
  const owned = sessions.get(sender); sessions.delete(sender)
  for (const session of owned?.values() ?? []) void session.close().catch(error => logger.warn('声音测量清理失败', { event: 'audio.loudness.cleanup_failed', error }))
}
export function registerAudioLoudnessHandlers(): void {
  registerIpcHandler('audio:loudness', raw => input.parse(raw), async (request, event) => {
    const sender = event.sender
    if (!watched.has(sender)) {
      watched.add(sender); sender.once('destroyed', () => release(sender.id))
      sender.on('did-start-navigation', (_event, _url, _inPlace, main) => { if (main) release(sender.id) })
    }
    let owned = sessions.get(sender.id)
    if (request.action === 'start') {
      if (!owned) { owned = new Map(); sessions.set(sender.id, owned) }
      if (owned.has(request.sessionId) || owned.size >= 4) throw new Error('声音测量正在进行，请等待或取消。')
      const session = new AudioLoudnessSession(request.sampleRate, request.channels)
      owned.set(request.sessionId, session)
      try { await session.initialize() } catch (error) { owned.delete(request.sessionId); await session.close(); throw error }
      return
    }
    const session = owned?.get(request.sessionId)
    if (request.action === 'close') { owned?.delete(request.sessionId); await session?.close(); return }
    if (!session) throw new Error('声音测量会话已关闭，请重新测量。')
    if (request.action === 'append') return session.append(request.channels)
    if (request.action === 'read') return session.read(request.startFrame, request.frames)
    logger.info('开始处理声音响度', { event: `audio.loudness.${request.action}.start`, context: { sessionId: request.sessionId } })
    try {
      const result = await (request.action === 'measure' ? session.measure() : request.action === 'activity' ? session.detectActivity(request.sensitivity) : session.normalize(request.settings))
      logger.info('声音响度处理完成', { event: `audio.loudness.${request.action}.completed`, context: { sessionId: request.sessionId, ...(Array.isArray(result) ? { intervals: result.length } : result) } }); return result
    } catch (error) { logger.error('声音响度处理失败', { event: `audio.loudness.${request.action}.failed`, error, context: { sessionId: request.sessionId } }); throw error }
  }, assertTrustedApplicationSender)
  app.once('before-quit', () => { for (const sender of sessions.keys()) release(sender) })
}
