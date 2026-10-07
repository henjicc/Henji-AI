import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoEditFrameCache } from './videoEditFrameCache'
import { resolveVideoEditDecodeBackend, VIDEO_EDIT_NATIVE_PRIMARY, type VideoEditAudioChunk, type VideoEditClipAudio, type VideoEditClipFrames, type VideoEditDecodeBackend, type VideoEditDecodeSupport, type VideoEditDecodedPicture, type VideoEditFrameBackend, type VideoEditFrameSeeker, type VideoEditFrameSource, type VideoEditSnapshot } from './videoEditFrameSource'
import { videoEditNativeFailureCode, videoEditNativeFailureKind } from './videoEditNativeFailure'

/** What the render worker knows about native decoding when it starts: the service state and the diagnostic setting. */
export interface VideoEditDecodeSettings {
  nativeAvailable: boolean
  /** Developer diagnostic `HENJI_VIDEO_DECODER`; never shown in the interface. */
  forced?: VideoEditDecodeBackend
}

/** Structured log entry from the worker (forwarded to the application log by the render session). */
export type VideoEditDecodeLog = (level: 'info' | 'warn', message: string, event: string, context: Record<string, unknown>) => void

/** The native backend as the router needs it: whether the service can read a media item, and dropping a file's sessions. */
export interface VideoEditNativeCapableBackend extends VideoEditFrameBackend {
  reads(media: VideoEditMedia): boolean
  /** Drops the file's shared sessions after a failure so the next read opens new ones. */
  reset?(media: VideoEditMedia): void
}

/**
 * After a native failure, a file the browser decodes stays on the browser for new reads this long, doubling per failure
 * in a row (a service restart takes 0.3–3.5s, 1.1/3.1 measurements); then new reads try native again ("恢复后新请求自动回到
 * 原生"). A file only native decodes retries native once per read instead, on a new session.
 */
export const VIDEO_EDIT_NATIVE_RETRY_MS = 2000
const NATIVE_RETRY_MAX_MS = 30_000

interface Decision {
  backend: Promise<VideoEditDecodeBackend>
  /** The resolved choice (set before any source of the file is handed out). */
  choice?: VideoEditDecodeBackend
  browser: VideoEditDecodeSupport['browser']
  /** The browser open made to ask whether it decodes the file; reused by the first browser open of the file. */
  probe?: { key: string; ready: Promise<VideoEditFrameSource> }
  /** Whether the browser decodes every stream of the file, asked when native fails (task 3.1). */
  browserCheck?: Promise<boolean>
  nativeFailures: number
  nativeRetryAt: number
}

/** How a failed read continues: on another (or a fresh) backend, or with this user-facing error. */
type Recovery = { retry: VideoEditDecodeBackend } | { error: unknown }

function mediaKey(media: VideoEditMedia): string { return `${media.path}\u0000${media.sourceRevision ?? ''}` }

/**
 * The renderer's decoding backend: one backend choice per file (path + revision) for picture and sound, made once by
 * `chooseVideoEditDecodeBackend` (the same decision media import logs). The project never records the choice
 * (record 006): a saved project chooses again when opened.
 *
 * Runtime failures (task 3.1; plan section 8): every read of a file goes through a routed source that recovers it in
 * flight. A native read that fails continues on the browser when the browser decodes the file (logged as
 * `video_edit.decode.native.fallback`; new reads, and sequential readers and plans still running on the fallback, return
 * to native after `VIDEO_EDIT_NATIVE_RETRY_MS`, logged as `video_edit.decode.native.restored` once one succeeds). A file only native decodes retries a failed service read once
 * on a new session (the service restarts by itself) and otherwise reports the failure in place; the next request tries
 * again. A forced backend is never replaced.
 */
export class VideoEditFrameRouter implements VideoEditFrameBackend {
  private readonly decisions = new Map<string, Decision>()
  private readonly opened = new Map<string, RoutedFileSource>()
  private readonly pending = new Set<string>()
  private readonly releasedEarly = new Set<string>()
  private next = 0

  constructor(
    private readonly browser: VideoEditFrameBackend,
    private readonly native: VideoEditNativeCapableBackend | undefined,
    private readonly settings: VideoEditDecodeSettings,
    private readonly log: VideoEditDecodeLog = () => {},
    private readonly nativePrimary = VIDEO_EDIT_NATIVE_PRIMARY,
    private readonly now: () => number = () => performance.now(),
  ) {}

  backend(choice: VideoEditDecodeBackend): VideoEditFrameBackend {
    if (choice === 'native') { if (!this.native) throw new Error('预览解码不可用。'); return this.native }
    return this.browser
  }

  /** The backend for a file, decided once per file and revision. */
  decide(media: VideoEditMedia): Decision {
    const key = mediaKey(media)
    const existing = this.decisions.get(key)
    if (existing) return existing
    const decision: Decision = { backend: Promise.resolve('browser'), browser: 'unknown', nativeFailures: 0, nativeRetryAt: 0 }
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
      decision.choice = choice
      return choice
    })()
    decision.backend.catch(() => { if (this.decisions.get(key) === decision) this.decisions.delete(key) })
    this.decisions.set(key, decision)
    return decision
  }

  /** The backend a new read of the file uses now: the chosen one, or the browser while native recovers. */
  current(decision: Decision): VideoEditDecodeBackend {
    const choice = decision.choice ?? 'browser'
    return choice === 'native' && decision.nativeRetryAt > this.now() ? 'browser' : choice
  }

  /** Whether a read running on the fallback should continue on native now (the cool-down after a failure has passed). */
  returnsToNative(decision: Decision, backend: VideoEditDecodeBackend): boolean {
    return backend === 'browser' && decision.choice === 'native' && decision.nativeFailures > 0 && this.current(decision) === 'native'
  }

  /** Whether the browser decodes every stream of the file (asked once, on the first native failure). */
  private browserDecodes(decision: Decision, media: VideoEditMedia): Promise<boolean> {
    if (decision.browser !== 'unknown') return Promise.resolve(decision.browser === 'decodes')
    decision.browserCheck ??= (async () => {
      const probe = this.browser.open(media)
      try { return await (await probe.ready).decodable?.() !== false } catch { return false } finally { this.browser.release(probe.key) }
    })().then(decodes => { decision.browser = decodes ? 'decodes' : 'cannot-decode'; return decodes })
    return decision.browserCheck
  }

  /**
   * A read of the file failed on `failed` (its `attempt`-th try): where it continues, or the error to report. One
   * recovery per read, so a failure on the recovered backend is reported, never looped.
   */
  async recover(decision: Decision, media: VideoEditMedia, failed: VideoEditDecodeBackend, error: unknown, attempt: number): Promise<Recovery> {
    const kind = videoEditNativeFailureKind(error)
    if (failed === 'browser') {
      // The browser is the only reader here (native unavailable or not this file): name the format problem in user
      // language instead of the decoder's own message when the browser cannot decode the file at all.
      if (attempt === 0 && decision.choice === 'browser' && !this.settings.forced && !(await this.browserDecodes(decision, media))) {
        return { error: new Error(`素材「${media.name}」的格式当前无法播放，请重启软件后重试，或先转为 H.264 视频后再导入。`, { cause: error }) }
      }
      return { error }
    }
    if (attempt > 0 || kind === 'closed' || kind === 'budget') return { error }
    const context = { mediaId: media.id, kind, code: videoEditNativeFailureCode(error) ?? null, error: error instanceof Error ? error.message : String(error) }
    if (this.settings.forced !== 'native' && await this.browserDecodes(decision, media)) {
      decision.nativeFailures++
      const retryInMs = Math.min(NATIVE_RETRY_MAX_MS, VIDEO_EDIT_NATIVE_RETRY_MS * 2 ** (decision.nativeFailures - 1))
      decision.nativeRetryAt = this.now() + retryInMs
      if (kind === 'service') this.native?.reset?.(media)
      this.log('warn', '原生解码失败，此素材暂时改用后备解码', 'video_edit.decode.native.fallback', { ...context, retryInMs })
      return { retry: 'browser' }
    }
    // Only native decodes this file: a service failure (exited, hung, lost session, undeliverable frames) is retried
    // once on a new session, which waits for the restarted service; a file failure is reported in place.
    if (kind !== 'service') return { error }
    decision.nativeFailures++
    this.native?.reset?.(media)
    this.log('warn', '原生解码中断，重新打开解码会话', 'video_edit.decode.native.retry', context)
    return { retry: 'native' }
  }

  succeeded(decision: Decision, media: VideoEditMedia, backend: VideoEditDecodeBackend): void {
    if (backend !== 'native' || decision.nativeFailures === 0) return
    this.log('info', '原生解码已恢复', 'video_edit.decode.native.restored', { mediaId: media.id, failures: decision.nativeFailures })
    decision.nativeFailures = 0; decision.nativeRetryAt = 0
  }

  /** Runs one read with recovery: on the current backend, then at most once more where `recover` says. */
  async read<T>(decision: Decision, media: VideoEditMedia, operation: (backend: VideoEditDecodeBackend) => Promise<T>): Promise<T> {
    let backend = this.current(decision)
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await operation(backend)
        this.succeeded(decision, media, backend)
        return result
      } catch (error) {
        const recovery = await this.recover(decision, media, backend, error, attempt)
        if ('error' in recovery) throw recovery.error
        backend = recovery.retry
      }
    }
  }

  /** The browser open made to ask about a file, handed to its first browser source (no second parse). */
  takeProbe(decision: Decision): { key: string; ready: Promise<VideoEditFrameSource> } | undefined {
    const probe = decision.probe; decision.probe = undefined
    return probe
  }

  open(media: VideoEditMedia): { key: string; ready: Promise<VideoEditFrameSource> } {
    const id = `route-${++this.next}`
    this.pending.add(id)
    const decision = this.decide(media)
    const ready = decision.backend.then(async () => {
      this.pending.delete(id)
      if (this.releasedEarly.delete(id)) throw new Error('预览已关闭。')
      const source = new RoutedFileSource(this, decision, media)
      this.opened.set(id, source)
      try { await source.prepare(this.current(decision)) } catch (error) { this.opened.delete(id); source.release(); throw error }
      return source
    }, error => { this.pending.delete(id); this.releasedEarly.delete(id); throw error })
    return { key: id, ready }
  }

  release(key: string): void {
    const source = this.opened.get(key)
    if (source) { this.opened.delete(key); source.release(); return }
    if (this.pending.has(key)) this.releasedEarly.add(key)
  }

  seeker(media: VideoEditMedia, cache: VideoEditFrameCache, snapshot: VideoEditSnapshot): VideoEditFrameSeeker {
    const decision = this.decide(media)
    const seekers = new Map<VideoEditDecodeBackend, VideoEditFrameSeeker>()
    let disposed = false
    const seeker = (backend: VideoEditDecodeBackend): VideoEditFrameSeeker => {
      let value = seekers.get(backend)
      if (!value) { value = this.backend(backend).seeker(media, cache, snapshot); seekers.set(backend, value) }
      return value
    }
    void decision.backend.catch(() => undefined)
    return {
      sample: async (time, direction) => {
        await decision.backend
        if (disposed) throw new Error('预览解码已关闭。')
        return this.read(decision, media, async backend => {
          if (disposed) throw new Error('预览解码已关闭。')
          return seeker(backend).sample(time, direction)
        })
      },
      dispose: async () => { disposed = true; await Promise.allSettled([...seekers.values()].map(value => value.dispose())); seekers.clear() },
    }
  }

  /** Closes a probe whose file was never opened afterwards. */
  dispose(): void {
    for (const decision of this.decisions.values()) if (decision.probe) { this.browser.release(decision.probe.key); decision.probe = undefined }
    this.decisions.clear()
  }
}

/**
 * One opened file and revision behind the router: the sources of both backends, opened when a read first needs them,
 * and the recovery of every read (`VideoEditFrameRouter.read`; generators resume where they stopped).
 */
class RoutedFileSource implements VideoEditFrameSource {
  codec?: string
  private readonly handles = new Map<VideoEditDecodeBackend, { key: string; ready: Promise<VideoEditFrameSource> }>()
  private initial!: { backend: VideoEditDecodeBackend; source: VideoEditFrameSource }
  private released = false

  constructor(private readonly router: VideoEditFrameRouter, private readonly decision: Decision, private readonly media: VideoEditMedia) {}

  /** Opens the backend the first reads use; its answers decide whether the file has pictures and sound at all. */
  async prepare(backend: VideoEditDecodeBackend): Promise<void> {
    this.initial = { backend, source: await this.source(backend) }
    this.codec = this.initial.source.codec
  }

  source(backend: VideoEditDecodeBackend): Promise<VideoEditFrameSource> {
    if (this.released) return Promise.reject(new Error('预览已关闭。'))
    let handle = this.handles.get(backend)
    if (!handle) {
      const opened = (backend === 'browser' ? this.router.takeProbe(this.decision) : undefined) ?? this.router.backend(backend).open(this.media)
      handle = opened
      // A failed open is not kept: a restored or relinked file is opened again by the next read.
      opened.ready.catch(() => { if (this.handles.get(backend) === opened) { this.handles.delete(backend); this.router.backend(backend).release(opened.key) } })
      this.handles.set(backend, opened)
    }
    return handle.ready
  }

  release(): void {
    if (this.released) return
    this.released = true
    for (const [backend, handle] of this.handles) this.router.backend(backend).release(handle.key)
    this.handles.clear()
  }

  clipFrames(): VideoEditClipFrames | undefined {
    const first = this.initial.source.clipFrames()
    if (!first) return undefined
    const readers = new Map<VideoEditDecodeBackend, VideoEditClipFrames | undefined>([[this.initial.backend, first]])
    const reader = async (backend: VideoEditDecodeBackend): Promise<VideoEditClipFrames> => {
      if (!readers.has(backend)) readers.set(backend, (await this.source(backend)).clipFrames())
      const value = readers.get(backend)
      if (!value) throw new Error(`素材「${this.media.name}」没有可解码的视频轨。`)
      return value
    }
    const { router, decision, media } = this
    return {
      frameAt: seconds => router.read(decision, media, async backend => (await reader(backend)).frameAt(seconds)),
      async *frames(start: number): AsyncGenerator<VideoEditDecodedPicture, void, unknown> {
        let backend = router.current(decision)
        // Pictures already handed out are skipped when a recovered reader starts again at the last one.
        let last = -Infinity
        for (let attempt = 0; ;) {
          try {
            let returning = false
            for await (const picture of (await reader(backend)).frames(last > -Infinity ? last : start)) {
              if (picture.timestamp <= last + 1e-7) { picture.close(); continue }
              last = picture.timestamp
              // The first picture a recovered native reader delivers is the recovery (a reader may run for minutes).
              router.succeeded(decision, media, backend)
              yield picture
              // A reader running on the fallback returns to native once the cool-down has passed, like new reads.
              if (router.returnsToNative(decision, backend)) { returning = true; break }
            }
            if (returning) { backend = 'native'; attempt = 0; continue }
            router.succeeded(decision, media, backend)
            return
          } catch (error) {
            const recovery = await router.recover(decision, media, backend, error, attempt++)
            if ('error' in recovery) throw recovery.error
            backend = recovery.retry
          }
        }
      },
    }
  }

  clipAudio(audioStream?: number): VideoEditClipAudio | undefined {
    const first = this.initial.source.clipAudio(audioStream)
    if (!first) return undefined
    const readers = new Map<VideoEditDecodeBackend, VideoEditClipAudio | undefined>([[this.initial.backend, first]])
    const reader = async (backend: VideoEditDecodeBackend): Promise<VideoEditClipAudio | undefined> => {
      if (!readers.has(backend)) readers.set(backend, (await this.source(backend)).clipAudio(audioStream))
      return readers.get(backend)
    }
    const { router, decision, media } = this
    return {
      async *chunks(startSeconds: number, endSeconds: number, sampleRate?: number): AsyncGenerator<VideoEditAudioChunk, void, unknown> {
        let backend = router.current(decision)
        for (let attempt = 0; ; attempt++) {
          // A mix reads at most one second; a native read yields one block, so a failure comes before anything is mixed.
          let yielded = false
          try {
            const current = await reader(backend)
            if (current) for await (const chunk of current.chunks(startSeconds, endSeconds, sampleRate)) { yielded = true; yield chunk }
            router.succeeded(decision, media, backend)
            return
          } catch (error) {
            if (yielded) throw error
            const recovery = await router.recover(decision, media, backend, error, attempt)
            if ('error' in recovery) throw recovery.error
            backend = recovery.retry
          }
        }
      },
      close(): void { for (const value of readers.values()) value?.close?.(); readers.clear() },
    }
  }

  async *schedule(timestamps: readonly number[], signal?: AbortSignal): AsyncGenerator<VideoEditDecodedPicture | null, void, unknown> {
    const { router, decision, media } = this
    let backend = router.current(decision)
    // One answer per time: a recovered plan continues with the times not answered yet.
    let index = 0
    for (let attempt = 0; ;) {
      try {
        let returning = false
        for await (const picture of (await this.source(backend)).schedule(index ? timestamps.slice(index) : timestamps, signal)) {
          index++
          if (picture) router.succeeded(decision, media, backend)
          yield picture
          if (index < timestamps.length && router.returnsToNative(decision, backend)) { returning = true; break }
        }
        if (returning) { backend = 'native'; attempt = 0; continue }
        router.succeeded(decision, media, backend)
        return
      } catch (error) {
        if (signal?.aborted) return
        const recovery = await router.recover(decision, media, backend, error, attempt++)
        if ('error' in recovery) throw recovery.error
        backend = recovery.retry
      }
    }
  }
}

