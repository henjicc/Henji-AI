import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoFrameDecoderInfo, VideoFrameScheduleEvent, VideoFrameStreamEndedPayload } from '@/platform/contracts/videoFrames'
import type { VideoEditFrameCache } from './videoEditFrameCache'
import type { VideoEditClipAudio, VideoEditClipFrames, VideoEditFrameBackend, VideoEditFrameSeeker, VideoEditFrameSource, VideoEditSnapshot } from './videoEditFrameSource'
import { VideoEditGpuFrame, videoEditGpuFrameUsesChroma } from './videoEditGpuFrame'
import { VideoEditNativePicture, videoEditNativeRotation } from './videoEditNativePicture'
import type { NativeVideoFrame, VideoEditNativeFrameReceiver } from './videoEditNativeFrames'
import { videoEditSourceReadError } from './videoEditSourceErrors'

/**
 * The native frame backend (task 2.2): pictures decoded by the native decoder service arrive as borrowed shared GPU
 * textures over the render worker's frame channel and enter owned memory through `snapshot()` like browser pictures.
 *
 * Sessions per opened file (path + revision), all opened on first use:
 * - one `playback` session for forward playback schedules (one long-lived decoder, cuts continue without flushing,
 *   exact microsecond timestamps; a new schedule cancels the previous one);
 * - one `seek` session shared by single-frame reads and the seeker, whose operations run one at a time;
 * - one `playback` session per sequential reader (`frames(start)`), closed with the reader.
 * Sound is not decoded natively yet (task 2.3 stage B): `clipAudio()` is undefined, so a file played by this backend
 * is silent until then (files the browser decodes completely stay on the browser for picture and sound).
 */

/** Worker-side access to native decoder sessions: port requests and borrowed frames over one frame channel. */
export type VideoEditNativeChannel = Pick<VideoEditNativeFrameReceiver, 'call' | 'subscribe' | 'subscribeSchedule' | 'subscribeEnded'>

/** Conservative per-renderer session limit until the resource budget of task 3.1 (the bridge allows 16 per window). */
export const VIDEO_EDIT_NATIVE_MAX_SESSIONS = 10
/** The native service accepts at most this many times per schedule; later frames use the regular path. */
const MAX_SCHEDULE_TIMES = 200_000
/**
 * A plan item whose frame has not arrived although a later item or the end of the plan has: frames and plan events
 * travel on different channels, so give the frame this long, then treat it as missing (a lost frame must not stall
 * playback).
 */
const LOST_FRAME_GRACE_MS = 1000
/** How long a single-frame read waits for its frame after the service confirmed it. */
const FRAME_ARRIVAL_TIMEOUT_MS = 5000
/** Seek windows of long-GOP material: decoded once into the shared frame cache, like the browser's GOP ranges. */
export const VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS = 1

type Plan = { times: readonly number[] } | { range: { from: number; to?: number } }
interface Consumer { frames: Map<number, NativeVideoFrame>; missing: Set<number>; highest: number; done?: { reason: string; delivered?: number; at: number }; wake?: () => void }
interface Ticket { deliver: (frame: NativeVideoFrame) => void; fail: (error: Error) => void }

function decodeFailure(name: string, error: unknown): Error {
  return new Error(`素材「${name}」解码失败，请确认文件可用，或在项目素材中重新定位源文件。`, { cause: error })
}

/** One native decoder session (a native stream) and the routing of its frames and plan events. */
export class VideoEditNativeDecoderSession {
  private readonly consumers = new Map<string, Consumer>()
  private readonly tickets = new Map<string, Ticket>()
  private readonly unsubscribe: () => void
  private ended?: Error
  private closing?: Promise<void>
  private next = 0
  readonly rotation
  private readonly frameDuration: number

  constructor(private readonly channel: VideoEditNativeChannel, readonly info: VideoFrameDecoderInfo, private readonly name: string, private readonly onClosed: () => void) {
    const frames = channel.subscribe(info.streamId, frame => this.onFrame(frame))
    const events = channel.subscribeSchedule(info.streamId, event => this.onEvent(event))
    const ended = channel.subscribeEnded(info.streamId, payload => this.onEnded(payload))
    this.unsubscribe = () => { frames(); events(); ended() }
    this.rotation = videoEditNativeRotation(info.rotationDegrees)
    this.frameDuration = info.fps > 0 ? 1 / info.fps : 1 / 30
  }

  get intraOnly(): boolean { return this.info.decoder.intraOnly }

  private picture(frame: NativeVideoFrame): VideoEditNativePicture { return new VideoEditNativePicture(frame, this.rotation, this.frameDuration) }

  private onFrame(frame: NativeVideoFrame): void {
    const tag = frame.meta.request
    if (!this.closing && tag?.kind === 'schedule') {
      const consumer = this.consumers.get(tag.id)
      if (consumer && !consumer.frames.has(tag.index)) { consumer.frames.set(tag.index, frame); consumer.highest = Math.max(consumer.highest, tag.index); consumer.wake?.(); return }
    } else if (!this.closing && tag?.kind === 'frame_at') {
      const ticket = this.tickets.get(tag.id)
      if (ticket) { this.tickets.delete(tag.id); ticket.deliver(frame); return }
    }
    // Superseded, cancelled or unknown: hand it straight back so the native pool slot is free again.
    frame.release()
  }

  private onEvent(event: VideoFrameScheduleEvent): void {
    const consumer = this.consumers.get(event.scheduleId)
    if (!consumer) return
    if (event.type === 'frame_missing') { consumer.missing.add(event.index); consumer.highest = Math.max(consumer.highest, event.index) }
    else consumer.done = { reason: event.reason, at: performance.now(), ...(event.delivered !== undefined ? { delivered: event.delivered } : {}) }
    consumer.wake?.()
  }

  private onEnded(payload: VideoFrameStreamEndedPayload): void {
    this.ended = decodeFailure(this.name, new Error(payload.message ?? payload.reason))
    this.fail(this.ended)
  }

  private fail(error: Error): void {
    for (const consumer of this.consumers.values()) { consumer.done ??= { reason: 'error', at: performance.now() }; consumer.wake?.() }
    for (const ticket of this.tickets.values()) ticket.fail(error)
    this.tickets.clear()
  }

  /** The picture showing at `time`, or null when the file has none there. */
  async frameAt(time: number): Promise<VideoEditNativePicture | null> {
    if (this.closing || this.ended) throw this.ended ?? new Error('预览解码已关闭。')
    const ticket = `t${++this.next}`
    let ticketEntry!: Ticket
    const arrived = new Promise<NativeVideoFrame>((deliver, fail) => { ticketEntry = { deliver, fail } })
    void arrived.catch(() => undefined)
    this.tickets.set(ticket, ticketEntry)
    let taken = false
    try {
      const result = await this.channel.call('frameAt', { streamId: this.info.streamId, time, ticket }).catch(error => { throw decodeFailure(this.name, error) })
      if (!result.found) return null
      let timer: ReturnType<typeof setTimeout> | undefined
      const frame = await Promise.race([arrived, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(decodeFailure(this.name, new Error('原生帧未送达'))), FRAME_ARRIVAL_TIMEOUT_MS) })]).finally(() => clearTimeout(timer))
      taken = true
      return this.picture(frame)
    } finally {
      this.tickets.delete(ticket)
      // A frame that arrived (or arrives) for an abandoned read goes straight back.
      if (!taken) void arrived.then(frame => frame.release(), () => undefined)
    }
  }

  /**
   * Runs one plan. `times`: exactly one picture or null per time, in order. `range`: every picture from the one
   * showing at `from` up to `to`, in order. Aborting (or returning the generator) cancels the plan.
   */
  async *run(plan: Plan, signal?: AbortSignal): AsyncGenerator<VideoEditNativePicture | null, void, unknown> {
    if (this.closing || this.ended) throw this.ended ?? new Error('预览解码已关闭。')
    const scheduleId = `s${++this.next}`
    const consumer: Consumer = { frames: new Map(), missing: new Set(), highest: -1 }
    this.consumers.set(scheduleId, consumer)
    const abort = (): void => consumer.wake?.()
    signal?.addEventListener('abort', abort)
    const times = 'times' in plan ? plan.times.slice(0, MAX_SCHEDULE_TIMES) : undefined
    try {
      await this.channel.call('schedule', { streamId: this.info.streamId, scheduleId, ...(times ? { times: [...times] } : { range: { ...('range' in plan ? plan.range : { from: 0 }) } }) })
        .catch(error => { throw decodeFailure(this.name, error) })
      for (let index = 0; times === undefined || index < times.length; index++) {
        const outcome = await this.take(consumer, index, times !== undefined, signal)
        if (outcome === 'end') break
        if (outcome === 'missing') { if (times) yield null; continue }
        yield this.picture(outcome)
      }
      if (times && 'times' in plan) for (let index = times.length; index < plan.times.length && !signal?.aborted; index++) yield null
      if (consumer.done?.reason === 'error' && times === undefined && !signal?.aborted) throw this.ended ?? decodeFailure(this.name, new Error('连续取帧失败'))
    } finally {
      signal?.removeEventListener('abort', abort)
      this.consumers.delete(scheduleId)
      for (const frame of consumer.frames.values()) frame.release()
      consumer.frames.clear()
      if (!consumer.done && !this.closing && !this.ended) void this.channel.call('cancelSchedule', { streamId: this.info.streamId, scheduleId }).catch(() => undefined)
    }
  }

  /**
   * The outcome of plan item `index`. A range plan delivers consecutive indices, so its end is known from the number
   * the plan delivered. Frames travel separately from plan events: an item whose frame has not arrived although the
   * plan ended or a later item arrived gets a grace period (counted once from the end of the plan, so a failed plan
   * does not wait per item), then counts as missing.
   */
  private async take(consumer: Consumer, index: number, timed: boolean, signal?: AbortSignal): Promise<NativeVideoFrame | 'missing' | 'end'> {
    let lostSince: number | undefined
    for (;;) {
      if (signal?.aborted) return 'end'
      const frame = consumer.frames.get(index)
      if (frame) { consumer.frames.delete(index); return frame }
      if (consumer.missing.has(index)) return 'missing'
      const done = consumer.done
      let deadline: number | undefined
      if (done) {
        if (!timed && (done.delivered !== undefined ? index >= done.delivered : done.reason !== 'completed')) return 'end'
        deadline = done.at + LOST_FRAME_GRACE_MS
      } else if (consumer.highest > index) { lostSince ??= performance.now(); deadline = lostSince + LOST_FRAME_GRACE_MS }
      if (deadline !== undefined && performance.now() >= deadline) return timed || !done ? 'missing' : 'end'
      await new Promise<void>(resolve => {
        const timer = deadline === undefined ? undefined : setTimeout(resolve, Math.max(0, deadline - performance.now()))
        consumer.wake = () => { clearTimeout(timer); consumer.wake = undefined; resolve() }
      })
      consumer.wake = undefined
    }
  }

  /** Stops the native stream; frames still borrowed by pictures come back as their owners close them. */
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.unsubscribe()
      for (const consumer of this.consumers.values()) { consumer.done ??= { reason: 'cancelled', at: performance.now() - LOST_FRAME_GRACE_MS }; consumer.wake?.() }
      for (const ticket of this.tickets.values()) ticket.fail(new Error('预览解码已关闭。'))
      this.tickets.clear()
      await this.channel.call('closeStream', { streamId: this.info.streamId }).catch(() => undefined)
      this.onClosed()
    })()
    return this.closing
  }
}

/** Runs seek-session operations one at a time; a foreground operation preempts speculative ones. */
class NativeSeekLane {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly speculative = new Set<AbortController>()
  run<T>(operation: (signal: AbortSignal) => Promise<T>, speculative = false): Promise<T> {
    if (!speculative) for (const controller of this.speculative) controller.abort()
    const controller = new AbortController()
    if (speculative) this.speculative.add(controller)
    const result = this.tail.catch(() => undefined).then(() => operation(controller.signal)).finally(() => this.speculative.delete(controller))
    this.tail = result
    return result
  }
  cancelSpeculative(): void { for (const controller of this.speculative) controller.abort() }
}

/** One opened file and revision on the native backend. */
export class VideoEditNativeFileSource implements VideoEditFrameSource {
  readonly codec = undefined
  readonly lane = new NativeSeekLane()
  private playback?: Promise<VideoEditNativeDecoderSession>
  private seekSession?: Promise<VideoEditNativeDecoderSession>
  private closed = false

  constructor(private readonly owner: VideoEditNativeFrames, readonly media: VideoEditMedia, private readonly path: string) {}

  private session(purpose: 'playback' | 'seek'): Promise<VideoEditNativeDecoderSession> {
    if (this.closed) return Promise.reject(new Error('预览解码已关闭。'))
    const field = purpose === 'playback' ? 'playback' : 'seekSession'
    let pending = this[field]
    if (!pending) {
      pending = this.owner.openSession(this.media, this.path, purpose)
      // A failed open is not kept: a restored file is read again.
      pending.catch(() => { if (this[field] === pending) this[field] = undefined })
      this[field] = pending
    }
    return pending
  }

  /** The shared single-frame session (also used by the seeker); opened on first use. */
  seek(): Promise<VideoEditNativeDecoderSession> { return this.session('seek') }

  clipFrames(): VideoEditClipFrames | undefined {
    if (this.media.kind !== 'video') return undefined
    return {
      frames: start => this.frames(start),
      frameAt: seconds => this.lane.run(async () => (await this.seek()).frameAt(seconds)),
    }
  }

  // Native sound decoding arrives with task 2.3 stage B; until then a file on this backend is silent.
  clipAudio(): VideoEditClipAudio | undefined { return undefined }

  async *schedule(timestamps: readonly number[]): AsyncGenerator<VideoEditNativePicture | null, void, unknown> {
    if (this.media.kind !== 'video') return
    yield* (await this.session('playback')).run({ times: timestamps })
  }

  private async *frames(start: number): AsyncGenerator<VideoEditNativePicture, void, unknown> {
    const session = await this.owner.openSession(this.media, this.path, 'playback')
    try {
      for await (const picture of session.run({ range: { from: start } })) if (picture) yield picture
    } finally { await session.close() }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.lane.cancelSpeculative()
    await Promise.allSettled([this.playback, this.seekSession].map(async pending => (await pending)?.close()))
  }
}

export interface VideoEditNativeFramesOptions {
  channel: VideoEditNativeChannel
  /** The local file the native service reads for a media item (its path in the worker is a fetchable URL). */
  localPath(media: VideoEditMedia): string | undefined
  maxSessions?: number
  /** A session of this file could not be opened (the router may choose another backend for later opens). */
  onFailure?(media: VideoEditMedia, error: unknown): void
}

/** The native frame backend of one renderer. */
export class VideoEditNativeFrames implements VideoEditFrameBackend {
  private readonly files = new Map<string, { users: number; source: VideoEditNativeFileSource }>()
  private readonly closing = new Set<Promise<void>>()
  private sessions = 0

  constructor(private readonly options: VideoEditNativeFramesOptions) {}

  /** Whether the native service can be asked to read this media item at all. */
  reads(media: VideoEditMedia): boolean { return media.kind !== 'image' && !!this.options.localPath(media) }

  /** Opens a native decoder session, counted against the per-renderer limit. */
  async openSession(media: VideoEditMedia, path: string, purpose: 'playback' | 'seek'): Promise<VideoEditNativeDecoderSession> {
    const limit = this.options.maxSessions ?? VIDEO_EDIT_NATIVE_MAX_SESSIONS
    if (this.sessions >= limit) throw new Error('同时读取的视频素材过多，请减少同时显示的视频后重试。')
    this.sessions++
    try {
      const info = await this.options.channel.call('openDecoder', { path, purpose })
      return new VideoEditNativeDecoderSession(this.options.channel, info, media.name, () => { this.sessions-- })
    } catch (error) { this.sessions--; this.options.onFailure?.(media, error); throw videoEditSourceReadError(media.name, error) }
  }

  /** The shared file source with one more user; pair with `release(key)`. */
  acquire(media: VideoEditMedia): { key: string; source: VideoEditNativeFileSource } {
    const key = `${media.path}\u0000${media.sourceRevision ?? ''}`
    let entry = this.files.get(key)
    if (!entry) {
      const path = this.options.localPath(media)
      if (!path) throw videoEditSourceReadError(media.name, new Error('没有本地源文件路径'))
      entry = { users: 0, source: new VideoEditNativeFileSource(this, media, path) }
      this.files.set(key, entry)
    }
    entry.users++
    return { key, source: entry.source }
  }

  open(media: VideoEditMedia): { key: string; ready: Promise<VideoEditFrameSource> } {
    try {
      const { key, source } = this.acquire(media)
      return { key, ready: Promise.resolve(source) }
    } catch (error) {
      return { key: '', ready: Promise.reject(error) }
    }
  }

  release(key: string): void {
    const entry = this.files.get(key)
    if (!entry || --entry.users > 0) return
    this.files.delete(key)
    const closing = entry.source.close().finally(() => this.closing.delete(closing))
    this.closing.add(closing)
  }

  seeker(media: VideoEditMedia, cache: VideoEditFrameCache, snapshot: VideoEditSnapshot): VideoEditFrameSeeker {
    return new VideoEditNativeSeeker(this, media, cache, snapshot)
  }

  /** Resolves when every session closed by released sources has stopped (before the frame channel closes). */
  async settled(): Promise<void> { while (this.closing.size) await Promise.allSettled([...this.closing]) }

  get openSessions(): number { return this.sessions }
}

interface SeekWaiter { time: number; resolve: (frame: VideoEditGpuFrame | undefined) => void; reject: (error: Error) => void }
interface SeekWindow { start: number; speculative: boolean; waiters: Set<SeekWaiter>; abort: AbortController; done: Promise<void> }

/**
 * Exact-frame seeking on the native backend with decoded pictures kept in the renderer's shared frame cache.
 * Intra-frame material (ProRes, DNxHR, CineForm) reads the requested picture directly. Long-GOP material decodes
 * one-second windows into the cache, so stepping and reverse scrubbing reuse decoded pictures the way the browser
 * seeker reuses whole GOPs; consecutive forward windows continue the decoder without seeking, and a scrub direction
 * prefetches the neighbouring window while the session is idle.
 */
export class VideoEditNativeSeeker implements VideoEditFrameSeeker {
  private opened?: { key: string; source: VideoEditNativeFileSource }
  private readonly windows = new Map<number, SeekWindow>()
  private disposed = false
  private failure?: Error
  private direction = 0

  constructor(private readonly backend: VideoEditNativeFrames, private readonly media: VideoEditMedia, private readonly cache: VideoEditFrameCache, private readonly snapshot: VideoEditSnapshot) {}

  private get path(): string { return this.media.path }
  private cached(time: number): VideoEditGpuFrame | undefined { return (this.cache.get(this.path, time) as VideoEditGpuFrame | undefined)?.clone() }
  private source(): VideoEditNativeFileSource { this.opened ??= this.backend.acquire(this.media); return this.opened.source }

  private async normalize(picture: VideoEditNativePicture): Promise<VideoEditGpuFrame> {
    try { return await this.snapshot(picture, videoEditGpuFrameUsesChroma(picture)) } finally { picture.close() }
  }

  async sample(time: number, direction: number): Promise<{ sample?: VideoEditGpuFrame; hit: boolean }> {
    if (this.disposed) throw new Error('预览解码已关闭。')
    if (this.failure) throw this.failure
    const source = this.source()
    const changed = Math.sign(direction) !== this.direction
    this.direction = Math.sign(direction)
    if (direction === 0 || changed) this.cancelSpeculative()
    const cached = this.cached(time)
    if (cached) { if (direction !== 0) this.prefetch(source, time, direction); return { sample: cached, hit: true } }
    const session = await source.seek()
    if (this.disposed) throw new Error('预览解码已关闭。')
    if (session.intraOnly) {
      // Every picture is a key frame: read exactly the requested one.
      const picture = await source.lane.run(() => session.frameAt(time))
      if (this.disposed) { picture?.close(); throw new Error('预览解码已关闭。') }
      if (!picture) return { hit: false }
      const copy = await this.normalize(picture)
      this.cache.put(this.path, copy.clone(), new Set())
      return { sample: copy, hit: false }
    }
    const already = this.cached(time)
    if (already) return { sample: already, hit: true }
    const window = this.window(source, Math.floor(time / VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS) * VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS, false)
    return { sample: await new Promise<VideoEditGpuFrame | undefined>((resolve, reject) => window.waiters.add({ time, resolve, reject })), hit: false }
  }

  private cancelSpeculative(): void {
    for (const window of this.windows.values()) if (window.speculative && !window.waiters.size) window.abort.abort()
  }

  private prefetch(source: VideoEditNativeFileSource, time: number, direction: number): void {
    const width = VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS
    const start = Math.floor(time / width) * width + (direction > 0 ? width : -width)
    if (start < 0 || start >= this.media.durationSeconds || this.windows.has(start) || this.windows.size >= 2) return
    // Only when the session is already open (a scrub has started) and the neighbour is not cached yet.
    void source.seek().then(session => {
      if (this.disposed || this.failure || session.intraOnly || this.windows.has(start) || this.windows.size >= 2) return
      if (this.cache.get(this.path, direction > 0 ? start + 1e-6 : start + width - 1e-6)) return
      this.window(source, start, true)
    }, () => undefined)
  }

  private window(source: VideoEditNativeFileSource, start: number, speculative: boolean): SeekWindow {
    const existing = this.windows.get(start)
    if (existing) { if (!speculative) existing.speculative = false; return existing }
    if (!speculative) this.cancelSpeculative()
    const window: SeekWindow = { start, speculative, waiters: new Set(), abort: new AbortController(), done: Promise.resolve() }
    this.windows.set(start, window)
    const deliver = (frame: VideoEditGpuFrame): void => {
      for (const waiter of window.waiters) if (waiter.time >= frame.timestamp - 1e-7 && waiter.time < frame.timestamp + frame.duration - 1e-7) { window.waiters.delete(waiter); waiter.resolve(frame.clone()) }
    }
    window.done = source.lane.run(async lane => {
      const stop = (): void => window.abort.abort()
      lane.addEventListener('abort', () => { if (!window.waiters.size) stop() }, { once: true })
      if (window.abort.signal.aborted) return
      const session = await source.seek()
      for await (const picture of session.run({ range: { from: start, to: start + VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS } }, window.abort.signal)) {
        if (!picture) continue
        if (this.disposed || window.abort.signal.aborted) { picture.close(); break }
        const copy = await this.normalize(picture)
        if (this.disposed) { copy.close(); break }
        deliver(copy)
        this.cache.put(this.path, copy, new Set())
      }
    }, speculative).then(() => {
      for (const waiter of window.waiters) waiter.resolve(this.cached(waiter.time))
    }, error => {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (!this.disposed && !window.abort.signal.aborted) this.failure = failure
      for (const waiter of window.waiters) waiter.reject(this.disposed ? new Error('预览解码已关闭。') : failure)
    }).finally(() => {
      window.waiters.clear()
      if (this.windows.get(start) === window) this.windows.delete(start)
    })
    return window
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const window of this.windows.values()) { window.abort.abort(); for (const waiter of window.waiters) waiter.reject(new Error('预览解码已关闭。')); window.waiters.clear() }
    await Promise.allSettled([...this.windows.values()].map(window => window.done))
    this.windows.clear()
    if (this.opened) this.backend.release(this.opened.key)
    this.opened = undefined
    this.cache.deleteMedia(this.path)
  }
}
