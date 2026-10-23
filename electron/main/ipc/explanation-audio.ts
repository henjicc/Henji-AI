import { app, session } from 'electron'
import { mediaPermissions } from '../services/media-permissions'
import { recordingAudioRequestSchema } from '../../../src/core/audioEdit/recordingAudio'
import { registerIpcHandler } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { explanationAudioService } from '../services/audio-edit/explanation-audio'
import { createMainLogger } from '../services/logging'

export function registerExplanationAudioHandlers(): void {
  const watched = new Set<number>(); const owned = new Map<number, Set<string>>()
  // 摄像头与系统声仍共用全局媒体权限处理器，讲解麦克风权限由原生录音入口申请。
  mediaPermissions.install(session.defaultSession)
  const logger = createMainLogger('main.audio_edit.explanation')
  const cleanup = (): void => { void explanationAudioService.cleanupExpired().catch(() => logger.warn('临时讲解录音清理失败', { event: 'explanation.audio.cleanup.failed' })) }
  const cleanupTimer = setInterval(cleanup, 60 * 60 * 1000); cleanupTimer.unref()
  cleanup(); app.on('before-quit', () => { clearInterval(cleanupTimer); cleanup() })
  registerIpcHandler('audioEdit:explanation', raw => recordingAudioRequestSchema.parse(raw), async (request, event) => {
    const senderId = event.sender.id
    if (!watched.has(senderId)) {
      watched.add(senderId)
      const revoke = (): void => { for (const id of owned.get(senderId) ?? []) explanationAudioService.cancel(id); owned.delete(senderId) }
      event.sender.on('did-start-navigation', revoke)
      event.sender.once('destroyed', () => { revoke(); watched.delete(senderId); event.sender.removeListener('did-start-navigation', revoke) })
    }
    if ('sessionId' in request) { const ids = owned.get(senderId) ?? new Set<string>(); ids.add(request.sessionId); owned.set(senderId, ids) }
    switch (request.action) {
      case 'write': return explanationAudioService.write(request)
      case 'read': return explanationAudioService.read(request.sessionId, request.chunkId)
      case 'erase': return explanationAudioService.erase(request.sessionId)
      case 'release': return explanationAudioService.release(request.sessionId)
      case 'archive': return explanationAudioService.archive(request.sessionId)
      case 'restore': return explanationAudioService.restore(request)
      case 'cancel': return explanationAudioService.cancel(request.sessionId)
      case 'transcribe': return explanationAudioService.transcribe(request)
      case 'preflight': return explanationAudioService.preflight(request)
    }
  }, assertTrustedApplicationSender)
}
