import { getPlatform } from '@/platform'
import type { CaptureAttachment, CaptureFollowUp, CaptureManifest, CapturePrepared, CaptureSpan, ScreenCaptureOptions } from '@/core/screenRecording/capture'
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
export async function prepareScreenCapture(sessionId: string, options: ScreenCaptureOptions, session?: RecordingSessionOptions, cursor?: 'redraw' | 'embed', followUp?: CaptureFollowUp): Promise<ScreenCaptureSession> {
  const api = getPlatform().screenRecording
  const prepared = await api.capture({ operation: 'prepare', sessionId, options, ...(session ? { session } : {}), ...(cursor ? { cursor } : {}), ...(followUp ? { followUp } : {}) }) as CapturePrepared
  let browser: ChromiumCaptureBackend | undefined
  let host: ScreenCaptureSession | undefined
  try {
    if (prepared.backend === 'chromium') {
      browser = new ChromiumCaptureBackend(options, {
        encoding: async encoding => { await api.capture({ operation: 'encoding', sessionId, encoding }) },
        clock: async () => await api.capture({ operation: 'clock', sessionId }) as number,
        anchor: async (index, monoUs) => { await api.capture({ operation: 'anchor', sessionId, index, monoUs }) },
        open: async () => await api.capture({ operation: 'open-span', sessionId }) as CaptureSpan,
        write: async (index, position, data) => { await api.capture({ operation: 'write', sessionId, index, position, data: new Uint8Array(data) }) },
        seal: async (index, durationUs) => { await api.capture({ operation: 'seal-span', sessionId, index, durationUs }) },
        failed: error => { void api.capture({ operation: 'failed', sessionId, error: error.message }).catch(failure => logger.error('录制失败状态同步失败', { event: 'recording.capture.sync.failed', error: failure })) },
      }, undefined, session?.tracks.systemAudio)
    }
    host = hostCapture(prepared, session, browser)
    await browser?.prepare()
    return host
  } catch (error) {
    if (host) await host.close().catch(() => undefined)
    else try { await api.capture({ operation: 'close', sessionId }) } finally { await browser?.cancel().catch(() => undefined) }
    throw error
  }
}

/**
 * 界面进程重载或崩溃重开后接回进行中的录制：画面和事件一直在主进程录着，这里只重新开声音与摄像头。
 * 正在录就立刻开设备，暂停中等恢复时再开；断开期间没有数据，主进程记作空档。
 */
export async function attachScreenCapture(sessionId: string, phase: 'ready' | 'countdown' | 'recording' | 'paused'): Promise<{ capture: ScreenCaptureSession; attachment: CaptureAttachment }> {
  const attachment = await getPlatform().screenRecording.capture({ operation: 'attach', sessionId }) as CaptureAttachment
  const capture = hostCapture(attachment.prepared, attachment.session, undefined, phase)
  return { capture, attachment }
}

/** 界面这一侧的录制宿主：声音与摄像头轨道，加上兼容采集时的画面编码；按主进程的命令开始、暂停与停止。 */
function hostCapture(prepared: CapturePrepared, session: RecordingSessionOptions | undefined, browser: ChromiumCaptureBackend | undefined, attachedPhase?: 'ready' | 'countdown' | 'recording' | 'paused'): ScreenCaptureSession {
  const api = getPlatform().screenRecording, { sessionId } = prepared
  const controller = new AbortController()
  let tracks: RecordingTracksSession | undefined
  if (session) {
    if (!prepared.directory) throw new Error('录制素材目录未准备完成')
    tracks = new RecordingTracksSession({ sessionId, originUs: prepared.originUs, directory: prepared.directory, microphoneCopyDirectory: prepared.directory, tracks: session.tracks,
      onRecord: async record => { await api.capture({ operation: 'track', sessionId, record }) },
      ...(browser && session.tracks.systemAudio ? { displayAudio: () => browser!.cloneAudio() } : {}),
      onFailure: error => { void api.capture({ operation: 'failed', sessionId, error: String(error).slice(0, 1000) }).catch(failure => logger.error('录制轨道失败同步失败', { event: 'recording.tracks.sync.failed', error: failure })) },
    })
  }
  const unsubscribe = api.onCaptureCommand(command => {
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
      }
    }
    void execute().then(() => api.capture({ operation: 'ack', sessionId, requestId: command.requestId }), error => api.capture({ operation: 'ack', sessionId, requestId: command.requestId, error: String(error).slice(0, 1000) })).catch(error => logger.warn('录制控制回执失败', { event: 'recording.capture.ack.failed', error }))
  })
  // 还没开始的会话等主进程的开始命令，和刚准备好时一样。
  if (attachedPhase && attachedPhase !== 'ready' && tracks) {
    const resumed = tracks
    void (attachedPhase === 'paused' ? resumed.attachPaused() : resumed.start(controller.signal))
      .then(() => logger.info('界面重新接上录制，声音与摄像头已恢复', { event: 'recording.tracks.reattach.completed', context: { phase: attachedPhase } }))
      .catch(error => logger.error('界面重新接上录制时声音与摄像头未能恢复', { event: 'recording.tracks.reattach.failed', error }))
  }
  return { prepared, read: async () => await api.capture({ operation: 'read', sessionId }) as CaptureManifest,
    close: async () => { try { await api.capture({ operation: 'close', sessionId }) } finally { controller.abort(); await Promise.allSettled([tracks?.cancel(), browser?.cancel()]); unsubscribe() } } }
}
