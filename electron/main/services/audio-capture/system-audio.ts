import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import { systemAudioHealthSchema, type AudioCaptureEvent, type SystemAudioHealth, type SystemAudioNativeEvent } from '../../../../src/core/audioCapture/contracts'
import type { RecordingTrackOpenSegment, RecordingTrackRecord } from '../../../../src/core/screenRecording/trackJournal'
import { AudioCaptureClient, mainClockUs, type AudioCaptureLoss } from './client'
import { AudioCaptureError } from './protocol'
import { audioCaptureExecutablePath } from './executable'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.audio_capture.system')
/** 原生服务失联后的重连间隔：先快后慢，直到这次录制结束。 */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 3000]
/** 补没封口的段前等旧进程退出的上限。 */
const SETTLE_WAIT_MS = 5000
const statusSchema = z.object({ sampleRate: z.number(), device: z.string(), durationSeconds: z.number(), systemHealth: systemAudioHealthSchema })
const ZERO_HEALTH: SystemAudioHealth = { segments: 0, silenceSeconds: 0, unavailableSeconds: 0, trimmedFrames: 0, discontinuities: 0, droppedFrames: 0, deviceSwitches: 0, maxWriteMs: 0 }
const addHealth = (a: SystemAudioHealth, b: SystemAudioHealth): SystemAudioHealth => ({ segments: a.segments + b.segments, silenceSeconds: a.silenceSeconds + b.silenceSeconds, unavailableSeconds: a.unavailableSeconds + b.unavailableSeconds,
  trimmedFrames: a.trimmedFrames + b.trimmedFrames, discontinuities: a.discontinuities + b.discontinuities, droppedFrames: a.droppedFrames + b.droppedFrames, deviceSwitches: a.deviceSwitches + b.deviceSwitches, maxWriteMs: Math.max(a.maxWriteMs, b.maxWriteMs) })

export interface SystemAudioRecording {
  /** 段文件写在这里（录制自己的目录）。 */
  directory: string
  /** 轨道时间的零点：主进程单调微秒，与画面、事件、麦克风共用。 */
  originUs: number
  /** 每开一段、封一段、记一个空档都按发生顺序交出；时间相对 originUs。 */
  record(record: RecordingTrackRecord): void
  /** 写盘失败（磁盘满、文件出错）：这一路已停，已写的段都在。 */
  failed?(error: AudioCaptureError): void
  /** 系统声暂时录不到（原生服务失联重连中、输出设备不在或被独占）时为 false，恢复后为 true。 */
  available?(available: boolean): void
}
export interface SystemAudioSummary { outcome: 'completed' | 'failed'; durationSeconds: number; segments: number; reconnects: number; device: string; health: SystemAudioHealth }

type SegmentEvent = Extract<SystemAudioNativeEvent, { event: 'segment' }>

/**
 * 一次录制的系统声。原生会话负责采集与落盘，这里把段事件换算成轨道记录；暂停就结束这一段原生会话、恢复再开一段。
 * 原生服务失联时先重开一段原生会话接着录，再把失联前没封口的段按文件补出来，中间记一段缺数据的空档。
 * 只有开始时没有可用的输出设备才报错；之后暂停、恢复、停止都不因原生出错而失败，已写的段都在文件里。
 */
export class SystemAudioRecorder {
  private native: string | undefined
  private state: 'starting' | 'recording' | 'paused' | 'reconnecting' | 'stopped' = 'starting'
  private outcome: SystemAudioSummary['outcome'] = 'completed'
  private readonly opened = new Map<string, RecordingTrackOpenSegment>()
  private pending: { fromUs: number; reason: 'pause' | 'missing-data' } | undefined
  /** 已封口的段里最晚的终点：暂停空档从真正录到的最后一帧起算。 */
  private lastEndUs: number | undefined
  private reconnect:{ timer?: ReturnType<typeof setTimeout>; attempt: number; since: number } | undefined
  private chain: Promise<unknown> = Promise.resolve()
  /** 录不到的原因；都消失才算恢复。 */
  private readonly down = new Set<'process' | 'device'>()
  /** 原生计数每开一段会话从零算起：结束的会话累加到 earlier。 */
  private earlier = ZERO_HEALTH
  private health: SystemAudioHealth | null = null
  private device = ''
  private frames = 0
  private sampleRate = 48000
  private reconnects = 0
  /** 最近一次失联的时刻，与补旧段的进行中任务。 */
  private lossAtUs: number | undefined
  private settling: Promise<void> | undefined
  private readonly startedAt = Date.now()
  constructor(private readonly client: AudioCaptureClient, readonly options: SystemAudioRecording, private readonly released: (recorder: SystemAudioRecorder) => void) {}

  owns(sessionId: string): boolean { return this.native === sessionId }
  /** 等待原生应答期间写盘失败的事件可能已经把这一路结束了；用方法读，免得类型收窄当成不可能。 */
  private ended(): boolean { return this.state === 'stopped' }
  private exclusive<T>(task: () => Promise<T>): Promise<T> { const next = this.chain.then(task); this.chain = next.catch(() => undefined); return next }
  private nowUs(): number { return Math.max(0, Math.round(mainClockUs() - this.options.originUs)) }
  /** 交给使用方的记录出错（例如校验不过）只记日志：不能让它沿着事件回调冒到原生客户端，被当成协议错误收掉进程。 */
  private emit(record: RecordingTrackRecord): void {
    try { this.options.record(record) } catch (error) { logger.error('系统声轨道记录没能登记', { event: 'audio_capture.system_audio.record.failed', error, context: { type: record.type } }) }
  }
  private setDown(reason: 'process' | 'device', on: boolean): void {
    const was = this.down.size > 0
    if (on) this.down.add(reason); else this.down.delete(reason)
    if (was !== this.down.size > 0) this.options.available?.(this.down.size === 0)
  }

  /** 第一次开始：没有可用的输出设备就报错（与原来的界面采集一致）。 */
  async open(): Promise<void> { await this.begin(); if (this.state === 'starting') this.state = 'recording' }
  private async begin(): Promise<void> {
    const sessionId = randomUUID()
    // 段事件可能先于开始的应答到达：先认下这个会话号。
    this.native = sessionId
    try {
      const status = statusSchema.parse(await this.client.request('startSystemAudio', { sessionId, directory: this.options.directory }))
      // 客户端失联时会把“正在录”清掉：每开一段原生会话都重新声明，免得空闲计时把进程关掉。
      this.client.setActive(true)
      this.sampleRate = status.sampleRate
      if (this.state === 'starting') logger.info('系统声开始采集', { event: 'audio_capture.system_audio.start.completed', context: { device: status.device, sampleRate: status.sampleRate } })
      else if (this.device && status.device !== this.device) logger.info('系统声输出设备已换', { event: 'audio_capture.system_audio.device.changed', context: { from: this.device, device: status.device } })
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
      // 重连中暂停：失联那段先记成缺数据，暂停从按下的这一刻起算。
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
        // 恢复时暂时开不了（没有输出设备、原生服务出错）不让整次录屏失败：按重连处理，暂停那段照常记暂停。
        logger.warn('系统声恢复时没能开始，稍后自动重试', { event: 'audio_capture.system_audio.resume.failed', error })
        this.lose(this.nowUs())
      }
    })
  }
  /** 停止：原生会话收尾后，最后一段的封口记录已经交出。暂停或重连中停止时空档记到按下停止的时刻。 */
  stop(atUs = this.nowUs()): Promise<SystemAudioSummary> {
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
    if (this.pending && atUs > this.pending.fromUs) this.emit({ type: 'gap', kind: 'systemAudio', gap: { monoSpanUs: [this.pending.fromUs, atUs], reason: this.pending.reason } })
    this.pending = undefined
  }
  /** 结束当前原生会话（若有），取消重连，把没封口的段按文件补出来。 */
  private async quiesce(): Promise<void> {
    const sessionId = this.native
    if (sessionId) {
      try { this.fold(statusSchema.parse(await this.client.request('stop', { sessionId })).systemHealth) }
      catch (error) { this.outcome = 'failed'; logger.warn('系统声没能正常收尾，按文件补齐已写的段', { event: 'audio_capture.system_audio.stop.failed', error }) }
      finally { if (this.native === sessionId) this.native = undefined }
    }
    const reconnecting = this.state === 'reconnecting'
    clearTimeout(this.reconnect?.timer); this.reconnect = undefined
    await this.settling
    if (this.opened.size) await this.settleOpened([...this.opened.keys()], reconnecting ? this.lossAtUs : undefined)
  }
  private fold(final: SystemAudioHealth | null): void { if (final) this.earlier = addHealth(this.earlier, final); this.health = null }
  private finish(): SystemAudioSummary {
    const summary = this.summary()
    logger.info('系统声结束汇总', { event: 'audio_capture.system_audio.summary', context: { outcome: summary.outcome, durationSeconds: summary.durationSeconds, reconnects: summary.reconnects, device: summary.device, elapsedSeconds: Math.round((Date.now() - this.startedAt) / 1000), ...summary.health } })
    return summary
  }
  private summary(): SystemAudioSummary {
    const health = addHealth(this.earlier, this.health ?? ZERO_HEALTH)
    return { outcome: this.outcome, durationSeconds: this.frames / this.sampleRate, segments: health.segments, reconnects: this.reconnects, device: this.device, health }
  }

  event(event: AudioCaptureEvent | SystemAudioNativeEvent): void {
    if (event.event === 'segment') this.segment(event)
    else if (event.event === 'device') this.deviceEvent(event)
    else if (event.event === 'systemHealth') this.recordHealth(event.health)
    else if (event.event === 'interrupted') {
      // 原生只在写盘失败时结束系统声会话；最后一段若没封上，按文件补出来。
      this.native = undefined; this.state = 'stopped'; this.outcome = 'failed'; this.fold(this.health)
      clearTimeout(this.reconnect?.timer); this.reconnect = undefined
      this.setDown('process', false); this.setDown('device', false)
      logger.error('系统声写盘失败，这一路停止，已写的段保留', { event: 'audio_capture.system_audio.failed', context: { code: event.error.code, writtenBytes: event.writtenBytes } })
      this.released(this)
      void this.exclusive(async () => { if (this.opened.size) await this.settleOpened([...this.opened.keys()]); this.finish() })
      this.options.failed?.(new AudioCaptureError(event.error.code, event.error.message))
    }
  }
  /** 输出设备不在或被独占：原生照常补静音、时间轴不断，这里只提醒用户这段没有录到声音。 */
  private deviceEvent(event: Extract<SystemAudioNativeEvent, { event: 'device' }>): void {
    if (event.state === 'unavailable') {
      logger.warn('系统声输出设备暂时不可用，补静音继续', { event: 'audio_capture.system_audio.device.unavailable', context: { device: event.name, reason: event.reason, atSeconds: event.atSeconds } })
      this.setDown('device', true)
      return
    }
    if (!this.device) this.device = event.name
    else if (event.name !== this.device) {
      logger.info('系统声输出设备已换', { event: 'audio_capture.system_audio.device.changed', context: { from: this.device, device: event.name, atSeconds: event.atSeconds } })
      this.device = event.name
    } else if (this.down.has('device')) logger.info('系统声输出设备已恢复', { event: 'audio_capture.system_audio.device.restored', context: { device: event.name, atSeconds: event.atSeconds } })
    this.setDown('device', false)
  }
  private segment(event: SegmentEvent): void {
    const startUs = Math.max(0, Math.round(event.monoUs - this.options.originUs))
    if (event.phase === 'seal') {
      const open = this.opened.get(event.segmentId)
      this.opened.delete(event.segmentId)
      if (open && event.frames) this.seal(open, event.frames)
      return
    }
    if (this.pending) {
      if (startUs > this.pending.fromUs) this.emit({ type: 'gap', kind: 'systemAudio', gap: { monoSpanUs: [this.pending.fromUs, startUs], reason: this.pending.reason } })
      this.pending = undefined
    }
    const segment: RecordingTrackOpenSegment = { id: event.segmentId, file: event.file, sampleRate: event.sampleRate, channels: event.channels, latencyCompensationUs: 0,
      sourceClockOffsetUs: startUs - Math.round(event.firstFrame * 1_000_000 / event.sampleRate), monoStartUs: startUs,
      anchor: { monoUs: startUs, presentedFrame: null, requestedFrame: null, sequenceRef: null, visitRef: null, playbackDirection: 0, playbackRate: 1, playing: false, epoch: 0, uncertaintyUs: Math.ceil(event.uncertaintyUs), audioSample: 0, audioSegmentRef: event.segmentId, audioRate: event.sampleRate } }
    this.opened.set(event.segmentId, segment)
    this.emit({ type: 'open', kind: 'systemAudio', segment: structuredClone(segment) })
  }
  /** 段的终点按帧数推算；下一段的起点是它自己的真实时刻，设备时钟的漂移留给拼接处吸收。 */
  private seal(open: RecordingTrackOpenSegment, frames: number): void {
    const { monoStartUs, anchor, ...rest } = open
    const endUs = monoStartUs + Math.round(frames * 1_000_000 / (open.sampleRate ?? this.sampleRate))
    this.lastEndUs = Math.max(this.lastEndUs ?? 0, endUs); this.frames += frames
    this.emit({ type: 'seal', kind: 'systemAudio', segment: { ...rest, monoSpanUs: [monoStartUs, endUs], units: frames, anchors: [anchor, { ...anchor, monoUs: endUs, audioSample: frames }] } })
  }
  private recordHealth(health: SystemAudioHealth): void {
    const previous = this.health
    this.health = health
    const grew = (key: keyof SystemAudioHealth): number => health[key] - (previous?.[key] ?? 0)
    const context = { ...health, newDroppedFrames: grew('droppedFrames'), newDiscontinuities: grew('discontinuities') }
    if (context.newDroppedFrames > 0 || context.newDiscontinuities > 0) logger.warn('系统声出现缺口，已补静音并继续', { event: 'audio_capture.system_audio.glitch', context })
    else if (grew('maxWriteMs') > 0 && health.maxWriteMs >= 100) logger.warn('系统声写盘耗时出现新峰值', { event: 'audio_capture.system_audio.disk.slow', context })
  }

  /** 原生服务失联（崩溃、不应答）：自动重连接着录。 */
  lost(loss: AudioCaptureLoss): void {
    if (this.state !== 'recording') return
    logger.warn('系统声服务失联，自动重连', { event: 'audio_capture.system_audio.reconnect.start', context: { code: loss.code } })
    this.lose(this.nowUs())
  }
  private lose(atUs: number): void {
    this.native = undefined; this.state = 'reconnecting'; this.fold(this.health)
    // 还没被下一段消费的暂停空档到此为止，之后是缺数据。
    this.closePending(atUs)
    this.pending = { fromUs: atUs, reason: 'missing-data' }
    this.lossAtUs = atUs
    clearTimeout(this.reconnect?.timer)
    this.reconnect = { attempt: 0, since: Date.now() }
    this.setDown('process', true)
    this.schedule()
  }
  private schedule(): void {
    const reconnect = this.reconnect
    if (!reconnect) return
    reconnect.timer = setTimeout(() => { void this.exclusive(() => this.reconnectOnce(reconnect)) }, RECONNECT_DELAYS_MS[Math.min(reconnect.attempt, RECONNECT_DELAYS_MS.length - 1)])
    reconnect.timer.unref?.()
  }
  private async reconnectOnce(reconnect: NonNullable<SystemAudioRecorder['reconnect']>): Promise<void> {
    if (this.reconnect !== reconnect || this.state !== 'reconnecting') return
    reconnect.attempt += 1
    // 失联前开了头的段：先记下，等新会话开起来再补，不让不应答的旧进程（最多两分钟才退）拖住重连。
    const stale = [...this.opened.keys()]
    try {
      await this.begin()
      if (this.reconnect !== reconnect) return
      this.state = 'recording'; this.reconnect = undefined; this.reconnects += 1
      this.setDown('process', false)
      logger.info('系统声已重连', { event: 'audio_capture.system_audio.reconnect.completed', context: { attempts: reconnect.attempt, gapSeconds: (Date.now() - reconnect.since) / 1000 } })
    } catch (error) {
      if (this.reconnect !== reconnect) return
      if (reconnect.attempt === 1) logger.warn('系统声重连失败，稍后再试', { event: 'audio_capture.system_audio.reconnect.failed', error, context: { attempt: reconnect.attempt } })
      else logger.debug('系统声重连失败，稍后再试', { event: 'audio_capture.system_audio.reconnect.failed', error, context: { attempt: reconnect.attempt } })
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
    const exited = await Promise.race([this.client.settled().then(() => true), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), SETTLE_WAIT_MS); timer.unref?.() })])
    clearTimeout(timer)
    if (!exited) { logger.warn('旧的系统声进程还没退出，没封口的段留到录制收尾再补', { event: 'audio_capture.system_audio.repair.deferred', context: { segments: ids.length } }); return }
    for (const id of ids) {
      const open = this.opened.get(id)
      if (!open) continue
      this.opened.delete(id)
      try {
        const { writtenBytes } = z.object({ writtenBytes: z.number() }).parse(await this.client.request('recover', { outputPath: path.join(this.options.directory, open.file) }))
        // 系统声固定 16 位：每帧 2 字节乘声道数。
        const rate = open.sampleRate ?? this.sampleRate
        const written = Math.floor(writtenBytes / (2 * (open.channels ?? 2)))
        const frames = capUs === undefined ? written : Math.min(written, Math.max(0, Math.floor((capUs - open.monoStartUs) * rate / 1_000_000)))
        if (frames > 0) { this.seal(open, frames); logger.info('补回没封口的系统声分段', { event: 'audio_capture.system_audio.repair.completed', context: { frames } }) }
      } catch (error) { logger.warn('没封口的系统声分段无法补回', { event: 'audio_capture.system_audio.repair.failed', error }) }
    }
  }
}

/** 系统声的原生服务：与麦克风分开的另一个录音进程，麦克风驱动出问题不影响系统声，反之亦然。 */
export class SystemAudioCaptureService {
  private readonly client: AudioCaptureClient
  private readonly recorders = new Set<SystemAudioRecorder>()
  constructor(executable: () => string) {
    this.client = new AudioCaptureClient(executable, event => { if ('sessionId' in event) [...this.recorders].find(recorder => recorder.owns(event.sessionId))?.event(event) }, loss => { for (const recorder of [...this.recorders]) recorder.lost(loss) })
  }
  async start(options: SystemAudioRecording): Promise<SystemAudioRecorder> {
    const recorder = new SystemAudioRecorder(this.client, options, value => { this.recorders.delete(value); this.client.setActive(this.recorders.size > 0) })
    this.recorders.add(recorder)
    logger.info('开始录制系统声', { event: 'audio_capture.system_audio.start' })
    try { await recorder.open() } catch (error) {
      this.recorders.delete(recorder); this.client.setActive(this.recorders.size > 0)
      logger.warn('系统声没能开始', { event: 'audio_capture.system_audio.start.failed', error })
      throw error
    }
    return recorder
  }
  /** 应用退出：先让每一路收尾封口，再关原生进程。 */
  async dispose(): Promise<void> {
    await Promise.allSettled([...this.recorders].map(recorder => recorder.stop()))
    await this.client.dispose()
  }
}

let shared: SystemAudioCaptureService | undefined
/** 主进程里唯一的系统声服务；录屏与界面自己的录制共用。 */
export function systemAudioCapture(): SystemAudioCaptureService { return shared ??= new SystemAudioCaptureService(audioCaptureExecutablePath) }
export async function disposeSystemAudioCapture(): Promise<void> { const service = shared; shared = undefined; await service?.dispose() }
