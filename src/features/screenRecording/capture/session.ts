import { getPlatform } from '@/platform'
import type { CaptureManifest, CapturePrepared, CaptureSpan, ScreenCaptureOptions } from '@/core/screenRecording/capture'
import { ChromiumCaptureBackend } from './chromium'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.screenRecording.capture')
export interface ScreenCaptureSession {
  prepared: CapturePrepared
  read(): Promise<CaptureManifest>
  close(): Promise<void>
}
/** The host grants a selected source first. 1.5 UI/Pi/MCP then share this service and the 1.1 control. */
export async function prepareScreenCapture(sessionId: string, options: ScreenCaptureOptions): Promise<ScreenCaptureSession> {
  const api = getPlatform().screenRecording
  const prepared = await api.capture({ operation: 'prepare', sessionId, options }) as CapturePrepared
  let browser: ChromiumCaptureBackend | undefined
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
      })
      const backend = browser
      unsubscribe = api.onCaptureCommand(command => {
        if (command.sessionId !== sessionId) return
        if (command.operation === 'cancel') controller.abort()
        const work = command.operation === 'cancel' ? backend.cancel() : backend[command.operation](controller.signal)
        void work.then(() => api.capture({ operation: 'ack', sessionId, requestId: command.requestId }), error => api.capture({ operation: 'ack', sessionId, requestId: command.requestId, error: error instanceof Error ? error.message : String(error) })).catch(error => logger.warn('录制控制回执失败', { event: 'recording.capture.ack.failed', error }))
      })
      await browser.prepare()
    }
    return { prepared, read: async () => await api.capture({ operation: 'read', sessionId }) as CaptureManifest,
      close: async () => { controller.abort(); await browser?.cancel(); try { await api.capture({ operation: 'close', sessionId }) } finally { unsubscribe() } } }
  } catch (error) { await browser?.cancel(); unsubscribe(); await api.capture({ operation: 'close', sessionId }); throw error }
}
