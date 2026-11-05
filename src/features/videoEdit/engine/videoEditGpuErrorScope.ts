import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createLogger } from '@/core/logging'

type ScopedDevice = GpuDevice & {
  pushErrorScope(filter: 'validation' | 'out-of-memory' | 'internal'): void
  popErrorScope(): Promise<{ message: string } | null>
  addEventListener?: (type: 'uncapturederror', listener: (event: { error: { message: string } }) => void) => void
}
type SubmittingQueue = { submit(commands: unknown[]): void }

export interface VideoEditGpuFault { seq: number; message: string }
export type VideoEditGpuFaultObserver = (event: string, message: string, context?: Record<string, unknown>) => void

const logger = createLogger('features.videoEdit.gpu')
let observeFault: VideoEditGpuFaultObserver = (event, message, context) => {
  logger.warn('GPU 执行失败', { event, context: { message, ...context } })
}
export function setVideoEditGpuFaultObserver(observer: VideoEditGpuFaultObserver): () => void {
  const previous = observeFault
  observeFault = observer
  return () => { observeFault = previous }
}
/** 同一消息每秒最多记一条：坏掉的效果每帧都报同样的错，不能刷满日志。 */
const lastReported = new Map<string, number>()
export function reportVideoEditGpuFault(event: string, message: string, context?: Record<string, unknown>): void {
  const key = `${event}\n${message}`, now = performance.now()
  if (now - (lastReported.get(key) ?? -Infinity) < 1000) return
  if (lastReported.size >= 64) lastReported.clear()
  lastReported.set(key, now)
  observeFault(event, message, context)
}

interface LedgerEntry { seq: number; settled: Promise<void>; fault?: string; owner?: VideoEditGpuWindow }

/**
 * 同一设备上一段工作的提交记录。
 *
 * 只收 `end()` 之前的提交。同步窗口的开关之间没有让出，区间内的提交恰好都是自己的，`end()` 时认领它们，
 * 跨 await 的窗口结清时跳过已认领的条目，这些错误经同步窗口的持有者交出。跨 await 的窗口开着时别的工作也在提交，
 * 重叠的窗口会一起失败：宁可多报，不交出坏画面。每个窗口必须结清或放弃一次，否则有错的条目留在台账里。
 */
export class VideoEditGpuWindow {
  private to?: number
  private settling?: Promise<VideoEditGpuFault[]>
  private done = false
  constructor(private readonly ledger: VideoEditGpuLedger, readonly from: number, private readonly synchronous: boolean) {}
  end(): void {
    if (this.to !== undefined) return
    this.to = this.ledger.sequence
    if (this.synchronous) this.ledger.claim(this, this.from, this.to)
  }
  /** 提交全部结清后返回区间内的错误；没有 `end()` 过的窗口在此时结束。 */
  settle(): Promise<VideoEditGpuFault[]> {
    this.end()
    return this.settling ??= this.ledger.settle(this, this.from, this.to!).finally(() => { this.release() })
  }
  /** 这段工作的结果没有人要：错误只留在日志里。 */
  discard(): void {
    this.end()
    if (!this.settling) this.settling = Promise.resolve([])
    this.release()
  }
  private release(): void {
    if (this.done) return
    this.done = true
    this.ledger.close(this)
  }
}

/**
 * 设备提交的唯一收口：每次 `queue.submit` 同步套一层校验错误作用域，结果按序号入账，不在提交处等待。
 * 提交只需要这一层：建对象的显存与内部错误，在用到那个对象时同样让提交校验失败；Dawn 把提交本身的非校验错误升级成设备丢失，
 * 由帧栅栏判定。少压两层让每次提交的 CPU 开销减到三分之一。
 *
 * 校验错误是异步、设备级的，不接住就只进“未捕获错误”，调用方照样把这一帧当成画好了。收口在提交处，
 * 宿主、作者原生 WebGPU、three 与 shaders 框架的提交都逃不掉，也不必把作者的异步代码放进根队列。
 * 作者拿到的仍是真实设备，不影响 `context.configure({ device })` 这类品牌检查。
 * 外层作用域因此看不到提交错误：靠作用域判断提交成败的地方都要读窗口。
 */
export class VideoEditGpuLedger {
  private seq = 0
  private readonly entries = new Map<number, LedgerEntry>()
  private readonly windows = new Set<VideoEditGpuWindow>()
  constructor(private readonly device: ScopedDevice) {
    const queue = device.queue as unknown as SubmittingQueue | undefined
    if (queue?.submit && typeof device.pushErrorScope === 'function') {
      const submit = queue.submit
      queue.submit = commands => { this.submitScoped(() => submit.call(queue, commands)) }
    }
    device.addEventListener?.('uncapturederror', event => { reportVideoEditGpuFault('video_edit.gpu.uncaptured_error', event.error.message) })
  }
  get sequence(): number { return this.seq }
  /** 跨 await 的窗口；中间让出时别的工作也可能提交。 */
  open(): VideoEditGpuWindow { return this.track(new VideoEditGpuWindow(this, this.seq, false)) }
  /** `end()` 之前不能让出，区间内的提交归自己所有。 */
  openSync(): VideoEditGpuWindow { return this.track(new VideoEditGpuWindow(this, this.seq, true)) }
  private track(window: VideoEditGpuWindow): VideoEditGpuWindow { this.windows.add(window); return window }
  private submitScoped(submit: () => void): void {
    const device = this.device
    device.pushErrorScope('validation')
    const seq = ++this.seq
    try { submit() } finally {
      const entry: LedgerEntry = { seq, settled: device.popErrorScope().then(error => {
        const message = error?.message
        if (message === undefined) { this.entries.delete(seq); return }
        entry.fault = message
        reportVideoEditGpuFault('video_edit.gpu.submit.failed', message)
        this.prune()
      }, () => { this.entries.delete(seq) }) }
      this.entries.set(seq, entry)
    }
  }
  claim(owner: VideoEditGpuWindow, from: number, to: number): void {
    for (let seq = from + 1; seq <= to; seq++) { const entry = this.entries.get(seq); if (entry && !entry.owner) entry.owner = owner }
  }
  async settle(window: VideoEditGpuWindow, from: number, to: number): Promise<VideoEditGpuFault[]> {
    const owned: LedgerEntry[] = []
    for (let seq = from + 1; seq <= to; seq++) { const entry = this.entries.get(seq); if (entry && (!entry.owner || entry.owner === window)) owned.push(entry) }
    await Promise.all(owned.map(entry => entry.settled))
    return owned.flatMap(entry => entry.fault === undefined ? [] : [{ seq: entry.seq, message: entry.fault }])
  }
  close(window: VideoEditGpuWindow): void {
    this.windows.delete(window)
    this.prune()
  }
  /** 还有窗口可能读到的错误条目才留着；新窗口的起点不小于当前序号，读不到更早的。 */
  private prune(): void {
    let oldest = this.seq
    for (const window of this.windows) oldest = Math.min(oldest, window.from)
    for (const [seq, entry] of this.entries) if (entry.fault !== undefined && seq <= oldest) this.entries.delete(seq)
  }
  /** 诊断与测试：尚未结清或仍被窗口引用的条目数。 */
  get retained(): number { return this.entries.size }
  get openWindows(): number { return this.windows.size }
}

/**
 * 一帧的 GPU 结果：这一帧提交的窗口，加上它复用的、更早产出的画面的结果。
 * 复用发生时产出那一帧可能还没结清（流水播放），所以不能只在失败时清缓存，复用方要把产出方的结果并进自己的。
 * 结果存在缓存条目上，不放在画面对象上：同一画面对象每帧原地重画，放上去会串帧或自己等自己。
 */
export class VideoEditFrameGpu {
  readonly outcome: Promise<readonly VideoEditGpuFault[]>
  private resolveOutcome!: (faults: readonly VideoEditGpuFault[]) => void
  private readonly reused = new Set<Promise<readonly VideoEditGpuFault[]>>()
  private readonly window: VideoEditGpuWindow
  constructor(ledger: VideoEditGpuLedger) {
    this.window = ledger.open()
    this.outcome = new Promise(resolve => { this.resolveOutcome = resolve })
  }
  reuse(outcome: Promise<readonly VideoEditGpuFault[]> | undefined): void {
    if (outcome && outcome !== this.outcome) this.reused.add(outcome)
  }
  end(): void { this.window.end() }
  async settle(): Promise<readonly VideoEditGpuFault[]> {
    const faults = (await Promise.all([this.window.settle(), ...this.reused])).flat()
    this.resolveOutcome(faults)
    return faults
  }
}

let gpuOutputEpoch = 0
/**
 * 按内容身份复用的 GPU 输出（代码输出、嵌套画面、图层效果、三维材质）都记这个纪元。一帧在 GPU 上失败时纪元前进，
 * 之前产出的输出全部不再命中，不必逐个缓存去清，也不会漏掉渲染树里的某一支。失败很少见，全部重做最简单。
 */
export function videoEditGpuOutputEpoch(): number { return gpuOutputEpoch }
export function retireVideoEditGpuOutputs(): void { gpuOutputEpoch++ }

const ledgers = new WeakMap<object, VideoEditGpuLedger>()
/** 按队列区分设备：着色器图把代理设备交给框架，代理与真实设备共用一个队列。 */
export function videoEditGpuLedger(device: GpuDevice): VideoEditGpuLedger {
  const key = (device as { queue?: object }).queue ?? device
  let ledger = ledgers.get(key)
  if (!ledger) { ledger = new VideoEditGpuLedger(device as ScopedDevice); ledgers.set(key, ledger) }
  return ledger
}

/**
 * 在错误作用域里同步执行一段 GPU 工作，把这段里的校验与显存错误变成抛出的异常。
 *
 * 不接住时调用方照样把这一帧当成画好了（例如提交里用到已销毁的缓冲区，整帧什么都没画，取帧却报已核验）。
 * 作用域是设备级的栈，所以 `action` 必须同步执行、中间不让出；两次弹出也在任何等待之前发出，不会与别的区段交错。
 * 提交错误由台账接住（收口点在提交前后另压一层），提交以外的操作（`writeBuffer`、建对象）由这里的作用域接住。
 */
/** 同步的结果：传入异步函数时作用域会在异步工作完成前弹出，类型上直接拒绝。 */
type Synchronous<T> = T extends PromiseLike<unknown> ? never : T
export async function guardVideoEditGpu<T>(device: GpuDevice, what: string, action: () => Synchronous<T>): Promise<T> {
  const scoped = device as unknown as ScopedDevice
  const window = videoEditGpuLedger(device).openSync()
  scoped.pushErrorScope('validation')
  scoped.pushErrorScope('out-of-memory')
  scoped.pushErrorScope('internal')
  let result: Synchronous<T> | undefined, thrown: unknown, failed = false
  try { result = action() } catch (error) { thrown = error; failed = true }
  const internal = scoped.popErrorScope(), memory = scoped.popErrorScope(), validation = scoped.popErrorScope()
  window.end()
  const error = (await internal) ?? (await memory) ?? (await validation)
  const faults = await window.settle()
  if (failed) throw thrown
  const message = error?.message ?? faults[0]?.message
  if (message) throw new Error(`${what}失败：${message}`)
  return result as T
}
