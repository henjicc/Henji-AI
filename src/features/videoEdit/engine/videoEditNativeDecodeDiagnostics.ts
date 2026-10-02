import { ALL_FORMATS, Input, UrlSource, VideoSampleSink } from 'mediabunny'
import type { VideoFrameScheduleEvent } from '@/platform/contracts/videoFrames'
import type { NativeVideoFrame, VideoEditNativeFrameReceiver } from './videoEditNativeFrames'

/**
 * 原生解码帧诊断（1.3，只供真实性测试；正式剪辑流程不使用）：
 * - `capture`：等某个请求（`request.id === ticket`）的帧到达，按给定坐标用 WebGPU `importExternalTexture`
 *   读回颜色（与正式合成入口同一导入方式），用于与 FFmpeg 参考帧、浏览器解码帧逐点比较；
 * - `browserCapture`：同一文件同一时间用浏览器后端（mediabunny + WebCodecs）解出的帧，按同样坐标读回；
 * - `pace`：按固定帧率“呈现”连续计划的帧（每个节拍导入并绘制到自有纹理后交回），统计节拍上画面是否已到，
 *   得到送达帧率、遗漏与间隔——与 1.2 的负载口径一致，但帧来自真实解码。
 */

export interface DecodeCaptureRequest { action: 'capture'; streamId: string; ticket: string; coords: number[]; timeoutMs?: number }
export interface DecodeBrowserCaptureRequest { action: 'browserCapture'; url: string; time: number; coords: number[] }
/** `fps` 为 0 时不按节拍：帧到达即记录并交回（只核对每项结果，不作为帧率数字）。 */
export interface DecodePaceRequest { action: 'pace'; streamId: string; scheduleId: string; count: number; fps: number; warmupFrames?: number }
export interface DecodePaceResultRequest { action: 'paceResult'; streamId: string; timeoutMs?: number }
export type DecodeDiagnosticsRequest = DecodeCaptureRequest | DecodeBrowserCaptureRequest | DecodePaceRequest | DecodePaceResultRequest

export interface DecodeCapture {
  ptsUs: number | null
  timestampUs: number
  frameFormat: string | null
  codedSize: [number, number]
  displaySize: [number, number]
  colorSpace: unknown
  /** 每个坐标一个 RGBA（与 coords 顺序一致）。 */
  samples: number[]
}

export interface DecodePaceResult {
  streamId: string
  ticks: number
  presented: number
  /** 节拍到时画面尚未到达。 */
  late: number
  /** 前若干个迟到节拍的序号（判断迟到集中在开头还是分散）。 */
  lateIndices: number[]
  /**
   * 开播 0.5 秒之后的稳态统计：与剪辑 5.1 标准负载的计时口径一致（开始播放、等 500ms 再计时），
   * 起播准备不计入；全程数字仍在上面如实给出。
   */
  steady: { fromTick: number; framesPerSecond: number; late: number; missing: number; intervals: { count: number; p50: number; p95: number; p99: number; max: number } }
  /** 原生报告无画面或解码失败。 */
  missing: number
  /** 送达帧率：节拍上实际呈现的画面数 ÷ 节拍总时长（每个节拍 1/fps 秒）。 */
  framesPerSecond: number
  spanMs: number
  intervals: { count: number; p50: number; p95: number; p99: number; max: number }
  /** 帧到达比呈现节拍提前的毫秒数（中位数），反映解码余量。 */
  leadMsMedian: number
  scheduleDone: string | null
  /** 每个计划项收到的帧时间（微秒）；null 为原生报告缺帧，-1 为没有收到任何结果。 */
  ptsByIndex: Array<number | null>
  errors: string[]
}

export type DecodeDiagnosticsResult = { capture?: DecodeCapture; pace?: DecodePaceResult; started?: boolean }

// WebGPU 常量与最小形状（项目未引入 @webgpu/types）。
const BUFFER_MAP_READ = 0x1
const BUFFER_COPY_SRC = 0x4
const BUFFER_COPY_DST = 0x8
const BUFFER_STORAGE = 0x80
const TEXTURE_BINDING = 0x4
const TEXTURE_RENDER_ATTACHMENT = 0x10

interface Buffer { destroy(): void; mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void }
interface Texture { readonly width: number; readonly height: number; createView(): unknown; destroy(): void }
interface Pipeline { getBindGroupLayout(index: number): unknown }
interface Pass { setPipeline(pipeline: Pipeline): void; setBindGroup(index: number, group: unknown): void; end(): void }
interface Encoder {
  beginComputePass(): Pass & { dispatchWorkgroups(count: number): void }
  beginRenderPass(descriptor: unknown): Pass & { draw(count: number): void }
  copyBufferToBuffer(source: Buffer, sourceOffset: number, target: Buffer, targetOffset: number, size: number): void
  finish(): unknown
}
export interface DiagnosticsDevice {
  queue: { submit(commands: unknown[]): void; writeBuffer(buffer: Buffer, offset: number, data: ArrayBufferView): void; onSubmittedWorkDone(): Promise<void> }
  createBuffer(descriptor: { size: number; usage: number }): Buffer
  createTexture(descriptor: { size: [number, number]; format: string; usage: number }): Texture
  createShaderModule(descriptor: { code: string }): unknown
  createComputePipeline(descriptor: unknown): Pipeline
  createRenderPipeline(descriptor: unknown): Pipeline
  createSampler(descriptor: unknown): unknown
  createBindGroup(descriptor: unknown): unknown
  createCommandEncoder(): Encoder
  importExternalTexture(descriptor: { source: VideoFrame }): unknown
}

export interface DecodeDiagnosticsGpu {
  device: DiagnosticsDevice
  /** `texture_external` + 坐标 → vec4 的计算管线。 */
  sample: Pipeline
  /** 外部纹理 → rgba8 自有纹理的绘制管线（与正式合成入口相同的用法）。 */
  copy: Pipeline
  sampler: unknown
}

function quantile(sorted: number[], q: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0
}
const round = (value: number, digits = 3): number => Math.round(value * 10 ** digits) / 10 ** digits

/** 按坐标读回外部纹理颜色。调用方负责帧的生命周期。 */
export async function readExternalFrame(gpu: DecodeDiagnosticsGpu, frame: VideoFrame, coords: number[]): Promise<number[]> {
  const { device } = gpu
  const count = coords.length / 2
  const input = device.createBuffer({ size: Math.max(16, count * 8), usage: BUFFER_STORAGE | BUFFER_COPY_DST })
  device.queue.writeBuffer(input, 0, new Uint32Array(coords))
  const output = device.createBuffer({ size: Math.max(16, count * 16), usage: BUFFER_STORAGE | BUFFER_COPY_SRC })
  const readback = device.createBuffer({ size: Math.max(16, count * 16), usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
  try {
    const external = device.importExternalTexture({ source: frame })
    const bind = device.createBindGroup({ layout: gpu.sample.getBindGroupLayout(0), entries: [{ binding: 0, resource: external }, { binding: 1, resource: { buffer: input } }, { binding: 2, resource: { buffer: output } }] })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(gpu.sample)
    pass.setBindGroup(0, bind)
    pass.dispatchWorkgroups(Math.ceil(count / 64))
    pass.end()
    encoder.copyBufferToBuffer(output, 0, readback, 0, count * 16)
    device.queue.submit([encoder.finish()])
    await readback.mapAsync(BUFFER_MAP_READ)
    const values = Array.from(new Float32Array(readback.getMappedRange().slice(0, count * 16)))
    readback.unmap()
    return values.map((value) => round(value, 6))
  } finally {
    input.destroy()
    output.destroy()
    readback.destroy()
  }
}

interface Waiter { ticket: string; coords: number[]; resolve: (capture: DecodeCapture) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

interface PaceState {
  request: DecodePaceRequest
  queue: Map<number, NativeVideoFrame>
  missing: Set<number>
  arrivals: Map<number, number>
  pts: Map<number, number | null>
  presentedAt: number[]
  /** 与 presentedAt 对应的节拍序号。 */
  presentedTicks: number[]
  lateTicks: number[]
  missingTicks: number[]
  leads: number[]
  late: number
  lateIndices: number[]
  missingCount: number
  presented: number
  tick: number
  started: boolean
  done: boolean
  scheduleDone: string | null
  errors: string[]
  target?: Texture
  finished: Promise<void>
  finish: () => void
}

/** 解码会话诊断：每个流同一时刻只有一个用途（取帧读回或节拍消费）。 */
export class NativeDecodeDiagnostics {
  private readonly waiters = new Map<string, Waiter[]>()
  private readonly paces = new Map<string, PaceState>()
  private readonly subscriptions = new Map<string, () => void>()

  constructor(private readonly receiver: VideoEditNativeFrameReceiver, private readonly gpu: () => Promise<DecodeDiagnosticsGpu>) {}

  async handle(request: DecodeDiagnosticsRequest): Promise<DecodeDiagnosticsResult> {
    if (request.action === 'capture') return { capture: await this.capture(request) }
    if (request.action === 'browserCapture') return { capture: await this.browserCapture(request) }
    if (request.action === 'pace') {
      // 预热与节拍在后台进行：调用方随后才发出计划，这里不能等帧到达。
      const gpu = await this.gpu()
      this.ensureSubscribed(request.streamId)
      void this.startPace(request, gpu)
      return { started: true }
    }
    return { pace: await this.paceResult(request.streamId, request.timeoutMs ?? 120_000) }
  }

  private ensureSubscribed(streamId: string): void {
    if (this.subscriptions.has(streamId)) return
    const frames = this.receiver.subscribe(streamId, (frame) => this.onFrame(streamId, frame))
    const schedule = this.receiver.subscribeSchedule(streamId, (event) => this.onSchedule(streamId, event))
    this.subscriptions.set(streamId, () => { frames(); schedule() })
  }

  private onFrame(streamId: string, frame: NativeVideoFrame): void {
    const pace = this.paces.get(streamId)
    const request = frame.meta.request
    if (pace && !pace.done && request?.kind === 'schedule' && request.id === pace.request.scheduleId) {
      pace.arrivals.set(request.index, frame.receivedAt)
      pace.pts.set(request.index, frame.meta.ptsUs ?? frame.meta.timestampUs)
      if (pace.request.fps === 0) {
        pace.presented += 1
        frame.release()
        this.checkCollected(pace)
        return
      }
      if (request.index < pace.tick) {
        // 节拍已过：迟到的帧直接交回。
        frame.release()
        return
      }
      pace.queue.set(request.index, frame)
      return
    }
    const waiters = this.waiters.get(streamId) ?? []
    const index = waiters.findIndex((waiter) => request?.id === waiter.ticket)
    if (index < 0) {
      frame.release()
      return
    }
    const [waiter] = waiters.splice(index, 1)
    clearTimeout(waiter.timer)
    void this.gpu().then(async (gpu) => {
      try {
        const samples = await readExternalFrame(gpu, frame.frame, waiter.coords)
        waiter.resolve({
          ptsUs: frame.meta.ptsUs ?? null,
          timestampUs: frame.meta.timestampUs,
          frameFormat: frame.frame.format,
          codedSize: [frame.frame.codedWidth, frame.frame.codedHeight],
          displaySize: [frame.frame.displayWidth, frame.frame.displayHeight],
          colorSpace: frame.frame.colorSpace?.toJSON?.() ?? null,
          samples,
        })
      } catch (error) {
        waiter.reject(error instanceof Error ? error : new Error(String(error)))
      } finally {
        frame.release(gpu.device)
      }
    }, (error: unknown) => {
      frame.release()
      waiter.reject(error instanceof Error ? error : new Error(String(error)))
    })
  }

  private onSchedule(streamId: string, event: VideoFrameScheduleEvent): void {
    const pace = this.paces.get(streamId)
    if (!pace || event.scheduleId !== pace.request.scheduleId) return
    if (event.type === 'frame_missing') {
      pace.missing.add(event.index)
      pace.pts.set(event.index, null)
      pace.missingCount += pace.request.fps === 0 ? 1 : 0
    }
    else pace.scheduleDone = event.reason + (event.message ? `：${event.message}` : '')
    if (pace.request.fps === 0) this.checkCollected(pace)
  }

  /** 收集模式：每项都有结果（或计划已结束且再无新结果）即完成。 */
  private checkCollected(pace: PaceState): void {
    if (pace.done) return
    if (pace.pts.size >= pace.request.count) {
      pace.done = true
      pace.tick = pace.request.count
      pace.finish()
    } else if (pace.scheduleDone) {
      setTimeout(() => {
        if (pace.done) return
        pace.done = true
        pace.tick = pace.request.count
        pace.finish()
      }, 1000)
    }
  }

  private capture(request: DecodeCaptureRequest): Promise<DecodeCapture> {
    this.ensureSubscribed(request.streamId)
    return new Promise((resolve, reject) => {
      const waiters = this.waiters.get(request.streamId) ?? []
      const timer = setTimeout(() => {
        const list = this.waiters.get(request.streamId) ?? []
        const index = list.findIndex((waiter) => waiter.ticket === request.ticket)
        if (index >= 0) list.splice(index, 1)
        reject(new Error(`等待帧 ${request.ticket} 超时`))
      }, request.timeoutMs ?? 10_000)
      waiters.push({ ticket: request.ticket, coords: request.coords, resolve, reject, timer })
      this.waiters.set(request.streamId, waiters)
    })
  }

  private async browserCapture(request: DecodeBrowserCaptureRequest): Promise<DecodeCapture> {
    const gpu = await this.gpu()
    const input = new Input({ source: new UrlSource(request.url, { getRetryDelay: () => null }), formats: ALL_FORMATS })
    try {
      const track = await input.getPrimaryVideoTrack()
      if (!track) throw new Error('浏览器后端没有读到视频轨')
      const sink = new VideoSampleSink(track, { hardwareAcceleration: 'prefer-hardware', optimizeForLatency: true })
      const sample = await sink.getSample(request.time)
      if (!sample) throw new Error('浏览器后端在该时间没有画面')
      const frame = sample.toVideoFrame()
      try {
        const samples = await readExternalFrame(gpu, frame, request.coords)
        return {
          ptsUs: sample.microsecondTimestamp,
          timestampUs: frame.timestamp,
          frameFormat: frame.format,
          codedSize: [frame.codedWidth, frame.codedHeight],
          displaySize: [frame.displayWidth, frame.displayHeight],
          colorSpace: frame.colorSpace?.toJSON?.() ?? null,
          samples,
        }
      } finally {
        frame.close()
        sample.close()
      }
    } finally {
      input.dispose()
    }
  }

  private async startPace(request: DecodePaceRequest, gpu: DecodeDiagnosticsGpu): Promise<void> {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => { finish = resolve })
    const state: PaceState = { request, queue: new Map(), missing: new Set(), arrivals: new Map(), pts: new Map(), presentedAt: [], presentedTicks: [], lateTicks: [], missingTicks: [], leads: [], late: 0, lateIndices: [], missingCount: 0, presented: 0, tick: 0, started: false, done: false, scheduleDone: null, errors: [], finished, finish }
    this.paces.set(request.streamId, state)
    if (request.fps === 0) return
    const period = 1000 / request.fps
    const warmup = request.warmupFrames ?? 4
    // 预热：等首批帧到达（纹理池填满）再开始节拍，与播放开始前的预取一致。
    const waitStart = performance.now()
    while (state.queue.size < warmup && !state.scheduleDone && performance.now() - waitStart < 10_000) await new Promise((resolve) => setTimeout(resolve, 2))
    state.started = true
    const origin = performance.now()
    const step = (): void => {
      if (state.done) return
      const index = state.tick
      const frame = state.queue.get(index)
      if (frame) {
        state.queue.delete(index)
        const now = performance.now()
        state.presentedAt.push(now)
        state.presentedTicks.push(index)
        state.leads.push(now - frame.receivedAt)
        state.presented += 1
        try {
          this.draw(gpu, state, frame)
        } catch (error) {
          if (state.errors.length < 10) state.errors.push(error instanceof Error ? error.message : String(error))
        }
        frame.release(gpu.device)
      } else if (state.missing.has(index)) {
        state.missingCount += 1
        state.missingTicks.push(index)
      } else {
        state.late += 1
        state.lateTicks.push(index)
        if (state.lateIndices.length < 30) state.lateIndices.push(index)
      }
      state.tick += 1
      if (state.tick >= request.count) {
        state.done = true
        for (const leftover of state.queue.values()) leftover.release()
        state.queue.clear()
        finish()
        return
      }
      const next = origin + state.tick * period
      setTimeout(step, Math.max(0, next - performance.now()))
    }
    step()
  }

  private draw(gpu: DecodeDiagnosticsGpu, state: PaceState, native: NativeVideoFrame): void {
    const { device } = gpu
    const width = native.frame.displayWidth
    const height = native.frame.displayHeight
    if (!state.target || state.target.width !== width || state.target.height !== height) {
      state.target?.destroy()
      state.target = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: TEXTURE_RENDER_ATTACHMENT | TEXTURE_BINDING })
    }
    const external = device.importExternalTexture({ source: native.frame })
    const bind = device.createBindGroup({ layout: gpu.copy.getBindGroupLayout(0), entries: [{ binding: 0, resource: external }, { binding: 1, resource: gpu.sampler }] })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: state.target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] })
    pass.setPipeline(gpu.copy)
    pass.setBindGroup(0, bind)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  private async paceResult(streamId: string, timeoutMs: number): Promise<DecodePaceResult> {
    const state = this.paces.get(streamId)
    if (!state) throw new Error(`流 ${streamId} 没有节拍消费`)
    await Promise.race([state.finished, new Promise((resolve) => setTimeout(resolve, timeoutMs))])
    state.done = true
    for (const leftover of state.queue.values()) leftover.release()
    state.queue.clear()
    state.target?.destroy()
    this.paces.delete(streamId)
    this.subscriptions.get(streamId)?.()
    this.subscriptions.delete(streamId)
    const intervals = state.presentedAt.slice(1).map((value, index) => value - state.presentedAt[index]).sort((a, b) => a - b)
    const fromTick = state.request.fps > 0 ? Math.ceil(state.request.fps * 0.5) : 0
    const steadyTimes = state.presentedAt.filter((_, index) => state.presentedTicks[index] >= fromTick)
    const steadyIntervals = steadyTimes.slice(1).map((value, index) => value - steadyTimes[index]).sort((a, b) => a - b)
    const steadyTicks = Math.max(0, state.tick - fromTick)
    const summary = (sorted: number[]) => ({ count: sorted.length, p50: round(quantile(sorted, 0.5), 2), p95: round(quantile(sorted, 0.95), 2), p99: round(quantile(sorted, 0.99), 2), max: round(sorted[sorted.length - 1] ?? 0, 2) })
    const spanMs = state.presentedAt.length > 1 ? state.presentedAt[state.presentedAt.length - 1] - state.presentedAt[0] : 0
    const leads = [...state.leads].sort((a, b) => a - b)
    return {
      streamId,
      ticks: state.tick,
      presented: state.presented,
      late: state.late,
      lateIndices: state.lateIndices,
      steady: {
        fromTick,
        framesPerSecond: steadyTicks > 0 ? round((steadyTimes.length * state.request.fps) / steadyTicks, 2) : 0,
        late: state.lateTicks.filter((tick) => tick >= fromTick).length,
        missing: state.missingTicks.filter((tick) => tick >= fromTick).length,
        intervals: summary(steadyIntervals),
      },
      missing: state.missingCount,
      framesPerSecond: state.request.fps > 0 && state.tick > 0 ? round((state.presented * state.request.fps) / state.tick, 2) : 0,
      spanMs: round(spanMs, 1),
      intervals: { count: intervals.length, p50: round(quantile(intervals, 0.5), 2), p95: round(quantile(intervals, 0.95), 2), p99: round(quantile(intervals, 0.99), 2), max: round(intervals[intervals.length - 1] ?? 0, 2) },
      leadMsMedian: round(quantile(leads, 0.5), 2),
      scheduleDone: state.scheduleDone,
      ptsByIndex: Array.from({ length: state.request.count }, (_, index) => (state.pts.has(index) ? (state.pts.get(index) ?? null) : -1)),
      errors: state.errors,
    }
  }

  /** 交回所有借用的帧（Worker 销毁或诊断结束前调用）。 */
  dispose(): void {
    for (const state of this.paces.values()) {
      state.done = true
      for (const frame of state.queue.values()) frame.release()
      state.target?.destroy()
    }
    this.paces.clear()
    for (const waiters of this.waiters.values()) for (const waiter of waiters) { clearTimeout(waiter.timer); waiter.reject(new Error('诊断已结束')) }
    this.waiters.clear()
    for (const stop of this.subscriptions.values()) stop()
    this.subscriptions.clear()
  }
}
