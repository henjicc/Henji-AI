import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { z } from 'zod'
import type { AudioCaptureEvent } from '../../../../src/core/audioCapture/contracts'
import { createMainLogger } from '../logging'
import { AudioCaptureError, AudioCaptureFrameReader, correlateNativeClock, type NativeAudioMessage } from './protocol'

const logger = createMainLogger('main.audio_capture.process')
export const mainClockUs = (): number => Number(process.hrtime.bigint() / 1000n)
const sampleSchema = z.object({ event: z.literal('samples'), sessionId: z.string(), sequence: z.number().int().nonnegative(), firstFrame: z.number().int().nonnegative(), frames: z.number().int().min(1).max(1024), channels: z.number().int().min(1).max(2), sampleRate: z.number().positive(), nativeMonoUs: z.number(), uncertaintyUs: z.number().nonnegative(), format: z.literal('float32le') })
const levelSchema = z.object({ event: z.literal('level'), sessionId: z.string(), peak: z.array(z.number()).max(2), rms: z.array(z.number()).max(2), clipped: z.array(z.boolean()).max(2), durationSeconds: z.number(), writtenBytes: z.number() })
const interruptedSchema = z.object({ event: z.literal('interrupted'), sessionId: z.string(), outputPath: z.string(), writtenBytes: z.number(), error: z.object({ code: z.string(), message: z.string(), recoverable: z.boolean() }) })

export class AudioCaptureClient {
  private child: ChildProcessWithoutNullStreams | undefined
  private ready: Promise<void> | undefined
  private nextId = 0
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private crashes: number[] = []
  private idle: ReturnType<typeof setTimeout> | undefined
  private calibration: ReturnType<typeof setInterval> | undefined
  private clock = { offsetUs: 0, uncertaintyUs: 1_000_000 }
  private lastCalibration = 0
  private active = false
  private disposed = false
  private panelOpen = false
  constructor(private readonly executable: () => string, private readonly onEvent: (event: AudioCaptureEvent) => void, private readonly onCrash: () => void) {}

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
    if (!this.active) { this.idle = setTimeout(() => { if (this.pending.size) this.touch(); else this.shutdown() }, 30_000); this.idle.unref() }
  }
  private async ensureStarted(): Promise<void> {
    if (this.disposed) throw new AudioCaptureError('SERVICE_CLOSED', '录音服务已关闭')
    if (this.ready) return this.ready
    this.crashes = this.crashes.filter(t => Date.now() - t < 60_000)
    if (this.crashes.length >= 3) throw new AudioCaptureError('SERVICE_UNAVAILABLE', '录音服务连续异常，请稍后重试并检查驱动')
    this.ready = this.launch().catch(error => { this.ready = undefined; this.child?.kill(); throw error })
    return this.ready
  }
  private async launch(): Promise<void> {
    logger.info('启动原生录音服务', { event: 'audio_capture.process.start' })
    const child = spawn(this.executable(), [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    const reader = new AudioCaptureFrameReader()
    child.stdout.on('data', (data: Buffer) => {
      try { reader.push(data, (message, binary) => this.receive(message, binary)) }
      catch (error) { logger.error('录音协议无效', { event: 'audio_capture.protocol.failed', error }); child.kill() }
    })
    child.stderr.on('data', (data: Buffer) => logger.debug('原生录音诊断', { event: 'audio_capture.native.diagnostic', context: { message: data.toString('utf8').slice(0, 4000) } }))
    const fail = (): void => {
      if (this.child !== child) return
      this.child = undefined; this.ready = undefined; clearInterval(this.calibration)
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new AudioCaptureError('PROCESS_EXITED', '录音服务已退出，已写文件可恢复')) }
      this.pending.clear(); this.crashes.push(Date.now()); this.active = false; this.onCrash()
      logger.warn('原生录音服务异常退出；下次调用重新启动，不自动重录', { event: 'audio_capture.process.failed' })
    }
    child.once('error', fail); child.once('exit', fail); child.stdin.once('error', fail)
    const hello = z.object({ protocol: z.literal(1) }).parse(await this.send('hello'))
    void hello
    await this.syncClock()
    this.calibration = setInterval(() => { if (!this.panelOpen && !this.pending.size) void this.syncClock().catch(() => child.kill()) }, 5000)
    this.calibration.unref(); this.touch()
    logger.info('原生录音服务已就绪', { event: 'audio_capture.process.completed' })
  }
  private send(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const child = this.child
    if (!child) return Promise.reject(new AudioCaptureError('PROCESS_EXITED', '录音服务未启动'))
    const id = String(++this.nextId)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AudioCaptureError('TIMEOUT', '录音驱动响应超时，请检查设备；已录文件可恢复')); child.kill() }, type === 'asioPanel' ? 300_000 : 20_000)
      this.pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, type, ...payload })}\n`, error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); child.kill() } })
    })
  }
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
  private receive(message: NativeAudioMessage, binary: Buffer): void {
    if (message.event === 'samples') {
      const block = sampleSchema.parse(message)
      if (binary.length !== block.frames * block.channels * 4) throw new AudioCaptureError('PROTOCOL_ERROR', '录音采样字节数不匹配')
      this.onEvent({ ...block, monoUs: block.nativeMonoUs + this.clock.offsetUs, uncertaintyUs: block.uncertaintyUs + this.clock.uncertaintyUs + Math.max(0, mainClockUs() - this.lastCalibration) * .0001, pcm: new Uint8Array(binary) })
    } else if (message.event === 'level') this.onEvent(levelSchema.parse(message))
    else if (message.event === 'interrupted') this.onEvent(interruptedSchema.parse(message))
    else if (message.id) {
      const p = this.pending.get(message.id); if (!p) return
      this.pending.delete(message.id); clearTimeout(p.timer)
      if (message.ok) p.resolve(message.result)
      else p.reject(new AudioCaptureError(message.error?.code ?? 'CAPTURE_FAILED', message.error?.message ?? '录音请求失败'))
    }
  }
  private shutdown(): void {
    const child = this.child; this.child = undefined; this.ready = undefined
    clearInterval(this.calibration); clearTimeout(this.idle)
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new AudioCaptureError('SERVICE_CLOSED', '录音服务正在关闭，已写文件保留')) }
    this.pending.clear()
    child?.stdin.end()
    if (child) { const timeout = setTimeout(() => child.kill(), 3000); timeout.unref(); child.once('exit', () => clearTimeout(timeout)) }
  }
  dispose(): void { this.disposed = true; this.shutdown() }
}
