import { getPlatform } from '@/platform/runtime'
import type { VideoEditExportEncoding } from '@/core/videoEdit/exportEncoding'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.exportCompression')
export async function compressVideoEditExport(id: string, encoding: VideoEditExportEncoding, fps: number, durationSeconds: number, signal: AbortSignal, progress: (value: number) => void, videoBitrateMbps = 50): Promise<void> {
  const api = getPlatform().videoEditExport
  const cancel = (): void => { void api.cancelCompression(id).catch(error => logger.warn('取消压制未完成', { event: 'video_edit.export.compress.cancel_failed', error })) }
  signal.addEventListener('abort', cancel, { once: true })
  let stopped = false
  let pending: Promise<void> | undefined
  const timer = setInterval(() => {
    if (pending || stopped) return
    pending = api.compressionProgress(id).then(value => { if (!stopped) progress(value) }).catch(error => {
      if (!stopped && !signal.aborted) logger.debug('压制进度暂不可读', { event: 'video_edit.export.compress.progress_unavailable', error })
    }).finally(() => { pending = undefined })
  }, 250)
  try {
    signal.throwIfAborted()
    await api.compress({ id, encoding, fps, durationSeconds, videoBitrateMbps })
    signal.throwIfAborted()
    progress(1)
  } finally { stopped = true; clearInterval(timer); signal.removeEventListener('abort', cancel); await pending }
}
