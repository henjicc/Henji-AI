import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { z } from 'zod'
import { audioCaptureHealthSchema, systemAudioHealthSchema, type AudioCaptureEvent, type SystemAudioNativeEvent } from '../../../../src/core/audioCapture/contracts'
import { createMainLogger } from '../logging'
import { AudioCaptureError, AudioCaptureFrameReader, correlateNativeClock, type NativeAudioMessage } from './protocol'

const logger = createMainLogger('main.audio_capture.process')
export const mainClockUs = (): number => Number(process.hrtime.bigint() / 1000n)
/**
 * 应答超时（其余请求 20 秒）。停止要先排空采集队列（4096 块、每块最多 1024 帧，48 kHz 下最多约 87 秒音频，
 * 正常磁盘不到一秒写完）和推流通道再收尾文件，磁盘慢时也不能被提前打断；驱动面板等用户操作。
 */
const REQUEST_TIMEOUT_MS: Partial<Record<string, number>> = { stop: 90_000, asioPanel: 300_000 }
/** 计时器比预定晚到这么多，说明主进程刚卡过：原生的应答可能还没进管道，再宽限几秒，最多几次。 */
const LATE_TIMER_MS = 1000
const LATE_GRACE_MS = 5000
const LATE_GRACES = 3
/** 失联的原生进程关掉输入后自己写完队列、收尾 WAV 的宽限；录音中给足，空闲时很快。过了仍不退才强杀。 */
const RETIRE_RECORDING_MS = 120_000
const RETIRE_IDLE_MS = 3000
/** 原生进程失联（退出、协议错误、不应答）的原因，交给崩溃回调用作中断说明。 */
export interface AudioCaptureLoss { code: string; message: string }
const EXITED: AudioCaptureLoss = { code: 'PROCESS_EXITED', message: '录音服务异常退出，已写文件保留，可恢复后重新录制' }
const NOT_RESPONDING: AudioCaptureLoss = { code: 'NOT_RESPONDING', message: '录音服务没有应答，录音已结束；已采集的部分正在写完，稍后可以恢复' }
const sampleSchema = z.object({ event: z.literal('samples'), sessionId: z.string(), sequence: z.number().int().nonnegative(), firstFrame: z.number().int().nonnegative(), frames: z.number().int().min(1).max(1024), channels: z.number().int().min(1).max(2), sampleRate: z.number().positive(), nativeMonoUs: z.number(), uncertaintyUs: z.number().nonnegative(), format: z.literal('float32le') })
const levelSchema = z.object({ event: z.literal('level'), sessionId: z.string(), peak: z.array(z.number()).max(2), rms: z.array(z.number()).max(2), clipped: z.array(z.boolean()).max(2), durationSeconds: z.number(), writtenBytes: z.number() })
const interruptedSchema = z.object({ event: z.literal('interrupted'), sessionId: z.string(), outputPath: z.string(), writtenBytes: z.number(), error: z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() }), health: audioCaptureHealthSchema.optional() })
const healthSchema = z.object({ event: z.literal('health'), sessionId: z.string(), durationSeconds: z.number(), health: audioCaptureHealthSchema })
const segmentSchema = z.object({ event: z.literal('segment'), sessionId: z.string(), phase: z.enum(['open', 'seal']), segmentId: z.string().uuid(), file: z.string().regex(/^[a-f0-9-]+\.wav$/), firstFrame: z.number().int().nonnegative(), frames: z.number().int().nonnegative().optional(), sampleRate: z.number().int().positive(), channels: z.number().int().min(1).max(2), bitDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]), nativeMonoUs: z.number(), uncertaintyUs: z.number().nonnegative() })
const deviceSchema = z.object({ event: z.literal('device'), sessionId: z.string(), state: z.enum(['capturing', 'unavailable']), name: z.string(), reason: z.string().nullable(), atSeconds: z.number() })
const systemHealthSchema = z.object({ event: z.literal('systemHealth'), sessionId: z.string(), durationSeconds: z.number(), health: systemAudioHealthSchema })
/**
 * 协议 4：麦克风的一路采集可同时交给音频编辑的整段文件和录屏的分段轨道（startMicrophoneTrack），段事件带位深与采集时钟误差。
 * 新旧程序不配套时在握手就失败，不在录音中途才报协议错误。
 */
export const AUDIO_CAPTURE_PROTOCOL = 4

export class AudioCaptureClient {
  private child: ChildProcessWithoutNullStreams | undefined
  private ready: Promise<void> | undefined
  private nextId = 0
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> | undefined }>()
  /** 已失联、正在自己收尾的原生进程，退出时移除。 */
  private readonly retiring = new Map<ChildProcessWithoutNullStreams, Promise<void>>()
  private crashes: number[] = []
  private idle: ReturnType<typeof setTimeout> | undefined
  private calibration: ReturnType<typeof setInterval> | undefined
  private clock = { offsetUs: 0, uncertaintyUs: 1_000_000 }
  private lastCalibration = 0
  private active = false
  private disposed = false
  private panelOpen = false
  constructor(private readonly executable: () => string, private readonly onEvent: (event: AudioCaptureEvent | SystemAudioNativeEvent) => void, private readonly onCrash: (loss: AudioCaptureLoss) => void) {}

  async request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureStarted()
    this.touch()
    if (type === 'asioPanel') this.panelOpen = true
    try { return await this.send(type, payload) }
    finally { if (type === 'asioPanel') this.panelOpen = false; this.touch() }
  }
  setActive(active: boolean): void { this.active = active; this.touch() }
  private touch(): void {
    clearTimeout(this.idle)
    if (!this.active) { this.idle = setTimeout(() => { if (this.pending.size) this.touch(); else void this.shutdown() }, 30_000); this.idle.unref() }
  }
  private async ensureStarted(): Promise<void> {
    if (this.disposed) throw new AudioCaptureError('SERVICE_CLOSED', '录音服务已关闭')
    if (this.ready) return this.ready
    this.crashes = this.crashes.filter(t => Date.now() - t < 60_000)
    if (this.crashes.length >= 3) throw new AudioCaptureError('SERVICE_UNAVAILABLE', '录音服务连续异常，请稍后重试并检查驱动')
    // 启动没成（版本不配套等）不算失联：先放开这个子进程再结束它，不记崩溃、不触发使用方的自动重连，调用方拿到原始的报错。
    this.ready = this.launch().catch(error => { const child = this.child; this.child = undefined; this.ready = undefined; clearInterval(this.calibration); child?.kill(); throw error })
    return this.ready
  }
  private async launch(): Promise<void> {
    logger.info('启动原生录音服务', { event: 'audio_capture.process.start' })
    const child = spawn(this.executable(), [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    const reader = new AudioCaptureFrameReader()
    child.stdout.on('data', (data: Buffer) => {
      // 失联后仍在收尾的进程：照常读空管道，免得它写满卡住出不来；它的事件与应答不再处理。
      if (this.child !== child) return
      try { reader.push(data, (message, binary) => this.receive(message, binary)) }
      catch (error) { logger.error('录音协议无效', { event: 'audio_capture.protocol.failed', error }); this.retire(child, EXITED) }
    })
    child.stderr.on('data', (data: Buffer) => logger.debug('原生录音诊断', { event: 'audio_capture.native.diagnostic', context: { message: data.toString('utf8').slice(0, 4000) } }))
    const lost = (): void => this.lost(child, EXITED)
    child.once('error', lost); child.once('exit', lost); child.stdin.once('error', lost)
    const { protocol } = z.object({ protocol: z.unknown() }).parse(await this.send('hello'))
    if (protocol !== AUDIO_CAPTURE_PROTOCOL) {
      logger.error('原生录音程序与应用版本不一致', { event: 'audio_capture.process.version_mismatch', context: { expected: AUDIO_CAPTURE_PROTOCOL, actual: protocol } })
      throw new AudioCaptureError('VERSION_MISMATCH', '录音组件版本与应用不一致，请重新安装痕迹AI；开发环境请先运行 npm run build:audio-capture 重新构建录音组件。')
    }
    await this.syncClock()
    this.calibration = setInterval(() => { if (!this.panelOpen && !this.pending.size) void this.syncClock().catch(() => this.retire(child, NOT_RESPONDING)) }, 5000)
    this.calibration.unref(); this.touch()
    logger.info('原生录音服务已就绪', { event: 'audio_capture.process.completed' })
  }
  private send(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const child = this.child
    if (!child) return Promise.reject(new AudioCaptureError('PROCESS_EXITED', '录音服务未启动'))
    const id = String(++this.nextId)
    return new Promise((resolve, reject) => {
      const entry: { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> | undefined } = { resolve, reject, timer: undefined }
      let due = Date.now() + (REQUEST_TIMEOUT_MS[type] ?? 20_000), graces = 0
      const check = (): void => {
        // 先让本轮已到达管道的应答处理完（计时器先于管道读取触发）。
        setImmediate(() => {
          if (this.pending.get(id) !== entry) return
          if (Date.now() - due > LATE_TIMER_MS && graces < LATE_GRACES) {
            graces += 1; due = Date.now() + LATE_GRACE_MS
            entry.timer = setTimeout(check, LATE_GRACE_MS)
            return
          }
          this.pending.delete(id)
          reject(new AudioCaptureError('TIMEOUT', '录音驱动响应超时，请检查设备；已录文件可恢复'))
          this.retire(child, NOT_RESPONDING)
        })
      }
      entry.timer = setTimeout(check, due - Date.now())
      this.pending.set(id, entry)
      child.stdin.write(`${JSON.stringify({ id, type, ...payload })}\n`, error => { if (error) { clearTimeout(entry.timer); this.pending.delete(id); reject(error); this.retire(child, EXITED) } })
    })
  }
  /**
   * 原生进程失联：在主进程这边同步收拢状态（拒绝待定请求，崩溃回调里清会话、放睡眠阻止、通知界面），
   * 不等它的退出事件——线程卡在驱动调用里时进程可能迟迟不退。对已失联的进程重复调用无害。
   */
  private lost(child: ChildProcessWithoutNullStreams, loss: AudioCaptureLoss): void {
    if (this.child !== child) return
    this.child = undefined; this.ready = undefined; clearInterval(this.calibration)
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new AudioCaptureError('PROCESS_EXITED', '录音服务已退出，已写文件可恢复')) }
    this.pending.clear(); this.crashes.push(Date.now()); this.active = false
    logger.warn('原生录音服务失联；下次调用重新启动，不自动重录', { event: 'audio_capture.process.failed', context: { code: loss.code } })
    this.onCrash(loss)
  }
  /**
   * 结束一个不应答（或协议出错）的原生进程而不丢已采集的音频：先收拢主进程状态，再关掉它的输入——
   * 原生读到输入结束会把采集队列写完、收尾 WAV 后自己退出；宽限期过了仍不退才强杀。
   */
  private retire(child: ChildProcessWithoutNullStreams, loss: AudioCaptureLoss): void {
    if (this.child !== child) return
    const graceMs = this.active ? RETIRE_RECORDING_MS : RETIRE_IDLE_MS
    const exited = new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
      const timer = setTimeout(() => {
        logger.warn('原生录音服务收尾超时，强制结束', { event: 'audio_capture.process.retire.killed', context: { graceMs } })
        child.kill(); resolve()
      }, graceMs)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
    this.retiring.set(child, exited)
    void exited.then(() => { this.retiring.delete(child); logger.info('失联的原生录音服务已退出', { event: 'audio_capture.process.retire.completed' }) })
    this.lost(child, loss)
    child.stdin.end()
  }
  /** 失联的原生进程都退出后才返回：恢复、回收同一个录音文件前要等它写完。 */
  async settled(): Promise<void> { await Promise.all([...this.retiring.values()]) }
  private async syncClock(): Promise<void> {
    let best: ReturnType<typeof correlateNativeClock> | undefined
    for (let i = 0; i < 3; i++) {
      const before = mainClockUs()
      const value = z.object({ nativeMonoUs: z.number() }).parse(await this.send('clock'))
      const sample = correlateNativeClock(before, mainClockUs(), value.nativeMonoUs)
      if (!best || sample.uncertaintyUs < best.uncertaintyUs) best = sample
    }
    this.clock = best!; this.lastCalibration = mainClockUs()
  }
  /** 原生单调时钟误差：校准本身的误差，加上距上次校准按 100 ppm 估的漂移。 */
  private clockUncertaintyUs(): number { return this.clock.uncertaintyUs + Math.max(0, mainClockUs() - this.lastCalibration) * .0001 }
  private receive(message: NativeAudioMessage, binary: Buffer): void {
    if (message.event === 'samples') {
      const block = sampleSchema.parse(message)
      if (binary.length !== block.frames * block.channels * 4) throw new AudioCaptureError('PROTOCOL_ERROR', '录音采样字节数不匹配')
      this.onEvent({ ...block, monoUs: block.nativeMonoUs + this.clock.offsetUs, uncertaintyUs: block.uncertaintyUs + this.clockUncertaintyUs(), pcm: new Uint8Array(binary) })
    } else if (message.event === 'level') this.onEvent(levelSchema.parse(message))
    else if (message.event === 'interrupted') this.onEvent(interruptedSchema.parse(message))
    else if (message.event === 'health') this.onEvent(healthSchema.parse(message))
    else if (message.event === 'segment') { const segment = segmentSchema.parse(message); this.onEvent({ ...segment, monoUs: segment.nativeMonoUs + this.clock.offsetUs, uncertaintyUs: segment.uncertaintyUs + this.clockUncertaintyUs() }) }
    else if (message.event === 'device') this.onEvent(deviceSchema.parse(message))
    else if (message.event === 'systemHealth') this.onEvent(systemHealthSchema.parse(message))
    else if (message.id) {
      const p = this.pending.get(message.id); if (!p) return
      this.pending.delete(message.id); clearTimeout(p.timer)
      if (message.ok) p.resolve(message.result)
      else p.reject(new AudioCaptureError(message.error?.code ?? 'CAPTURE_FAILED', message.error?.message ?? '录音请求失败'))
    }
  }
  /** 关闭输入让原生进程自己收尾 WAV 后退出。空闲时它读到输入结束立即退出；停止已应答而结尾还在落盘时要等它写完，所以强杀宽限与录音中退役一致。返回进程结束。 */
  private shutdown(): Promise<void> {
    const child = this.child; this.child = undefined; this.ready = undefined
    clearInterval(this.calibration); clearTimeout(this.idle)
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new AudioCaptureError('SERVICE_CLOSED', '录音服务正在关闭，已写文件保留')) }
    this.pending.clear()
    if (!child) return Promise.resolve()
    child.stdin.end()
    return new Promise(resolve => {
      const timeout = setTimeout(() => { child.kill(); resolve() }, RETIRE_RECORDING_MS)
      timeout.unref()
      child.once('exit', () => { clearTimeout(timeout); resolve() })
    })
  }
  /** 应用退出：关掉当前进程；仍在收尾的失联进程再等一会儿，还不退就强杀，不留占着设备的孤儿进程。 */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.shutdown()
    if (!this.retiring.size) return
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([this.settled(), new Promise<void>(resolve => { timer = setTimeout(resolve, 10_000) })])
    clearTimeout(timer)
    for (const child of this.retiring.keys()) child.kill()
  }
}
