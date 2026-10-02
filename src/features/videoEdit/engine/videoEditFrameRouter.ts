import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoEditFrameCache } from './videoEditFrameCache'
import { resolveVideoEditDecodeBackend, VIDEO_EDIT_NATIVE_PRIMARY, type VideoEditDecodeBackend, type VideoEditDecodeSupport, type VideoEditFrameBackend, type VideoEditFrameSeeker, type VideoEditFrameSource, type VideoEditSnapshot } from './videoEditFrameSource'

/** What the render worker knows about native decoding when it starts: the service state and the diagnostic setting. */
export interface VideoEditDecodeSettings {
  nativeAvailable: boolean
  /** Developer diagnostic `HENJI_VIDEO_DECODER`; never shown in the interface. */
  forced?: VideoEditDecodeBackend
}

/** Structured log entry from the worker (forwarded to the application log by the render session). */
export type VideoEditDecodeLog = (level: 'info' | 'warn', message: string, event: string, context: Record<string, unknown>) => void

/** The native backend as the router needs it: whether the service can be asked to read a media item at all. */
export interface VideoEditNativeCapableBackend extends VideoEditFrameBackend {
  reads(media: VideoEditMedia): boolean
}

interface Decision {
  backend: Promise<VideoEditDecodeBackend>
  browser: VideoEditDecodeSupport['browser']
  /** The browser open made to ask whether it decodes the file; reused by the first open when the browser is chosen. */
  probe?: { key: string; ready: Promise<VideoEditFrameSource> }
}

function mediaKey(media: VideoEditMedia): string { return `${media.path}\u0000${media.sourceRevision ?? ''}` }

/**
 * The renderer's decoding backend: one backend per file (path + revision) for picture and sound, chosen once by
 * `chooseVideoEditDecodeBackend` (the same decision media import logs). While native is not the primary path, the
 * browser is asked whether it decodes the whole file only when native could read it; a file that only native decodes
 * plays natively. The project never records the choice (record 006): a saved project chooses again when opened.
 *
 * After a native failure on a file the browser may decode, later opens of that file choose the browser (logged);
 * readers already open keep failing in place until the renderer drops them (task 3.1 owns in-flight recovery).
 * A forced backend is never replaced.
 */
export class VideoEditFrameRouter implements VideoEditFrameBackend {
  private readonly decisions = new Map<string, Decision>()
  private readonly opened = new Map<string, { backend: VideoEditFrameBackend; key: string }>()
  private readonly pending = new Set<string>()
  private readonly releasedEarly = new Set<string>()
  private next = 0

  constructor(
    private readonly browser: VideoEditFrameBackend,
    private readonly native: VideoEditNativeCapableBackend | undefined,
    private readonly settings: VideoEditDecodeSettings,
    private readonly log: VideoEditDecodeLog = () => {},
    private readonly nativePrimary = VIDEO_EDIT_NATIVE_PRIMARY,
  ) {}

  private backend(choice: VideoEditDecodeBackend): VideoEditFrameBackend {
    if (choice === 'native') { if (!this.native) throw new Error('预览解码不可用。'); return this.native }
    return this.browser
  }

  /** The backend for a file, decided once per file and revision. */
  decide(media: VideoEditMedia): Decision {
    const key = mediaKey(media)
    const existing = this.decisions.get(key)
    if (existing) return existing
    const decision: Decision = { backend: Promise.resolve('browser'), browser: 'unknown' }
    const forced = this.settings.forced
    const nativeReads = this.settings.nativeAvailable && !!this.native?.reads(media)
    decision.backend = (async () => {
      let retry = false
      const { backend: choice, browser } = await resolveVideoEditDecodeBackend({
        nativeReads, forced, nativePrimary: this.nativePrimary,
        // The browser open made for the question is kept for the first open of the file when the browser is chosen.
        browserDecodes: async () => {
          const probe = this.browser.open(media); decision.probe = probe
          try { return await (await probe.ready).decodable?.() !== false } catch (error) { retry = true; throw error }
        },
      })
      decision.browser = browser
      if (choice !== 'browser' && decision.probe) { this.browser.release(decision.probe.key); decision.probe = undefined }
      // An unreadable file (moved, being restored) is decided again on its next open.
      if (retry && this.decisions.get(key) === decision) this.decisions.delete(key)
      this.log('info', '剪辑素材解码方式已确定', 'video_edit.decode.backend.selected', { mediaId: media.id, backend: choice ?? 'none', browser: decision.browser, nativeAvailable: this.settings.nativeAvailable, ...(forced ? { forced } : {}) })
      if (!choice) throw new Error(`素材「${media.name}」的格式当前无法播放，请重启软件后重试，或先转为 H.264 视频后再导入。`)
      return choice
    })()
    decision.backend.catch(() => { if (this.decisions.get(key) === decision) this.decisions.delete(key) })
    this.decisions.set(key, decision)
    return decision
  }

  /** A native read of this file failed: later opens use the browser when it may decode the file. */
  nativeFailed(media: VideoEditMedia, error: unknown): void {
    const key = mediaKey(media)
    const decision = this.decisions.get(key)
    if (!decision || this.settings.forced || decision.browser === 'cannot-decode') return
    void decision.backend.then(choice => {
      if (choice !== 'native' || this.decisions.get(key) !== decision) return
      this.decisions.set(key, { backend: Promise.resolve('browser'), browser: decision.browser })
      this.log('warn', '原生解码失败，此素材改用后备解码', 'video_edit.decode.native.fallback', { mediaId: media.id, error: error instanceof Error ? error.message : String(error) })
    }, () => undefined)
  }

  open(media: VideoEditMedia): { key: string; ready: Promise<VideoEditFrameSource> } {
    const id = `route-${++this.next}`
    this.pending.add(id)
    const decision = this.decide(media)
    const ready = decision.backend.then(choice => {
      this.pending.delete(id)
      if (this.releasedEarly.delete(id)) throw new Error('预览已关闭。')
      const backend = this.backend(choice)
      let handle: { key: string; ready: Promise<VideoEditFrameSource> }
      if (choice === 'browser' && decision.probe) { handle = decision.probe; decision.probe = undefined }
      else handle = backend.open(media)
      this.opened.set(id, { backend, key: handle.key })
      return handle.ready
    }, error => { this.pending.delete(id); this.releasedEarly.delete(id); throw error })
    return { key: id, ready }
  }

  release(key: string): void {
    const entry = this.opened.get(key)
    if (entry) { this.opened.delete(key); entry.backend.release(entry.key); return }
    if (this.pending.has(key)) this.releasedEarly.add(key)
  }

  seeker(media: VideoEditMedia, cache: VideoEditFrameCache, snapshot: VideoEditSnapshot): VideoEditFrameSeeker {
    let disposed = false
    const inner = this.decide(media).backend.then(choice => this.backend(choice).seeker(media, cache, snapshot))
    void inner.catch(() => undefined)
    return {
      sample: async (time, direction) => {
        const seeker = await inner
        if (disposed) throw new Error('预览解码已关闭。')
        return seeker.sample(time, direction)
      },
      dispose: async () => { disposed = true; await (await inner.catch(() => undefined))?.dispose() },
    }
  }

  /** Closes a probe whose file was never opened afterwards. */
  dispose(): void {
    for (const decision of this.decisions.values()) if (decision.probe) { this.browser.release(decision.probe.key); decision.probe = undefined }
    this.decisions.clear()
  }
}
