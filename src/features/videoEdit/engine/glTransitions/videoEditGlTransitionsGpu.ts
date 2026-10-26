import type { GpuBuffer, GpuDevice, GpuRenderPipeline, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { glTransitionName, glTransitionUniforms, type GlTransitionKind } from '@/core/videoEdit/glTransitions/transitions'

/** 一次 GL 转场：进度 0 是前一段、1 是后一段；单侧过渡空着的一侧由标记换成透明画面。 */
export interface VideoEditGlTransitionInput { kind: GlTransitionKind; params: Readonly<VideoEditBuiltinParams>; progress: number; emptyOutgoing?: boolean; emptyIncoming?: boolean }
interface LayoutDevice { createBindGroupLayout(descriptor: unknown): unknown; createPipelineLayout(descriptor: unknown): unknown }

/** gl-transitions 的 uniform 缓冲最大 64 字节（生成目录核对），留足余量。 */
const UNIFORM_BYTES = 256

/**
 * gl-transitions 转场的 GPU 执行器：着色器表（约 380KB 文本）首次用到时才加载；管线按（转场, 输出格式）懒编译，
 * 绑定按上游契约固定为 0 uniform、1 取样器、2 前一段、3 后一段。一次转场一次提交，uniform 写入与提交按顺序排队，
 * 同一帧里多个转场共用一个 uniform 缓冲也互不干扰。
 */
export class VideoEditGlTransitionsGpu {
  private shaders?: Promise<Readonly<Record<string, string>>>
  private readonly modules = new Map<string, unknown>()
  private readonly pipelines = new Map<string, Promise<GpuRenderPipeline>>()
  private layout?: { group: unknown; pipeline: unknown }
  private uniform?: GpuBuffer
  private disposed = false
  constructor(private readonly device: GpuDevice, private readonly sampler: unknown) {}

  private source(): Promise<Readonly<Record<string, string>>> {
    const pending = this.shaders ??= import('./glTransitionShaders.generated').then(module => module.GL_TRANSITION_WGSL)
    pending.catch(() => { if (this.shaders === pending) this.shaders = undefined })
    return pending
  }
  private bindings(): { group: unknown; pipeline: unknown } {
    if (this.layout) return this.layout
    const device = this.device as GpuDevice & Partial<LayoutDevice>
    if (!device.createBindGroupLayout || !device.createPipelineLayout) throw new Error('GPU设备不支持转场绑定。')
    const group = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 2, buffer: { type: 'uniform' } },
      { binding: 1, visibility: 2, sampler: { type: 'filtering' } },
      { binding: 2, visibility: 2, texture: { sampleType: 'float' } },
      { binding: 3, visibility: 2, texture: { sampleType: 'float' } },
    ] })
    return this.layout = { group, pipeline: device.createPipelineLayout({ bindGroupLayouts: [group] }) }
  }
  private pipeline(kind: GlTransitionKind, format: string): Promise<GpuRenderPipeline> {
    const key = `${kind}\u0000${format}`
    let pending = this.pipelines.get(key)
    if (!pending) {
      pending = (async () => {
        const name = glTransitionName(kind)
        const code = (await this.source())[name]
        if (!code) throw new Error(`转场“${name}”缺少着色器。`)
        if (this.disposed) throw new Error('转场渲染已关闭。')
        this.device.pushErrorScope('validation')
        let compiled: Promise<GpuRenderPipeline>
        try {
          let module = this.modules.get(name)
          if (!module) { module = this.device.createShaderModule({ code, label: `gl-transition ${name}` }); this.modules.set(name, module) }
          const descriptor = { layout: this.bindings().pipeline, vertex: { module, entryPoint: 'henjiVertex' }, fragment: { module, entryPoint: 'henjiFragment', targets: [{ format }] }, primitive: { topology: 'triangle-list' } }
          compiled = this.device.createRenderPipelineAsync ? this.device.createRenderPipelineAsync(descriptor) : Promise.resolve(this.device.createRenderPipeline(descriptor))
        } catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
        // Pop before yielding: parallel preparation must not steal another pipeline's error scope.
        const [pipeline, error] = await Promise.all([compiled, this.device.popErrorScope()])
        if (error) throw new Error(`转场“${name}”着色器编译失败：${error.message}`)
        return pipeline
      })()
      this.pipelines.set(key, pending)
      pending.catch(() => { if (this.pipelines.get(key) === pending) this.pipelines.delete(key) })
    }
    return pending
  }
  /** 预编译（试渲染与播放到那一段之前）。 */
  async prepare(kind: GlTransitionKind, format: string): Promise<void> { await this.pipeline(kind, format) }
  /**
   * `outgoing` 前一段、`incoming` 后一段、`output` 三者尺寸相同（输入可以是 1×1 透明画面，按 uv 取样）；
   * `format` 是输出格式，`transparent` 在单侧过渡时提供空着那一侧的画面。
   */
  async render(input: VideoEditGlTransitionInput, outgoing: GpuTexture, incoming: GpuTexture, output: GpuTexture, size: { width: number; height: number; format: string }, transparent: () => GpuTexture): Promise<void> {
    if (![size.width, size.height].every(value => Number.isInteger(value) && value >= 1)) throw new Error('过渡需要有效的画面尺寸。')
    if (!Number.isFinite(input.progress) || input.progress < 0 || input.progress > 1) throw new Error('过渡进度必须在 0 到 1 之间。')
    const pipeline = await this.pipeline(input.kind, size.format)
    if (this.disposed) throw new Error('转场渲染已关闭。')
    const data = glTransitionUniforms(input.kind, input.params, input.progress, size.width / size.height)
    if (data.byteLength > UNIFORM_BYTES) throw new Error('转场参数超出缓冲。')
    const buffer = this.uniform ??= this.device.createBuffer({ size: UNIFORM_BYTES, usage: 0x08 | 0x40 })
    this.device.queue.writeBuffer(buffer, 0, new Uint8Array(data))
    const from = input.emptyOutgoing ? transparent() : outgoing; const to = input.emptyIncoming ? transparent() : incoming
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: this.bindings().group, entries: [
      { binding: 0, resource: { buffer } }, { binding: 1, resource: this.sampler },
      { binding: 2, resource: from.createView() }, { binding: 3, resource: to.createView() },
    ] }))
    pass.draw(3); pass.end()
    this.device.queue.submit([encoder.finish()])
  }
  dispose(): void {
    this.disposed = true
    this.uniform?.destroy(); this.uniform = undefined
    this.pipelines.clear(); this.modules.clear(); this.layout = undefined
  }
}
