import type { NativeVideoFrame, VideoEditNativeFrameReceiver } from './videoEditNativeFrames'
import { NativeDecodeDiagnostics, type DecodeDiagnosticsRequest, type DecodeDiagnosticsResult, type DiagnosticsDevice } from './videoEditNativeDecodeDiagnostics'

/**
 * 原生帧通道诊断（只在渲染 Worker 收到真实性测试的诊断消息时实例化，正式剪辑流程不使用）：
 * - 像素校验：按原生测试画面布局，用 WebGPU `importExternalTexture` + 计算着色器 `textureLoad` 读回色条、
 *   帧号位块、透明块与整行灰阶，得到颜色误差、帧号是否正确、位深是否保留；
 * - 负载：其余帧照正式合成入口的做法导入外部纹理并绘制到一张同尺寸自有纹理，统计到达间隔。
 * 原生解码会话（1.3）的读回与节拍消费见 `videoEditNativeDecodeDiagnostics.ts`，共用这里的 WebGPU 设备与管线。
 */

export interface NativeFramePatternLayout {
  width: number
  height: number
  bars: Array<{ x: number; y: number; color: [number, number, number] }>
  ramp: { y: number; x0: number; x1: number }
  bits: Array<{ x: number; y: number }>
  alpha: { x: number; y: number; color: [number, number, number, number] }
  background: { x: number; y: number }
}

export interface NativeFrameDiagnosticsStream {
  streamId: string
  pattern?: NativeFramePatternLayout
  /** 跳过开头几帧后做像素校验的帧数。 */
  checkFrames?: number
  skipFrames?: number
}

export type NativeFrameDiagnosticsRequest =
  | { action: 'start'; streams: NativeFrameDiagnosticsStream[]; composite?: boolean }
  | { action: 'stop'; streamIds?: string[] }
  | { action: 'snapshot' }
  | DecodeDiagnosticsRequest

export interface NativeFramePixelCheck {
  frameIndex: number
  decodedBits: number
  bitsOk: boolean
  barsMaxError: number
  bars: number[][]
  alpha: number[]
  background: number[]
  rampDistinct: number
  rampNonMonotonic: number
  rampMin: number
  rampMax: number
  frameFormat: string | null
  codedSize: [number, number]
}

export interface NativeFrameIntervalSummary {
  count: number
  p50: number
  p95: number
  p99: number
  max: number
}

export interface NativeFrameStreamDiagnostics {
  streamId: string
  received: number
  spanMs: number
  framesPerSecond: number
  intervals: NativeFrameIntervalSummary
  /** 帧号不连续（跳帧）次数与跳过的帧数。 */
  gaps: number
  missingFrames: number
  checks: NativeFramePixelCheck[]
  errors: string[]
}

export interface NativeFrameDiagnosticsResult {
  streams: NativeFrameStreamDiagnostics[]
  receiver: ReturnType<VideoEditNativeFrameReceiver['stats']>
  /** 解码会话诊断的结果（只在对应动作时出现）。 */
  decode?: DecodeDiagnosticsResult
}

const BIT_COUNT = 16

// WebGPU 常量（项目未引入 @webgpu/types，与合成器一样只声明用到的最小形状）。
const BUFFER_MAP_READ = 0x1
const BUFFER_COPY_SRC = 0x4
const BUFFER_COPY_DST = 0x8
const BUFFER_STORAGE = 0x80
const TEXTURE_BINDING = 0x4
const TEXTURE_RENDER_ATTACHMENT = 0x10
const MAP_READ = 0x1

interface DiagBuffer {
  destroy(): void
  mapAsync(mode: number): Promise<void>
  getMappedRange(): ArrayBuffer
  unmap(): void
}

interface DiagTexture {
  readonly width: number
  readonly height: number
  createView(): unknown
  destroy(): void
}

interface DiagPipeline {
  getBindGroupLayout(index: number): unknown
}

interface DiagPass {
  setPipeline(pipeline: DiagPipeline): void
  setBindGroup(index: number, group: unknown): void
  end(): void
}

interface DiagEncoder {
  beginComputePass(): DiagPass & { dispatchWorkgroups(count: number): void }
  beginRenderPass(descriptor: unknown): DiagPass & { draw(count: number): void }
  copyBufferToBuffer(source: DiagBuffer, sourceOffset: number, target: DiagBuffer, targetOffset: number, size: number): void
  finish(): unknown
}

interface DiagDevice {
  queue: { submit(commands: unknown[]): void; writeBuffer(buffer: DiagBuffer, offset: number, data: ArrayBufferView): void; onSubmittedWorkDone(): Promise<void> }
  createBuffer(descriptor: { size: number; usage: number }): DiagBuffer
  createTexture(descriptor: { size: [number, number]; format: string; usage: number }): DiagTexture
  createShaderModule(descriptor: { code: string }): unknown
  createComputePipeline(descriptor: unknown): DiagPipeline
  createRenderPipeline(descriptor: unknown): DiagPipeline
  createSampler(descriptor: unknown): unknown
  createBindGroup(descriptor: unknown): unknown
  createCommandEncoder(): DiagEncoder
  importExternalTexture(descriptor: { source: VideoFrame }): unknown
}

interface DiagAdapter {
  requestDevice(): Promise<DiagDevice>
}

const SAMPLE_WGSL = /* wgsl */ `
@group(0) @binding(0) var source: texture_external;
@group(0) @binding(1) var<storage, read> coords: array<vec2u>;
@group(0) @binding(2) var<storage, read_write> samples: array<vec4f>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= arrayLength(&coords)) { return; }
  samples[id.x] = textureLoad(source, coords[id.x]);
}`

const COPY_WGSL = /* wgsl */ `
@group(0) @binding(0) var source: texture_external;
@group(0) @binding(1) var linear: sampler;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) index: u32) -> Out {
  let uv = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
  return Out(vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0), uv);
}
@fragment fn fs(input: Out) -> @location(0) vec4f { return textureSampleBaseClampToEdge(source, linear, input.uv); }`

interface StreamState {
  config: NativeFrameDiagnosticsStream
  arrivals: number[]
  frameIndices: number[]
  checks: NativeFramePixelCheck[]
  errors: string[]
  target?: DiagTexture
  unsubscribe: () => void
  checking: number
}

interface GpuResources {
  device: DiagDevice & DiagnosticsDevice
  sample: DiagPipeline
  copy: DiagPipeline
  sampler: unknown
}

function quantile(sorted: number[], q: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0
}

const round = (value: number, digits = 4): number => Math.round(value * 10 ** digits) / 10 ** digits

export class NativeFrameDiagnostics {
  private gpu: Promise<GpuResources> | null = null
  private readonly streams = new Map<string, StreamState>()
  private composite = true
  private decode: NativeDecodeDiagnostics | null = null

  constructor(private readonly receiver: VideoEditNativeFrameReceiver) {}

  async handle(request: NativeFrameDiagnosticsRequest): Promise<NativeFrameDiagnosticsResult> {
    if (request.action === 'capture' || request.action === 'browserCapture' || request.action === 'pace' || request.action === 'paceResult') {
      this.decode ??= new NativeDecodeDiagnostics(this.receiver, () => this.resources())
      return { streams: [], receiver: this.receiver.stats(), decode: await this.decode.handle(request) }
    }
    if (request.action === 'start') {
      const gpu = await this.resources()
      this.composite = request.composite !== false
      for (const config of request.streams) {
        this.streams.get(config.streamId)?.unsubscribe()
        const state: StreamState = { config, arrivals: [], frameIndices: [], checks: [], errors: [], unsubscribe: () => undefined, checking: 0 }
        state.unsubscribe = this.receiver.subscribe(config.streamId, (frame) => this.onFrame(gpu, state, frame))
        this.streams.set(config.streamId, state)
      }
      return this.result([...this.streams.keys()])
    }
    if (request.action === 'snapshot') return this.result([...this.streams.keys()])
    const ids = request.streamIds ?? [...this.streams.keys()]
    // 等在途像素读回完成，结果才完整。
    const deadline = performance.now() + 2_000
    while ([...this.streams.values()].some((state) => state.checking > 0) && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    const result = this.result(ids)
    for (const id of ids) {
      const state = this.streams.get(id)
      state?.unsubscribe()
      state?.target?.destroy()
      this.streams.delete(id)
    }
    return result
  }

  private resources(): Promise<GpuResources> {
    this.gpu ??= (async () => {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(options?: unknown): Promise<DiagAdapter | null> } }).gpu
      const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance' })
      if (!adapter) throw new Error('WebGPU 不可用')
      const device = (await adapter.requestDevice()) as DiagDevice & DiagnosticsDevice
      const sample = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: SAMPLE_WGSL }), entryPoint: 'main' } })
      const module = device.createShaderModule({ code: COPY_WGSL })
      const copy = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } })
      return { device, sample, copy, sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) }
    })()
    return this.gpu
  }

  private onFrame(gpu: GpuResources, state: StreamState, native: NativeVideoFrame): void {
    state.arrivals.push(native.receivedAt)
    state.frameIndices.push(native.meta.frameIndex)
    const { config } = state
    const position = state.arrivals.length
    try {
      if (config.pattern && position > (config.skipFrames ?? 2) && state.checks.length + state.checking < (config.checkFrames ?? 0)) {
        this.check(gpu, state, native, config.pattern)
        return
      }
      if (this.composite) this.drawToOwnTexture(gpu, state, native)
    } catch (error) {
      if (state.errors.length < 10) state.errors.push(error instanceof Error ? error.message : String(error))
    }
    native.release(gpu.device)
  }

  /** 与正式合成入口相同的用法：导入外部纹理并绘制到自有纹理。 */
  private drawToOwnTexture(gpu: GpuResources, state: StreamState, native: NativeVideoFrame): void {
    const { device } = gpu
    const width = native.frame.codedWidth
    const height = native.frame.codedHeight
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

  private check(gpu: GpuResources, state: StreamState, native: NativeVideoFrame, pattern: NativeFramePatternLayout): void {
    const { device } = gpu
    const points: number[] = []
    for (const bar of pattern.bars) points.push(bar.x, bar.y)
    for (const bit of pattern.bits) points.push(bit.x, bit.y)
    points.push(pattern.alpha.x, pattern.alpha.y, pattern.background.x, pattern.background.y)
    const fixed = points.length / 2
    for (let x = pattern.ramp.x0; x <= pattern.ramp.x1; x += 1) points.push(x, pattern.ramp.y)
    const count = points.length / 2
    const coords = device.createBuffer({ size: count * 8, usage: BUFFER_STORAGE | BUFFER_COPY_DST })
    device.queue.writeBuffer(coords, 0, new Uint32Array(points))
    const samples = device.createBuffer({ size: count * 16, usage: BUFFER_STORAGE | BUFFER_COPY_SRC })
    const readback = device.createBuffer({ size: count * 16, usage: BUFFER_MAP_READ | BUFFER_COPY_DST })
    const frameFormat = native.frame.format
    const codedSize: [number, number] = [native.frame.codedWidth, native.frame.codedHeight]
    const external = device.importExternalTexture({ source: native.frame })
    const bind = device.createBindGroup({ layout: gpu.sample.getBindGroupLayout(0), entries: [{ binding: 0, resource: external }, { binding: 1, resource: { buffer: coords } }, { binding: 2, resource: { buffer: samples } }] })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(gpu.sample)
    pass.setBindGroup(0, bind)
    pass.dispatchWorkgroups(Math.ceil(count / 64))
    pass.end()
    encoder.copyBufferToBuffer(samples, 0, readback, 0, count * 16)
    device.queue.submit([encoder.finish()])
    native.release(device)
    state.checking += 1
    void readback.mapAsync(MAP_READ).then(() => {
      const values = new Float32Array(readback.getMappedRange().slice(0))
      readback.unmap()
      const at = (index: number): number[] => Array.from(values.subarray(index * 4, index * 4 + 4))
      let barsMaxError = 0
      const bars = pattern.bars.map((bar, index) => {
        const got = at(index)
        barsMaxError = Math.max(barsMaxError, ...bar.color.map((value, channel) => Math.abs(value - got[channel])))
        return got.map((value) => round(value))
      })
      let decodedBits = 0
      for (let bit = 0; bit < BIT_COUNT; bit += 1) if (at(pattern.bars.length + bit)[0] > 0.5) decodedBits |= 1 << bit
      const ramp: number[] = []
      for (let index = fixed; index < count; index += 1) ramp.push(values[index * 4])
      let nonMonotonic = 0
      for (let index = 1; index < ramp.length; index += 1) if (ramp[index] < ramp[index - 1] - 1e-6) nonMonotonic += 1
      state.checks.push({
        frameIndex: native.meta.frameIndex,
        decodedBits,
        bitsOk: decodedBits === (native.meta.frameIndex & 0xffff),
        barsMaxError: round(barsMaxError),
        bars,
        alpha: at(pattern.bars.length + BIT_COUNT).map((value) => round(value)),
        background: at(pattern.bars.length + BIT_COUNT + 1).map((value) => round(value)),
        rampDistinct: new Set(ramp.map((value) => value.toFixed(7))).size,
        rampNonMonotonic: nonMonotonic,
        rampMin: round(Math.min(...ramp)),
        rampMax: round(Math.max(...ramp)),
        frameFormat,
        codedSize,
      })
    }).catch((error: unknown) => {
      if (state.errors.length < 10) state.errors.push(error instanceof Error ? error.message : String(error))
    }).finally(() => {
      state.checking -= 1
      coords.destroy()
      samples.destroy()
      readback.destroy()
    })
  }

  private result(ids: string[]): NativeFrameDiagnosticsResult {
    const streams = ids.flatMap((id) => {
      const state = this.streams.get(id)
      if (!state) return []
      const gaps = state.arrivals.slice(1).map((value, index) => value - state.arrivals[index]).sort((a, b) => a - b)
      const spanMs = state.arrivals.length > 1 ? state.arrivals[state.arrivals.length - 1] - state.arrivals[0] : 0
      let gapCount = 0
      let missing = 0
      for (let index = 1; index < state.frameIndices.length; index += 1) {
        const step = state.frameIndices[index] - state.frameIndices[index - 1]
        if (step > 1) {
          gapCount += 1
          missing += step - 1
        }
      }
      return [{
        streamId: id,
        received: state.arrivals.length,
        spanMs: round(spanMs, 1),
        framesPerSecond: spanMs > 0 ? round(((state.arrivals.length - 1) * 1000) / spanMs, 2) : 0,
        intervals: { count: gaps.length, p50: round(quantile(gaps, 0.5), 2), p95: round(quantile(gaps, 0.95), 2), p99: round(quantile(gaps, 0.99), 2), max: round(gaps[gaps.length - 1] ?? 0, 2) },
        gaps: gapCount,
        missingFrames: missing,
        checks: state.checks,
        errors: state.errors,
      }]
    })
    return { streams, receiver: this.receiver.stats() }
  }
}
