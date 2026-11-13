import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import type { AudioCaptureEvent, SystemAudioNativeEvent } from '../../../../src/core/audioCapture/contracts'
import type { RecordingTrackKind, RecordingTrackGap } from '../../../../src/core/screenRecording/tracks'
import type { RecordingTrackOpenSegment, RecordingTrackRecord } from '../../../../src/core/screenRecording/trackJournal'
import { mainClockUs, type AudioCaptureClient, type AudioCaptureLoss } from './client'
import { AudioCaptureError } from './protocol'
import type { createMainLogger } from '../logging'

/** 原生服务失联或设备没了之后的重连间隔：先快后慢，直到这次录制结束。 */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 3000]
/** 补没封口的段前等旧进程退出的上限。 */
const SETTLE_WAIT_MS = 5000

export type NativeTrackHealth = Record<string, number>
/** 原生计数每开一段会话从零算起，结束的会话累加起来：写盘峰值取最大，最近一次缺口取后来的，其余相加。 */
function addHealth<H extends NativeTrackHealth>(a: H, b: H): H {
  const sum: NativeTrackHealth = { ...a }
  for (const [key, value] of Object.entries(b)) sum[key] = key === 'maxWriteMs' ? Math.max(a[key] ?? 0, value) : key === 'lastGlitchSeconds' ? value : (a[key] ?? 0) + value
  return sum as H
}

/** 一种由原生录音服务按段落盘的轨道（系统声、录屏的麦克风轨）：怎么开一段原生会话、怎么读它的健康计数。 */
export interface NativeTrackSource<H extends NativeTrackHealth> {
  kind: Extract<RecordingTrackKind, 'microphone' | 'systemAudio'>
  /** 日志里的称呼与事件前缀。 */
  label: string
  event: string
  logger: ReturnType<typeof createMainLogger>
  client: AudioCaptureClient
  zero: H
  /** 开一段原生会话写进 directory；reconnecting 时设备可能已换（重新枚举）。 */
  begin(sessionId: string, directory: string, reconnecting: boolean): Promise<{ sampleRate: number; device: string }>
  /** 原生应答里的累计健康计数。 */
  health(result: unknown): H
  /** 这些计数出现新增就记一条缺口日志。 */
  glitchKeys: readonly (keyof H & string)[]
  /** 原生结束会话的中断是设备没了（补空档、重连接着录），还是写盘失败（这一路结束）。 */
  deviceLost(code: string): boolean
}

export interface NativeTrackRecording {
  /** 段文件写在这里（录制自己的目录）。 */
  directory: string
  /** 轨道时间的零点：主进程单调微秒，与画面、事件、其他声音轨共用。 */
  originUs: number
  /** 每开一段、封一段、记一个空档都按发生顺序交出；时间相对 originUs。 */
  record(record: RecordingTrackRecord): void
  /** 写盘失败（磁盘满、文件出错）：这一路已停，已写的段都在。 */
  failed?(error: AudioCaptureError): void
  /** 这一路暂时录不到（原生服务失联重连中、设备不在）时为 false，恢复后为 true。 */
  available?(available: boolean): void
  /** 电平（0–1 的峰值），约每 33 毫秒一次。 */
  level?(peak: number): void
}
export interface NativeTrackSummary<H extends NativeTrackHealth> { outcome: 'completed' | 'failed'; durationSeconds: number; segments: number; reconnects: number; device: string; health: H }
/** 使用方（录屏、界面自己的录制）只需要的那几个动作，不管是哪种轨道。 */
export interface NativeTrack {
  pause(): Promise<void>
  resume(): Promise<void>
  stop(atUs?: number): Promise<NativeTrackSummary<NativeTrackHealth>>
  stats(): NativeTrackSummary<NativeTrackHealth>
}

type SegmentEvent = Extract<SystemAudioNativeEvent, { event: 'segment' }>
type GapReason = RecordingTrackGap['reason']
type Native = AudioCaptureEvent | SystemAudioNativeEvent

/**
 * 一次录制里的一路原生轨道。原生会话负责采集与落盘，这里把段事件换算成轨道记录；暂停就结束这一段原生会话、恢复再开一段。
 * 原生服务失联或设备没了时先记空档、自动重连接着录；失联前没封口的段按文件补出来。
 * 只有开始时开不了才报错；之后暂停、恢复、停止都不因原生出错而失败，已写的段都在文件里。
 */
export class NativeTrackRecorder<H extends NativeTrackHealth> {
  private native: string | undefined
  private state: 'starting' | 'recording' | 'paused' | 'reconnecting' | 'stopped' = 'starting'
  private outcome: NativeTrackSummary<H>['outcome'] = 'completed'
  private readonly opened = new Map<string, { segment: RecordingTrackOpenSegment; bytesPerFrame: number }>()
  private pending: { fromUs: number; reason: GapReason } | undefined
  /** 已封口的段里最晚的终点：暂停与设备空档从真正录到的最后一帧起算。 */
  private lastEndUs: number | undefined
  private reconnect: { timer?: ReturnType<typeof setTimeout>; attempt: number; since: number } | undefined
  private chain: Promise<unknown> = Promise.resolve()
  /** 录不到的原因；都消失才算恢复。 */
  private readonly down = new Set<'process' | 'device'>()
  private earlier: H
  private health: H | null = null
  private device = ''
  private frames = 0
  private sampleRate = 48000
  private reconnects = 0
  private sealed = 0
  private gaps = 0
  /** 最近一次失联的时刻，与补旧段的进行中任务。 */
  private lossAtUs: number | undefined
  private settling: Promise<void> | undefined
  private readonly startedAt = Date.now()
  constructor(private readonly source: NativeTrackSource<H>, readonly options: NativeTrackRecording, private readonly released: (recorder: NativeTrackRecorder<H>) => void) { this.earlier = source.zero }

  owns(sessionId: string): boolean { return this.native === sessionId }
  /** 原生会话在采集（不在暂停、重连中）。 */
  live(): boolean { return this.native !== undefined }
  /** 等待原生应答期间写盘失败的事件可能已经把这一路结束了；用方法读，免得类型收窄当成不可能。 */
  private ended(): boolean { return this.state === 'stopped' }
  private exclusive<T>(task: () => Promise<T>): Promise<T> { const next = this.chain.then(task); this.chain = next.catch(() => undefined); return next }
  private nowUs(): number { return Math.max(0, Math.round(mainClockUs() - this.options.originUs)) }
  private name(event: string): string { return `${this.source.event}.${event}` }
  /** 交给使用方的记录出错（例如校验不过）只记日志：不能让它沿着事件回调冒到原生客户端，被当成协议错误收掉进程。 */
  private emit(record: RecordingTrackRecord): void {
    if (record.type === 'gap') this.gaps += 1
    try { this.options.record(record) } catch (error) { this.source.logger.error(`${this.source.label}轨道记录没能登记`, { event: this.name('record.failed'), error, context: { type: record.type } }) }
  }
  private setDown(reason: 'process' | 'device', on: boolean): void {
    const was = this.down.size > 0
    if (on) this.down.add(reason); else this.down.delete(reason)
    if (was !== this.down.size > 0) this.options.available?.(this.down.size === 0)
  }
  private gap(fromUs: number, toUs: number, reason: GapReason): void { if (toUs > fromUs) this.emit({ type: 'gap', kind: this.source.kind, gap: { monoSpanUs: [fromUs, toUs], reason } }) }

  /** 第一次开始：开不了就报错。 */
  async open(): Promise<void> { await this.begin(); if (this.state === 'starting') this.state = 'recording' }
  private async begin(): Promise<void> {
    const sessionId = randomUUID()
    // 段事件可能先于开始的应答到达：先认下这个会话号。
    this.native = sessionId
    try {
      const status = await this.source.begin(sessionId, this.options.directory, this.state !== 'starting')
      this.sampleRate = status.sampleRate
      if (this.state === 'starting') this.source.logger.info(`${this.source.label}开始采集`, { event: this.name('start.completed'), context: { device: status.device, sampleRate: status.sampleRate } })
      else if (this.device && status.device !== this.device) this.source.logger.info(`${this.source.label}设备已换`, { event: this.name('device.changed'), context: { from: this.device, device: status.device } })
      this.device = status.device
      this.setDown('device', false)
    } catch (error) { if (this.native === sessionId) this.native = undefined; throw error }
  }
  pause(): Promise<void> {
    return this.exclusive(async () => {
      if (this.state !== 'recording' && this.state !== 'reconnecting') return
      const atUs = this.nowUs(), reconnecting = this.state === 'reconnecting'
      await this.quiesce()
      // 收尾途中写盘失败，这一路已经结束。
      if (this.ended()) return
      this.state = 'paused'
      // 重连中暂停：之前那段先按原因记成空档，暂停从按下的这一刻起算。
      this.closePending(atUs)
      this.pending = { fromUs: reconnecting ? atUs : this.lastEndUs ?? atUs, reason: 'pause' }
      // 暂停期间不在采集，提醒撤掉；恢复后设备仍不在会再报。
      this.setDown('process', false); this.setDown('device', false)
    })
  }
  resume(): Promise<void> {
    return this.exclusive(async () => {
      if (this.state !== 'paused') return
      try { await this.begin(); if (this.state === 'paused') this.state = 'recording' } catch (error) {
        // 恢复时暂时开不了（设备不在、原生服务出错）不让整次录屏失败：按重连处理，暂停那段照常记暂停。
        this.source.logger.warn(`${this.source.label}恢复时没能开始，稍后自动重试`, { event: this.name('resume.failed'), error })
        this.lose(this.nowUs(), 'missing-data', 'process')
        this.versionMismatch(error)
      }
    })
  }
  /** 停止：原生会话收尾后，最后一段的封口记录已经交出。暂停或重连中停止时空档记到按下停止的时刻。 */
  stop(atUs = this.nowUs()): Promise<NativeTrackSummary<H>> {
    return this.exclusive(async () => {
      if (this.state === 'stopped') return this.summary()
      await this.quiesce()
      if (this.ended()) return this.summary()
      this.state = 'stopped'
      this.closePending(atUs)
      this.setDown('process', false); this.setDown('device', false)
      this.released(this)
      return this.finish()
    })
  }
  private closePending(atUs: number): void {
    if (this.pending) this.gap(this.pending.fromUs, atUs, this.pending.reason)
    this.pending = undefined
  }
  /** 结束当前原生会话（若有），取消重连，把没封口的段按文件补出来。 */
  private async quiesce(): Promise<void> {
    const sessionId = this.native
    let pending = false
    if (sessionId) {
      try {
        const result = await this.source.client.request('stop', { sessionId })
        this.fold(this.source.health(result))
        pending = z.object({ pending: z.literal(true) }).safeParse(result).success
      } catch (error) { this.outcome = 'failed'; this.source.logger.warn(`${this.source.label}没能正常收尾，按文件补齐已写的段`, { event: this.name('stop.failed'), error }) }
      finally { if (this.native === sessionId) this.native = undefined }
    }
    // 磁盘卡得太久，原生先应答、写盘线程还在写：没封口的段不能现在按文件补（文件还在变），留给录制收尾按文件补齐。
    if (pending) {
      this.outcome = 'failed'
      this.source.logger.warn(`${this.source.label}停止时磁盘还在写，没封口的段留到录制收尾再补`, { event: this.name('stop.pending'), context: { segments: this.opened.size } })
      this.opened.clear()
    }
    const reconnecting = this.state === 'reconnecting'
    clearTimeout(this.reconnect?.timer); this.reconnect = undefined
    await this.settling
    if (this.opened.size) await this.settleOpened([...this.opened.keys()], reconnecting ? this.lossAtUs : undefined)
  }
  private fold(final: H | null): void { if (final) this.earlier = addHealth(this.earlier, final); this.health = null }
  private finish(): NativeTrackSummary<H> {
    const summary = this.summary()
    this.source.logger.info(`${this.source.label}结束汇总`, { event: this.name('summary'), context: { outcome: summary.outcome, durationSeconds: summary.durationSeconds, reconnects: summary.reconnects, gaps: this.gaps, device: summary.device, elapsedSeconds: Math.round((Date.now() - this.startedAt) / 1000), ...summary.health } })
    return summary
  }
  /** 到此刻为止的累计事实；录制读回长录事实用，停止后仍可读。 */
  stats(): NativeTrackSummary<H> { return this.summary() }
  private summary(): NativeTrackSummary<H> {
    const health = this.health ? addHealth(this.earlier, this.health) : this.earlier
    return { outcome: this.outcome, durationSeconds: this.frames / this.sampleRate, segments: this.sealed, reconnects: this.reconnects, device: this.device, health }
  }

  event(event: Native): void {
    if (event.event === 'segment') this.segment(event)
    else if (event.event === 'device') this.deviceEvent(event)
    else if (event.event === 'systemHealth' || event.event === 'health') this.recordHealth(event.health as unknown as H)
    else if (event.event === 'level') { if (event.peak.length) this.options.level?.(Math.min(1, Math.max(...event.peak))) }
    else if (event.event === 'interrupted') {
      this.native = undefined; this.fold(event.health ? event.health as unknown as H : this.health)
      clearTimeout(this.reconnect?.timer); this.reconnect = undefined
      if (this.state !== 'stopped' && this.source.deviceLost(event.error.code)) {
        // 设备没了：原生已把最后一段封口。轨道从真正录到的最后一帧起记设备空档，设备回来（或换到默认设备）后接着录。
        this.source.logger.warn(`${this.source.label}设备中断，留空档并自动重连`, { event: this.name('device.lost'), context: { code: event.error.code } })
        this.lose(this.lastEndUs ?? this.nowUs(), 'device', 'device')
        return
      }
      // 写盘失败：这一路停止；最后一段若没封上，按文件补出来。
      this.state = 'stopped'; this.outcome = 'failed'
      this.setDown('process', false); this.setDown('device', false)
      this.source.logger.error(`${this.source.label}写盘失败，这一路停止，已写的段保留`, { event: this.name('failed'), context: { code: event.error.code, writtenBytes: event.writtenBytes } })
      this.released(this)
      void this.exclusive(async () => { if (this.opened.size) await this.settleOpened([...this.opened.keys()]); this.finish() })
      this.options.failed?.(new AudioCaptureError(event.error.code, event.error.message))
    }
  }
  /** 输出设备不在或被独占（系统声）：原生照常补静音、时间轴不断，这里只提醒用户这段没有录到声音。 */
  private deviceEvent(event: Extract<SystemAudioNativeEvent, { event: 'device' }>): void {
    if (event.state === 'unavailable') {
      this.source.logger.warn(`${this.source.label}设备暂时不可用，补静音继续`, { event: this.name('device.unavailable'), context: { device: event.name, reason: event.reason, atSeconds: event.atSeconds } })
      this.setDown('device', true)
      return
    }
    if (!this.device) this.device = event.name
    else if (event.name !== this.device) {
      this.source.logger.info(`${this.source.label}设备已换`, { event: this.name('device.changed'), context: { from: this.device, device: event.name, atSeconds: event.atSeconds } })
      this.device = event.name
    } else if (this.down.has('device')) this.source.logger.info(`${this.source.label}设备已恢复`, { event: this.name('device.restored'), context: { device: event.name, atSeconds: event.atSeconds } })
    this.setDown('device', false)
  }
  private segment(event: SegmentEvent): void {
    const startUs = Math.max(0, Math.round(event.monoUs - this.options.originUs))
    if (event.phase === 'seal') {
      const open = this.opened.get(event.segmentId)
      this.opened.delete(event.segmentId)
      if (open && event.frames) this.seal(open.segment, event.frames)
      return
    }
    if (this.pending) {
      this.gap(this.pending.fromUs, startUs, this.pending.reason)
      this.pending = undefined
    }
    const segment: RecordingTrackOpenSegment = { id: event.segmentId, file: event.file, sampleRate: event.sampleRate, channels: event.channels, latencyCompensationUs: 0,
      sourceClockOffsetUs: startUs - Math.round(event.firstFrame * 1_000_000 / event.sampleRate), monoStartUs: startUs,
      anchor: { monoUs: startUs, presentedFrame: null, requestedFrame: null, sequenceRef: null, visitRef: null, playbackDirection: 0, playbackRate: 1, playing: false, epoch: 0, uncertaintyUs: Math.ceil(event.uncertaintyUs), audioSample: 0, audioSegmentRef: event.segmentId, audioRate: event.sampleRate } }
    this.opened.set(event.segmentId, { segment, bytesPerFrame: (event.bitDepth ?? 16) / 8 * event.channels })
    this.emit({ type: 'open', kind: this.source.kind, segment: structuredClone(segment) })
  }
  /** 段的终点按帧数推算；下一段的起点是它自己的真实时刻，设备时钟的漂移留给拼接处吸收。 */
  private seal(open: RecordingTrackOpenSegment, frames: number): void {
    const { monoStartUs, anchor, ...rest } = open
    const endUs = monoStartUs + Math.round(frames * 1_000_000 / (open.sampleRate ?? this.sampleRate))
    this.lastEndUs = Math.max(this.lastEndUs ?? 0, endUs); this.frames += frames; this.sealed += 1
    this.emit({ type: 'seal', kind: this.source.kind, segment: { ...rest, monoSpanUs: [monoStartUs, endUs], units: frames, anchors: [anchor, { ...anchor, monoUs: endUs, audioSample: frames }] } })
  }
  private recordHealth(health: H): void {
    const previous = this.health
    this.health = health
    const grew = (key: string): number => (health[key] ?? 0) - (previous?.[key] ?? 0)
    const grown = Object.fromEntries(this.source.glitchKeys.map(key => [`new${key[0].toUpperCase()}${key.slice(1)}`, grew(key)]))
    const context = { ...health, ...grown }
    if (Object.values(grown).some(value => value > 0)) this.source.logger.warn(`${this.source.label}出现缺口，已补静音并继续`, { event: this.name('glitch'), context })
    else if (grew('maxWriteMs') > 0 && (health.maxWriteMs ?? 0) >= 100) this.source.logger.warn(`${this.source.label}写盘耗时出现新峰值`, { event: this.name('disk.slow'), context })
  }

  /**
   * 原生程序与应用版本不一致：重连永远连不上，不再重试。这一路按失败结束，使用方收到那条可操作的提示（重新安装或重新构建）。
   */
  private versionMismatch(error: unknown): boolean {
    if (!(error instanceof AudioCaptureError) || error.code !== 'VERSION_MISMATCH') return false
    clearTimeout(this.reconnect?.timer); this.reconnect = undefined
    this.closePending(this.nowUs())
    this.state = 'stopped'; this.outcome = 'failed'
    this.setDown('process', false); this.setDown('device', false)
    this.source.logger.error(`${this.source.label}的录音组件版本与应用不一致，不再重连`, { event: this.name('failed'), error })
    this.released(this)
    this.finish()
    this.options.failed?.(error)
    return true
  }

  /** 原生服务失联（崩溃、不应答）：自动重连接着录。 */
  lost(loss: AudioCaptureLoss): void {
    if (this.state !== 'recording') return
    this.source.logger.warn(`${this.source.label}服务失联，自动重连`, { event: this.name('reconnect.start'), context: { code: loss.code } })
    this.lose(this.nowUs(), 'missing-data', 'process')
  }
  private lose(atUs: number, reason: GapReason, down: 'process' | 'device'): void {
    this.native = undefined; this.state = 'reconnecting'; this.fold(this.health)
    // 还没被下一段消费的暂停空档到此为止，之后按这次的原因记。
    this.closePending(atUs)
    this.pending = { fromUs: atUs, reason }
    this.lossAtUs = atUs
    clearTimeout(this.reconnect?.timer)
    this.reconnect = { attempt: 0, since: Date.now() }
    this.setDown(down, true)
    // 录不到的这段电平不能停在最后的值上。
    this.options.level?.(0)
    this.schedule()
  }
  private schedule(): void {
    const reconnect = this.reconnect
    if (!reconnect) return
    reconnect.timer = setTimeout(() => { void this.exclusive(() => this.reconnectOnce(reconnect)) }, RECONNECT_DELAYS_MS[Math.min(reconnect.attempt, RECONNECT_DELAYS_MS.length - 1)])
    reconnect.timer.unref?.()
  }
  private async reconnectOnce(reconnect: NonNullable<NativeTrackRecorder<H>['reconnect']>): Promise<void> {
    if (this.reconnect !== reconnect || this.state !== 'reconnecting') return
    reconnect.attempt += 1
    // 失联前开了头的段：先记下，等新会话开起来再补，不让不应答的旧进程（最多两分钟才退）拖住重连。
    const stale = [...this.opened.keys()]
    try {
      await this.begin()
      if (this.reconnect !== reconnect) return
      this.state = 'recording'; this.reconnect = undefined; this.reconnects += 1
      this.setDown('process', false)
      this.source.logger.info(`${this.source.label}已重连`, { event: this.name('reconnect.completed'), context: { attempts: reconnect.attempt, gapSeconds: (Date.now() - reconnect.since) / 1000, device: this.device } })
    } catch (error) {
      if (this.reconnect !== reconnect) return
      if (this.versionMismatch(error)) return
      if (reconnect.attempt === 1) this.source.logger.warn(`${this.source.label}重连失败，稍后再试`, { event: this.name('reconnect.failed'), error, context: { attempt: reconnect.attempt } })
      else this.source.logger.debug(`${this.source.label}重连失败，稍后再试`, { event: this.name('reconnect.failed'), error, context: { attempt: reconnect.attempt } })
      this.schedule()
      return
    }
    // 补旧段放在串行队列之外：暂停、停止、下一次重连都不等它（停止前会等它做完）。
    // 封口不超过失联时刻：不应答的旧进程可能还在往这一段里写，越过的部分与新会话重叠。
    if (stale.length) this.settling = this.settleOpened(stale, this.lossAtUs)
  }
  /**
   * 开了头没封口的段：等旧进程退出后按文件里实际写到的帧补出封口记录；一帧都没有就放弃。
   * 不应答的旧进程最多两分钟才退，只等一会儿；没补上的段留给录制收尾按文件补（主进程录屏的轨道记录会做）。
   */
  private async settleOpened(ids: string[], capUs?: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const exited = await Promise.race([this.source.client.settled().then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), SETTLE_WAIT_MS); timer.unref?.() })])
    clearTimeout(timer)
    if (!exited) { this.source.logger.warn(`旧的${this.source.label}进程还没退出，没封口的段留到录制收尾再补`, { event: this.name('repair.deferred'), context: { segments: ids.length } }); return }
    for (const id of ids) {
      const open = this.opened.get(id)
      if (!open) continue
      this.opened.delete(id)
      try {
        const { writtenBytes } = z.object({ writtenBytes: z.number() }).parse(await this.source.client.request('recover', { outputPath: path.join(this.options.directory, open.segment.file) }))
        const rate = open.segment.sampleRate ?? this.sampleRate
        const written = Math.floor(writtenBytes / open.bytesPerFrame)
        const frames = capUs === undefined ? written : Math.min(written, Math.max(0, Math.floor((capUs - open.segment.monoStartUs) * rate / 1_000_000)))
        if (frames > 0) { this.seal(open.segment, frames); this.source.logger.info(`补回没封口的${this.source.label}分段`, { event: this.name('repair.completed'), context: { frames } }) }
      } catch (error) { this.source.logger.warn(`没封口的${this.source.label}分段无法补回`, { event: this.name('repair.failed'), error }) }
    }
  }
}
