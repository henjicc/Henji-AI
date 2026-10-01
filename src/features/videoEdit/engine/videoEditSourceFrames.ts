import type { VideoEditComposition, VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditFps } from '@/core/videoEdit/time'
import { VideoEditRenderSession } from './videoEditRenderSession'

const SOURCE_CACHE_BYTES = 3 * 1024 ** 3

/** A transient original-source view using the production decoder and GPU surface. */
export class VideoEditSourceFrames {
  private readonly session: VideoEditRenderSession
  private document: VideoEditComposition
  private readonly durationUs: number
  private revision = 0
  private disposed = false
  private released?: Promise<void>

  constructor(media: VideoEditMedia, surface: HTMLCanvasElement) {
    const durationUs = Math.round(media.durationSeconds * 1e6)
    const frameRate = media.frameRate ? { ...media.frameRate } : { numerator: 30, denominator: 1 }
    if (media.kind !== 'video' || !Number.isFinite(media.durationSeconds) || media.durationSeconds <= 0 || !Number.isSafeInteger(durationUs) || durationUs < 1) throw new Error('源画面需要具有有效时长的视频素材。')
    if (![media.width, media.height, frameRate.numerator, frameRate.denominator].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('源视频尺寸或帧率无效。')
    this.durationUs = durationUs
    const itemId = crypto.randomUUID()
    this.document = {
      id: crypto.randomUUID(), name: media.name, revision: 0,
      width: media.width, height: media.height, frameRate, fps: videoEditFps(frameRate),
      pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      media: [{ ...media, ...(media.frameRate ? { frameRate: { ...media.frameRate } } : {}) }],
      items: [{ id: itemId, name: media.name, kind: 'video', mediaId: media.id }],
      tracks: [{ id: crypto.randomUUID(), name: media.name, index: 0, kind: 'video', locked: false, enabled: true, muted: true, solo: false }],
      clips: [{ id: crypto.randomUUID(), itemId, name: media.name, kind: 'video', sourceComponent: 'video', track: 0, start: 0, duration: 1,
        sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, brightness: 1, text: '' }],
      annotations: [],
    }
    surface.width = media.width; surface.height = media.height
    this.session = new VideoEditRenderSession(this.document, media.width, undefined, surface.transferControlToOffscreen(), SOURCE_CACHE_BYTES)
  }

  invalidate(): void {
    if (!this.disposed) this.session.invalidateDocument(++this.revision)
  }

  private assertCurrent(revision: number): void {
    if (this.disposed) throw new Error('源画面会话已关闭。')
    if (revision !== this.revision) throw new Error('源画面请求已被更新。')
  }

  async present(timeUs: number, deadline?: number): Promise<{ timeUs: number; presentedTimeUs: number; decodeMs: number; gpuMs: number; cacheHits: number; cacheBytes: number }> {
    if (this.disposed) throw new Error('源画面会话已关闭。')
    if (!Number.isSafeInteger(timeUs) || timeUs < 0 || timeUs > this.durationUs) throw new Error('源画面位置必须是素材范围内的整数微秒。')
    if (deadline !== undefined && (!Number.isFinite(deadline) || deadline < 0)) throw new Error('源画面呈现时刻无效。')
    // The inclusive source clock endpoint has no picture of its own. Query one
    // microsecond inside the final picture while preserving the requested clock.
    const sourceInUs = timeUs === this.durationUs ? this.durationUs - 1 : timeUs
    this.invalidate()
    const revision = this.revision
    this.document = { ...this.document, revision, clips: [{ ...this.document.clips[0], sourceInUs }] }
    await this.session.updateDocument(this.document)
    this.assertCurrent(revision)
    const result = await this.session.present(0, false, false, deadline)
    try {
      this.assertCurrent(revision)
      const timestamp = result.sourceTimestamps?.[0]
      if (result.presented !== true || timestamp === undefined || !Number.isFinite(timestamp) || timestamp < 0 || timestamp >= this.document.media[0].durationSeconds || timestamp > sourceInUs / 1e6 + 1e-7) throw new Error('源画面未确认有效的实际呈现位置。')
      const presentedTimeUs = Math.round(timestamp * 1e6)
      if (!Number.isSafeInteger(presentedTimeUs) || presentedTimeUs < 0 || presentedTimeUs > this.durationUs) throw new Error('源画面实际呈现位置超出范围。')
      return { timeUs, presentedTimeUs, decodeMs: result.decodeMs ?? 0, gpuMs: result.gpuMs ?? 0, cacheHits: result.cacheHits ?? 0, cacheBytes: result.cacheBytes ?? 0 }
    } finally { result.bitmap?.close() }
  }

  dispose(): Promise<void> {
    if (!this.released) {
      this.invalidate(); this.disposed = true
      this.released = this.session.dispose()
    }
    return this.released
  }
}
