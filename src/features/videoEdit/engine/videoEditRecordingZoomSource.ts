import { RECORDING_ZOOM_FOLLOW_STEP_US, recordingZoomPointerFromEvents, type RecordingZoomPointer } from '@/core/videoEdit/recordingZoom'
import type { RecordingCursorSource } from '@/core/videoEdit/recordingCursor'
import type { VideoEditRecordingCursorSource } from './videoEditRecordingCursorSource'

/** 每块覆盖 200 个网格点（10 秒源时间）；块之间互不依赖，读取顺序不影响结果。 */
const CHUNK = 200
const CHUNK_US = CHUNK * RECORDING_ZOOM_FOLLOW_STEP_US
/** 块开始前往回找最后一个指针位置的范围（指针长时间静止时仍知道它停在哪）。 */
const LOOKBACK_US = 10_000_000
/** Soft cache budget (about 1.6 KB per chunk); the chunks needed by the current frame are always kept. */
const CACHED_CHUNKS = 512

/**
 * 自动缩放跟随镜头的指针采样：按全局源时间网格（50 毫秒）把事件日志折算成归一化指针位置，按块缓存。
 * 日志读取复用光标层的分页源（同一份完整性与归属校验、同一份页缓存），一小时录屏也不会整份载入。
 */
export class VideoEditRecordingZoomPointers {
  private readonly chunks = new Map<string, Float32Array>()
  constructor(private readonly cursor: VideoEditRecordingCursorSource) {}
  clear(): void { this.chunks.clear() }
  /** 先读入 `spans`（源时间微秒）需要的块，返回同步的采样函数；网格点之间线性插值，没有数据时为 null。 */
  async pointer(source: RecordingCursorSource, spans: ReadonlyArray<{ fromUs: number; toUs: number }>, signal: AbortSignal): Promise<RecordingZoomPointer> {
    const owner = JSON.stringify([source.ownerRef, source.sourceDigest, source.recordingStartUs])
    const key = (index: number): string => `${owner}\u0000${index}`
    const needed = new Set<number>()
    for (const span of spans) for (let index = Math.floor(span.fromUs / CHUNK_US); index <= Math.floor((span.toUs + RECORDING_ZOOM_FOLLOW_STEP_US) / CHUNK_US); index++) needed.add(index)
    const loaded = new Map<number, Float32Array>()
    for (const index of needed) {
      let chunk = this.chunks.get(key(index))
      if (!chunk) {
        const startUs = index * CHUNK_US
        const events = await this.cursor.range(source, source.recordingStartUs + startUs - LOOKBACK_US, source.recordingStartUs + startUs + CHUNK_US + 100_000, signal)
        signal.throwIfAborted()
        chunk = new Float32Array(CHUNK * 2)
        for (let i = 0; i < CHUNK; i++) {
          const point = recordingZoomPointerFromEvents(events, source.recordingStartUs + startUs + i * RECORDING_ZOOM_FOLLOW_STEP_US, source)
          chunk[i * 2] = point ? point.x : NaN; chunk[i * 2 + 1] = point ? point.y : NaN
        }
        const pinned = new Set([...needed].map(key))
        while (this.chunks.size >= CACHED_CHUNKS) { const oldest = [...this.chunks.keys()].find(value => !pinned.has(value)); if (!oldest) break; this.chunks.delete(oldest) }
      } else this.chunks.delete(key(index))
      this.chunks.set(key(index), chunk); loaded.set(index, chunk)
    }
    const at = (grid: number): { x: number; y: number } | null => {
      const chunk = loaded.get(Math.floor(grid / CHUNK)); const offset = (grid - Math.floor(grid / CHUNK) * CHUNK) * 2
      if (!chunk || Number.isNaN(chunk[offset])) return null
      return { x: chunk[offset], y: chunk[offset + 1] }
    }
    return sourceUs => {
      const position = sourceUs / RECORDING_ZOOM_FOLLOW_STEP_US; const grid = Math.floor(position); const t = position - grid
      const a = at(grid)
      if (!a || t < 1e-9) return a
      const b = at(grid + 1)
      return b ? { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } : a
    }
  }
}
