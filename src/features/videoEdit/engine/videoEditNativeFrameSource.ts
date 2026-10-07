import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoFrameDecoderInfo, VideoFrameScheduleEvent, VideoFrameStreamEndedPayload } from '@/platform/contracts/videoFrames'
import type { VideoEditFrameCache } from './videoEditFrameCache'
import { VIDEO_EDIT_NATIVE_SOUND_READY, type VideoEditClipAudio, type VideoEditClipFrames, type VideoEditFrameBackend, type VideoEditFrameSeeker, type VideoEditFrameSource, type VideoEditSnapshot } from './videoEditFrameSource'
import { createVideoEditNativeClipAudio, openVideoEditNativePcm, type VideoEditPcmSession } from './videoEditNativeAudio'
import { VideoEditGpuFrame, videoEditGpuFrameUsesChroma } from './videoEditGpuFrame'
import { VideoEditNativePicture, videoEditNativeRotation } from './videoEditNativePicture'
import type { NativeVideoFrame, VideoEditNativeFrameReceiver } from './videoEditNativeFrames'
import { videoEditSourceReadError } from './videoEditSourceErrors'
import { VideoEditNativeFailure, videoEditNativeClosed, videoEditNativeFailureKind, videoEditNativeFailureKindOf, videoEditNativeFailureMessage, videoEditNativeOpenFailure, videoEditNativeReadFailure } from './videoEditNativeFailure'

/**
 * The native frame backend (task 2.2): pictures decoded by the native decoder service arrive as borrowed shared GPU
 * textures over the render worker's frame channel and enter owned memory through `snapshot()` like browser pictures.
 *
 * Sessions per opened file (path + revision), all opened on first use:
 * - one `playback` session for forward playback schedules (one long-lived decoder, cuts continue without flushing,
 *   exact microsecond timestamps; a new schedule cancels the previous one);
 * - one `seek` session shared by single-frame reads and the seeker, whose operations run one at a time;
 * - one `playback` session per sequential reader (`frames(start)`), closed with the reader;
 * - one sound session per clip sound reader (`clipAudio()`, task 2.3), opened on its first read at the mix's sample
 *   rate and closed with the reader. Sound sessions carry no textures and do not count against the session limit.
 */

/** Worker-side access to native decoder sessions: port requests and borrowed frames over one frame channel. */
export type VideoEditNativeChannel = Pick<VideoEditNativeFrameReceiver, 'call' | 'subscribe' | 'subscribeSchedule' | 'subscribeEnded'>

/**
 * Native decoder sessions per renderer (task 3.1 budget): below the frame bridge's 16 streams per window, so a window's
 * program and source monitor together stay within the service's 32 sessions; the service also budgets video memory
 * and hardware decoders across all windows (`native/video-decoder/src/budget.rs`). Beyond it reads fail in place.
 */
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
/** How long a file failure of a seek window answers further reads before they try the file again (task 3.1). */
const FILE_FAILURE_HOLD_MS = 2000
/** Seek windows of long-GOP material: decoded once into the shared frame cache, like the browser's GOP ranges. */
export const VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS = 1

type Plan = { times: readonly number[] } | { range: { from: number; to?: number } }
interface Consumer { frames: Map<number, NativeVideoFrame>; missing: Set<number>; highest: number; done?: { reason: string; delivered?: number; at: number }; wake?: () => void }
interface Ticket { deliver: (frame: NativeVideoFrame) => void; fail: (error: Error) => void }

const decodeFailure = videoEditNativeReadFailure
const closedFailure = (): VideoEditNativeFailure => videoEditNativeClosed()

/** One native decoder session (a native stream) and the routing of its frames and plan events. */
export class VideoEditNativeDecoderSession {
  private readonly consumers = new Map<string, Consumer>()
  private readonly tickets = new Map<string, Ticket>()
  private readonly unsubscribe: () => void
  private ended?: VideoEditNativeFailure
  private readonly endedListeners = new Set<() => void>()
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

  /** False once the native stream ended (service exited, frames could not be delivered) or the session closed. */
  get alive(): boolean { return !this.ended && !this.closing }

  /** Called once when the native stream ends; the owner drops the session so the next read opens a new one. */
  whenEnded(listener: () => void): void {
    if (this.ended) listener(); else this.endedListeners.add(listener)
  }

  private picture(frame: NativeVideoFrame): VideoEditNativePicture { return new VideoEditNativePicture(frame, this.rotation, this.frameDuration, { bitDepth: this.info.decoder.bitDepth, hasAlpha: this.info.decoder.hasAlpha }) }

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
    // A stream that ends while open always ended by a failure: the service exited, or its frames could not reach
    // this worker (import/delivery failure). Both are service failures; no further frame or plan event comes.
    const code = payload.code ?? (payload.reason === 'service_exited' ? 'PROCESS_EXITED' : undefined)
    const kind = payload.code ? videoEditNativeFailureKindOf(code) : 'service'
    this.ended = new VideoEditNativeFailure(videoEditNativeFailureMessage(this.name, kind), kind, code, { cause: new Error(payload.message ?? payload.reason) })
    this.fail(this.ended)
    for (const listener of this.endedListeners) listener()
    this.endedListeners.clear()
  }

  private fail(error: Error): void {
    for (const consumer of this.consumers.values()) { consumer.done ??= { reason: 'error', at: performance.now() }; consumer.wake?.() }
    for (const ticket of this.tickets.values()) ticket.fail(error)
    this.tickets.clear()
  }

  /** The picture showing at `time`, or null when the file has none there. */
  async frameAt(time: number): Promise<VideoEditNativePicture | null> {
    if (this.closing || this.ended) throw this.ended ?? closedFailure()
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
   * showing at `from` up to `to`, in order, with null where a decoded picture never arrived (so a reader does not
   * stretch the previous picture over it). Aborting (or returning the generator) cancels the plan. `outcome.completed`
   * tells whether the service finished the whole plan (a range reached `to` or the end of the file), as opposed to
   * stopping early (cancelled, interrupted, failed).
   */
  async *run(plan: Plan, signal?: AbortSignal, outcome?: { completed: boolean }): AsyncGenerator<VideoEditNativePicture | null, void, unknown> {
    if (this.closing || this.ended) throw this.ended ?? closedFailure()
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
        const item = await this.take(consumer, index, times !== undefined, signal)
        if (item === 'end') break
        if (item === 'missing') { yield null; continue }
        yield this.picture(item)
      }
      if (outcome) outcome.completed = consumer.done?.reason === 'completed' && !signal?.aborted && !this.ended
      // A stream that ended (service exited, frames undeliverable) fails the plan instead of answering every remaining
      // time with "no picture": the router recovers it on a new session or another backend (task 3.1).
      if (this.ended && !signal?.aborted) throw this.ended
      if (times && 'times' in plan) for (let index = times.length; index < plan.times.length && !signal?.aborted; index++) yield null
      if (consumer.done?.reason === 'error' && times === undefined && !signal?.aborted) throw decodeFailure(this.name, new Error('连续取帧失败'), 'file')
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
      // Nothing more comes from an ended stream: no grace period.
      if (this.ended) return 'end'
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

  /**
   * Stops the native stream; frames still borrowed by pictures come back as their owners close them. `reason`
   * `service`: the router reset the session after a failure, so waiting reads fail as retryable (task 3.1).
   */
  close(reason: 'closed' | 'service' = 'closed'): Promise<void> {
    // A reset fails plans and reads in progress (instead of answering "no picture"), so they recover too.
    if (reason === 'service' && !this.closing) this.ended ??= videoEditNativeClosed('service')
    this.closing ??= (async () => {
      this.unsubscribe()
      for (const consumer of this.consumers.values()) { consumer.done ??= { reason: 'cancelled', at: performance.now() - LOST_FRAME_GRACE_MS }; consumer.wake?.() }
      for (const ticket of this.tickets.values()) ticket.fail(videoEditNativeClosed(reason))
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
    if (this.closed) return Promise.reject(closedFailure())
    const field = purpose === 'playback' ? 'playback' : 'seekSession'
    let pending = this[field]
    if (!pending) {
      const opening = this.owner.openSession(this.media, this.path, purpose)
      // A failed open is not kept (a restored file is read again), nor is a session whose stream ended: the next
      // read opens a new one on the restarted service (task 3.1).
      opening.then(session => session.whenEnded(() => { if (this[field] === opening) this[field] = undefined }), () => { if (this[field] === opening) this[field] = undefined })
      this[field] = pending = opening
    }
    return pending
  }

  /** The shared single-frame session (also used by the seeker); opened on first use. */
  seek(): Promise<VideoEditNativeDecoderSession> { return this.session('seek') }

  /**
   * Drops this file's shared sessions after a failure (task 3.1): reads waiting on them fail as retryable, and the
   * next read opens new sessions. A session that timed out may still be alive natively; closing it stops it.
   */
  reset(): void {
    const sessions = [this.playback, this.seekSession]
    this.playback = undefined; this.seekSession = undefined
    this.lane.cancelSpeculative()
    for (const pending of sessions) void pending?.then(session => session.close('service'), () => undefined)
  }

  clipFrames(): VideoEditClipFrames | undefined {
    if (this.media.kind !== 'video') return undefined
    return {
      frames: start => this.frames(start),
      frameAt: seconds => this.lane.run(async () => (await this.seek()).frameAt(seconds)),
    }
  }

  /** The `audioStream`-th sound stream of the file (default the first; task 2.6 opens the others by their number). */
  clipAudio(audioStream?: number): VideoEditClipAudio | undefined {
    if (!this.owner.sound || this.media.kind === 'image' || (this.media.kind === 'video' && this.media.hasAudio === false)) return undefined
    return createVideoEditNativeClipAudio(sampleRate => this.owner.openSound(this.media, this.path, sampleRate, audioStream))
  }

  async *schedule(timestamps: readonly number[], signal?: AbortSignal): AsyncGenerator<VideoEditNativePicture | null, void, unknown> {
    if (this.media.kind !== 'video') return
    yield* (await this.session('playback')).run({ times: timestamps }, signal)
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
  /** Whether sound is decoded natively (default `VIDEO_EDIT_NATIVE_SOUND_READY`). */
  sound?: boolean
}

/** The native frame backend of one renderer. */
export class VideoEditNativeFrames implements VideoEditFrameBackend {
  private readonly files = new Map<string, { users: number; source: VideoEditNativeFileSource }>()
  private readonly closing = new Set<Promise<void>>()
  private sessions = 0

  constructor(private readonly options: VideoEditNativeFramesOptions) {}

  /** Whether the native service can be asked to read this media item at all. */
  reads(media: VideoEditMedia): boolean { return media.kind !== 'image' && !!this.options.localPath(media) }

  get sound(): boolean { return this.options.sound ?? VIDEO_EDIT_NATIVE_SOUND_READY }

  /** Opens the sound session of one clip reader; null when the file has no sound stream. */
  openSound(media: VideoEditMedia, path: string, sampleRate: number | undefined, audioStream?: number): Promise<VideoEditPcmSession | null> {
    return openVideoEditNativePcm(this.options.channel, path, media.name, { ...(sampleRate !== undefined ? { sampleRate } : {}), ...(audioStream !== undefined ? { audioStream } : {}) })
  }

  /** Opens a native decoder session, counted against the per-renderer limit (an exceeded budget is a `budget` failure). */
  async openSession(media: VideoEditMedia, path: string, purpose: 'playback' | 'seek'): Promise<VideoEditNativeDecoderSession> {
    const limit = this.options.maxSessions ?? VIDEO_EDIT_NATIVE_MAX_SESSIONS
    if (this.sessions >= limit) throw new VideoEditNativeFailure(videoEditNativeFailureMessage(media.name, 'budget'), 'budget', 'BUDGET_EXCEEDED')
    this.sessions++
    try {
      const info = await this.options.channel.call('openDecoder', { path, purpose })
      return new VideoEditNativeDecoderSession(this.options.channel, info, media.name, () => { this.sessions-- })
    } catch (error) { this.sessions--; throw videoEditNativeOpenFailure(media.name, error) }
  }

  /** Drops the shared sessions of a file after a failure so the next read opens new ones (router recovery, 3.1). */
  reset(media: VideoEditMedia): void { this.files.get(`${media.path}\u0000${media.sourceRevision ?? ''}`)?.source.reset() }

  /** The shared file source with one more user; pair with `release(key)`. */
  acquire(media: VideoEditMedia): { key: string; source: VideoEditNativeFileSource } {
    const key = `${media.path}\u0000${media.sourceRevision ?? ''}`
    let entry = this.files.get(key)
    if (!entry) {
      const path = this.options.localPath(media)
      if (!path) throw new VideoEditNativeFailure(videoEditSourceReadError(media.name, new Error('没有本地源文件路径')).message, 'file', 'UNAUTHORIZED')
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
  /**
   * A file failure of a window answers further reads for `FILE_FAILURE_HOLD_MS`, so a scrub over an unreadable file
   * does not start a failing decode per pointer event; afterwards reads try again (a repaired or restored file).
   */
  private failed?: { error: Error; until: number }
  private direction = 0

  constructor(private readonly backend: VideoEditNativeFrames, private readonly media: VideoEditMedia, private readonly cache: VideoEditFrameCache, private readonly snapshot: VideoEditSnapshot) {}

  private get path(): string { return this.media.path }
  private get failure(): Error | undefined { return this.failed && performance.now() < this.failed.until ? this.failed.error : undefined }
  private cached(time: number): VideoEditGpuFrame | undefined { return (this.cache.get(this.path, time) as VideoEditGpuFrame | undefined)?.clone() }
  private source(): VideoEditNativeFileSource { this.opened ??= this.backend.acquire(this.media); return this.opened.source }

  private async normalize(picture: VideoEditNativePicture): Promise<VideoEditGpuFrame> {
    try { return await this.snapshot(picture, videoEditGpuFrameUsesChroma(picture)) } finally { picture.close() }
  }

  async sample(time: number, direction: number): Promise<{ sample?: VideoEditGpuFrame; hit: boolean }> {
    if (this.disposed) throw closedFailure()
    if (this.failure) throw this.failure
    const source = this.source()
    const changed = Math.sign(direction) !== this.direction
    this.direction = Math.sign(direction)
    if (direction === 0 || changed) this.cancelSpeculative()
    const cached = this.cached(time)
    if (cached) { if (direction !== 0) this.prefetch(source, time, direction); return { sample: cached, hit: true } }
    const session = await source.seek()
    if (this.disposed) throw closedFailure()
    if (session.intraOnly) {
      // Every picture is a key frame: read exactly the requested one.
      const picture = await source.lane.run(() => session.frameAt(time))
      if (this.disposed) { picture?.close(); throw closedFailure() }
      if (!picture) return { hit: false }
      const copy = await this.normalize(picture)
      this.cache.put(this.path, copy.clone(), new Set())
      return { sample: copy, hit: false }
    }
    // A window can end without this time's picture for it: delivered and already evicted before this request joined, or
    // the window was stopped. Decode once more instead of showing nothing (task 3.1: a scrubbed layer showed no picture);
    // only a time without any picture in the file (before its first frame) stays empty.
    for (let attempt = 0; attempt < 2; attempt++) {
      const already = this.cached(time)
      if (already) return { sample: already, hit: true }
      const start = Math.floor(time / VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS) * VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS
      const window = this.window(source, start, false)
      const picture = await new Promise<VideoEditGpuFrame | undefined>((resolve, reject) => window.waiters.add({ time, resolve, reject }))
      if (picture) {
        if (direction !== 0) this.prefetch(source, time, direction)
        return { sample: picture, hit: false }
      }
      if (this.disposed) throw closedFailure()
      if (this.failure) throw this.failure
    }
    return { hit: false }
  }

  private cancelSpeculative(): void {
    for (const window of this.windows.values()) if (window.speculative && !window.waiters.size) window.abort.abort()
  }

  /**
   * Whether every picture of the window starting at `start` is likely cached: probes its first, middle and last
   * picture (a window is decoded front to back, and the cache evicts by distance, so a partly evicted window misses
   * one of them). Checking only the first picture let a scrub skip prefetching a window that was mostly gone.
   */
  private windowCached(start: number): boolean {
    const width = VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS
    return [start + 1e-6, start + width / 2, start + width - 1e-3].every(time => time >= this.media.durationSeconds || this.cache.get(this.path, time) !== undefined)
  }

  /** Keeps the window ahead of a scrub (in its direction) decoding while the session is idle. */
  private prefetch(source: VideoEditNativeFileSource, time: number, direction: number): void {
    const width = VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS
    const start = Math.floor(time / width) * width + (direction > 0 ? width : -width)
    if (start < 0 || start >= this.media.durationSeconds || this.windows.has(start) || this.windows.size >= 2) return
    // Only when the session is already open (a scrub has started) and the neighbour is not cached yet.
    void source.seek().then(session => {
      if (this.disposed || this.failure || session.intraOnly || this.windows.has(start) || this.windows.size >= 2) return
      if (this.windowCached(start)) return
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
    const end = start + VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS
    window.done = source.lane.run(async lane => {
      const stop = (): void => window.abort.abort()
      lane.addEventListener('abort', () => { if (!window.waiters.size) stop() }, { once: true })
      if (window.abort.signal.aborted) return
      const session = await source.seek()
      // The exact picture at a time is the last one starting at or before it (task 3.1): each picture is cached and
      // handed to waiting reads with its span reaching the next picture, so a decoder duration shorter than the gap
      // (variable frame rate) still holds the picture there instead of leaving the layer empty. Only a gap the decoder
      // really has is held over: after a picture that never arrived, or a window stopped early, the previous picture
      // keeps its own span (a scrub showed a key frame for later times when the window ended early).
      let held: VideoEditGpuFrame | undefined
      const settle = (frame: VideoEditGpuFrame, next: number): void => {
        const shown = next - frame.timestamp > frame.duration + 1e-6 ? frame.retimed(next - frame.timestamp) : frame
        if (shown !== frame) frame.close()
        deliver(shown)
        this.cache.put(this.path, shown, new Set())
      }
      const outcome = { completed: false }
      try {
        for await (const picture of session.run({ range: { from: start, to: end } }, window.abort.signal, outcome)) {
          if (!picture) { if (held) settle(held, held.timestamp); held = undefined; continue }
          if (this.disposed || window.abort.signal.aborted) { picture.close(); break }
          // A partly cached window (prefetched again after eviction) keeps its cached pictures: no second GPU copy.
          const cached = this.cached(picture.timestamp + 1e-7)
          let copy: VideoEditGpuFrame
          if (cached && Math.abs(cached.timestamp - picture.timestamp) < 1e-6) { picture.close(); copy = cached }
          else {
            cached?.close()
            copy = await this.normalize(picture)
            if (this.disposed) { copy.close(); break }
          }
          deliver(copy)
          if (held) settle(held, copy.timestamp)
          held = copy
        }
        // When the window ran to its end, every picture starting before it was delivered and the last one holds until it.
        if (held && !this.disposed && !window.abort.signal.aborted) settle(held, outcome.completed ? end : held.timestamp)
        else held?.close()
        held = undefined
      } finally { held?.close() }
    }, speculative)
    // A finished window leaves the map before its waiters resume: a read joining it afterwards would wait forever
    // (task 3.1: removal used to run one step later, in `finally`).
    const finish = (): void => { if (this.windows.get(start) === window) this.windows.delete(start) }
    window.done = window.done.then(() => {
      finish()
      for (const waiter of window.waiters) waiter.resolve(this.cached(waiter.time))
    }, error => {
      finish()
      const failure = error instanceof Error ? error : new Error(String(error))
      // Only a file failure sticks (the file cannot be decoded); a service failure is retried by the next request.
      if (!this.disposed && !window.abort.signal.aborted && videoEditNativeFailureKind(failure) === 'file') this.failed = { error: failure, until: performance.now() + FILE_FAILURE_HOLD_MS }
      for (const waiter of window.waiters) waiter.reject(this.disposed ? closedFailure() : failure)
    }).finally(() => window.waiters.clear())
    return window
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    for (const window of this.windows.values()) { window.abort.abort(); for (const waiter of window.waiters) waiter.reject(closedFailure()); window.waiters.clear() }
    await Promise.allSettled([...this.windows.values()].map(window => window.done))
    this.windows.clear()
    if (this.opened) this.backend.release(this.opened.key)
    this.opened = undefined
    this.cache.deleteMedia(this.path)
  }
}
