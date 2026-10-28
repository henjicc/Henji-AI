import { VideoEditTimingHistogram } from './videoEditTimingHistogram'

/** Worker-local cumulative preparation counters; never part of the authored budget. */
const stages: Record<string, { ms: number; count: number }> = {}

export function recordVideoEditPreparation(stage: string, ms: number): void {
  const entry = stages[stage] ??= { ms: 0, count: 0 }
  entry.ms += ms; entry.count++
}

export function videoEditPreparationSnapshot(): Record<string, { ms: number; count: number }> {
  return Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, { ...value }]))
}

/** 当前渲染调用期间的阶段增量；保留原有阶段名供诊断，不重新执行测量渲染。 */
export function videoEditPreparationDelta(before: ReturnType<typeof videoEditPreparationSnapshot>): Record<string, number> {
  return Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, Math.max(0, value.ms - (before[key]?.ms ?? 0))]))
}

/*
 * 渲染诊断：只在会话初始化时带 `diagnostics` 打开（基准台与排障用）。关闭时下面的入口直接返回，
 * 不建探针计时器、不申请 GPU 时间戳特性，正常播放的开销与行为不变。
 * 结果写进渲染分段：`gpu.*` 是 GPU 时间戳量出的分段，`lag.*` 是 Worker 事件循环的迟滞与投递延迟。
 */
let diagnostics = false
const absoluteNow = (): number => performance.timeOrigin + performance.now()

export function enableVideoEditRenderDiagnostics(value: boolean): void {
  if (diagnostics === value) return
  diagnostics = value
  clearTimeout(probeTimer); probeTimer = undefined
  if (value) { probeExpected = absoluteNow() + LAG_PROBE_MS; probeTimer = setTimeout(probeTick, LAG_PROBE_MS) }
}
export function videoEditRenderDiagnosticsEnabled(): boolean { return diagnostics }

// ---- 事件循环迟滞探针 ----
// 每 4ms 排一个定时器；它晚到超过 4ms，说明这段时间 Worker 的事件循环被占住（渲染队列之外的工作、GC 等），
// 消息与回执都要等它。期间运行过的已标记任务与有计数变化的准备阶段记在这次阻塞上，供投递延迟按来源拆分。
const LAG_PROBE_MS = 4
/** 投递延迟只看最近的阻塞，按时间窗口归属只保留最近这些条；汇总另按计数与直方图累计，不受这个上限影响。 */
const STALL_LIMIT = 512
const WORST_STALLS = 8
interface WorkerStall { start: number; end: number; tasks: Record<string, number>; stages: string[] }
const stalls: WorkerStall[] = []
let stallSummary = { histogram: new VideoEditTimingHistogram(), worst: [] as WorkerStall[], evicted: false }
let probeTimer: ReturnType<typeof setTimeout> | undefined
let probeExpected = 0
let windowTasks: Record<string, number> = {}
let windowCounts: Record<string, number> = {}

function stageCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [key, value] of Object.entries(stages)) if (!key.startsWith('lag.') && !key.startsWith('gpu.')) counts[key] = value.count
  return counts
}
function probeTick(): void {
  const now = absoluteNow()
  const late = now - probeExpected
  const counts = stageCounts()
  if (late > LAG_PROBE_MS) {
    const stall = { start: probeExpected, end: now, tasks: windowTasks, stages: Object.keys(counts).filter(key => counts[key] !== windowCounts[key]) }
    stalls.push(stall)
    if (stalls.length > STALL_LIMIT) { stalls.shift(); stallSummary.evicted = true }
    stallSummary.histogram.add(late)
    const worst = stallSummary.worst
    if (worst.length < WORST_STALLS || late > worst[worst.length - 1].end - worst[worst.length - 1].start) {
      worst.push(stall); worst.sort((a, b) => (b.end - b.start) - (a.end - a.start)); worst.length = Math.min(worst.length, WORST_STALLS)
    }
    recordVideoEditPreparation('lag.stall', late)
  }
  windowCounts = counts; windowTasks = {}
  probeExpected = now + LAG_PROBE_MS
  probeTimer = setTimeout(probeTick, LAG_PROBE_MS)
}

/** 给 Worker 里的一段同步工作打标签记耗时；诊断关闭时直接执行。 */
export function probeVideoEditTask<T>(label: string, run: () => T): T {
  if (!diagnostics) return run()
  const started = performance.now()
  try { return run() } finally {
    const ms = performance.now() - started
    windowTasks[label] = (windowTasks[label] ?? 0) + ms
    recordVideoEditPreparation(`lag.task.${label}`, ms)
  }
}

/**
 * 一条请求从主线程发出（`sentAt`）到 Worker 收到（`receivedAt`，都是 timeOrigin + now 的绝对毫秒）的投递延迟，
 * 以及这段时间里探针记下的阻塞：标记过的任务按各自耗时计，其余记 unlabeled；`near.*` 是同一阻塞里有计数变化的准备阶段。
 */
export function videoEditDeliveryStages(sentAt: number, receivedAt: number): Record<string, number> {
  const result: Record<string, number> = { 'lag.delivery': Math.max(0, receivedAt - sentAt), 'lag.blocked': 0 }
  const add = (key: string, ms: number): void => { result[key] = (result[key] ?? 0) + ms }
  for (const stall of stalls) {
    const overlap = Math.min(stall.end, receivedAt) - Math.max(stall.start, sentAt)
    if (overlap <= 0) continue
    add('lag.blocked', overlap)
    let labeled = 0
    for (const [label, ms] of Object.entries(stall.tasks)) { const part = Math.min(ms, overlap - labeled); if (part > 0) { add(`lag.blocked.task.${label}`, part); labeled += part } }
    if (overlap > labeled) add('lag.blocked.unlabeled', overlap - labeled)
    for (const stage of stall.stages) add(`lag.blocked.near.${stage}`, overlap)
  }
  return result
}

/**
 * 自上次汇总以来的阻塞统计，读后清空：次数、总时长与最大值精确，P50/P95 来自固定桶直方图（相对误差 ≤1%），
 * 最长的几次带来源。`attributionTruncated` 表示这段时间阻塞多到超出了按时间窗口归属保留的条数，较早帧的投递延迟拆分不完整。
 */
export function videoEditLagSummary(): { stalls: number; totalMs: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null; attributionTruncated: boolean; worst: Array<{ ms: number; tasks: Record<string, number>; stages: string[] }> } {
  const { histogram, worst, evicted } = stallSummary
  const distribution = histogram.distribution()
  const summary = { stalls: histogram.count, totalMs: Math.round(histogram.total * 100) / 100, p50Ms: distribution.p50, p95Ms: distribution.p95, maxMs: distribution.max, attributionTruncated: evicted,
    worst: worst.map(stall => ({ ms: Math.round((stall.end - stall.start) * 100) / 100, tasks: stall.tasks, stages: stall.stages })) }
  stalls.length = 0
  stallSummary = { histogram: new VideoEditTimingHistogram(), worst: [], evicted: false }
  return summary
}

// ---- GPU 时间戳 ----
// 在 GPU 队列上打点：作者入口前后各提交一个空计时 pass，合成器最后一次提交的首尾也打点，同一帧的点在合成提交里解析、
// GPU 完成后读回。量到的是 GPU 执行到这些点的时刻，和 CPU 侧等刷新时刻、等 GPU 完成的时间分开。
const TIMESTAMP_SLOTS = 64
let gpuEpoch = 0
const BUFFER_MAP_READ = 0x01
const BUFFER_COPY_SRC = 0x04
const BUFFER_COPY_DST = 0x08
const BUFFER_QUERY_RESOLVE = 0x200
interface TimestampEncoder {
  beginComputePass(descriptor: unknown): { end(): void }
  resolveQuerySet(querySet: unknown, firstQuery: number, queryCount: number, destination: unknown, destinationOffset: number): void
  copyBufferToBuffer(source: unknown, sourceOffset: number, destination: unknown, destinationOffset: number, size: number): void
  finish(): unknown
}
interface TimestampBuffer { destroy(): void; mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void }
interface TimestampDevice {
  features?: { has(name: string): boolean }
  createQuerySet?(descriptor: { type: 'timestamp'; count: number }): unknown
  createBuffer(descriptor: { size: number; usage: number }): unknown
  createCommandEncoder(): unknown
  queue: { submit(commands: unknown[]): void }
}
export interface VideoEditGpuSpan { label: string; begin: number; end?: number; epoch?: number }

/** 计时段的时间戳（纳秒）换成分段毫秒：同名段相加，`gpu.frame` 是本帧第一个点到最后一个点；没写入的点跳过。 */
export function videoEditGpuSpanStages(values: ArrayLike<bigint>, spans: readonly VideoEditGpuSpan[]): Record<string, number> {
  const result: Record<string, number> = {}
  let first: bigint | undefined, last: bigint | undefined
  for (const span of spans) {
    if (span.end === undefined) continue
    const begin = values[span.begin], end = values[span.end]
    if (!begin || !end || end < begin) continue
    result[`gpu.${span.label}`] = (result[`gpu.${span.label}`] ?? 0) + Number(end - begin) / 1e6
    if (first === undefined || begin < first) first = begin
    if (last === undefined || end > last) last = end
  }
  if (first !== undefined && last !== undefined) result['gpu.frame'] = Number(last - first) / 1e6
  return result
}

/**
 * 打点按渲染请求归属：Worker 每开始一个画面请求调用 `beginVideoEditGpuFrame`，之后的点属于这个请求；上屏合成只解析
 * 当前请求的点，没上屏的请求留下的点在下一个请求开始时作废，不会算进后面的帧。
 * 与排队的画面请求并行的只有快速拖动时的两种画面：转入后台继续准备的实时画面（它的作者段可能落在下一个请求上），
 * 和队列外先画的常驻关键帧（它的上屏合成可能带走正在准备的请求的作者段）。播放是一帧画完提交后才开始下一帧，归属准确。
 */
export class VideoEditGpuTimer {
  private used = 0
  private spans: VideoEditGpuSpan[] = []
  private epoch = gpuEpoch
  constructor(private readonly device: TimestampDevice, private readonly querySet: unknown) {}
  private write(encoder: unknown): number | undefined {
    // 新的请求开始了：上一请求没解析的点作废，槽位从头用（在它们之后提交的写入会覆盖旧值）。
    if (this.epoch !== gpuEpoch) { this.epoch = gpuEpoch; this.spans = []; this.used = 0 }
    if (this.used >= TIMESTAMP_SLOTS) return undefined
    const slot = this.used++
    const target = (encoder ?? this.device.createCommandEncoder()) as TimestampEncoder
    target.beginComputePass({ timestampWrites: { querySet: this.querySet, beginningOfPassWriteIndex: slot } }).end()
    if (!encoder) this.device.queue.submit([target.finish()])
    return slot
  }
  /** 不传编码器时单独提交一个空计时 pass。 */
  begin(label: string, encoder?: unknown): VideoEditGpuSpan | undefined {
    const slot = this.write(encoder)
    if (slot === undefined) return undefined
    const span = { label, begin: slot, epoch: this.epoch }
    this.spans.push(span)
    return span
  }
  end(span: VideoEditGpuSpan | undefined, encoder?: unknown): void {
    if (!span) return
    if (span.epoch !== gpuEpoch) return
    const slot = this.write(encoder)
    if (slot !== undefined) span.end = slot
  }
  /** 帧尾：在合成器最后一次提交的编码器里解析本帧的点；GPU 完成后由 `takeVideoEditGpuFrame` 读回。 */
  finishFrame(encoder: unknown): void {
    const spans = this.spans.filter(span => span.end !== undefined && span.epoch === gpuEpoch)
    const count = this.used
    this.spans = []; this.used = 0
    if (!spans.length) return
    const bytes = count * 8
    const resolve = this.device.createBuffer({ size: bytes, usage: BUFFER_QUERY_RESOLVE | BUFFER_COPY_SRC }) as TimestampBuffer
    const read = this.device.createBuffer({ size: bytes, usage: BUFFER_MAP_READ | BUFFER_COPY_DST }) as TimestampBuffer
    const target = encoder as TimestampEncoder
    target.resolveQuerySet(this.querySet, 0, count, resolve, 0)
    target.copyBufferToBuffer(resolve, 0, read, 0, bytes)
    gpuFrame = (async () => {
      try {
        await read.mapAsync(BUFFER_MAP_READ)
        const values = new BigUint64Array(read.getMappedRange().slice(0))
        read.unmap()
        return videoEditGpuSpanStages(values, spans)
      } finally { resolve.destroy(); read.destroy() }
    })()
    void gpuFrame.catch(() => {})
  }
}

const timers = new WeakMap<object, VideoEditGpuTimer | null>()
let gpuFrame: Promise<Record<string, number>> | undefined

/** 一个画面请求开始渲染：之后的 GPU 打点归它（见 `VideoEditGpuTimer`）。 */
export function beginVideoEditGpuFrame(): void {
  if (!diagnostics) return
  gpuEpoch++
  gpuFrame = undefined
}

/** 诊断打开且设备启用了 `timestamp-query` 时返回该设备的计时器；不支持的设备退化为不计时。 */
export function videoEditGpuTimer(device: object): VideoEditGpuTimer | undefined {
  if (!diagnostics) return undefined
  let timer = timers.get(device)
  if (timer === undefined) {
    const candidate = device as TimestampDevice
    try {
      timer = candidate.features?.has('timestamp-query') && candidate.createQuerySet
        ? new VideoEditGpuTimer(candidate, candidate.createQuerySet({ type: 'timestamp', count: TIMESTAMP_SLOTS }))
        : null
    } catch { timer = null }
    timers.set(device, timer)
  }
  return timer ?? undefined
}

/** 取走最近一帧合成提交的 GPU 分段（只取一次）。 */
export function takeVideoEditGpuFrame(): Promise<Record<string, number>> | undefined {
  const pending = gpuFrame
  gpuFrame = undefined
  return pending
}
