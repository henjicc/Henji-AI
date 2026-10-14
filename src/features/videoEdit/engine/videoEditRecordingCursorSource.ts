import { captureLogPageSchema, type CaptureEvent, type CaptureLogPage } from '@/core/captureLog/events'
import { assertRecordingCursorPage, CURSOR_LOOKAHEAD_US, type RecordingCursorPage, type RecordingCursorSource } from '@/core/videoEdit/recordingCursor'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.recordingCursor')
const PAGE_BYTES = 2 * 1024 ** 2
export type RecordingCursorPageReader = (page: RecordingCursorPage, signal: AbortSignal) => Promise<Uint8Array>
/** The render-session boundary authorizes and converts paths; Workers never accept raw disk paths. */
export const fetchRecordingCursorPage: RecordingCursorPageReader = async (page, signal) => {
  if (!page.path.startsWith('henji-media://')) throw new Error('光标日志需要授权的媒体地址，请在剪辑渲染会话边界转换路径。')
  const response = await fetch(page.path, { signal })
  if (!response.ok || !response.body) throw new Error('无法读取光标日志，请恢复录制文件。')
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  try {
    for (let result = await reader.read(); !result.done; result = await reader.read()) {
      size += result.value.byteLength
      if (size > PAGE_BYTES) throw new Error('光标日志页超过读取预算。')
      chunks.push(result.value)
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
/** Per-renderer bounded LRU, not a global recording cache. A one-hour log is never loaded in full. */
export class VideoEditRecordingCursorSource {
  private readonly pages = new Map<string, { page: CaptureLogPage; bytes: number }>()
  private bytes = 0
  constructor(private readonly read: RecordingCursorPageReader = fetchRecordingCursorPage) {}
  clear(): void { this.pages.clear(); this.bytes = 0 }
  async window(source: RecordingCursorSource, timeUs: number, hideAfterSeconds: number, signal: AbortSignal): Promise<CaptureEvent[]> {
    const from = timeUs - Math.max(600_000, hideAfterSeconds * 1_000_000 + CURSOR_LOOKAHEAD_US)
    const to = timeUs + CURSOR_LOOKAHEAD_US
    return this.range(source, from, to, signal)
  }
  /** Attention analysis reads bounded time chunks through the same integrity/owner checks and cache. */
  async range(source: RecordingCursorSource, from: number, to: number, signal: AbortSignal): Promise<CaptureEvent[]> {
    signal.throwIfAborted()
    let lo = 0; let hi = source.pages.length
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (source.pages[mid].recordingSpanUs[1] < from) lo = mid + 1; else hi = mid }
    const events: CaptureEvent[] = []
    for (let i = lo; i < source.pages.length && source.pages[i].recordingSpanUs[0] <= to; i++) {
      signal.throwIfAborted()
      const ref = source.pages[i]; const key = JSON.stringify([ref.path, ref.sha256])
      let cached = this.pages.get(key)
      if (!cached) {
        logger.debug('读取光标事件页', { event: 'video_edit.cursor.read.start', context: { pageIndex: i } })
        try {
          const bytes = await this.read(ref, signal); signal.throwIfAborted()
          if (bytes.byteLength > PAGE_BYTES) throw new Error('光标日志页超过读取预算。')
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))), b => b.toString(16).padStart(2, '0')).join('')
          signal.throwIfAborted()
          if (digest !== ref.sha256) throw new Error('光标日志校验失败，请恢复原录制文件。')
          const page = captureLogPageSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
          assertRecordingCursorPage(page, ref, source)
          cached = { page, bytes: bytes.byteLength }
          while (this.pages.size && (this.pages.size >= 32 || this.bytes + cached.bytes > 8 * 1024 ** 2)) {
            const oldest = this.pages.keys().next().value!; this.bytes -= this.pages.get(oldest)!.bytes; this.pages.delete(oldest)
          }
          this.pages.set(key, cached); this.bytes += cached.bytes
          logger.debug('光标事件页读取完成', { event: 'video_edit.cursor.read.completed', context: { pageIndex: i, count: page.count } })
        } catch (error) {
          if (!signal.aborted) logger.warn('光标事件页读取失败', { event: 'video_edit.cursor.read.failed', error, context: { pageIndex: i } })
          throw error
        }
      } else { assertRecordingCursorPage(cached.page, ref, source); this.pages.delete(key); this.pages.set(key, cached) }
      events.push(...cached.page.entries.filter(e => e.recordingUs >= from && e.recordingUs <= to))
    }
    return events
  }
}
