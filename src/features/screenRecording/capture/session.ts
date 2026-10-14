import { getPlatform } from '@/platform'
import type { CaptureManifest, CapturePrepared, CaptureSpan, ScreenCaptureOptions } from '@/core/screenRecording/capture'
import { ChromiumCaptureBackend } from './chromium'
import { createLogger } from '@/core/logging'
import { RecordingTracksSession } from '../tracks/session'
import type { RecordingSessionOptions } from '@/core/screenRecording/sessionOptions'

const logger = createLogger('features.screenRecording.capture')
export interface ScreenCaptureSession {
  prepared: CapturePrepared
  read(): Promise<CaptureManifest>
  close(): Promise<void>
}
/** The host grants a selected source first. 1.5 UI/Pi/MCP then share this service and the 1.1 control. */
export async function prepareScreenCapture(sessionId: string, options: ScreenCaptureOptions, session?: RecordingSessionOptions, cursor?: 'redraw' | 'embed'): Promise<ScreenCaptureSession> {
  const api = getPlatform().screenRecording
  const prepared = await api.capture({ operation: 'prepare', sessionId, options, ...(session ? { session } : {}), ...(cursor ? { cursor } : {}) }) as CapturePrepared
  let browser: ChromiumCaptureBackend | undefined
  let tracks: RecordingTracksSession | undefined
  const controller = new AbortController()
  let unsubscribe = (): void => undefined
  try {
    if (prepared.backend === 'chromium') {
      browser = new ChromiumCaptureBackend(options, {
        clock: async () => await api.capture({ operation: 'clock', sessionId }) as number,
        anchor: async (index, monoUs) => { await api.capture({ operation: 'anchor', sessionId, index, monoUs }) },
        open: async () => await api.capture({ operation: 'open-span', sessionId }) as CaptureSpan,
        write: async (index, position, data) => { await api.capture({ operation: 'write', sessionId, index, position, data: new Uint8Array(data) }) },
        seal: async (index, durationUs) => { await api.capture({ operation: 'seal-span', sessionId, index, durationUs }) },
        failed: error => { void api.capture({ operation: 'failed', sessionId, error: error.message }).catch(failure => logger.error('录制失败状态同步失败', { event: 'recording.capture.sync.failed', error: failure })) },
      }, undefined, session?.tracks.systemAudio)
    }
    const checkpoint = async (): Promise<void> => { if (tracks) await api.capture({ operation: 'tracks', sessionId, tracks: tracks.snapshot() }) }
    if (session) {
      if (!prepared.directory) throw new Error('录制素材目录未准备完成')
      tracks = new RecordingTracksSession({ sessionId, originUs: prepared.originUs, directory: prepared.directory, tracks: session.tracks,
        onSegment: checkpoint,
        ...(browser && session.tracks.systemAudio ? { displayAudio: () => browser!.cloneAudio() } : {}),
        onFailure: error => { void api.capture({ operation: 'failed', sessionId, error: String(error).slice(0, 1000) }).catch(failure => logger.error('录制轨道失败同步失败', { event: 'recording.tracks.sync.failed', error: failure })) },
      })
    }
    unsubscribe = api.onCaptureCommand(command => {
      if (command.sessionId !== sessionId) return
      const execute = async (): Promise<void> => {
        if (command.operation === 'cancel') {
          controller.abort()
          const results = await Promise.allSettled([tracks?.cancel(), browser?.cancel()])
          const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
          if (failure) throw failure.reason
        } else {
          const results = await Promise.allSettled([tracks?.[command.operation](controller.signal), browser?.[command.operation](controller.signal)])
          const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
          if (failure) throw failure.reason
          await checkpoint()
        }
      }
      void execute().then(() => api.capture({ operation: 'ack', sessionId, requestId: command.requestId }), error => api.capture({ operation: 'ack', sessionId, requestId: command.requestId, error: String(error).slice(0, 1000) })).catch(error => logger.warn('录制控制回执失败', { event: 'recording.capture.ack.failed', error }))
    })
    await browser?.prepare()
    return { prepared, read: async () => await api.capture({ operation: 'read', sessionId }) as CaptureManifest,
      close: async () => { try { await api.capture({ operation: 'close', sessionId }) } finally { controller.abort(); await Promise.allSettled([tracks?.cancel(), browser?.cancel()]); unsubscribe() } } }
  } catch (error) { try { await api.capture({ operation: 'close', sessionId }) } finally { await Promise.allSettled([tracks?.cancel(), browser?.cancel()]); unsubscribe() } throw error }
}
