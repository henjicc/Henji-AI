import type { GpuBuffer, GpuDevice, GpuRenderPipeline, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { VideoEditBuiltinEffectInstance } from '@/core/videoEdit/compositing'
import type { VideoEditBuiltinTransitionInput } from '@/core/videoEdit/transitions'
import { planVideoEditBuiltinEffect, planVideoEditBuiltinTransition, type VideoEditBuiltinPlan, type VideoEditBuiltinTexture } from './videoEditBuiltinEffectPasses'
import { VIDEO_EDIT_BUILTIN_EFFECT_SHADER, type VideoEditBuiltinEffectEntry } from './videoEditBuiltinEffectShaders'

interface LayoutDevice { createBindGroupLayout(descriptor: unknown): unknown; createPipelineLayout(descriptor: unknown): unknown }
/** 中间纹理由宿主分配（计入宿主的显存预算），按尺寸与格式复用。 */
export interface VideoEditBuiltinScratchAllocator { allocate(width: number, height: number, format: string): GpuTexture; release(texture: GpuTexture): void }
interface Scratch { texture: GpuTexture; width: number; height: number; format: string; used: boolean }

/**
 * 内置效果的 GPU 执行器：按 `planVideoEditBuiltinEffect` 的工序逐道绘制，一个效果一次提交。
 * 管线按（入口, 输出格式）懒编译；中间纹理按需取用，`releaseIdle` 释放上一帧以来没用到的。
 */
export class VideoEditBuiltinEffectsGpu {
  private readonly pipelines = new Map<string, Promise<GpuRenderPipeline>>()
  private readonly scratch: Scratch[] = []
  private readonly uniforms: GpuBuffer[] = []
  private layout?: unknown
  private module?: unknown
  passes = 0
  constructor(private readonly device: GpuDevice, private readonly sampler: unknown, private readonly allocator: VideoEditBuiltinScratchAllocator) {}
  private pipelineLayout(): unknown {
    if (this.layout) return this.layout
    const device = this.device as GpuDevice & Partial<LayoutDevice>
    if (!device.createBindGroupLayout || !device.createPipelineLayout) throw new Error('GPU设备不支持内置效果绑定。')
    const group = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 2, texture: { sampleType: 'float' } },
      { binding: 1, visibility: 2, sampler: { type: 'filtering' } },
      { binding: 2, visibility: 2, buffer: { type: 'uniform', minBindingSize: 64 } },
      { binding: 3, visibility: 2, texture: { sampleType: 'float' } },
    ] })
    return this.layout = device.createPipelineLayout({ bindGroupLayouts: [group] })
  }
  private pipeline(entry: VideoEditBuiltinEffectEntry, format: string): Promise<GpuRenderPipeline> {
    const key = `${entry}\u0000${format}`
    let pending = this.pipelines.get(key)
    if (!pending) {
      pending = (async () => {
        this.device.pushErrorScope('validation')
        let pipeline: GpuRenderPipeline
        try {
          this.module ??= this.device.createShaderModule({ code: VIDEO_EDIT_BUILTIN_EFFECT_SHADER })
          pipeline = this.device.createRenderPipeline({ layout: this.pipelineLayout(), vertex: { module: this.module, entryPoint: 'vs' }, fragment: { module: this.module, entryPoint: entry, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
        } catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
        const error = await this.device.popErrorScope()
        if (error) throw new Error(`内置效果管线编译失败：${error.message}`)
        return pipeline
      })()
      this.pipelines.set(key, pending)
      pending.catch(() => { if (this.pipelines.get(key) === pending) this.pipelines.delete(key) })
    }
    return pending
  }
  private take(width: number, height: number, format: string, taken: Set<Scratch>): GpuTexture {
    let entry = this.scratch.find(value => !taken.has(value) && value.width === width && value.height === height && value.format === format)
    if (!entry) { entry = { texture: this.allocator.allocate(width, height, format), width, height, format, used: true }; this.scratch.push(entry) }
    entry.used = true; taken.add(entry)
    return entry.texture
  }
  /** 预编译效果用到的全部管线（试渲染与首次使用前）。 */
  async prepare(instance: VideoEditBuiltinEffectInstance, width: number, height: number, format: string): Promise<void> {
    const plan = planVideoEditBuiltinEffect(instance, { width, height, frame: 0 })
    await Promise.all([...new Set(plan.passes.map(pass => pass.entry))].map(entry => this.pipeline(entry, format)))
  }
  /** `input` 与 `output` 尺寸相同；`frame` 只用作胶片颗粒的确定种子。 */
  async render(instance: VideoEditBuiltinEffectInstance, input: { texture: GpuTexture; width: number; height: number; format: string }, output: GpuTexture, frame: number): Promise<void> {
    await this.execute(planVideoEditBuiltinEffect(instance, { width: input.width, height: input.height, frame }), input.format, input.texture, output)
  }
  /**
   * 带参数的视频过渡（4.7）：`outgoing` 前一段、`incoming` 后一段（单侧过渡两者可以是同一纹理，空着的一侧由参数标记），
   * 三者尺寸相同；`format` 是输出格式（任一侧是高精度时为高精度）。
   */
  async renderTransition(transition: VideoEditBuiltinTransitionInput, outgoing: GpuTexture, incoming: GpuTexture, output: GpuTexture, size: { width: number; height: number; format: string }): Promise<void> {
    await this.execute(planVideoEditBuiltinTransition(transition, size), size.format, outgoing, output, incoming)
  }
  private async execute(plan: VideoEditBuiltinPlan, format: string, input: GpuTexture, output: GpuTexture, second?: GpuTexture): Promise<void> {
    const pipelines = await Promise.all(plan.passes.map(pass => this.pipeline(pass.entry, format)))
    const taken = new Set<Scratch>()
    const scratch = plan.scratch.map(value => this.take(value.width, value.height, format, taken))
    const texture = (ref: VideoEditBuiltinTexture): GpuTexture => ref === 'input' ? input : ref === 'second' ? second ?? input : ref === 'output' ? output : scratch[ref]
    const encoder = this.device.createCommandEncoder()
    plan.passes.forEach((pass, index) => {
      const buffer = this.uniforms[index] ??= this.device.createBuffer({ size: 64, usage: 0x08 | 0x40 })
      this.device.queue.writeBuffer(buffer, 0, pass.uniforms)
      const target = encoder.beginRenderPass({ colorAttachments: [{ view: texture(pass.target).createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
      const pipeline = pipelines[index]
      target.setPipeline(pipeline)
      target.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: texture(pass.source).createView() }, { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer } }, { binding: 3, resource: texture(pass.original ?? 'input').createView() },
      ] }))
      target.draw(3); target.end()
    })
    this.device.queue.submit([encoder.finish()])
    this.passes += plan.passes.length
  }
  /** 释放自上次调用以来没有用到的中间纹理。 */
  releaseIdle(): void {
    for (let index = this.scratch.length - 1; index >= 0; index--) {
      const entry = this.scratch[index]
      if (entry.used) { entry.used = false; continue }
      this.allocator.release(entry.texture); this.scratch.splice(index, 1)
    }
  }
  dispose(): void {
    for (const entry of this.scratch) this.allocator.release(entry.texture)
    this.scratch.length = 0
    for (const buffer of this.uniforms) buffer.destroy()
    this.uniforms.length = 0; this.pipelines.clear(); this.layout = undefined; this.module = undefined
  }
}
