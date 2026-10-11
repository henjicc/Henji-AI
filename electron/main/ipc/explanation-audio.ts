import { app, session } from 'electron'
import { isTrustedMainRendererUrl } from '../security/main-renderer-url'
import { recordingAudioRequestSchema } from '../../../src/core/audioEdit/recordingAudio'
import { registerIpcHandler } from './registry'
import { assertTrustedApplicationSender } from './application-control'
import { explanationAudioService } from '../services/audio-edit/explanation-audio'
import { createMainLogger } from '../services/logging'

export function registerExplanationAudioHandlers(): void {
  const armed = new Set<number>()
  const watched = new Set<number>(); const owned = new Map<number, Set<string>>()
  // Preserve the application's existing copy/paste APIs; recording grants no other capability.
  const clipboardPermission = (permission: string): boolean => ['clipboard-read', 'clipboard-sanitized-write', 'deprecated-sync-clipboard-read'].includes(permission)
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (!contents || !isTrustedMainRendererUrl(contents.getURL())) return false
    return clipboardPermission(permission) || permission === 'media' && armed.has(contents.id) && details.mediaType === 'audio'
  })
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const trusted = isTrustedMainRendererUrl(contents.getURL())
    callback(trusted && details.isMainFrame && (clipboardPermission(permission) || permission === 'media' && armed.has(contents.id) && 'mediaTypes' in details && details.mediaTypes?.length === 1 && details.mediaTypes?.[0] === 'audio'))
  })
  const logger = createMainLogger('main.audio_edit.explanation')
  const cleanup = (): void => { void explanationAudioService.cleanupExpired().catch(() => logger.warn('临时讲解录音清理失败', { event: 'explanation.audio.cleanup.failed' })) }
  const cleanupTimer = setInterval(cleanup, 60 * 60 * 1000); cleanupTimer.unref()
  cleanup(); app.on('before-quit', () => { clearInterval(cleanupTimer); cleanup() })
  registerIpcHandler('audioEdit:explanation', raw => recordingAudioRequestSchema.parse(raw), async (request, event) => {
    const senderId = event.sender.id
    if (!watched.has(senderId)) {
      watched.add(senderId)
      const revoke = (): void => { armed.delete(senderId); for (const id of owned.get(senderId) ?? []) explanationAudioService.cancel(id); owned.delete(senderId) }
      event.sender.on('did-start-navigation', revoke)
      event.sender.once('destroyed', () => { revoke(); watched.delete(senderId); event.sender.removeListener('did-start-navigation', revoke) })
    }
    if ('sessionId' in request) { const ids = owned.get(senderId) ?? new Set<string>(); ids.add(request.sessionId); owned.set(senderId, ids) }
    switch (request.action) {
      case 'microphone': {
        if (request.enabled) armed.add(event.sender.id)
        else armed.delete(event.sender.id)
        return
      }
      case 'write': return explanationAudioService.write(request)
      case 'read': return explanationAudioService.read(request.sessionId, request.chunkId)
      case 'erase': return explanationAudioService.erase(request.sessionId)
      case 'release': return explanationAudioService.release(request.sessionId)
      case 'archive': return explanationAudioService.archive(request.sessionId)
      case 'restore': return explanationAudioService.restore(request)
      case 'cancel': return explanationAudioService.cancel(request.sessionId)
      case 'transcribe': return explanationAudioService.transcribe(request)
    }
  }, assertTrustedApplicationSender)
}
