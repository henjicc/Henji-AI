import type { VideoEditDocument } from '@/core/videoEdit/document'
import { activeVideoEditClips, clipSourceSeconds } from '@/core/videoEdit/document'
import type { VideoEditPreviewSource, VideoPreviewProxyResult } from '@/core/videoEdit/preview'
import { getPlatform } from '@/platform/runtime'
import { toFetchableMediaUrl } from '@/services/imageSource'

/** View-owned leases of bounded native preview segments, with original-time mapping. */
export class VideoEditPreviewSources {
  private readonly segments = new Map<string, { id: string; ready: Promise<VideoPreviewProxyResult>; completed: boolean }>()
  private readonly selected = new Map<string, { source: string; result: VideoPreviewProxyResult }>()
  private disposed = false
  preparationMs = 0
  bytes = 0
  constructor(private readonly preparing: (active: boolean) => void = () => {}) {}
  private segment(source: string, time: number, duration: number): { id: string; ready: Promise<VideoPreviewProxyResult>; completed: boolean } {
    const startSeconds = Math.max(0, Math.floor(time / 30) * 30 - 1)
    const durationSeconds = Math.min(32, duration - startSeconds)
    const key = `${source}:${startSeconds}:${durationSeconds}`
    const existing = this.segments.get(key)
    if (existing) return existing
    for (const [oldKey, segment] of this.segments) if (this.segments.size >= 12 && segment.completed) { this.segments.delete(oldKey); void getPlatform().video.cancelPreview(segment.id) }
    const id = crypto.randomUUID()
    const segment = { id, completed: false, ready: Promise.resolve({} as VideoPreviewProxyResult) }
    segment.ready = getPlatform().video.preparePreview({ requestId: id, source, startSeconds, durationSeconds }).then(async result => {
      if (this.disposed) throw new Error('预览准备已取消。')
      await getPlatform().media.allowRoot(await getPlatform().system.paths.dirname(result.path))
      this.preparationMs += result.preparationMs; this.bytes += result.sizeBytes
      return result
    }).catch(error => { this.segments.delete(key); throw error }).finally(() => { segment.completed = true })
    this.segments.set(key, segment)
    return segment
  }
  async resolve(document: VideoEditDocument, frame: number): Promise<VideoEditPreviewSource[]> {
    const clips = activeVideoEditClips(document, frame).filter(clip => clip.kind === 'video')
    const results: VideoEditPreviewSource[] = []
    let waiting = false
    try {
      for (const clip of clips) {
        const media = document.media.find(item => item.id === clip.mediaId)
        if (!media || media.width * media.height <= 1920 * 1080) continue
        const time = clipSourceSeconds(clip, frame, document.fps)
        const segment = this.segment(media.path, time, media.durationSeconds)
        const previous = this.selected.get(clip.id)
        // Segments overlap. Keep using the already decoded segment while the next
        // is preparing, as long as it still contains the requested source time.
        const reusable = !segment.completed && previous?.source === media.path && time >= previous.result.startSeconds && time < previous.result.startSeconds + previous.result.durationSeconds
        if (!segment.completed && !reusable) { waiting = true; this.preparing(true) }
        const result = reusable ? previous.result : await segment.ready
        this.selected.set(clip.id, { source: media.path, result })
        results.push({ clipId: clip.id, mediaId: media.id, path: toFetchableMediaUrl(result.path), startSeconds: result.startSeconds, endSeconds: result.startSeconds + result.durationSeconds })
        // Start the next bounded segment as soon as this one is usable. Waiting
        // until the last seconds leaves too little time for full-resolution encoding.
        if (result.startSeconds + result.durationSeconds < media.durationSeconds) {
          void this.segment(media.path, result.startSeconds + result.durationSeconds, media.durationSeconds).ready.catch(() => { /* surfaced if the segment becomes required */ })
        }
        if (time - result.startSeconds < 8 && result.startSeconds > 0) {
          void this.segment(media.path, result.startSeconds - 1, media.durationSeconds).ready.catch(() => { /* surfaced if the segment becomes required */ })
        }
      }
      return results
    } finally { if (waiting) this.preparing(false) }
  }
  async dispose(): Promise<void> { this.disposed = true; await Promise.allSettled([...this.segments.values()].map(segment => getPlatform().video.cancelPreview(segment.id))); this.segments.clear(); this.selected.clear() }
}
