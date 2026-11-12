import { VideoEditGpuFrameError } from './videoEditGpuFailure'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoFrameDecoderInfo, VideoFrameNativeStats, VideoFrameScheduleEvent, VideoFrameStreamEndedPayload } from '@/platform/contracts/videoFrames'
import type { VideoEditFrameCache } from './videoEditFrameCache'
import { closeVideoEditScheduledPicture, VIDEO_EDIT_NATIVE_SOUND_READY, VIDEO_EDIT_PICTURE_HELD, type VideoEditClipAudio, type VideoEditClipFrames, type VideoEditClipFramesOptions, type VideoEditFrameBackend, type VideoEditFrameSeeker, type VideoEditFrameSource, type VideoEditScheduledPicture, type VideoEditScrubRead, type VideoEditSnapshot } from './videoEditFrameSource'
import { createVideoEditNativeClipAudio, openVideoEditNativePcm, type VideoEditPcmSession } from './videoEditNativeAudio'
import { VideoEditGpuFrame, videoEditGpuFrameUsesChroma } from './videoEditGpuFrame'
import { VideoEditNativePicture, videoEditNativeRotation } from './videoEditNativePicture'
import type { NativeVideoFrame, VideoEditNativeFrameReceiver } from './videoEditNativeFrames'
import { videoEditSourceReadError } from './videoEditSourceErrors'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'
import { VideoEditNativeCallError, VideoEditNativeFailure, videoEditNativeClosed, videoEditNativeFailureKind, videoEditNativeFailureKindOf, videoEditNativeFailureMessage, videoEditNativeOpenFailure, videoEditNativeReadFailure } from './videoEditNativeFailure'

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
 *   rate and closed with the reader. Sound sessions carry no textures and are not in the video memory ledger.
 *
 * 会话数不设上限，显存由原生服务的账本作淘汰目标（`native/video-decoder/src/budget.rs`）。按读取对当前画面的必要性分三种
 * 打开方式（`VideoEditNativeAdmission`）：文件的共享会话一律打开，超出预算后在后台淘汰不在当前画面的闲置会话，淘汰不动就
 * 照常超出（驱动把显存换出到内存，变慢而不失败）；能退回共享会话的读取（独占读取者、同一素材的第二个播放计划、拖动图层
 * 自己的会话）只在有余量时另开会话，从不为此淘汰别的会话；提前打开只在留有前台余量时进行。显存不够时变慢（共用一个
 * 解码器来回定位、不提前打开），不让任何一帧失败。
 */

/** Worker-side access to native decoder sessions: port requests and borrowed frames over one frame channel. */
export type VideoEditNativeChannel = Pick<VideoEditNativeFrameReceiver, 'call' | 'subscribe' | 'subscribeSchedule' | 'subscribeEnded'>

/**
 * 打开解码会话的方式：`required` 当前画面要读的文件共享会话（与顺序读取），一律打开；`optional` 能退回共享会话的读取，
 * 没有余量时以 `budget` 失败让调用方退回（不为它淘汰别的会话）；`speculative` 提前打开，调用方先确认留有前台余量
 * （`canPreopen`、`makeRoomAhead`）。
 */
type VideoEditNativeAdmission = 'required' | 'optional' | 'speculative'
/**
 * 这么久（毫秒）以内前台读过的会话算当前画面在用，按预算淘汰时不动：读完的一瞬间会话就算闲置，淘汰了下一帧又要重开。
 * 前瞻给出距离 0 的用途（暂停时当前画面要读的）同样不动（`VideoEditNativeFileSource.inUse`）。
 */
const VIDEO_EDIT_NATIVE_IN_USE_MS = 1000
type VideoEditNativePurpose = 'playback' | 'seek'
const VIDEO_EDIT_NATIVE_PURPOSES: ReadonlySet<VideoEditNativePurpose> = new Set(['playback', 'seek'])
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
/** How long an exclusive reader denied an own session (no video memory room) reads on the file's shared session before trying again. */
const EXCLUSIVE_RETRY_MS = 2000
/** Seek windows of long-GOP material: decoded once into the shared frame cache, like the browser's GOP ranges. */
const VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS = 1
/**
 * 播放计划在剪辑点前这么多项（时间线帧）就让下一段在文件的另一个播放会话上开始定位。H.264/HEVC 的剪辑点要清空解码器、
 * 从关键帧解到入点（4K 每帧约 4.6ms，GOP 中段约 0.3 秒，长 GOP 末尾可过半秒）；同一个解码器要等剪辑点之前的帧都交完才
 * 轮到它，播放池那几帧余量盖不住。60 帧在 60fps 时间线上约 1 秒。
 */
const VIDEO_EDIT_NATIVE_NEXT_SEGMENT_LEAD = 60
/**
 * 向前跳过超过这么久（秒）才另起一段。原生服务只在目标的关键帧位于已送入的包之后时定位（`plan.rs` 的
 * `seek_decision`），这里不知道关键帧在哪：跳得近时服务多半续解，或只定位到很近的关键帧，单独起段反而让两个解码器
 * 都解；跳过一秒以上才值得另一个解码器提前去定位。向后跳服务总要定位，一律起段。
 */
const SEGMENT_FORWARD_SECONDS = 1
/** 短于这么多项的段不单独起：变速快段、频繁切换处每段只有几帧，提前定位省下的抵不过两个解码器同时解。 */
const MIN_SEGMENT_ITEMS = 30
/**
 * 拖动中这么久（毫秒）没读的图层算停了：它的定位会话让给别的图层，自己开的会话关掉。拖动之间停顿几秒很常见，
 * 重开一个 4K 会话要一两百毫秒，所以不能太短。
 */
const SCRUB_READER_IDLE_MS = 10_000

/** 播放计划按需要重新定位的剪辑点切成的段，返回每段的起始下标（首项为 0）；同一段在一个解码器上顺序续解。 */
export function videoEditNativeScheduleSegments(times: readonly number[]): number[] {
  const cuts: number[] = []
  for (let index = 1; index < times.length; index++) {
    const from = times[index - 1], to = times[index]
    if (Number.isFinite(from) && Number.isFinite(to) && (to < from || to - from > SEGMENT_FORWARD_SECONDS)) cuts.push(index)
  }
  // 太短的段并回前一段（剪辑点照常由服务现场定位）。
  return [0, ...cuts.filter((cut, index) => (cuts[index + 1] ?? times.length) - cut >= MIN_SEGMENT_ITEMS)]
}

type Plan = { times: readonly number[] } | { range: { from: number; to?: number } }
/** `held`：服务答复沿用上一幅画面的项（`VIDEO_EDIT_PICTURE_HELD`）。 */
interface Consumer { frames: Map<number, NativeVideoFrame>; missing: Set<number>; held: Set<number>; highest: number; done?: { reason: string; delivered?: number; at: number }; wake?: () => void }
interface Ticket { deliver: (frame: NativeVideoFrame) => void; fail: (error: Error) => void }

const decodeFailure = videoEditNativeReadFailure
const closedFailure = (): VideoEditNativeFailure => videoEditNativeClosed()
/** 显存没有余量给一个能退回共享会话的读取或提前打开：调用方退回共享会话或放弃提前打开（`VideoEditNativeAdmission`）。 */
const noRoom = (name: string): VideoEditNativeFailure => new VideoEditNativeFailure(videoEditNativeFailureMessage(name, 'budget'), 'budget', 'BUDGET_EXCEEDED')
/** A read its caller abandoned (`VideoEditFrameReadOptions.signal`); not a decoding failure. */
const readAbandoned = (): DOMException => new DOMException('取帧已取消。', 'AbortError')
const isAbandoned = (error: unknown): boolean => (error as { name?: unknown } | null)?.name === 'AbortError'
/** 放弃的读取与复制进显存失败都不是解码会话的问题，会话留着。 */
const keepsSession = (error: unknown): boolean => isAbandoned(error) || error instanceof VideoEditGpuFrameError
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
    if (event.type === 'frame_missing') { (event.reason === 'held' ? consumer.held : consumer.missing).add(event.index); consumer.highest = Math.max(consumer.highest, event.index) }
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
   * `AbortError`; a frame already on its way goes straight back. `retain`: a scrub read, the decoded pictures stay in the
   * service for later reads (`decode/retain.rs`) and the picture carries its run's key frame time (`keySeconds`).
   */
  async frameAt(time: number, keyOnly = false, background = false, signal?: AbortSignal, retain = false): Promise<VideoEditNativePicture | null> {
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
      const result = await Promise.race([this.channel.call('frameAt', { streamId: this.info.streamId, time, ticket, ...(keyOnly ? { keyOnly } : {}), ...(retain ? { retain } : {}) }).catch(error => { throw decodeFailure(this.name, error) }), abandoned])
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
      if (result.keySeconds !== undefined) picture.keySeconds = result.keySeconds
      if (result.retained) recordVideoEditPreparation('nativeFrameAtRetained', 0)
      return picture
    } finally {
      signal?.removeEventListener('abort', abandon)
      this.tickets.delete(ticket)
      // A frame that arrived (or arrives) for an abandoned read goes straight back.
      if (!taken) void arrived.then(frame => frame.release(), () => undefined)
    }
  }

  /**
   * 倒拖预解：服务把 `time` 所在 GOP 从关键帧到 `time` 都解出留在服务里，不交帧（`decode/retain.rs`）。返回这一段是否已全部
   * 留存及它的关键帧时间；留存满了时停在已解到的位置，下次接着解。中止 `signal` 时服务同样停在原处，以 `AbortError` 结束。
   */
  async prefetch(time: number, signal: AbortSignal): Promise<{ retained: boolean; keySeconds?: number }> {
    if (this.closing || this.ended) throw this.ended ?? closedFailure()
    if (signal.aborted) throw readAbandoned()
    const ticket = `p${++this.next}`
    let abandon = (): void => {}
    const abandoned = new Promise<never>((_, reject) => {
      abandon = () => {
        void this.channel.call('cancelFrameAt', { streamId: this.info.streamId, ticket }).catch(() => undefined)
        reject(readAbandoned())
      }
    })
    void abandoned.catch(() => undefined)
    signal.addEventListener('abort', abandon, { once: true })
    const started = performance.now()
    try {
      const result = await Promise.race([this.channel.call('frameAt', { streamId: this.info.streamId, time, ticket, retain: true, prefetch: true }).catch(error => { throw decodeFailure(this.name, error) }), abandoned])
      recordVideoEditPreparation(result.retained ? 'nativePrefetch' : result.full ? 'nativePrefetchFull' : 'nativePrefetchStopped', performance.now() - started)
      return { retained: result.retained === true, ...(result.keySeconds !== undefined ? { keySeconds: result.keySeconds } : {}) }
    } finally { signal.removeEventListener('abort', abandon) }
  }

  /**
   * Runs one plan. `times`: exactly one picture or null per time, in order. `range`: every picture from the one
   * showing at `from` up to `to`, in order, with null where a decoded picture never arrived (so a reader does not
   * stretch the previous picture over it). Aborting (or returning the generator) cancels the plan. `outcome.completed`
   * tells whether the service finished the whole plan (a range reached `to` or the end of the file), as opposed to
   * stopping early (cancelled, interrupted, failed). Only a `times` plan answers an item with `VIDEO_EDIT_PICTURE_HELD`
   * (the previous answer's picture again).
   */
  run(plan: { range: { from: number; to?: number } }, signal?: AbortSignal, outcome?: { completed: boolean }): AsyncGenerator<VideoEditNativePicture | null, void, unknown>
  run(plan: { times: readonly number[] }, signal?: AbortSignal, outcome?: { completed: boolean }): AsyncGenerator<VideoEditScheduledPicture<VideoEditNativePicture>, void, unknown>
  async *run(plan: Plan, signal?: AbortSignal, outcome?: { completed: boolean }): AsyncGenerator<VideoEditScheduledPicture<VideoEditNativePicture>, void, unknown> {
    if (this.closing || this.ended) throw this.ended ?? closedFailure()
    const scheduleId = `s${++this.next}`
    const consumer: Consumer = { frames: new Map(), missing: new Set(), held: new Set(), highest: -1 }
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
        if (item === 'held') { yield VIDEO_EDIT_PICTURE_HELD; continue }
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
  private async take(consumer: Consumer, index: number, timed: boolean, signal?: AbortSignal): Promise<NativeVideoFrame | 'missing' | 'held' | 'end'> {
    let lostSince: number | undefined
    for (;;) {
      if (signal?.aborted) return 'end'
      const frame = consumer.frames.get(index)
      if (frame) { consumer.frames.delete(index); return frame }
      if (consumer.missing.has(index)) return 'missing'
      if (consumer.held.delete(index)) return 'held'
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
  /** 播放计划的奇数段在这个会话上提前定位（与 `playback` 交替）；跟 `playback` 一起保留与回收，不在每个剪辑点开关解码器。 */
  private alternate?: Promise<VideoEditNativeDecoderSession>
  private seekSession?: Promise<VideoEditNativeDecoderSession>
  private readonly opening = new Set<Promise<VideoEditNativeDecoderSession>>()
  private closed = false
  active = 0
  private activeSeek = 0
  private activePlayback = 0
  lastUsed = performance.now()
  /** 每种会话最近一次前台读取的时刻（`reading`）；提前打开与推测读取不算。 */
  private readonly readAt: Record<VideoEditNativePurpose, number> = { playback: -Infinity, seek: -Infinity }
  /** 离播放头的时间距离（`maintain` 按前瞻目标给出）；淘汰闲置会话时远的先走。 */
  distance = Infinity
  /** 距离 0 时前瞻要读的用途（`maintain` 给出）；没给出时距离 0 的文件全部用途都算在用。 */
  current?: ReadonlySet<VideoEditNativePurpose>
  private warming?: { abort: AbortController; done: Promise<void> }
  private warmed = new Set<'playback' | 'seek'>()

  get idle(): boolean { return this.active === 0 && !this.warming && this.opening.size === 0 }
  get hasSessions(): boolean { return !!this.playback || !!this.alternate || !!this.seekSession }
  get hasIdleSessions(): boolean { return !this.warming && ([this.playback, this.alternate].some(pending => !!pending && !this.opening.has(pending)) && !this.activePlayback || !!this.seekSession && !this.opening.has(this.seekSession) && !this.activeSeek) }
  hasSession(purpose: 'playback' | 'seek'): boolean { return !!(purpose === 'playback' ? this.playback : this.seekSession) }
  private get hasAlternate(): boolean { return !!this.alternate }

  cancelWarm(): void { this.warming?.abort.abort() }
  private reading(purpose: VideoEditNativePurpose): void { this.lastUsed = this.readAt[purpose] = performance.now() }
  /**
   * 当前画面在用的会话用途：最近一帧前台读过的，或前瞻给出距离 0 的。按预算淘汰时不动，不然必须打开的会话超出预算后的
   * 回收（`relieve`）会淘汰本帧刚读完的会话，下一帧又重开。
   */
  inUse(): Set<VideoEditNativePurpose> {
    const now = performance.now(), atPlayhead = this.distance === 0 ? this.current ?? VIDEO_EDIT_NATIVE_PURPOSES : undefined
    return new Set([...VIDEO_EDIT_NATIVE_PURPOSES].filter(purpose => now - this.readAt[purpose] < VIDEO_EDIT_NATIVE_IN_USE_MS || atPlayhead?.has(purpose)))
  }
  /** 有当前画面不用的闲置会话（可按预算淘汰）。 */
  get evictable(): boolean {
    if (this.warming) return false
    const keep = this.inUse()
    return !keep.has('playback') && !this.activePlayback && [this.playback, this.alternate].some(pending => !!pending && !this.opening.has(pending))
      || !keep.has('seek') && !this.activeSeek && !!this.seekSession && !this.opening.has(this.seekSession)
  }

  /** 前台先取消推测读取；同文件等待取消收束，避免旧计划取消新计划。 */
  async use<T>(operation: () => Promise<T>): Promise<T> {
    this.active++; this.activeSeek++; this.reading('seek')
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
      for await (const picture of session.run({ times: [time] }, abort.signal)) { if (picture) decoded = true; closeVideoEditScheduledPicture(picture) }
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

  /** `alternate` 按提前打开的方式开（调用方已确认余量）；预打开期间按提前打开，前台读取按必须打开。 */
  private session(use: 'playback' | 'seek' | 'alternate'): Promise<VideoEditNativeDecoderSession> {
    if (this.closed) return Promise.reject(closedFailure())
    const field = use === 'seek' ? 'seekSession' : use
    const purpose = use === 'seek' ? 'seek' : 'playback'
    let pending = this[field]
    if (pending && this.active && use !== 'alternate' && this.warmed.delete(purpose)) this.owner.log('debug', '命中提前定位的解码会话', 'video_edit.decode.preopen.hit', { mediaId: this.media.id, purpose, durationMs: 0 })
    if (!pending) {
      if (this.active && use !== 'alternate') this.owner.log('debug', '关键路径打开解码会话', 'video_edit.decode.preopen.miss', { mediaId: this.media.id, mediaName: this.media.name, purpose })
      const opening = this.owner.openSession(this.media, this.path, purpose, use === 'alternate' || !!this.warming && !this.active ? 'speculative' : 'required')
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

  /** 拖动中另一个图层自己的定位会话（`VideoEditNativeSeeker` 管理，随图层停读或定位器释放关闭）；没有余量时以 `budget` 失败。 */
  openScrubSession(): Promise<VideoEditNativeDecoderSession> { return this.owner.openSession(this.media, this.path, 'seek', 'optional') }

  /**
   * Drops this file's shared sessions after a failure (task 3.1): reads waiting on them fail as retryable, and the
   * next read opens new sessions. A session that timed out may still be alive natively; closing it stops it.
   */
  reset(): void {
    const sessions = [this.playback, this.alternate, this.seekSession]
    this.playback = undefined; this.alternate = undefined; this.seekSession = undefined
    this.warmed.clear()
    this.lane.cancelSpeculative()
    for (const pending of sessions) void pending?.then(session => session.close('service'), () => undefined)
  }

  async retire(keep: ReadonlySet<VideoEditNativePurpose> = new Set()): Promise<void> {
    const sessions: Array<Promise<VideoEditNativeDecoderSession> | undefined> = []
    // 同文件正在播放时仍可让出闲置定位会话，反之亦然；不能把整个文件都当成忙碌。
    if (!keep.has('playback') && !this.activePlayback && (!this.playback || !this.opening.has(this.playback))) { sessions.push(this.playback); this.playback = undefined; this.warmed.delete('playback') }
    if (!keep.has('playback') && !this.activePlayback && (!this.alternate || !this.opening.has(this.alternate))) { sessions.push(this.alternate); this.alternate = undefined }
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
   * When video memory has no room left for another session even after idle sessions are freed (many references showing
   * at once), a foreground read falls back to the file's shared single-frame session, as every reference read before:
   * slower when references interleave, never a failed frame. A speculative read (`VideoEditFrameReadOptions`) opens only
   * with room left for the foreground and otherwise fails.
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
      const opening = this.owner.openSession(this.media, this.path, 'seek', speculative ? 'speculative' : 'optional')
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
          if (speculative) this.lastUsed = performance.now(); else this.reading('seek')
          recordVideoEditPreparation('nativeFrameAt', 0)
          if (!session && performance.now() < sharingUntil) { if (speculative) throw noRoom(this.media.name); return shared(seconds, options?.keyFrame === true, signal) }
          let pending: Promise<VideoEditNativeDecoderSession> | undefined
          try {
            const room = !!session || !speculative || await this.owner.makeRoomAhead()
            if (closed || this.closed) throw closedFailure()
            if (!room) throw noRoom(this.media.name)
            pending = open(speculative)
            return await (await pending).frameAt(seconds, options?.keyFrame === true, speculative, signal)
          } catch (error) {
            // An abandoned read keeps the session: the next read continues where the native decode stopped.
            if (keepsSession(error)) throw error
            // Closed while waiting for room or opening: nothing to recover, and no budget failure reaches a picture.
            if (closed || this.closed) throw closedFailure()
            const kind = videoEditNativeFailureKind(error)
            if (kind === 'budget' && !speculative) {
              sharingUntil = performance.now() + EXCLUSIVE_RETRY_MS
              this.owner.log('info', '显存余量不足，此视频输入暂时改用素材共享的定位会话', 'video_edit.decode.exclusive.shared', { mediaId: this.media.id, sessions: this.owner.openSessions, retryInMs: EXCLUSIVE_RETRY_MS })
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

  async *schedule(timestamps: readonly number[], signal?: AbortSignal): AsyncGenerator<VideoEditScheduledPicture<VideoEditNativePicture>, void, unknown> {
    if (this.media.kind !== 'video') return
    // Another plan of this file is running (another renderer: a nested sequence, a second instance of one, the
    // program beside it): a second plan on the shared session would cancel it (the service runs one plan per
    // session), so this one runs on a playback session of its own, closed with the plan. Without video memory room for
    // one it takes the shared session as before.
    const concurrent = this.activePlayback > 0
    this.active++; this.activePlayback++; this.reading('playback'); this.owner.cancelSpeculative(); this.owner.stopUnclaimed()
    let own: VideoEditNativeDecoderSession | undefined
    try {
      await this.warming?.done.catch(() => undefined)
      if (signal?.aborted) return
      if (concurrent) {
        own = await this.owner.openSession(this.media, this.path, 'playback', 'optional').catch(error => {
          if (videoEditNativeFailureKind(error) !== 'budget') throw error
          this.owner.log('info', '显存余量不足，同一素材的第二个播放计划改用共享会话', 'video_edit.decode.schedule.shared', { mediaId: this.media.id, sessions: this.owner.openSessions })
          return undefined
        })
        if (own) this.owner.log('debug', '同一素材同时播放，第二个计划使用独立会话', 'video_edit.decode.schedule.concurrent', { mediaId: this.media.id })
      }
      if (!signal?.aborted) yield* own ? own.run({ times: timestamps }, signal) : this.segmented(timestamps, signal)
    } finally {
      this.active--; this.activePlayback--; this.lastUsed = performance.now()
      if (own) this.owner.track(own.close())
    }
  }

  /**
   * 播放计划按剪辑点分段，相邻两段交替用文件的两个播放会话：一段还剩 `VIDEO_EDIT_NATIVE_NEXT_SEGMENT_LEAD` 项时，下一段
   * 已在另一个会话上定位并解出开头几帧，剪辑点直接接上。一个会话一次只跑一个计划，所以再下一段要等这一段交完才开始。
   * 另一个会话只在显存留有前台余量时按提前打开的方式开；开不成，这个计划余下的段都接在同一会话上（剪辑点照常现场定位）。
   * 全帧内素材不分段：服务在计划内自己预先接续下一段（`decode/mod.rs` 3.6）。
   */
  private async *segmented(timestamps: readonly number[], signal?: AbortSignal): AsyncGenerator<VideoEditScheduledPicture<VideoEditNativePicture>, void, unknown> {
    const shared = await this.session('playback')
    const starts = shared.intraOnly ? [0] : videoEditNativeScheduleSegments(timestamps)
    if (starts.length === 1) { yield* shared.run({ times: timestamps }, signal); return }
    const stop = new AbortController()
    const plan = eitherSignal(stop.signal, signal)
    interface Segment { iterator: AsyncGenerator<VideoEditScheduledPicture<VideoEditNativePicture>, void, unknown>; first: Promise<IteratorResult<VideoEditScheduledPicture<VideoEditNativePicture>, void>> }
    /** 各段实际所在的会话（拿到会话后才知道）。 */
    const uses = new Map<number, 'playback' | 'alternate'>()
    /** 另一个会话开不成后，这个计划不再尝试。 */
    let single = false
    /** 段 `index` 的计划：拿到会话就发出，第一项随即开始等（帧到之前先在会话里排着）。计划已取消就不再发出。 */
    const run = (use: 'playback' | 'alternate', index: number): Promise<Segment> => this.session(use).then(session => {
      if (plan.aborted) throw readAbandoned()
      uses.set(index, use)
      const iterator = session.run({ times: timestamps.slice(starts[index], starts[index + 1] ?? timestamps.length) }, plan)
      const first = iterator.next(); void first.catch(() => undefined)
      return { iterator, first }
    })
    /** 奇数段在另一个会话上；余量不足时得到 undefined，并且这个计划余下的段都留在共享会话上。 */
    const alternate = async (index: number): Promise<Segment | undefined> => {
      try {
        if (!this.hasAlternate && !await this.owner.canPreopen()) throw noRoom(this.media.name)
        return await run('alternate', index)
      } catch (error) {
        if (videoEditNativeFailureKind(error) !== 'budget') throw error
        single = true
        this.owner.log('info', '显存余量不足，剪辑点改在同一播放会话上现场定位', 'video_edit.decode.schedule.cut_shared', { mediaId: this.media.id, sessions: this.owner.openSessions })
        return undefined
      }
    }
    const started = new Map<number, Promise<Segment | undefined>>()
    /**
     * 段 `index` 进入提前量就开始，前提是它的会话空着：再前一段已交完（调用时总是如此），前一段确知在另一个会话上。
     * 前一段的会话还没拿到时不猜，下一项再看。
     */
    const ahead = (index: number, item: number): void => {
      if (single || index >= starts.length || started.has(index) || starts[index] - item > VIDEO_EDIT_NATIVE_NEXT_SEGMENT_LEAD) return
      const previous = uses.get(index - 1)
      if (!previous || previous === (index % 2 ? 'alternate' : 'playback')) return
      const pending = index % 2 ? alternate(index) : run('playback', index)
      void pending.catch(() => undefined)
      started.set(index, pending)
    }
    try {
      for (let index = 0; index < starts.length; index++) {
        const end = starts[index + 1] ?? timestamps.length
        // 没提前开（或另一个会话开不成）的段接在共享会话上：上一段已经交完。
        const segment = await started.get(index) ?? await run('playback', index)
        started.delete(index)
        let pending: Promise<IteratorResult<VideoEditScheduledPicture<VideoEditNativePicture>, void>> | undefined = segment.first
        try {
          for (let item = starts[index]; item < end; item++) {
            ahead(index + 1, item)
            const result = await (pending ?? segment.iterator.next()); pending = undefined
            if (signal?.aborted) return
            if (result.done) { for (; item < end; item++) yield null; break }
            yield result.value
          }
        } finally { await segment.iterator.return() }
      }
    } finally {
      stop.abort()
      // 还在打开会话的段不等：打开后见计划已取消就不发出；已发出的计划随取消立即结束。
      for (const pending of started.values()) this.owner.track(pending.then(async segment => {
        if (!segment) return
        closeVideoEditScheduledPicture((await segment.first.catch(() => undefined))?.value)
        await segment.iterator.return()
      }, () => undefined))
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
    await Promise.allSettled([this.playback, this.alternate, this.seekSession].map(async pending => (await pending)?.close()))
  }
}

export interface VideoEditNativeFramesOptions {
  channel: VideoEditNativeChannel
  /** The local file the native service reads for a media item (its path in the worker is a fetchable URL). */
  localPath(media: VideoEditMedia): string | undefined
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
  private budgetUnavailable = false
  private budgetSnapshot?: { stats: VideoFrameNativeStats; at: number; sessions: number }
  /** 必须打开的会话使登记超出预算后，在后台淘汰闲置会话（`relieve`）。 */
  private relieving?: Promise<void>

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

  /**
   * 显存预算里是否还有 `extra` 个会话的余量。每个会话的估算由服务端给出（实测最大会话或冷启动保留量），快照之后本地新开
   * 的会话同样扣除；拖动留存帧不算占用（会话越过预算时服务先收回它们）。缺字段时当作没有余量（只影响能退回共享会话的
   * 读取与提前打开）。
   */
  private headroom(stats: VideoFrameNativeStats | null | undefined, extra: number): boolean {
    const budget = stats?.budget
    const reserve = budget?.foregroundReserveBytes ?? budget?.largestSessionBytes
    if (!budget || !reserve) return false
    const pending = Math.max(0, this.sessions - (this.budgetSnapshot?.sessions ?? this.sessions))
    return budget.vramLimitBytes - (budget.vramReservedBytes - budget.vramRetainedBytes) >= reserve * (extra + pending)
  }

  private async budgetStats(refresh = false): Promise<VideoFrameNativeStats | undefined> {
    if (!refresh && this.budgetSnapshot && performance.now() - this.budgetSnapshot.at < 500) return this.budgetSnapshot.stats
    try {
      const stats = (await this.options.channel.call('stats', {})).native ?? undefined
      if (!stats?.budget?.foregroundReserveBytes && !stats?.budget?.largestSessionBytes) throw new Error('原生服务未提供前台预算保留量。')
      this.budgetUnavailable = false
      // 预算 IPC 不占用每个短暂空档；快照之后新增的本地会话仍按保留量扣除（`headroom`）。
      this.budgetSnapshot = { stats, at: performance.now(), sessions: this.sessions }
      return stats
    } catch (error) {
      if (!this.budgetUnavailable) this.log('info', '无法读取解码显存预算，暂停提前打开，可共享的读取改用共享会话', 'video_edit.decode.lookahead.budget_failed', { reason: String(error) })
      this.budgetUnavailable = true; this.budgetSnapshot = undefined
      return undefined
    }
  }
  /**
   * 提前打开一个片段开始前要用的会话（代码视频输入）所需的余量：自己加前台保留共 2 个会话，按服务当前的账本（各窗口、
   * 各渲染器共用）。不够时淘汰不在当前画面的闲置会话（远的、久未用的先）；仍不够返回 false，调用方放弃提前打开。
   */
  async makeRoomAhead(): Promise<boolean> {
    for (;;) {
      const stats = await this.budgetStats(true)
      if (this.headroom(stats, 2)) return true
      if (!stats || !this.options.retainIdle || !await this.evictOne('ahead')) return false
    }
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

  /**
   * 最远且最久未用的文件先回收；当前画面在用的会话（`inUse`）不动。引用本身可继续存在，下次读取会重新打开会话。
   */
  private async evictOne(reason = 'budget'): Promise<boolean> {
    const entries = [...this.files.entries()].filter(([, entry]) => entry.source.evictable)
      .sort((a, b) => (b[1].source.distance - a[1].source.distance || a[1].source.lastUsed - b[1].source.lastUsed))
    const entry = entries[0]
    if (!entry) return false
    const [key, { source, users }] = entry, started = performance.now()
    const keep = source.inUse(), whole = users === 0 && source.idle && keep.size === 0
    if (whole) this.files.delete(key)
    const closing = whole ? source.close() : source.retire(keep)
    this.closing.add(closing)
    try { await closing } finally { this.closing.delete(closing) }
    this.log('debug', '闲置解码会话已释放', 'video_edit.decode.idle.evicted', { mediaId: source.media.id, reason, distanceSeconds: Number.isFinite(source.distance) ? source.distance : undefined, durationMs: performance.now() - started })
    return true
  }

  async maintain(distances: ReadonlyMap<string, number>, wanted?: ReadonlyMap<string, boolean>): Promise<void> {
    if (!this.options.retainIdle) return
    for (const [key, { source }] of this.files) {
      source.distance = distances.get(source.media.path) ?? Infinity
      source.current = wanted && source.distance === 0 ? new Set([...VIDEO_EDIT_NATIVE_PURPOSES].filter(purpose => wanted.has(`${key}\0${purpose}`))) : undefined
    }
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

  /**
   * 必须打开的会话使登记超出预算时，在后台淘汰不在当前画面的闲置会话，直到回到预算内或没有可淘汰的；淘汰不动就照常
   * 超出。不挡住正在读的画面。
   */
  private relieve(): void {
    if (!this.options.retainIdle || this.relieving) return
    this.relieving = (async () => {
      for (;;) {
        const stats = await this.budgetStats(true)
        if (!stats || this.headroom(stats, 0) || !await this.evictOne('over-budget')) return
      }
    })().finally(() => { this.relieving = undefined })
  }

  /** 关闭没有读取者的文件（含按前瞻距离留着的闲置会话），等它们的会话都停下。 */
  async disposeIdle(): Promise<void> {
    const idle = [...this.files].filter(([, entry]) => entry.users === 0)
    for (const [key] of idle) this.files.delete(key)
    await Promise.allSettled(idle.map(([, entry]) => entry.source.close()))
  }

  /** Whether the native service can be asked to read this media item at all. */
  reads(media: VideoEditMedia): boolean { return media.kind !== 'image' && !!this.options.localPath(media) }

  get sound(): boolean { return this.options.sound ?? VIDEO_EDIT_NATIVE_SOUND_READY }

  /** Opens the sound session of one clip reader; null when the file has no sound stream. */
  openSound(media: VideoEditMedia, path: string, sampleRate: number | undefined, audioStream?: number): Promise<VideoEditPcmSession | null> {
    return openVideoEditNativePcm(this.options.channel, path, media.name, { ...(sampleRate !== undefined ? { sampleRate } : {}), ...(audioStream !== undefined ? { audioStream } : {}) })
  }

  /**
   * Opens a native decoder session (see `VideoEditNativeAdmission`): `required` always opens and frees idle sessions in
   * the background when the ledger went past the budget; `optional` opens only with room for itself and otherwise fails
   * as `budget`, so its caller reads on the shared session; `speculative` relies on its caller having checked the room.
   * A pool the service could not allocate even at its smallest (`GPU_FAILED` with the device intact) is a missing room
   * for the latter two, so their callers fall back instead of reporting a failure.
   */
  async openSession(media: VideoEditMedia, path: string, purpose: 'playback' | 'seek', admission: VideoEditNativeAdmission = 'required'): Promise<VideoEditNativeDecoderSession> {
    if (admission === 'optional' && !this.headroom(await this.budgetStats(true), 1)) throw noRoom(media.name)
    this.sessions++
    try {
      // Pre-rendered preview files (8-bit H.264, NV12 slots) keep a deeper decoded queue: opening the next file's decoder
      // briefly stalls decoding, and 16 ready pictures (267ms at 60fps) cover it without a dropped frame.
      const deep = purpose === 'playback' && media.id.startsWith('render-cache:')
      const started = performance.now()
      const info: VideoFrameDecoderInfo = await this.options.channel.call('openDecoder', { path, purpose, ...(deep ? { poolSize: 16 } : {}) })
      const speculative = admission === 'speculative'
      if (speculative) this.log('debug', '前瞻原生会话打开完成', 'video_edit.decode.preopen.opened', { mediaId: media.id, purpose, durationMs: performance.now() - started })
      recordVideoEditPreparation(speculative ? 'lookaheadNativeOpen' : purpose === 'playback' ? 'nativeOpenPlayback' : 'nativeOpenSeek', performance.now() - started)
      if (admission === 'required') this.relieve()
      return new VideoEditNativeDecoderSession(this.options.channel, info, media.name, () => { this.sessions--; recordVideoEditPreparation(purpose === 'playback' ? 'nativeClosedPlayback' : 'nativeClosedSeek', 0) })
    } catch (error) {
      this.sessions--
      if (admission !== 'required' && error instanceof VideoEditNativeCallError && error.code === 'GPU_FAILED') {
        this.log('info', '显存分配失败，这次读取改用共享会话或不提前打开', 'video_edit.decode.open.no_memory', { mediaId: media.id, admission, reason: error.message })
        throw noRoom(media.name)
      }
      throw videoEditNativeOpenFailure(media.name, error)
    }
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
 * 拖动读取的一个图层。第一个读的图层用文件的共享定位会话与队列；同时在读的其他图层各开一个会话与队列，各自顺序续解，
 * 不在两个源时间之间来回定位（同一文件的两层相差一秒时，共用一个解码器让正拖六成读取都要回到关键帧）。显存没有余量时共用。
 * `key`：最近一次原生读取所在段的关键帧时间；`prefetch`：在途的预解（`scrubAhead`），`prefetched` 是已解完的预解目标。
 */
interface ScrubReader {
  /** 读取时现取会话：共享会话可能已被回收或重置（下次读取由文件源重开），自己开的会话结束后读取者随之丢弃。 */
  session(): Promise<VideoEditNativeDecoderSession>
  /** 图层自己开的会话（显存没有余量时没有，用共享会话）；停读或定位器释放时关闭。 */
  own?: Promise<VideoEditNativeDecoderSession>
  lane: NativeSeekLane; lastRead: number; key?: number; prefetched?: number; prefetch?: { abort: AbortController }
}

/**
 * Exact-frame seeking on the native backend with decoded pictures kept in the renderer's shared frame cache.
 * Intra-frame material (ProRes, DNxHR, CineForm) reads the requested picture directly. Long-GOP material decodes
 * one-second windows into the cache, so stepping and reverse scrubbing reuse decoded pictures the way the browser
 * seeker reuses whole GOPs; consecutive forward windows continue the decoder without seeking, and a scrub direction
 * prefetches the neighbouring window while the session is idle.
 */
class VideoEditNativeSeeker implements VideoEditFrameSeeker {
  private opened?: { key: string; source: VideoEditNativeFileSource }
  private readonly windows = new Map<number, SeekWindow>()
  private disposed = false
  /**
   * A file failure of a window answers further reads for `FILE_FAILURE_HOLD_MS`, so a scrub over an unreadable file
   * does not start a failing decode per pointer event; afterwards reads try again (a repaired or restored file).
   */
  private failed?: { error: Error; until: number }
  private direction = 0
  private readonly readers = new Map<string, ScrubReader>()
  /** 停拖后关掉图层自己开的会话（`SCRUB_READER_IDLE_MS` 后检查一次）。 */
  private readerSweep?: ReturnType<typeof setTimeout>

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
  sample(time: number, direction: number, singleFrame = false, approximate = false, signal?: AbortSignal, scrub?: VideoEditScrubRead): Promise<{ sample?: VideoEditGpuFrame; hit: boolean; approximate?: boolean }> {
    if (this.disposed) return Promise.reject(closedFailure())
    if (signal?.aborted) return Promise.reject(readAbandoned())
    return this.backend.managesIdleSessions ? this.source().use(() => this.sampleActive(time, direction, singleFrame, approximate, signal, scrub)) : this.sampleActive(time, direction, singleFrame, approximate, signal, scrub)
  }

  private async sampleActive(time: number, direction: number, singleFrame: boolean, approximate: boolean, signal?: AbortSignal, scrub?: VideoEditScrubRead): Promise<{ sample?: VideoEditGpuFrame; hit: boolean; approximate?: boolean }> {
    if (this.disposed) throw closedFailure()
    if (this.failure) throw this.failure
    if (signal?.aborted) throw readAbandoned()
    const source = this.source()
    this.backend.stopUnclaimed(source)
    const changed = Math.sign(direction) !== this.direction
    this.direction = Math.sign(direction)
    if (direction === 0 || changed) this.cancelSpeculative()
    const cached = this.cached(time)
    if (cached) { recordVideoEditPreparation('scrubCacheHit', 0); if (direction !== 0) this.prefetch(source, time, direction); if (scrub) this.scrubAhead(scrub, time); return { sample: cached, hit: true } }
    const session = await source.seek()
    if (this.disposed) throw closedFailure()
    if (signal?.aborted) throw readAbandoned()
    const start = Math.floor(time / VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS) * VIDEO_EDIT_NATIVE_SEEK_WINDOW_SECONDS
    // An exact read of a window left unclaimed takes it back instead of stopping it and decoding the picture again.
    const unclaimed = this.windows.get(start)
    const rejoin = !approximate && !!unclaimed?.unclaimed && !unclaimed.abort.signal.aborted
    if ((session.intraOnly || singleFrame) && !rejoin) {
      // A first still needs only one picture. Decode the GOP natively without importing/copying its preceding frames.
      // Continuous scrubbing keeps the existing window cache and speculative neighbour decoding. A scrub read of a
      // long-GOP layer runs on its reader's session and keeps the decoded pictures in the service (`ScrubReader`).
      const reader = scrub && !session.intraOnly ? this.reader(source, scrub.reader) : undefined
      const readSession = reader ? await reader.session() : session
      if (this.disposed) throw closedFailure()
      const lane = reader?.lane ?? source.lane
      const queued = performance.now()
      const picture = await lane.run(async () => {
        recordVideoEditPreparation('scrubLaneWait', performance.now() - queued)
        const started = performance.now()
        const value = await readSession.frameAt(time, approximate && !session.intraOnly, false, signal, !!reader)
        recordVideoEditPreparation(value?.approximate ? 'scrubKeyFrame' : 'scrubExactFrame', performance.now() - started)
        return value
      }).catch(error => {
        // 自己开的会话出了服务故障（未送达、卡住）：丢掉读取者，路由重试时重开，不再落回这个会话。
        if (reader?.own && scrub && !keepsSession(error) && videoEditNativeFailureKind(error) === 'service') this.dropReader(scrub.reader, reader)
        throw error
      })
      if (this.disposed) { picture?.close(); throw closedFailure() }
      if (reader && scrub) { reader.lastRead = performance.now(); if (picture?.keySeconds !== undefined) reader.key = picture.keySeconds; this.scrubAhead(scrub, time) }
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

  /** 图层 `id` 的拖动读取者（见 `ScrubReader`）；顺带关掉已经停读的其他图层自己开的会话。 */
  private reader(source: VideoEditNativeFileSource, id: string): ScrubReader {
    this.sweepReaders(id)
    let reader = this.readers.get(id)
    if (reader) return reader
    const shared = (): Promise<VideoEditNativeDecoderSession> => source.seek()
    if (![...this.readers.values()].some(other => !other.own)) reader = { session: shared, lane: source.lane, lastRead: performance.now() }
    else {
      const created: ScrubReader = { session: shared, lane: new NativeSeekLane(), lastRead: performance.now() }
      const own = source.openScrubSession()
      created.own = own
      // 显存没有余量时这次读取也落到共享会话，不让这一帧失败。
      created.session = () => own.catch(error => videoEditNativeFailureKind(error) === 'budget' ? shared() : Promise.reject(error))
      void own.then(session => session.whenEnded(() => this.dropReader(id, created)), error => {
        if (videoEditNativeFailureKind(error) !== 'budget') { this.dropReader(id, created); return }
        // 显存没有余量：与第一个图层共用文件的定位会话。
        if (created.own === own) { created.own = undefined; created.session = shared; created.lane = source.lane }
      })
      reader = created
    }
    this.readers.set(id, reader)
    this.armReaderSweep()
    return reader
  }

  private dropReader(id: string, reader: ScrubReader): void {
    if (this.readers.get(id) === reader) this.readers.delete(id)
    this.closeReader(reader)
  }

  private closeReader(reader: ScrubReader): void {
    reader.prefetch?.abort.abort(); reader.prefetch = undefined
    const own = reader.own
    reader.own = undefined
    if (own) this.backend.track(own.then(session => session.close(), () => undefined))
  }

  /** 关掉停读超过 `SCRUB_READER_IDLE_MS` 的其他图层的读取者（`keep` 除外）。 */
  private sweepReaders(keep?: string): void {
    const now = performance.now()
    for (const [key, other] of this.readers) if (key !== keep && now - other.lastRead > SCRUB_READER_IDLE_MS) this.dropReader(key, other)
  }

  private armReaderSweep(): void {
    if (this.readerSweep !== undefined || this.disposed) return
    this.readerSweep = setTimeout(() => {
      this.readerSweep = undefined
      this.sweepReaders()
      if ([...this.readers.values()].some(reader => reader.own)) this.armReaderSweep()
    }, SCRUB_READER_IDLE_MS)
  }

  /**
   * 倒拖时让图层的解码器走在读取前面：预解当前段之前的整个 GOP，解出的帧留在服务里，拖到那里时直接交出，不在 GOP 边界停下
   * 重解（正拖时各图层顺序续解，不需要）。预解不排在图层队列里：服务在预解途中直接答复落在留存帧里的读取，遇到要解码的读取
   * 就停下先办它（解码器停在原处），读完再接着发。
   */
  private scrubAhead(scrub: VideoEditScrubRead, time: number): void {
    const reader = this.readers.get(scrub.reader)
    if (!reader || this.disposed) return
    reader.lastRead = performance.now()
    if (reader.prefetch && scrub.direction >= 0) { reader.prefetch.abort.abort(); reader.prefetch = undefined }
    if (scrub.direction >= 0 || reader.prefetch) return
    // 读取经渲染层缓存越过了上次原生读取的那一段时，先预解读取所在的这一段，由结果得知它的关键帧再往前预解。
    const from = reader.key !== undefined && reader.key <= time ? reader.key : time
    // 关键帧之前一点：服务定位到上一个关键帧，解到这一段第一帧之前。
    const target = from - 1e-4
    if (target <= 0 || reader.prefetched === target) return
    const prefetch = { abort: new AbortController() }
    reader.prefetch = prefetch
    void reader.session().then(session => session.prefetch(target, prefetch.abort.signal))
      .then(result => {
        if (result.retained) reader.prefetched = target
        if (from !== reader.key && result.keySeconds !== undefined) reader.key = result.keySeconds
      }, () => undefined)
      .finally(() => { if (reader.prefetch === prefetch) reader.prefetch = undefined })
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
    clearTimeout(this.readerSweep); this.readerSweep = undefined
    for (const reader of this.readers.values()) this.closeReader(reader)
    this.readers.clear()
    for (const window of this.windows.values()) { window.abort.abort(); for (const waiter of window.waiters) waiter.reject(closedFailure()); window.waiters.clear() }
    await Promise.allSettled([...this.windows.values()].map(window => window.done))
    this.windows.clear()
    if (this.opened) this.backend.release(this.opened.key)
    this.opened = undefined
    // 原生会话跨片段保留时，已复制的 GOP 帧也交给原有有界帧缓存淘汰，避免切回时重新解码。
    if (!this.backend.managesIdleSessions) this.cache.deleteMedia(this.path)
  }
}
