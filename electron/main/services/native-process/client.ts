import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { z } from 'zod'
import type { createMainLogger } from '../logging'
import { correlateNativeClock, type NativeFrameReader, type NativeProcessMessage } from './protocol'

export const mainClockUs = (): number => Number(process.hrtime.bigint() / 1000n)
/** 计时器比预定晚到这么多，说明主进程刚卡过：原生的应答可能还没进管道，再宽限几秒，最多几次。 */
const LATE_TIMER_MS = 1000
const LATE_GRACE_MS = 5000
const LATE_GRACES = 3
/** 失联的原生进程关掉输入后自己写完队列、收尾文件的宽限；录制中给足，空闲时很快。过了仍不退才强杀。 */
const RETIRE_RECORDING_MS = 120_000
const RETIRE_IDLE_MS = 3000
const DEFAULT_TIMEOUT_MS = 20_000
/** 原生进程失联（退出、协议错误、不应答）的原因，交给失联回调用作中断说明。 */
export interface NativeProcessLoss { code: string; message: string }

/** 一种原生进程的身份：日志、提示文字、协议号与各指令的应答时限。 */
export interface NativeProcessIdentity<M extends NativeProcessMessage> {
  /** 日志里的名字，如“原生录音服务”。 */
  label: string
  /** 结构化日志事件的前缀，如 `audio_capture`。 */
  event: string
  logger: ReturnType<typeof createMainLogger>
  protocol: number
  /** 握手时带给原生的参数（例如期望的协议号，原生据此拒绝不配套的应用）。 */
  hello?: Record<string, unknown>
  versionMismatch: string
  texts: { closed: string; unavailable: string; notStarted: string; exited: string; timeout: string; closing: string }
  losses: { exited: NativeProcessLoss; notResponding: NativeProcessLoss }
  timeouts?: Partial<Record<string, number>>
  reader(): NativeFrameReader<M>
  error(code: string, message: string): Error
}

/**
 * 自研原生进程的主进程客户端：按需启动、握手核对协议号、请求应答与超时、时钟校准、失联收拢、退役（关输入让它自己收尾）与应用退出。
 * 事件的解析交给具体的子类。
 */
export abstract class NativeProcessClient<M extends NativeProcessMessage> {
  private child: ChildProcessWithoutNullStreams | undefined
  private ready: Promise<void> | undefined
  private nextId = 0
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> | undefined }>()
  /** 已失联、正在自己收尾的原生进程，退出时移除。 */
  private readonly retiring = new Map<ChildProcessWithoutNullStreams, Promise<void>>()
  private crashes: number[] = []
  private idle: ReturnType<typeof setTimeout> | undefined
  private calibration: ReturnType<typeof setInterval> | undefined
  protected clock = { offsetUs: 0, uncertaintyUs: 1_000_000 }
  private lastCalibration = 0
  private active = false
  private disposed = false
  constructor(private readonly identity: NativeProcessIdentity<M>, private readonly executable: () => string, private readonly onCrash: (loss: NativeProcessLoss) => void) {}

  /** 带 `event` 的消息（应答之外的一切）；抛错按协议错误处理。 */
  protected abstract event(message: M, binary: Buffer): void
  /** 此刻能否插入时钟校准（例如驱动面板开着时原生线程被占住）。 */
  protected calibrationAllowed(): boolean { return true }

  async request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    await this.ensureStarted()
    this.touch()
    try { return await this.send(type, payload) }
    finally { this.touch() }
  }
  setActive(active: boolean): void { this.active = active; this.touch() }
  private touch(): void {
    clearTimeout(this.idle)
    if (!this.active) { this.idle = setTimeout(() => { if (this.pending.size) this.touch(); else void this.shutdown() }, 30_000); this.idle.unref() }
  }
  private async ensureStarted(): Promise<void> {
    if (this.disposed) throw this.identity.error('SERVICE_CLOSED', this.identity.texts.closed)
    if (this.ready) return this.ready
    this.crashes = this.crashes.filter(t => Date.now() - t < 60_000)
    if (this.crashes.length >= 3) throw this.identity.error('SERVICE_UNAVAILABLE', this.identity.texts.unavailable)
    // 启动没成（版本不配套等）不算失联：先放开这个子进程再结束它，不记崩溃、不触发使用方的自动重连，调用方拿到原始的报错。
    this.ready = this.launch().catch(error => { const child = this.child; this.child = undefined; this.ready = undefined; clearInterval(this.calibration); child?.kill(); throw error })
    return this.ready
  }
  private async launch(): Promise<void> {
    const { logger, label, event } = this.identity
    logger.info(`启动${label}`, { event: `${event}.process.start` })
    const child = spawn(this.executable(), [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    this.child = child
    const reader = this.identity.reader()
    child.stdout.on('data', (data: Buffer) => {
      // 失联后仍在收尾的进程：照常读空管道，免得它写满卡住出不来；它的事件与应答不再处理。
      if (this.child !== child) return
      try { reader.push(data, (message, binary) => this.receive(message, binary)) }
      catch (error) { logger.error(`${label}协议无效`, { event: `${event}.protocol.failed`, error }); this.retire(child, this.identity.losses.exited) }
    })
    child.stderr.on('data', (data: Buffer) => logger.debug(`${label}诊断`, { event: `${event}.native.diagnostic`, context: { message: data.toString('utf8').slice(0, 4000) } }))
    const lost = (): void => this.lost(child, this.identity.losses.exited)
    child.once('error', lost); child.once('exit', lost); child.stdin.once('error', lost)
    let protocol: unknown
    try { ({ protocol } = z.object({ protocol: z.unknown() }).parse(await this.send('hello', this.identity.hello))) }
    catch (error) { if ((error as { code?: unknown }).code !== 'PROTOCOL_MISMATCH') throw error }
    if (protocol !== this.identity.protocol) {
      logger.error(`${label}与应用版本不一致`, { event: `${event}.process.version_mismatch`, context: { expected: this.identity.protocol, actual: protocol ?? null } })
      throw this.identity.error('VERSION_MISMATCH', this.identity.versionMismatch)
    }
    await this.syncClock()
    this.calibration = setInterval(() => { if (this.calibrationAllowed() && !this.pending.size) void this.syncClock().catch(() => this.retire(child, this.identity.losses.notResponding)) }, 5000)
    this.calibration.unref(); this.touch()
    logger.info(`${label}已就绪`, { event: `${event}.process.completed` })
  }
  private send(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const child = this.child
    if (!child) return Promise.reject(this.identity.error('PROCESS_EXITED', this.identity.texts.notStarted))
    const id = String(++this.nextId)
    return new Promise((resolve, reject) => {
      const entry: { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> | undefined } = { resolve, reject, timer: undefined }
      let due = Date.now() + (this.identity.timeouts?.[type] ?? DEFAULT_TIMEOUT_MS), graces = 0
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
          reject(this.identity.error('TIMEOUT', this.identity.texts.timeout))
          this.retire(child, this.identity.losses.notResponding)
        })
      }
      entry.timer = setTimeout(check, due - Date.now())
      this.pending.set(id, entry)
      child.stdin.write(`${JSON.stringify({ id, type, ...payload })}\n`, error => { if (error) { clearTimeout(entry.timer); this.pending.delete(id); reject(error); this.retire(child, this.identity.losses.exited) } })
    })
  }
  /**
   * 原生进程失联：在主进程这边同步收拢状态（拒绝待定请求，失联回调里清会话、放睡眠阻止、通知界面），
   * 不等它的退出事件——线程卡在驱动调用里时进程可能迟迟不退。对已失联的进程重复调用无害。
   */
  private lost(child: ChildProcessWithoutNullStreams, loss: NativeProcessLoss): void {
    if (this.child !== child) return
    this.child = undefined; this.ready = undefined; clearInterval(this.calibration)
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(this.identity.error('PROCESS_EXITED', this.identity.texts.exited)) }
    this.pending.clear(); this.crashes.push(Date.now()); this.active = false
    this.identity.logger.warn(`${this.identity.label}失联；下次调用重新启动，不自动重录`, { event: `${this.identity.event}.process.failed`, context: { code: loss.code } })
    this.onCrash(loss)
  }
  /**
   * 结束一个不应答（或协议出错）的原生进程而不丢已采集的内容：先收拢主进程状态，再关掉它的输入——
   * 原生读到输入结束会把队列写完、收尾文件后自己退出；宽限期过了仍不退才强杀。
   */
  private retire(child: ChildProcessWithoutNullStreams, loss: NativeProcessLoss): void {
    if (this.child !== child) return
    const graceMs = this.active ? RETIRE_RECORDING_MS : RETIRE_IDLE_MS
    const exited = new Promise<void>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
      const timer = setTimeout(() => {
        this.identity.logger.warn(`${this.identity.label}收尾超时，强制结束`, { event: `${this.identity.event}.process.retire.killed`, context: { graceMs } })
        child.kill(); resolve()
      }, graceMs)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
    this.retiring.set(child, exited)
    void exited.then(() => { this.retiring.delete(child); this.identity.logger.info(`失联的${this.identity.label}已退出`, { event: `${this.identity.event}.process.retire.completed` }) })
    this.lost(child, loss)
    child.stdin.end()
  }
  /** 失联的原生进程都退出后才返回：恢复、回收同一个文件前要等它写完。 */
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
  protected clockUncertaintyUs(): number { return this.clock.uncertaintyUs + Math.max(0, mainClockUs() - this.lastCalibration) * .0001 }
  private receive(message: M, binary: Buffer): void {
    if (message.event) { this.event(message, binary); return }
    if (!message.id) return
    const p = this.pending.get(message.id); if (!p) return
    this.pending.delete(message.id); clearTimeout(p.timer)
    if (message.ok) p.resolve(message.result)
    else p.reject(this.identity.error(message.error?.code ?? 'CAPTURE_FAILED', message.error?.message ?? `${this.identity.label}请求失败`))
  }
  /** 关闭输入让原生进程自己收尾后退出。停止已应答而结尾还在落盘时要等它写完，所以强杀宽限与录制中退役一致。返回进程结束。 */
  private shutdown(): Promise<void> {
    const child = this.child; this.child = undefined; this.ready = undefined
    clearInterval(this.calibration); clearTimeout(this.idle)
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(this.identity.error('SERVICE_CLOSED', this.identity.texts.closing)) }
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
