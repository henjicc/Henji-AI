import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoFrameDecoderInfo, VideoFrameNativeStats, VideoFrameScheduleEvent, VideoFrameStreamEndedPayload } from '@/platform/contracts/videoFrames'
import type { VideoEditFrameCache } from './videoEditFrameCache'
import { VIDEO_EDIT_NATIVE_SOUND_READY, type VideoEditClipAudio, type VideoEditClipFrames, type VideoEditClipFramesOptions, type VideoEditFrameBackend, type VideoEditFrameSeeker, type VideoEditFrameSource, type VideoEditSnapshot } from './videoEditFrameSource'
import { createVideoEditNativeClipAudio, openVideoEditNativePcm, type VideoEditPcmSession } from './videoEditNativeAudio'
import { VideoEditGpuFrame, videoEditGpuFrameUsesChroma } from './videoEditGpuFrame'
import { VideoEditNativePicture, videoEditNativeRotation } from './videoEditNativePicture'
import type { NativeVideoFrame, VideoEditNativeFrameReceiver } from './videoEditNativeFrames'
import { videoEditSourceReadError } from './videoEditSourceErrors'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'
import { VideoEditNativeFailure, videoEditNativeClosed, videoEditNativeFailureKind, videoEditNativeFailureKindOf, videoEditNativeFailureMessage, videoEditNativeOpenFailure, videoEditNativeReadFailure } from './videoEditNativeFailure'

/**
 * The native frame backend (task 2.2): pictures decoded by the native decoder service arrive as borrowed shared GPU
 * textures over the render worker's frame channel and enter owned memory through `snapshot()` like browser pictures.
 *
 * Sessions per opened file (path + revision), all opened on first use:
 * - one `playback` session for forward playback schedules (one long-lived decoder, cuts continue without flushing,
 *   exact microsecond timestamps; a new schedule cancels the previous one);
 * - one `seek` session shared by single-frame reads and the seeker, whose operations run one at a time;
 * - one `seek` session per exclusive reader (`clipFrames({ exclusive: true })`, a code video input), opened on its
 *   first single-frame read and closed with the reader;
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
/**
 * Exclusive sessions (code video inputs, one per reference) leave this many of the renderer's sessions to shared ones
 * (playback schedules, the shared single-frame session a reference falls back to); a reference beyond that shares its
 * file's session as all references did before, slower when they interleave but never a failed frame.
 */
export const VIDEO_EDIT_NATIVE_EXCLUSIVE_RESERVE = 3
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
/** How long an exclusive reader the budget refused an own session reads on the file's shared session before trying again. */
const EXCLUSIVE_RETRY_MS = 2000
/** Seek windows of long-GOP material: decoded once into the shared frame cache, like the browser's GOP ranges. */
export const VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS = 1

type Plan = { times: readonly number[] } | { range: { from: number; to?: number } }
interface Consumer { frames: Map<number, NativeVideoFrame>; missing: Set<number>; highest: number; done?: { reason: string; delivered?: number; at: number }; wake?: () => void }
interface Ticket { deliver: (frame: NativeVideoFrame) => void; fail: (error: Error) => void }

const decodeFailure = videoEditNativeReadFailure
const closedFailure = (): VideoEditNativeFailure => videoEditNativeClosed()
/** A read its caller abandoned (`VideoEditFrameReadOptions.signal`); not a decoding failure. */
const readAbandoned = (): DOMException => new DOMException('取帧已取消。', 'AbortError')
const isAbandoned = (error: unknown): boolean => (error as { name?: unknown } | null)?.name === 'AbortError'
/** Aborted when either is (a preemption here, or the caller abandoning the read). */
const eitherSignal = (signal: AbortSignal, caller?: AbortSignal): AbortSignal => caller ? AbortSignal.any([signal, caller]) : signal

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

  /**
   * The picture showing at `time`, or null when the file has none there. `background`: a read ahead of need, timed as
   * `nativeFrameAtBackground` so a frame's stages tell its own reads from the background steps running beside it.
   * Aborting `signal` stops the native decode where it got to (the session keeps that position) and rejects with an
   * `AbortError`; a frame already on its way goes straight back.
   */
  async frameAt(time: number, keyOnly = false, background = false, signal?: AbortSignal): Promise<VideoEditNativePicture | null> {
    if (this.closing || this.ended) throw this.ended ?? closedFailure()
    if (signal?.aborted) throw readAbandoned()
    const ticket = `t${++this.next}`
    let ticketEntry!: Ticket
    const arrived = new Promise<NativeVideoFrame>((deliver, fail) => { ticketEntry = { deliver, fail } })
    void arrived.catch(() => undefined)
    this.tickets.set(ticket, ticketEntry)
    let abandon = (): void => {}
    const abandoned = new Promise<never>((_, reject) => {
      abandon = () => {
        this.tickets.delete(ticket)
        void this.channel.call('cancelFrameAt', { streamId: this.info.streamId, ticket }).catch(() => undefined)
        reject(readAbandoned())
      }
    })
    void abandoned.catch(() => undefined)
    signal?.addEventListener('abort', abandon, { once: true })
    let taken = false
    const started = performance.now()
    try {
      const result = await Promise.race([this.channel.call('frameAt', { streamId: this.info.streamId, time, ticket, ...(keyOnly ? { keyOnly } : {}) }).catch(error => { throw decodeFailure(this.name, error) }), abandoned])
      if (!result.found) return null
      let timer: ReturnType<typeof setTimeout> | undefined
      const frame = await Promise.race([arrived, abandoned, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(decodeFailure(this.name, new Error('原生帧未送达'))), FRAME_ARRIVAL_TIMEOUT_MS) })]).finally(() => clearTimeout(timer))
      taken = true
      // Where a slow read spent its time: in the service (decoding, a seek back to a key frame, waiting for a free
      // pool slot, the copy) or on the way (the request and the frame relayed through the main processes).
      const service = Number.isFinite(result.decodeMs) ? result.decodeMs : 0
      if (background) recordVideoEditPreparation('nativeFrameAtBackground', performance.now() - started)
      else {
        recordVideoEditPreparation(result.seeked ? 'nativeFrameAtSeek' : 'nativeFrameAtService', service)
        recordVideoEditPreparation('nativeFrameAtRelay', Math.max(0, performance.now() - started - service))
      }
      const picture = this.picture(frame)
      if (result.approximate) picture.approximate = true
      return picture
    } finally {
      signal?.removeEventListener('abort', abandon)
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
      const started = performance.now()
      await this.channel.call('closeStream', { streamId: this.info.streamId }).catch(() => undefined)
      recordVideoEditPreparation('nativeClose', performance.now() - started)
      this.onClosed()
    })()
    return this.closing
  }
}

/** Runs seek-session operations one at a time; a foreground operation preempts speculative and unclaimed ones. */
class NativeSeekLane {
  private tail: Promise<unknown> = Promise.resolve()
  private readonly speculative = new Set<AbortController>()
  private readonly unclaimed = new Set<AbortController>()
  run<T>(operation: (signal: AbortSignal) => Promise<T>, speculative = false): Promise<T> {
    if (!speculative) { for (const controller of this.speculative) controller.abort(); this.stopUnclaimed() }
    const controller = new AbortController()
    if (speculative) this.speculative.add(controller)
    const result = this.tail.catch(() => undefined).then(() => operation(controller.signal)).finally(() => this.speculative.delete(controller))
    this.tail = result
    return result
  }
  cancelSpeculative(): void { for (const controller of this.speculative) controller.abort(); this.stopUnclaimed() }
  /**
   * Marks the operation of `controller` as one nobody waits for any more: the next foreground operation here, or a
   * foreground read or playback plan of another file (`VideoEditNativeFrames.stopUnclaimed`), stops it. The result
   * undoes that.
   */
  unclaim(controller: AbortController): () => void { this.unclaimed.add(controller); return () => { this.unclaimed.delete(controller) } }
  stopUnclaimed(): void { for (const controller of this.unclaimed) controller.abort() }
}

/** One opened file and revision on the native backend. */
export class VideoEditNativeFileSource implements VideoEditFrameSource {
  readonly codec = undefined
  readonly lane = new NativeSeekLane()
  private playback?: Promise<VideoEditNativeDecoderSession>
  private seekSession?: Promise<VideoEditNativeDecoderSession>
  private readonly opening = new Set<Promise<VideoEditNativeDecoderSession>>()
  private closed = false
  active = 0
  private activeSeek = 0
  private activePlayback = 0
  lastUsed = performance.now()
  distance = Infinity
  private warming?: { abort: AbortController; done: Promise<void> }
  private warmed = new Set<'playback' | 'seek'>()

  get idle(): boolean { return this.active === 0 && !this.warming && this.opening.size === 0 }
  get hasSessions(): boolean { return !!this.playback || !!this.seekSession }
  get hasIdleSessions(): boolean { return !this.warming && (!!this.playback && !this.opening.has(this.playback) && !this.activePlayback || !!this.seekSession && !this.opening.has(this.seekSession) && !this.activeSeek) }
  hasSession(purpose: 'playback' | 'seek'): boolean { return !!(purpose === 'playback' ? this.playback : this.seekSession) }

  cancelWarm(): void { this.warming?.abort.abort() }
  async settleWarm(): Promise<void> { await this.warming?.done.catch(() => undefined) }

  /** 前台先取消推测读取；同文件等待取消收束，避免旧计划取消新计划。 */
  async use<T>(operation: () => Promise<T>): Promise<T> {
    this.active++; this.activeSeek++; this.lastUsed = performance.now()
    this.owner.cancelSpeculative(); this.owner.stopUnclaimed(this)
    try { await this.warming?.done.catch(() => undefined); return await operation() }
    finally { this.active--; this.activeSeek--; this.lastUsed = performance.now() }
  }

  async warm(time: number, purpose: 'playback' | 'seek', signal: AbortSignal, openOnly = false): Promise<void> {
    if (this.active || this.warming || this.warmed.has(purpose)) return
    const abort = new AbortController()
    const cancel = (): void => abort.abort()
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
    const task = { abort, done: Promise.resolve() }
    this.warming = task
    task.done = (async () => {
      if (abort.signal.aborted) return
      const session = await this.session(purpose)
      // 前台抢占只停止后续预解码，已打开的会话仍可在切点复用。显式跳转取消才丢弃。
      if (openOnly) { this.warmed.add(purpose); return }
      if (abort.signal.aborted) return
      let decoded = false
      for await (const picture of session.run({ times: [time] }, abort.signal)) { if (picture) decoded = true; picture?.close() }
      if (!abort.signal.aborted && !decoded) throw decodeFailure(this.media.name, new Error('入点没有可解码画面。'), 'file')
      if (!abort.signal.aborted) this.warmed.add(purpose)
    })().finally(async () => {
      signal.removeEventListener('abort', cancel)
      if (signal.aborted && !this.active) await this.retire()
      if (this.warming === task) this.warming = undefined
    })
    await task.done
    if (abort.signal.aborted) {
      throw new DOMException('预打开已取消。', 'AbortError')
    }
  }

  constructor(private readonly owner: VideoEditNativeFrames, readonly media: VideoEditMedia, private readonly path: string) {}

  private session(purpose: 'playback' | 'seek'): Promise<VideoEditNativeDecoderSession> {
    if (this.closed) return Promise.reject(closedFailure())
    const field = purpose === 'playback' ? 'playback' : 'seekSession'
    let pending = this[field]
    if (pending && this.active && this.warmed.delete(purpose)) this.owner.log('debug', '命中提前定位的解码会话', 'video_edit.decode.preopen.hit', { mediaId: this.media.id, purpose, durationMs: 0 })
    if (!pending) {
      if (this.active) this.owner.log('debug', '关键路径打开解码会话', 'video_edit.decode.preopen.miss', { mediaId: this.media.id, mediaName: this.media.name, purpose })
      const opening = this.owner.openSession(this.media, this.path, purpose, !!this.warming && !this.active)
      this.opening.add(opening)
      // A failed open is not kept (a restored file is read again), nor is a session whose stream ended: the next
      // read opens a new one on the restarted service (task 3.1).
      opening.then(session => { this.opening.delete(opening); session.whenEnded(() => { if (this[field] === opening) this[field] = undefined }) }, () => { this.opening.delete(opening); if (this[field] === opening) this[field] = undefined })
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
    this.warmed.clear()
    this.lane.cancelSpeculative()
    for (const pending of sessions) void pending?.then(session => session.close('service'), () => undefined)
  }

  async retire(keep: ReadonlySet<'playback' | 'seek'> = new Set()): Promise<void> {
    const sessions: Array<Promise<VideoEditNativeDecoderSession> | undefined> = []
    // 同文件正在播放时仍可让出闲置定位会话，反之亦然；不能把整个文件都当成忙碌。
    if (!keep.has('playback') && !this.activePlayback && (!this.playback || !this.opening.has(this.playback))) { sessions.push(this.playback); this.playback = undefined; this.warmed.delete('playback') }
    if (!keep.has('seek') && !this.activeSeek && (!this.seekSession || !this.opening.has(this.seekSession))) { sessions.push(this.seekSession); this.seekSession = undefined; this.warmed.delete('seek'); this.lane.cancelSpeculative() }
    await Promise.allSettled(sessions.map(async pending => (await pending)?.close()))
  }

  clipFrames(options?: VideoEditClipFramesOptions): VideoEditClipFrames | undefined {
    if (this.media.kind !== 'video') return undefined
    if (options?.exclusive) return this.exclusiveFrames()
    return {
      frames: start => this.frames(start),
      frameAt: (seconds, options) => this.use(() => this.lane.run(async lane => { recordVideoEditPreparation('nativeFrameAt', 0); return (await this.seek()).frameAt(seconds, false, false, eitherSignal(lane, options?.signal)) })),
    }
  }

  /**
   * A reader whose single-frame reads run on a session of its own (opened on first read, closed with the reader), so
   * consecutive reads continue forward in the native decoder (`frame_at` only seeks backwards or across GOPs) and no
   * other reader of the file moves its position. Reads run one at a time; a session that ended or failed as a service
   * is dropped, so the next read (the router's retry) opens a new one. The shared sessions and their speculative
   * warm-ups are untouched: this session competes with nothing.
   *
   * When the renderer's decoder budget has no room left for another session (many references showing at once), a
   * foreground read falls back to the file's shared single-frame session, as every reference read before: slower when
   * references interleave, never a failed frame. A speculative read (`VideoEditFrameReadOptions`) opens only with
   * headroom left for the foreground and otherwise fails.
   */
  private exclusiveFrames(): VideoEditClipFrames {
    let session: Promise<VideoEditNativeDecoderSession> | undefined
    let tail: Promise<unknown> = Promise.resolve()
    let closed = false
    /** Until when reads share the file's session after the budget refused an own one (then an own session is tried again). */
    let sharingUntil = -Infinity
    const drop = (pending: Promise<VideoEditNativeDecoderSession> | undefined): void => {
      if (!pending) return
      if (session === pending) session = undefined
      this.owner.track(pending.then(value => value.close(), () => undefined))
    }
    /** The reader's session, opened on first use (reads are serialized, so there is never a second open). */
    const open = (speculative: boolean): Promise<VideoEditNativeDecoderSession> => {
      if (session) return session
      const started = performance.now()
      const opening = this.owner.openSession(this.media, this.path, 'seek', speculative, true)
      session = opening
      opening.then(value => {
        this.owner.log('debug', '独占解码会话已打开', 'video_edit.decode.exclusive.opened', { mediaId: this.media.id, speculative, durationMs: performance.now() - started })
        value.whenEnded(() => { if (session === opening) session = undefined })
      }, () => { if (session === opening) session = undefined })
      return opening
    }
    const shared = (seconds: number, keyFrame = false, signal?: AbortSignal): Promise<VideoEditNativePicture | null> => this.use(() => this.lane.run(async lane => (await this.seek()).frameAt(seconds, keyFrame, false, eitherSignal(lane, signal))))
    /** Speculative reads queued or under way (background walk steps); the next foreground read preempts them. */
    const speculativeReads = new Set<AbortController>()
    return {
      continues: true,
      frames: start => this.frames(start),
      frameAt: (seconds, options) => {
        const speculative = options?.speculative === true
        // A foreground read does not wait for a background step to finish decoding: the step stops where it got to and
        // this read continues from there.
        if (!speculative) { for (const controller of speculativeReads) controller.abort(); this.owner.stopUnclaimed(this) }
        const own = speculative ? new AbortController() : undefined
        if (own) speculativeReads.add(own)
        const signal = own ? eitherSignal(own.signal, options?.signal) : options?.signal
        const read = tail.catch(() => undefined).then(async () => {
          if (closed || this.closed) throw closedFailure()
          if (signal?.aborted) throw readAbandoned()
          this.lastUsed = performance.now()
          recordVideoEditPreparation('nativeFrameAt', 0)
          if (!session && performance.now() < sharingUntil) { if (speculative) throw new VideoEditNativeFailure(videoEditNativeFailureMessage(this.media.name, 'budget'), 'budget', 'BUDGET_EXCEEDED'); return shared(seconds, options?.keyFrame === true, signal) }
          let pending: Promise<VideoEditNativeDecoderSession> | undefined
          try {
            if (!session && speculative && !await this.owner.makeRoomAhead()) throw new VideoEditNativeFailure(videoEditNativeFailureMessage(this.media.name, 'budget'), 'budget', 'BUDGET_EXCEEDED')
            if (closed) throw closedFailure()
            pending = open(speculative)
            return await (await pending).frameAt(seconds, options?.keyFrame === true, speculative, signal)
          } catch (error) {
            // An abandoned read keeps the session: the next read continues where the native decode stopped.
            if (isAbandoned(error)) throw error
            const kind = videoEditNativeFailureKind(error)
            if (kind === 'budget' && !speculative && !closed) {
              sharingUntil = performance.now() + EXCLUSIVE_RETRY_MS
              this.owner.log('info', '解码会话已满，此视频输入暂时改用素材共享的定位会话', 'video_edit.decode.exclusive.shared', { mediaId: this.media.id, sessions: this.owner.openSessions, retryInMs: EXCLUSIVE_RETRY_MS })
              return shared(seconds, options?.keyFrame === true, signal)
            }
            // A hung or lost session must not answer the retry: close it so the next read opens a fresh one.
            if (kind === 'service') drop(pending)
            throw error
          }
        }).finally(() => { if (own) speculativeReads.delete(own) })
        tail = read
        return read
      },
      close: () => {
        if (closed) return
        closed = true
        drop(session)
      },
      // After the read in progress (reads are serialized); the next read opens a new session.
      suspend: () => {
        const pending = session
        if (pending) tail = tail.catch(() => undefined).then(() => { if (session === pending) drop(pending) })
      },
    }
  }

  /** The `audioStream`-th sound stream of the file (default the first; task 2.6 opens the others by their number). */
  clipAudio(audioStream?: number): VideoEditClipAudio | undefined {
    if (!this.owner.sound || this.media.kind === 'image' || (this.media.kind === 'video' && this.media.hasAudio === false)) return undefined
    return createVideoEditNativeClipAudio(sampleRate => this.owner.openSound(this.media, this.path, sampleRate, audioStream))
  }

  async *schedule(timestamps: readonly number[], signal?: AbortSignal): AsyncGenerator<VideoEditNativePicture | null, void, unknown> {
    if (this.media.kind !== 'video') return
    // Another plan of this file is running (another renderer: a nested sequence, a second instance of one, the
    // program beside it): a second plan on the shared session would cancel it (the service runs one plan per
    // session), so this one runs on a playback session of its own, closed with the plan. Without room for one it
    // takes the shared session as before.
    const concurrent = this.activePlayback > 0
    this.active++; this.activePlayback++; this.lastUsed = performance.now(); this.owner.cancelSpeculative(); this.owner.stopUnclaimed()
    let own: VideoEditNativeDecoderSession | undefined
    try {
      await this.warming?.done.catch(() => undefined)
      if (signal?.aborted) return
      if (concurrent) {
        own = await this.owner.openSession(this.media, this.path, 'playback').catch(error => {
          if (videoEditNativeFailureKind(error) !== 'budget') throw error
          this.owner.log('info', '解码会话已满，同一素材的第二个播放计划改用共享会话', 'video_edit.decode.schedule.shared', { mediaId: this.media.id, sessions: this.owner.openSessions })
          return undefined
        })
        if (own) this.owner.log('debug', '同一素材同时播放，第二个计划使用独立会话', 'video_edit.decode.schedule.concurrent', { mediaId: this.media.id })
      }
      if (!signal?.aborted) yield* (own ?? await this.session('playback')).run({ times: timestamps }, signal)
    } finally {
      this.active--; this.activePlayback--; this.lastUsed = performance.now()
      if (own) this.owner.track(own.close())
    }
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
    this.cancelWarm()
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
  /** 预览 Worker 统一管理闲置会话；导出和独立读取保持立即释放。 */
  retainIdle?: boolean
  log?: (level: 'debug' | 'info', message: string, event: string, context: Record<string, unknown>) => void
}

/** The native frame backend of one renderer. */
export class VideoEditNativeFrames implements VideoEditFrameBackend {
  private readonly files = new Map<string, { users: number; source: VideoEditNativeFileSource }>()
  private readonly closing = new Set<Promise<void>>()
  private sessions = 0
  private exclusiveSessions = 0
  private budgetUnavailable = false
  private budgetSnapshot?: { stats: VideoFrameNativeStats; at: number; sessions: number }

  constructor(private readonly options: VideoEditNativeFramesOptions) {}
  get managesIdleSessions(): boolean { return this.options.retainIdle === true }

  log(level: 'debug' | 'info', message: string, event: string, context: Record<string, unknown>): void { this.options.log?.(level, message, event, context) }

  cancelSpeculative(): void { for (const { source } of this.files.values()) source.cancelWarm() }
  /**
   * Stops the seek windows nobody waits for any more (`NativeSeekLane.unclaim`) of every file but `keep`: a foreground
   * read or a playback plan elsewhere needs the hardware decoder, the GPU queue and the worker more than they do. The
   * file being read keeps its own, for a read continuing them.
   */
  stopUnclaimed(keep?: VideoEditNativeFileSource): void { for (const { source } of this.files.values()) if (source !== keep) source.lane.stopUnclaimed() }
  private async settleSpeculative(): Promise<void> { await Promise.all([...this.files.values()].map(entry => entry.source.settleWarm())) }

  /** 余量完全由服务端给出（实测最大会话或冷启动保留量）；旧服务缺字段时不做推测打开。 */
  private headroom(stats: VideoFrameNativeStats | null | undefined, extra: number): boolean {
    const budget = stats?.budget
    const reserve = budget?.foregroundReserveBytes ?? budget?.largestSessionBytes
    if (!budget || !reserve) return false
    const pending = Math.max(0, this.sessions - (this.budgetSnapshot?.sessions ?? this.sessions))
    return budget.vramLimitBytes - budget.vramReservedBytes >= reserve * (extra + pending)
      && budget.hardwareSessionLimit - budget.hardwareSessions >= extra + pending
      && budget.decoderSessionLimit - stats.streams.filter(stream => stream.kind === 'decoder').length >= extra + pending
      && (this.options.maxSessions ?? VIDEO_EDIT_NATIVE_MAX_SESSIONS) - this.sessions >= extra
  }

  private async budgetStats(refresh = false): Promise<VideoFrameNativeStats | undefined> {
    if (!refresh && this.budgetSnapshot && performance.now() - this.budgetSnapshot.at < 500) return this.budgetSnapshot.stats
    try {
      const stats = (await this.options.channel.call('stats', {})).native ?? undefined
      if (!stats?.budget?.foregroundReserveBytes && !stats?.budget?.largestSessionBytes) throw new Error('原生服务未提供前台预算保留量。')
      this.budgetUnavailable = false
      // 预算 IPC 不占用每个短暂空档；快照之后新增的本地会话仍扣除保留量，服务端负责最终原子准入。
      this.budgetSnapshot = { stats, at: performance.now(), sessions: this.sessions }
      return stats
    } catch (error) {
      if (!this.budgetUnavailable) this.log('info', '无法读取前瞻预算，保留当前会话并暂停推测打开', 'video_edit.decode.lookahead.budget_failed', { reason: String(error) })
      this.budgetUnavailable = true; this.budgetSnapshot = undefined
      return undefined
    }
  }
  /**
   * Room for one decoder needed within seconds (a code video input opened ahead of its clip): with the service's
   * budget for it plus the foreground's reserve, freeing idle sessions (farthest first) when that is what lacks.
   * Never more: sessions in use are untouched, and without room the caller gives up instead of taking the last one.
   */
  async makeRoomAhead(): Promise<boolean> {
    for (let attempt = 0; attempt < (this.options.maxSessions ?? VIDEO_EDIT_NATIVE_MAX_SESSIONS); attempt++) {
      const stats = await this.budgetStats(true)
      if (this.headroom(stats, 2)) return true
      if (!stats || !this.options.retainIdle || !await this.evictOne('ahead')) return false
    }
    return false
  }

  async canPreopen(): Promise<boolean> {
    const stats = await this.budgetStats()
    this.log('debug', '前瞻预算快照', 'video_edit.decode.lookahead.budget', { budget: stats?.budget, sessions: this.sessions, streams: stats?.streams.length })
    return this.headroom(stats, 2)
  }

  needsPreopen(media: VideoEditMedia, purpose: 'playback' | 'seek'): boolean {
    const source = this.files.get(`${media.path}\u0000${media.sourceRevision ?? ''}`)?.source
    return !source || (source.idle && !source.hasSession(purpose))
  }

  /** 最远且最久未用的文件先回收；引用本身可继续存在，下次读取会重新打开会话。 */
  private async evictOne(reason = 'budget'): Promise<boolean> {
    const entries = [...this.files.entries()].filter(([, entry]) => entry.source.hasIdleSessions)
      .sort((a, b) => (b[1].source.distance - a[1].source.distance || a[1].source.lastUsed - b[1].source.lastUsed))
    const entry = entries[0]
    if (!entry) return false
    const [key, { source, users }] = entry, started = performance.now()
    if (users === 0 && source.idle) this.files.delete(key)
    const closing = users === 0 && source.idle ? source.close() : source.retire()
    this.closing.add(closing)
    try { await closing } finally { this.closing.delete(closing) }
    this.log('debug', '闲置解码会话已释放', 'video_edit.decode.idle.evicted', { mediaId: source.media.id, reason, distanceSeconds: Number.isFinite(source.distance) ? source.distance : undefined, durationMs: performance.now() - started })
    return true
  }

  async maintain(distances: ReadonlyMap<string, number>, wanted?: ReadonlyMap<string, boolean>): Promise<void> {
    if (!this.options.retainIdle) return
    for (const { source } of this.files.values()) source.distance = distances.get(source.media.path) ?? Infinity
    // 窗口外会话即使显存足够也不无限保留，防止重开后积累硬件解码器及定位队列。
    if (wanted) for (const [key, entry] of this.files) {
      const keep = new Set((['playback', 'seek'] as const).filter(purpose => wanted.has(`${key}\0${purpose}`)))
      if (!entry.source.hasIdleSessions) continue
      await entry.source.retire(keep)
      if (!entry.users && !entry.source.hasSessions) this.files.delete(key)
    }
    for (;;) {
      const stats = await this.budgetStats(true)
      if (!stats || this.headroom(stats, 1) || !await this.evictOne('budget')) return
    }
  }

  async disposeIdle(): Promise<void> {
    for (const [key, entry] of this.files) if (entry.users === 0) { this.files.delete(key); await entry.source.close() }
  }

  /** Whether the native service can be asked to read this media item at all. */
  reads(media: VideoEditMedia): boolean { return media.kind !== 'image' && !!this.options.localPath(media) }

  get sound(): boolean { return this.options.sound ?? VIDEO_EDIT_NATIVE_SOUND_READY }

  /** Opens the sound session of one clip reader; null when the file has no sound stream. */
  openSound(media: VideoEditMedia, path: string, sampleRate: number | undefined, audioStream?: number): Promise<VideoEditPcmSession | null> {
    return openVideoEditNativePcm(this.options.channel, path, media.name, { ...(sampleRate !== undefined ? { sampleRate } : {}), ...(audioStream !== undefined ? { audioStream } : {}) })
  }

  /**
   * Opens a native decoder session, counted against the per-renderer limit (an exceeded budget is a `budget` failure).
   * `exclusive`: an exclusive reader's own session, also counted against `VIDEO_EDIT_NATIVE_EXCLUSIVE_RESERVE`.
   */
  async openSession(media: VideoEditMedia, path: string, purpose: 'playback' | 'seek', speculative = false, exclusive = false): Promise<VideoEditNativeDecoderSession> {
    const limit = this.options.maxSessions ?? VIDEO_EDIT_NATIVE_MAX_SESSIONS
    if (exclusive && this.exclusiveSessions >= limit - VIDEO_EDIT_NATIVE_EXCLUSIVE_RESERVE) throw new VideoEditNativeFailure(videoEditNativeFailureMessage(media.name, 'budget'), 'budget', 'BUDGET_EXCEEDED')
    if (this.options.retainIdle && !speculative && this.sessions >= limit) { this.cancelSpeculative(); await this.settleSpeculative(); await this.settled() }
    if (this.options.retainIdle && !speculative) while (this.sessions >= limit && await this.evictOne('foreground')) { /* 当前帧优先腾出名额。 */ }
    if (this.sessions >= limit) throw new VideoEditNativeFailure(videoEditNativeFailureMessage(media.name, 'budget'), 'budget', 'BUDGET_EXCEEDED')
    this.sessions++
    if (exclusive) this.exclusiveSessions++
    try {
      // Pre-rendered preview files (8-bit H.264, NV12 slots) keep a deeper decoded queue: opening the next file's decoder
      // briefly stalls decoding, and 16 ready pictures (267ms at 60fps) cover it without a dropped frame.
      const deep = purpose === 'playback' && media.id.startsWith('render-cache:')
      const started = performance.now()
      const open = () => this.options.channel.call('openDecoder', { path, purpose, ...(deep ? { poolSize: 16 } : {}) })
      let info: VideoFrameDecoderInfo
      for (;;) {
        try { info = await open(); break } catch (error) {
          if (speculative || !this.options.retainIdle || videoEditNativeFailureKind(videoEditNativeOpenFailure(media.name, error)) !== 'budget') throw error
          const before = this.sessions
          this.cancelSpeculative(); await this.settleSpeculative(); await this.settled()
          if (await this.evictOne('foreground') || this.sessions < before) continue
          throw error
        }
      }
      if (speculative) this.log('debug', '前瞻原生会话打开完成', 'video_edit.decode.preopen.opened', { mediaId: media.id, purpose, durationMs: performance.now() - started })
      recordVideoEditPreparation(speculative ? 'lookaheadNativeOpen' : purpose === 'playback' ? 'nativeOpenPlayback' : 'nativeOpenSeek', performance.now() - started)
      return new VideoEditNativeDecoderSession(this.options.channel, info, media.name, () => { this.sessions--; if (exclusive) this.exclusiveSessions--; recordVideoEditPreparation(purpose === 'playback' ? 'nativeClosedPlayback' : 'nativeClosedSeek', 0) })
    } catch (error) { this.sessions--; if (exclusive) this.exclusiveSessions--; throw videoEditNativeOpenFailure(media.name, error) }
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

  /** 短期引用预打开共享会话；指定目标时解到入点，正式读取复用相同的定位或播放会话。 */
  preopen(media: VideoEditMedia, target?: { time: number; purpose: 'playback' | 'seek'; signal: AbortSignal; openOnly?: boolean; distance?: number }): { ready: Promise<void>; release: () => void } {
    const { key, source } = this.acquire(media)
    source.distance = target?.distance ?? 0
    let released = false
    const release = (): void => { if (!released) { released = true; this.release(key, target?.signal.aborted === true) } }
    const ready = (target ? source.warm(target.time, target.purpose, target.signal, target.openOnly) : source.seek().then(() => undefined)).catch(error => { release(); throw error })
    return { ready, release }
  }

  open(media: VideoEditMedia): { key: string; ready: Promise<VideoEditFrameSource> } {
    try {
      const { key, source } = this.acquire(media)
      return { key, ready: Promise.resolve(source) }
    } catch (error) {
      return { key: '', ready: Promise.reject(error) }
    }
  }

  release(key: string, discard = false): void {
    const entry = this.files.get(key)
    if (!entry || --entry.users > 0) return
    if (this.options.retainIdle && !discard && Number.isFinite(entry.source.distance) && entry.source.hasSessions) return
    this.files.delete(key)
    const closing = entry.source.close().finally(() => this.closing.delete(closing))
    this.closing.add(closing)
  }

  seeker(media: VideoEditMedia, cache: VideoEditFrameCache, snapshot: VideoEditSnapshot): VideoEditFrameSeeker {
    return new VideoEditNativeSeeker(this, media, cache, snapshot)
  }

  /** Counts a session close (an exclusive reader's) among those `settled()` waits for. */
  track(closing: Promise<void>): void {
    const tracked: Promise<void> = closing.then(() => {}, () => {}).finally(() => this.closing.delete(tracked))
    this.closing.add(tracked)
  }

  /** Resolves when every session closed by released sources has stopped (before the frame channel closes). */
  async settled(): Promise<void> { while (this.closing.size) await Promise.allSettled([...this.closing]) }

  get openSessions(): number { return this.sessions }
}

interface SeekWaiter { time: number; resolve: (frame: VideoEditGpuFrame | undefined) => void; reject: (error: Error) => void }
/**
 * `unclaimed`: every read waiting for the window was abandoned. It keeps decoding: a read of the same window takes it
 * back (a step back from an abandoned paused frame often lies just behind it), and the next other operation on the
 * session, or a foreground read or playback plan of another file, stops it. Holds the undo of `NativeSeekLane.unclaim`.
 * An unclaimed window still counts toward the two windows a prefetch leaves room for: it lives only until the next
 * read of any file, which either takes it back or stops it.
 */
interface SeekWindow { start: number; speculative: boolean; waiters: Set<SeekWaiter>; abort: AbortController; done: Promise<void>; unclaimed?: () => void }

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

  /**
   * Aborting `signal` abandons the read: a single-frame read stops the native decode where it got to (the session keeps
   * that position), a window read leaves its window, and a window nobody waits for any more is left unclaimed (see
   * `SeekWindow`).
   */
  sample(time: number, direction: number, singleFrame = false, approximate = false, signal?: AbortSignal): Promise<{ sample?: VideoEditGpuFrame; hit: boolean; approximate?: boolean }> {
    if (this.disposed) return Promise.reject(closedFailure())
    if (signal?.aborted) return Promise.reject(readAbandoned())
    return this.backend.managesIdleSessions ? this.source().use(() => this.sampleActive(time, direction, singleFrame, approximate, signal)) : this.sampleActive(time, direction, singleFrame, approximate, signal)
  }

  private async sampleActive(time: number, direction: number, singleFrame: boolean, approximate: boolean, signal?: AbortSignal): Promise<{ sample?: VideoEditGpuFrame; hit: boolean; approximate?: boolean }> {
    if (this.disposed) throw closedFailure()
    if (this.failure) throw this.failure
    if (signal?.aborted) throw readAbandoned()
    const source = this.source()
    this.backend.stopUnclaimed(source)
    const changed = Math.sign(direction) !== this.direction
    this.direction = Math.sign(direction)
    if (direction === 0 || changed) this.cancelSpeculative()
    const cached = this.cached(time)
    if (cached) { recordVideoEditPreparation('scrubCacheHit', 0); if (direction !== 0) this.prefetch(source, time, direction); return { sample: cached, hit: true } }
    const session = await source.seek()
    if (this.disposed) throw closedFailure()
    if (signal?.aborted) throw readAbandoned()
    const start = Math.floor(time / VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS) * VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS
    // An exact read of a window left unclaimed takes it back instead of stopping it and decoding the picture again.
    const unclaimed = this.windows.get(start)
    const rejoin = !approximate && !!unclaimed?.unclaimed && !unclaimed.abort.signal.aborted
    if ((session.intraOnly || singleFrame) && !rejoin) {
      // A first still needs only one picture. Decode the GOP natively without importing/copying its preceding frames.
      // Continuous scrubbing keeps the existing window cache and speculative neighbour decoding.
      const queued = performance.now()
      const picture = await source.lane.run(async () => {
        recordVideoEditPreparation('scrubLaneWait', performance.now() - queued)
        const started = performance.now()
        const value = await session.frameAt(time, approximate && !session.intraOnly, false, signal)
        recordVideoEditPreparation(value?.approximate ? 'scrubKeyFrame' : 'scrubExactFrame', performance.now() - started)
        return value
      })
      if (this.disposed) { picture?.close(); throw closedFailure() }
      if (!picture) return { hit: false }
      const keyFrame = picture.approximate
      const copy = await this.normalize(picture)
      // 关键帧按它自己的时间入缓存：对它自身的时间它就是精确画面，查目标时间不会命中它。
      this.cache.put(this.path, copy.clone(), new Set())
      return { sample: copy, hit: false, ...(keyFrame ? { approximate: true } : {}) }
    }
    // A window can end without this time's picture for it: delivered and already evicted before this request joined, or
    // the window was stopped. Decode once more instead of showing nothing (task 3.1: a scrubbed layer showed no picture);
    // only a time without any picture in the file (before its first frame) stays empty.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw readAbandoned()
      const already = this.cached(time)
      if (already) return { sample: already, hit: true }
      const window = this.window(source, start, false)
      const waited = performance.now()
      const picture = await this.wait(source, window, time, signal)
      recordVideoEditPreparation('scrubWindow', performance.now() - waited)
      if (picture) {
        if (direction !== 0) this.prefetch(source, time, direction)
        return { sample: picture, hit: false }
      }
      if (this.disposed) throw closedFailure()
      if (this.failure) throw this.failure
    }
    return { hit: false }
  }

  /** The picture at `time` from `window`; aborting `signal` leaves the window, unclaimed once nobody waits for it. */
  private wait(source: VideoEditNativeFileSource, window: SeekWindow, time: number, signal?: AbortSignal): Promise<VideoEditGpuFrame | undefined> {
    const unclaim = (): void => { if (!window.waiters.size && !window.unclaimed && !window.abort.signal.aborted) window.unclaimed = source.lane.unclaim(window.abort) }
    if (signal?.aborted) { unclaim(); return Promise.reject(readAbandoned()) }
    return new Promise((resolve, reject) => {
      const leave = (): void => {
        if (!window.waiters.delete(waiter)) return
        reject(readAbandoned())
        unclaim()
      }
      const waiter: SeekWaiter = {
        time,
        resolve: frame => { signal?.removeEventListener('abort', leave); resolve(frame) },
        reject: error => { signal?.removeEventListener('abort', leave); reject(error) },
      }
      window.waiters.add(waiter)
      signal?.addEventListener('abort', leave, { once: true })
    })
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
    // A stopped window still finishing delivers nothing more: a new read starts a new one (it queues on the lane behind it).
    if (existing && !existing.abort.signal.aborted) {
      if (!speculative) { existing.speculative = false; existing.unclaimed?.(); existing.unclaimed = undefined }
      return existing
    }
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
    const finish = (): void => { window.unclaimed?.(); window.unclaimed = undefined; if (this.windows.get(start) === window) this.windows.delete(start) }
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
    // 原生会话跨片段保留时，已复制的 GOP 帧也交给原有有界帧缓存淘汰，避免切回时重新解码。
    if (!this.backend.managesIdleSessions) this.cache.deleteMedia(this.path)
  }
}
