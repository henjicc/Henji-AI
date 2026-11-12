import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import { decodePersistenceResource } from '@/core/persistence/resourceContracts'
import { recordingTrackOptionsSchema, type RecordingTrackKind, type RecordingTrackOptions, type RecordingTracks } from '@/core/screenRecording/tracks'
import { RecordingTrackState, type RecordingTrackRecord } from '@/core/screenRecording/trackJournal'
import type { RecordingTrackStatus } from '@/core/screenRecording/contracts'
import type { CapturedAudioBlock } from '@/features/creativeIntent'
import { RecordingTracksClock } from './clock'
import { openTrackDevice, type OpenTrackDevice, type TrackDevice } from './devices'
import { createTrackOutput, type TrackOutput } from './output'

const logger = createLogger('features.screen_recording.tracks')
type GapReason = Extract<RecordingTrackRecord, { type: 'gap' }>['gap']['reason']
interface Slot {
  kind: RecordingTrackKind; output: TrackOutput; device?: TrackDevice; opening?: Promise<void>; queue: Promise<void>; queuedBytes: number; backlogWarned: boolean
  accepting: boolean; closing: boolean; disconnected: boolean; gap?: { at: number; reason: GapReason }
  lastEnd?: number; previousAudioFrame?: number; previousAudioRate?: number; silentFrames: number; silent: boolean; warned: boolean
}
export interface RecordingTracksSessionOptions {
  sessionId: string
  /** Same main-process originUs supplied to RecordingEventSession and screen capture. */
  originUs: number
  directory: string
  tracks: RecordingTrackOptions
  onFailure(error: unknown): void
  /** Clone audio from the screen fallback to avoid opening a second display stream. Ownership transfers here. */
  displayAudio?: () => Promise<MediaStream>
  /** 每开一段、封一段、记一个空档或警告都按发生顺序交出去；录屏把它交给主进程登记。 */
  onRecord?(record: RecordingTrackRecord): Promise<void>
  /** 原生麦克风整段副本写到这里并留给录制收尾补采样；不给时写系统临时目录、停止即删。 */
  microphoneCopyDirectory?: string
  status?(status: RecordingTrackStatus): Promise<void>
}
export interface RecordingTracksDependencies { openDevice?: OpenTrackDevice; output?: typeof createTrackOutput; clock?: RecordingTracksClock; silentRisk?: boolean; queueBudgetBytes?: number }
/**
 * 每路排队等写盘的采样上限。写盘慢时宁可在内存里多攒（系统声 48 kHz 双声道约 8 分钟），
 * 也不因为一时卡顿停掉录制；真写不进去由写入失败结束。
 */
const QUEUE_BUDGET_BYTES = 256 * 1024 * 1024
const QUEUE_WARNING_BYTES = 16 * 1024 * 1024

/** Internal capture substrate. 1.5 owns the public session entity/coordinator; UI/Pi/MCP all delegate to it. */
export class RecordingTracksSession {
  private readonly options: RecordingTracksSessionOptions
  private readonly slots: Slot[]
  private readonly state: RecordingTrackState
  private readonly clock: RecordingTracksClock
  private readonly abort = new AbortController()
  private phase: 'ready' | 'recording' | 'paused' | 'stopped' = 'ready'
  private transition: Promise<void> = Promise.resolve()
  private records: Promise<void> = Promise.resolve()
  private terminal: Promise<void> | undefined
  private failure: unknown
  private risk = false
  private preview: string | null = null
  private level: number | null = null
  private lastPreview = -Infinity
  private lastStatus = -Infinity
  private publishing = false
  private readonly retry = (): void => { void this.exclusive(() => this.reconnect()).catch(error => this.fail(error)) }
  constructor(options: RecordingTracksSessionOptions, private readonly dependencies: RecordingTracksDependencies = {}) {
    this.options = { ...options, tracks: recordingTrackOptionsSchema.parse(options.tracks) }
    this.clock = dependencies.clock ?? new RecordingTracksClock(options.originUs, () => getPlatform().screenRecording.clock(), error => this.fail(error))
    const kinds: RecordingTrackKind[] = []
    if (this.options.tracks.microphone) kinds.push('microphone')
    if (this.options.tracks.systemAudio) kinds.push('systemAudio')
    if (this.options.tracks.camera) kinds.push('camera')
    this.state = new RecordingTrackState(kinds)
    this.slots = kinds.map(kind => ({ kind, output: (dependencies.output ?? createTrackOutput)(kind, options.directory, this.options.tracks.camera?.frameRate ?? 30,
      async segment => { this.record({ type: 'seal', kind, segment: structuredClone(segment) }) },
      segment => this.record({ type: 'open', kind, segment })),
    queue: Promise.resolve(), queuedBytes: 0, backlogWarned: false, accepting: false, closing: false, disconnected: false, silentFrames: 0, silent: false, warned: false }))
  }
  /** 本地状态与交给主进程的记录同源；记录依次送达，主进程按到达顺序追加。 */
  private record(record: RecordingTrackRecord): void {
    this.state.apply(record)
    const deliver = this.options.onRecord
    if (deliver) this.records = this.records.then(() => deliver(record)).catch(error => logger.warn('录制轨道记录未送达主进程', { event: 'recording.tracks.record.failed', error, context: { type: record.type } }))
  }
  private exclusive(operation: () => Promise<void>): Promise<void> {
    const next = this.transition.then(operation); this.transition = next.catch(() => undefined); return next
  }
  start(signal: AbortSignal): Promise<void> {
    return this.exclusive(async () => {
      if (this.phase !== 'ready') throw new Error('声音与摄像头采集已经开始')
      logger.info('开始采集声音与摄像头', { event: 'recording.tracks.start.start' })
      const abort = (): void => { void this.cancel().catch(error => this.fail(error)) }
      signal.addEventListener('abort', abort, { once: true })
      this.abort.signal.addEventListener('abort', () => signal.removeEventListener('abort', abort), { once: true })
      try {
        signal.throwIfAborted(); this.abort.signal.throwIfAborted()
        await getPlatform().system.fs.mkdir(this.options.directory, { recursive: true })
        await this.clock.start()
        this.risk = this.dependencies.silentRisk ?? (await getPlatform().screenRecording.permissions()).find(item => item.kind === 'systemAudio')?.status === 'unknown'
        this.phase = 'recording'
        navigator.mediaDevices.addEventListener('devicechange', this.retry)
        await this.openAll(signal)
        logger.info('声音与摄像头采集已开始', { event: 'recording.tracks.start.completed' })
      } catch (error) { if (error !== this.abort.signal.reason) this.fail(error); await Promise.allSettled(this.slots.map(slot => this.release(slot))); throw error }
    })
  }
  /** 界面重新接上暂停中的录制：设备留到恢复时再开，只登记这次会话。 */
  async attachPaused(): Promise<void> {
    await this.exclusive(async () => {
      if (this.phase !== 'ready') throw new Error('声音与摄像头采集已经开始')
      await getPlatform().system.fs.mkdir(this.options.directory, { recursive: true })
      await this.clock.start()
      this.risk = this.dependencies.silentRisk ?? (await getPlatform().screenRecording.permissions()).find(item => item.kind === 'systemAudio')?.status === 'unknown'
      this.phase = 'paused'
      navigator.mediaDevices.addEventListener('devicechange', this.retry)
    })
  }
  private async openAll(signal: AbortSignal): Promise<void> {
    const results = await Promise.allSettled(this.slots.map(slot => this.open(slot)))
    signal.throwIfAborted(); this.abort.signal.throwIfAborted()
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }
  private open(slot: Slot): Promise<void> {
    if (slot.opening || slot.device) return slot.opening ?? Promise.resolve()
    slot.accepting = true; slot.closing = false; slot.previousAudioFrame = undefined; slot.previousAudioRate = undefined; slot.silentFrames = 0; slot.silent = false
    const task = (async () => {
      const device = await (this.dependencies.openDevice ?? openTrackDevice)(slot.kind, this.options.tracks, this.clock, {
        audio: block => this.audio(slot, block),
        video: (frame, monoUs, uncertaintyUs, compensationUs) => this.video(slot, frame, monoUs, uncertaintyUs, compensationUs),
        state: state => this.deviceState(slot, state), failed: error => this.fail(error),
      }, this.abort.signal, this.options.displayAudio, this.options.microphoneCopyDirectory)
      if (this.abort.signal.aborted || this.phase !== 'recording') { await device.stop(); return }
      slot.device = device; slot.disconnected = false
    })().finally(() => { slot.opening = undefined })
    slot.opening = task; return task
  }
  private enqueue(slot: Slot, bytes: number, operation: () => Promise<void>): Promise<void> {
    const budget = this.dependencies.queueBudgetBytes ?? QUEUE_BUDGET_BYTES
    if (slot.queuedBytes + bytes > budget) { const error = new Error('录制写入跟不上采集，请停止录制并检查磁盘'); this.fail(error); return Promise.reject(error) }
    slot.queuedBytes += bytes
    if (slot.queuedBytes > QUEUE_WARNING_BYTES && !slot.backlogWarned) {
      slot.backlogWarned = true
      logger.warn('录制声音写盘跟不上，暂存在内存中继续录制', { event: 'recording.tracks.backlog', context: { kind: slot.kind, queuedBytes: slot.queuedBytes } })
    }
    const task = slot.queue.then(() => { this.abort.signal.throwIfAborted(); return operation() }).finally(() => {
      slot.queuedBytes -= bytes
      if (slot.backlogWarned && slot.queuedBytes < QUEUE_WARNING_BYTES / 4) slot.backlogWarned = false
    })
    slot.queue = task.catch(error => { if (error !== this.abort.signal.reason) this.fail(error) })
    return task
  }
  private beginData(slot: Slot, monoUs: number): void {
    if (slot.gap) {
      if (monoUs > slot.gap.at) this.record({ type: 'gap', kind: slot.kind, gap: { monoSpanUs: [slot.gap.at, monoUs], reason: slot.gap.reason } })
      slot.gap = undefined
    }
  }
  private audio(slot: Slot, block: CapturedAudioBlock): void {
    if (!slot.accepting || this.abort.signal.aborted) return
    const channels = block.channels ?? 1
    const previousFrame = slot.previousAudioFrame; const previousRate = slot.previousAudioRate
    slot.previousAudioFrame = block.firstFrame + block.samples.length / channels; slot.previousAudioRate = block.sampleRate
    const discontinuity = previousFrame !== undefined && (block.firstFrame !== previousFrame || previousRate !== block.sampleRate)
    if (slot.kind === 'microphone') this.level = Math.min(1, Math.max(...block.samples.subarray(0, 4096).map(Math.abs)))
    if (slot.kind === 'systemAudio' && this.risk) {
      const audible = block.samples.some(sample => Math.abs(sample) > .00001)
      slot.silentFrames = audible ? 0 : slot.silentFrames + block.samples.length / channels
      slot.silent = slot.silentFrames >= block.sampleRate * 5
      if (slot.silent && !slot.warned) { slot.warned = true; this.record({ type: 'warning', kind: slot.kind, warning: 'system-audio-silent' }); logger.warn('系统声音持续静音，请检查采集权限', { event: 'recording.tracks.system_audio.silent' }) }
    }
    this.publish()
    void this.enqueue(slot, block.samples.byteLength, async () => {
      if (discontinuity) { await slot.output.close(); this.gap(slot, 'missing-data') }
      this.beginData(slot, block.monoStartUs)
      await slot.output.audio(block)
      slot.lastEnd = block.monoStartUs + Math.round(block.samples.length / channels / block.sampleRate * 1_000_000)
    }).catch(() => undefined)
  }
  private async video(slot: Slot, frame: VideoFrame, monoUs: number, uncertaintyUs: number, compensationUs: number): Promise<void> {
    if (!slot.accepting || this.abort.signal.aborted) return
    if (monoUs - this.lastPreview >= 500_000) {
      this.lastPreview = monoUs
      const scale = Math.min(160 / frame.displayWidth, 90 / frame.displayHeight)
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(frame.displayWidth * scale)); canvas.height = Math.max(1, Math.round(frame.displayHeight * scale))
      canvas.getContext('2d')?.drawImage(frame, 0, 0, canvas.width, canvas.height)
      this.preview = canvas.toDataURL('image/jpeg', .6); this.publish()
    }
    await this.enqueue(slot, 0, async () => {
      const quantumUs = Math.ceil(1_000_000 / (this.options.tracks.camera?.frameRate ?? 30))
      // MP4 preserves source PTS gaps. Restarting the encoder here amplifies dropped frames through cold starts.
      if (!slot.gap && slot.lastEnd !== undefined && monoUs - slot.lastEnd > quantumUs) this.record({ type: 'gap', kind: slot.kind, gap: { monoSpanUs: [slot.lastEnd, monoUs], reason: 'missing-data' } })
      this.beginData(slot, monoUs)
      await slot.output.video(frame, monoUs, uncertaintyUs, compensationUs)
      slot.lastEnd = monoUs + (frame.duration ?? quantumUs)
    })
  }
  private gap(slot: Slot, reason: GapReason): void { slot.gap ??= { at: slot.lastEnd ?? this.clock.nowUs(), reason } }
  private deviceState(slot: Slot, state: 'ended' | 'muted' | 'unmuted'): void {
    if (slot.closing || this.phase !== 'recording' || this.abort.signal.aborted) return
    if (state === 'unmuted') { slot.accepting = true; slot.disconnected = false; slot.previousAudioFrame = undefined; this.publish(true); return }
    slot.accepting = false; slot.disconnected = true; this.preview = null
    void this.enqueue(slot, 0, async () => { await slot.output.close(); this.gap(slot, state === 'ended' ? 'device' : 'muted') }).catch(() => undefined)
    if (state === 'ended') void this.exclusive(async () => { await this.release(slot); slot.disconnected = true }).catch(error => this.fail(error))
    logger.warn('录制设备中断，保留空档等待恢复', { event: 'recording.tracks.device.interrupted', context: { kind: slot.kind, state } })
    this.publish(true)
  }
  private async reconnect(): Promise<void> {
    if (this.phase !== 'recording' || this.abort.signal.aborted) return
    for (const slot of this.slots.filter(item => item.disconnected && !item.device)) {
      try { await this.open(slot); logger.info('录制设备恢复', { event: 'recording.tracks.device.restored', context: { kind: slot.kind } }) }
      catch (error) { slot.accepting = false; logger.warn('录制设备仍不可用', { event: 'recording.tracks.device.restore.failed', context: { kind: slot.kind }, error }) }
    }
    this.publish(true)
  }
  private publish(force = false): void {
    const at = this.clock.nowUs()
    if (this.publishing || !force && at - this.lastStatus < 500_000 || this.abort.signal.aborted) return
    this.lastStatus = at; this.publishing = true
    const warnings: RecordingTrackStatus['warnings'] = this.phase === 'recording' && this.slots.some(slot => slot.silent) ? ['system-audio-silent'] : []
    if (this.slots.some(slot => slot.disconnected)) warnings.push('device-disconnected')
    const status: RecordingTrackStatus = { microphoneLevel: this.phase === 'recording' ? this.level : null, cameraPreview: this.phase === 'recording' ? this.preview : null, warnings }
    void (this.options.status?.(status) ?? getPlatform().screenRecording.trackStatus(this.options.sessionId, status)).catch(error => { if (!this.abort.signal.aborted && this.phase !== 'stopped') this.fail(error) }).finally(() => { this.publishing = false })
  }
  private async release(slot: Slot): Promise<void> {
    slot.closing = true
    await slot.opening?.catch(() => undefined)
    const device = slot.device; slot.device = undefined
    try { await device?.stop() } finally { slot.accepting = false; await slot.queue; await slot.output.close() }
  }
  pause(signal: AbortSignal): Promise<void> {
    return this.exclusive(async () => {
      signal.throwIfAborted(); if (this.phase !== 'recording') throw new Error('录制没有进行中')
      this.phase = 'paused'
      const results = await Promise.allSettled(this.slots.map(async slot => { await this.release(slot); this.gap(slot, 'pause') }))
      this.preview = null; this.level = null; this.publish(true)
      this.checkResults(results)
      logger.info('声音与摄像头采集已暂停', { event: 'recording.tracks.pause.completed' })
    })
  }
  resume(signal: AbortSignal): Promise<void> {
    return this.exclusive(async () => {
      signal.throwIfAborted(); this.abort.signal.throwIfAborted(); if (this.phase !== 'paused') throw new Error('录制未暂停')
      this.phase = 'recording'
      try { await this.openAll(signal) } catch (error) { if (error !== this.abort.signal.reason) this.fail(error); await Promise.allSettled(this.slots.map(slot => this.release(slot))); throw error }
      logger.info('声音与摄像头采集已恢复', { event: 'recording.tracks.resume.completed' })
    })
  }
  stop(signal: AbortSignal): Promise<void> {
    return this.exclusive(async () => {
      signal.throwIfAborted(); if (this.phase === 'stopped') { if (this.failure) throw this.failure; return }
      const stoppedAt = this.clock.nowUs()
      logger.info('保存录制轨道', { event: 'recording.tracks.stop.start' })
      this.phase = 'stopped'; this.clock.stop(); navigator.mediaDevices.removeEventListener('devicechange', this.retry)
      const results = await Promise.allSettled(this.slots.map(slot => this.release(slot)))
      this.checkResults(results)
      for (const slot of this.slots) if (slot.gap) this.beginData(slot, stoppedAt)
      await this.records
      await this.save()
      this.abort.abort()
      logger.info('录制轨道已保存', { event: 'recording.tracks.stop.completed' })
    }).catch(error => { this.fail(error); throw error })
  }
  cancel(): Promise<void> {
    if (this.terminal) return this.terminal
    this.abort.abort(); this.clock.stop(); this.phase = 'stopped'; navigator.mediaDevices.removeEventListener('devicechange', this.retry)
    this.terminal = this.transition.then(async () => {
      const results = await Promise.allSettled(this.slots.map(async slot => { slot.accepting = false; await this.release(slot) }))
      await this.records
      this.checkResults(results)
    })
    return this.terminal
  }
  private checkResults(results: PromiseSettledResult<void>[]): void {
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed) { this.fail(failed.reason); throw failed.reason }
    if (this.failure) throw this.failure
  }
  private fail(error: unknown): void {
    if (this.failure) return
    this.failure = error
    logger.error('录制声音与摄像头失败', { event: 'recording.tracks.capture.failed', error })
    void this.cancel().catch(cleanup => logger.error('录制轨道清理失败', { event: 'recording.tracks.cancel.failed', error: cleanup }))
    this.options.onFailure(error)
  }
  snapshot(): RecordingTracks { return this.state.tracks(this.options.sessionId, this.options.originUs) }
  private async save(): Promise<void> {
    const path = await getPlatform().system.paths.join(this.options.directory, 'tracks.json')
    await getPlatform().system.fs.writeTextFile(path, JSON.stringify(this.snapshot()))
  }
}

export async function readRecordingTracks(directory: string): Promise<RecordingTracks> {
  const path = await getPlatform().system.paths.join(directory, 'tracks.json')
  return decodePersistenceResource('screen-recording-tracks', JSON.parse(await getPlatform().system.fs.readTextFile(path)))
}
