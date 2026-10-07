import type { VideoEditComposition, VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditFps, videoEditPictureSeconds } from '@/core/videoEdit/time'
import { getPlatform } from '@/platform/runtime'
import { isLikelyLocalImagePath, toFetchableMediaUrl } from '@/services/imageSource'
import { VideoEditRenderSession } from './videoEditRenderSession'
import { videoEditBrowserDecodable } from './videoEditBrowserFrames'
import { resolveVideoEditDecodeBackend, type VideoEditDecodeBackend } from './videoEditFrameSource'

const SOURCE_CACHE_BYTES = 3 * 1024 ** 3

const sourceBackends = new Map<string, Promise<VideoEditDecodeBackend | undefined>>()
/**
 * The backend that plays a video or audio item in the source monitor, decided like the render worker decides it (one
 * backend per file and revision, cached for the page). Native-decoded items cannot use a media element: the source
 * monitor shows them through `VideoEditSourceFrames` and plays their sound through `VideoEditSourceSoundPlayer`.
 */
export function videoEditSourceBackend(media: VideoEditMedia): Promise<VideoEditDecodeBackend | undefined> {
  const key = `${media.path}\u0000${media.sourceRevision ?? ''}`
  let decided = sourceBackends.get(key)
  if (!decided) {
    decided = (async () => {
      const status = await getPlatform().videoDecoder.status().catch(() => ({ available: false, forcedBackend: null }))
      const forced = status.forcedBackend ?? undefined
      const nativeReads = status.available && media.kind !== 'image' && isLikelyLocalImagePath(media.path)
      return (await resolveVideoEditDecodeBackend({ nativeReads, forced, browserDecodes: () => videoEditBrowserDecodable(toFetchableMediaUrl(media.path)) })).backend
    })()
    const settled = decided
    // A failed decision (no platform, moved file) is decided again next time.
    settled.then(backend => { if (!backend) sourceBackends.delete(key) }, () => sourceBackends.delete(key))
    sourceBackends.set(key, settled)
  }
  return decided
}

/** A transient original-source view using the production decoder and GPU surface. */
export class VideoEditSourceFrames {
  private readonly session: VideoEditRenderSession
  private document: VideoEditComposition
  private readonly durationUs: number
  private revision = 0
  private disposed = false
  private released?: Promise<void>
  /** Set while playing forward through the renderer's scheduled path (a document spanning the whole source). */
  private playback?: number

  constructor(media: VideoEditMedia, surface: HTMLCanvasElement, proxyProjectId?: string) {
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
        sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }],
      annotations: [],
    }
    surface.width = media.width; surface.height = media.height
    this.session = new VideoEditRenderSession(this.document, media.width, undefined, surface.transferControlToOffscreen(), SOURCE_CACHE_BYTES, proxyProjectId)
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
    this.playback = undefined
    this.document = { ...this.document, revision, clips: [{ ...this.document.clips[0], sourceInUs, duration: 1 }] }
    await this.session.updateDocument(this.document)
    this.assertCurrent(revision)
    const result = await this.session.present(0, false, false, deadline)
    try {
      this.assertCurrent(revision)
      const timestamp = this.blank(result) ? this.gridSeconds(sourceInUs) : result.sourceTimestamps?.[0]
      if (result.presented !== true || timestamp === undefined || !Number.isFinite(timestamp) || timestamp < 0 || timestamp >= this.document.media[0].durationSeconds || timestamp > videoEditPictureSeconds(sourceInUs / 1e6) + 1e-7) throw new Error('源画面未确认有效的实际呈现位置。')
      const presentedTimeUs = Math.round(timestamp * 1e6)
      if (!Number.isSafeInteger(presentedTimeUs) || presentedTimeUs < 0 || presentedTimeUs > this.durationUs) throw new Error('源画面实际呈现位置超出范围。')
      return { timeUs, presentedTimeUs, decodeMs: result.decodeMs ?? 0, gpuMs: result.gpuMs ?? 0, cacheHits: result.cacheHits ?? 0, cacheBytes: result.cacheBytes ?? 0 }
    } finally { result.bitmap?.close() }
  }

  /**
   * The source has no picture at this time (before its stream's first picture): the render session showed a
   * transparent layer, so the confirmed position is the nominal frame the clock is in.
   */
  private blank(result: { presented?: boolean; sourceTimestamps?: number[]; blankPictures?: number }): boolean { return result.presented === true && !result.sourceTimestamps?.length && result.blankPictures === 1 }
  private gridSeconds(timeUs: number): number { return Math.floor(timeUs * this.document.fps / 1e6 + 1e-6) / this.document.fps }

  /** Frames of the source on its own frame clock (frame k shows source time k / fps). */
  get frameCount(): number { return Math.max(1, Math.ceil(this.durationUs * this.document.fps / 1e6 - 1e-6)) }

  /**
   * Forward playback: presents frame `frame` of the source's own frame clock through the renderer's scheduled path,
   * which decodes consecutive frames through one long-lived decoder like the program monitor. Call with consecutive
   * frames; `deadline` paces the presentation. Any `present()` or `invalidate()` ends the run.
   */
  async playFrame(frame: number, deadline?: number): Promise<{ timeUs: number; presentedTimeUs: number; decodeMs: number; gpuMs: number; cacheHits: number; cacheBytes: number }> {
    if (this.disposed) throw new Error('源画面会话已关闭。')
    if (!Number.isSafeInteger(frame) || frame < 0 || frame >= this.frameCount) throw new Error('源画面帧号超出素材范围。')
    if (this.playback !== this.revision) {
      this.invalidate()
      const revision = this.revision
      this.document = { ...this.document, revision, clips: [{ ...this.document.clips[0], sourceInUs: 0, duration: this.frameCount }] }
      await this.session.updateDocument(this.document)
      this.assertCurrent(revision)
      this.playback = revision
    }
    const revision = this.revision
    const result = await this.session.present(frame, true, false, deadline)
    try {
      this.assertCurrent(revision)
      const timestamp = this.blank(result) ? frame / this.document.fps : result.sourceTimestamps?.[0]
      if (result.presented !== true || timestamp === undefined || !Number.isFinite(timestamp) || timestamp < 0 || timestamp >= this.document.media[0].durationSeconds) throw new Error('源画面未确认有效的实际呈现位置。')
      return { timeUs: Math.min(this.durationUs, Math.round(frame / this.document.fps * 1e6)), presentedTimeUs: Math.round(timestamp * 1e6), decodeMs: result.decodeMs ?? 0, gpuMs: result.gpuMs ?? 0, cacheHits: result.cacheHits ?? 0, cacheBytes: result.cacheBytes ?? 0 }
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
