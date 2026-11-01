import type { EffectPlannerInput } from './effectPlanner'
import type { GpuBuffer, GpuDevice, GpuRenderPipeline, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { VideoEditBuiltinEffectInstance } from '@/core/videoEdit/compositing'
import type { VideoEditBuiltinTransitionInput } from '@/core/videoEdit/transitions'
import { planVideoEditBuiltinEffect, planVideoEditBuiltinTransition, type VideoEditBuiltinPlan, type VideoEditBuiltinTexture } from './videoEditBuiltinEffectPasses'
import { VIDEO_EDIT_BUILTIN_EFFECT_SHADER, VIDEO_EDIT_UNFILTERED_SOURCE_ENTRIES, type VideoEditBuiltinEffectEntry } from './videoEditBuiltinEffectShaders'
import type { CubeLut } from '@/core/videoEdit/cubeLut'
import type { ColorLutAsset } from '@/core/videoEdit/colorLutAsset'
import { fetchVideoEditColorLut } from './videoEditColorLutSource'
import type { EffectQuality, EffectSize } from '@/core/imaging/effects/descriptor'

export type VideoEditLutLoader = (asset: ColorLutAsset) => Promise<CubeLut>
const loadLut: VideoEditLutLoader = fetchVideoEditColorLut
interface UploadQueue { writeTexture(destination: unknown, data: ArrayBufferView, layout: unknown, size: unknown): void }
const halfScratch = new Float32Array(1); const halfBits = new Uint32Array(halfScratch.buffer)
function half(value: number): number {
  halfScratch[0] = value; const bits = halfBits[0]; const sign = (bits >>> 16) & 0x8000; const exponent = ((bits >>> 23) & 255) - 127 + 15; const mantissa = bits & 0x7fffff
  if (exponent <= 0) return exponent < -10 ? sign : sign | ((mantissa | 0x800000) >>> (14 - exponent))
  return sign | (exponent << 10) | (mantissa >>> 13)
}

interface LayoutDevice { createBindGroupLayout(descriptor: unknown): unknown; createPipelineLayout(descriptor: unknown): unknown }
/** 中间纹理由宿主分配（计入宿主的显存预算），按尺寸与格式复用。 */
export interface VideoEditBuiltinScratchAllocator { allocate(width: number, height: number, format: string, mipLevelCount?: number, storage?: boolean): GpuTexture; release(texture: GpuTexture): void }
export interface BuiltinEncodingBatch { encoder: ReturnType<GpuDevice['createCommandEncoder']>; uniformIndex: number; taken: Set<Scratch>; created?: Set<Scratch>; mixIndex?: number }
interface Scratch { texture: GpuTexture; width: number; height: number; format: string; used: boolean; idleFrames: number }

/**
 * 内置效果的 GPU 执行器：按规划逐道绘制，批次内共享编码器与独占的 uniform 槽。
 * 管线按（入口, 输出格式）懒编译；中间纹理按需取用，`releaseIdle` 释放上一帧以来没用到的。
 */
export class VideoEditBuiltinEffectsGpu {
  private readonly pipelines = new Map<string, Promise<GpuRenderPipeline>>()
  private readonly scratch: Scratch[] = []
  private readonly uniforms: GpuBuffer[] = []
  private layout?: unknown
  private gaussianLayout?: unknown
  private module?: unknown
  private fallbackLut?: GpuTexture
  private readonly lookups = new Map<string, { texture: GpuTexture; cube?: CubeLut; used: boolean; width?: number; height?: number }>()
  private disposed = false
  passes = 0
  constructor(private readonly device: GpuDevice, private readonly sampler: unknown, private readonly allocator: VideoEditBuiltinScratchAllocator, private readonly lutLoader: VideoEditLutLoader = loadLut) {}
  private pipelineLayout(gaussian = false): unknown {
    const existing = gaussian ? this.gaussianLayout : this.layout
    if (existing) return existing
    const device = this.device as GpuDevice & Partial<LayoutDevice>
    if (!device.createBindGroupLayout || !device.createPipelineLayout) throw new Error('GPU设备不支持内置效果绑定。')
    const group = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 2, texture: { sampleType: gaussian ? 'unfilterable-float' : 'float' } },
      { binding: 1, visibility: 2, sampler: { type: 'filtering' } },
      { binding: 2, visibility: 2, buffer: { type: 'uniform', minBindingSize: 96 } },
      { binding: 3, visibility: 2, texture: { sampleType: 'float' } },
      { binding: 4, visibility: 2, texture: { sampleType: 'float', viewDimension: '3d' } },
      { binding: 5, visibility: 2, texture: { sampleType: 'float' } },
    ] })
    const layout = device.createPipelineLayout({ bindGroupLayouts: [group] })
    if (gaussian) this.gaussianLayout = layout
    else this.layout = layout
    return layout
  }
  private pipeline(entry: VideoEditBuiltinEffectEntry, format: string): Promise<GpuRenderPipeline> {
    const key = `${entry}\u0000${format}`
    let pending = this.pipelines.get(key)
    if (!pending) {
      pending = (async () => {
        this.device.pushErrorScope('validation')
        let compiled: Promise<GpuRenderPipeline>
        try {
          this.module ??= this.device.createShaderModule({ code: VIDEO_EDIT_BUILTIN_EFFECT_SHADER })
          const descriptor = { layout: this.pipelineLayout(VIDEO_EDIT_UNFILTERED_SOURCE_ENTRIES.has(entry)), vertex: { module: this.module, entryPoint: 'vs' }, fragment: { module: this.module, entryPoint: entry, targets: [{ format }] }, primitive: { topology: 'triangle-list' } }
          compiled = this.device.createRenderPipelineAsync ? this.device.createRenderPipelineAsync(descriptor) : Promise.resolve(this.device.createRenderPipeline(descriptor))
        } catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
        // Pop before yielding: parallel preparation must not steal another pipeline's error scope.
        const [pipeline, error] = await Promise.all([compiled, this.device.popErrorScope()])
        if (error) throw new Error(`内置效果管线编译失败：${error.message}`)
        return pipeline
      })()
      this.pipelines.set(key, pending)
      pending.catch(() => { if (this.pipelines.get(key) === pending) this.pipelines.delete(key) })
    }
    return pending
  }
  private take(width: number, height: number, format: string, taken: Set<Scratch>, created?: Set<Scratch>): Scratch {
    let entry = this.scratch.find(value => !taken.has(value) && value.width === width && value.height === height && value.format === format)
    if (!entry) {
      // 尺寸变化时先归还闲置档位，避免新旧分辨率同时占满预算。
      for (let index = this.scratch.length - 1; index >= 0; index--) {
        const idle = this.scratch[index]
        if (!taken.has(idle) && !idle.used && (idle.width !== width || idle.height !== height)) {
          this.allocator.release(idle.texture); this.scratch.splice(index, 1)
        }
      }
      entry = { texture: this.allocator.allocate(width, height, format), width, height, format, used: true, idleFrames: 0 }; this.scratch.push(entry); created?.add(entry)
    }
    entry.used = true; taken.add(entry)
    return entry
  }
  /** 预编译效果用到的全部管线（试渲染与首次使用前）。 */
  async prepare(instance: VideoEditBuiltinEffectInstance, width: number, height: number, format: string): Promise<void> {
    const plan = planVideoEditBuiltinEffect(instance, { width, height, frame: 0 })
    await Promise.all([...new Set(plan.passes.map(pass => pass.entry))].map(entry => this.pipeline(entry, format)))
  }
  /** `input`、`output` 与人物蒙版 `subject` 尺寸相同；`frame`、`frameDuration` 是效果时钟（片段自己的帧号与每帧秒数），随帧效果取种子、随时间变化的效果求秒数都用它；随时间变化的效果在第 0 帧以外缺帧时长会报错。 */
  async render(instance: EffectPlannerInput, input: { texture: GpuTexture; width: number; height: number; format: string }, output: GpuTexture, frame: number, renderScale = 1, luts: readonly ColorLutAsset[] = [], quality: EffectQuality = 'interactive', referenceSize?: EffectSize, frameDuration?: number, subject?: GpuTexture): Promise<void> {
    await this.encodePlan(planVideoEditBuiltinEffect(instance, { width: input.width, height: input.height, frame, frameDuration, renderScale, quality, referenceSize }), input.format, input.texture, output, undefined, luts, undefined, undefined, subject)
  }
  /**
   * 带参数的视频过渡（4.7）：`outgoing` 前一段、`incoming` 后一段（单侧过渡两者可以是同一纹理，空着的一侧由参数标记），
   * 三者尺寸相同；`format` 是输出格式（任一侧是高精度时为高精度）。
   */
  async renderTransition(transition: VideoEditBuiltinTransitionInput, outgoing: GpuTexture, incoming: GpuTexture, output: GpuTexture, size: { width: number; height: number; format: string }): Promise<void> {
    await this.encodePlan(planVideoEditBuiltinTransition(transition, size), size.format, outgoing, output, incoming)
  }
  private upload(data: Float32Array, width: number, depth = 1, three = false): GpuTexture {
    const height = three ? width : Math.ceil(data.length / 4 / width)
    const padded = new Float32Array(width * height * depth * 4); padded.set(data)
    const texture = this.device.createTexture({ size: [width, height, depth], dimension: three ? '3d' : '2d', format: 'rgba16float', usage: 2 | 4 })
    ;(this.device.queue as typeof this.device.queue & UploadQueue).writeTexture({ texture }, Uint16Array.from(padded, half), { bytesPerRow: width * 8, rowsPerImage: height }, [width, height, depth])
    return texture
  }
  async encodePlan(plan: VideoEditBuiltinPlan, format: string, input: GpuTexture, output: GpuTexture, second?: GpuTexture, luts: readonly ColorLutAsset[] = [], batch?: BuiltinEncodingBatch, underlay?: GpuTexture, subject?: GpuTexture): Promise<void> {
    if (!subject && plan.passes.some(pass => pass.source === 'subject' || pass.original === 'subject' || pass.mask === 'subject')) throw new Error('这个效果需要人物蒙版，人物还没有识别出来。')
    const scratchFormat = plan.scratchFormat ?? (plan.linearScratch ? plan.resolvedGaussian?.intermediateFormat ?? 'rgba16float' : format)
    const pipelines = await Promise.all(plan.passes.map(pass => this.pipeline(pass.entry, pass.target === 'output' || pass.target === plan.underlay && underlay ? format : scratchFormat)))
    if (this.disposed) throw new Error('原调色渲染已关闭。')
    // Resolve all resources before recording, so missing LUT never silently becomes identity.
    const lookups: Array<{ texture: GpuTexture; cube?: CubeLut } | undefined> = []
    for (const pass of plan.passes) {
      const lookup = pass.lookup
      if (!lookup) { lookups.push(undefined); continue }
      const asset = lookup.kind === 'cube' ? luts.find(asset => asset.id === lookup.ref) : undefined
      if (lookup.kind === 'cube' && !asset) throw new Error('项目中找不到此 LUT，请重新导入或移除引用。')
      const key = lookup.kind === 'table' ? `table:${lookup.key}` : `cube:${asset!.path}:${asset!.contentIdentity}`
      let resource = this.lookups.get(key)
      if (!resource) {
        if (lookup.kind === 'table') {
          // Parameter tables change on every drag frame: rewrite an idle table texture of the same size instead of allocating.
          // 只复用同尺寸的闲置表：调色参数表与蓝噪声表尺寸不同，换用错尺寸的纹理会越界写入。
          const rows = Math.ceil(lookup.data.length / 4 / lookup.width)
          const idle = [...this.lookups].find(([key, value]) => key.startsWith('table:') && !value.used && !value.cube && value.width === lookup.width && value.height === rows)
          if (idle) {
            this.lookups.delete(idle[0]); resource = idle[1]
            ;(this.device.queue as typeof this.device.queue & UploadQueue).writeTexture({ texture: resource.texture }, Uint16Array.from(lookup.data, half), { bytesPerRow: lookup.width * 8, rowsPerImage: lookup.height }, [lookup.width, lookup.height, 1])
          } else resource = { texture: this.upload(lookup.data, lookup.width), used: true, width: lookup.width, height: rows }
        } else {
          const cube = await this.lutLoader(asset!)
          if (this.disposed) throw new Error('原调色渲染已关闭。')
          resource = { cube, texture: this.upload(cube.data, cube.kind === '3d' ? cube.size : Math.min(1024, cube.size), cube.kind === '3d' ? cube.size : 1, cube.kind === '3d'), used: true }
        }
        this.lookups.set(key, resource)
      }
      resource.used = true
      lookups.push(resource)
    }
    this.fallbackLut ??= this.upload(new Float32Array([0, 0, 0, 1]), 1, 1, true)
    const taken = batch?.taken ?? new Set<Scratch>()
    // 高斯只用 textureLoad 与显式有效尺寸取样；各缩放工序共用两幅全尺寸 backing，
    // 通过 viewport 限定写入区域，保持 final 的 32f 数值而不同时驻留整组金字塔。
    const gaussianBacking = plan.resolvedGaussian && plan.scratch.length ? {
      width: Math.max(...plan.scratch.map(value => value.width)), height: Math.max(...plan.scratch.map(value => value.height)),
    } : undefined
    const scratch: GpuTexture[] = []
    const borrowed = new Map<number, Scratch>()
    const lastUse = new Map<number, number>()
    plan.passes.forEach((pass, index) => {
      for (const ref of [pass.source, pass.original, pass.mask, pass.target]) if (typeof ref === 'number') lastUse.set(ref, index)
    })
    const texture = (ref: VideoEditBuiltinTexture): GpuTexture => ref === 'input' ? input : ref === 'second' ? second ?? input : ref === 'output' ? output : ref === 'subject' ? subject! : scratch[ref]
    const encoder = batch?.encoder ?? this.device.createCommandEncoder()
    plan.passes.forEach((pass, index) => {
      for (const ref of [pass.source, pass.original, pass.mask, pass.target]) {
        if (typeof ref !== 'number' || scratch[ref]) continue
        if (ref === plan.underlay && underlay) scratch[ref] = underlay
        else {
          const size = gaussianBacking ?? plan.scratch[ref], entry = this.take(size.width, size.height, scratchFormat, taken, batch?.created)
          scratch[ref] = entry.texture; borrowed.set(ref, entry)
        }
      }
      const lookup = lookups[index]; const cube = lookup?.cube
      if (cube) {
        pass.uniforms[5] = cube.kind === '1d' ? 1 : 0; pass.uniforms[6] = cube.size
        pass.uniforms.set(cube.domainMin, 8); pass.uniforms.set(cube.domainMax.map((value, i) => value - cube.domainMin[i]), 12)
      }
      const slot = batch ? batch.uniformIndex++ : index
      const buffer = this.uniforms[slot] ??= this.device.createBuffer({ size: 96, usage: 0x08 | 0x40 })
      const uniform = new Float32Array(24); uniform.set(pass.uniforms)
      this.device.queue.writeBuffer(buffer, 0, uniform)
      const target = encoder.beginRenderPass({ colorAttachments: [{ view: (texture(pass.target) as GpuTexture & { createView(descriptor: unknown): unknown }).createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
      if (gaussianBacking && typeof pass.target === 'number') {
        const size = plan.scratch[pass.target]
        const viewport = target as typeof target & { setViewport(x: number, y: number, width: number, height: number, minDepth: number, maxDepth: number): void; setScissorRect(x: number, y: number, width: number, height: number): void }
        viewport.setViewport(0, 0, size.width, size.height, 0, 1); viewport.setScissorRect(0, 0, size.width, size.height)
      }
      const pipeline = pipelines[index]
      target.setPipeline(pipeline)
      target.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: texture(pass.source).createView() }, { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer } }, { binding: 3, resource: (lookup && cube?.kind !== '3d' ? lookup.texture : texture(pass.original ?? 'input')).createView() },
        { binding: 4, resource: (cube?.kind === '3d' ? lookup!.texture : this.fallbackLut!).createView() },
        { binding: 5, resource: texture(pass.mask ?? 'input').createView() },
      ] }))
      target.draw(3); target.end()
      // 同一 encoder 中的 pass 有序执行；最后一次读取以后即可复用像素存储，uniform 仍逐道独占。
      for (const [ref, entry] of borrowed) if (lastUse.get(ref) === index) { taken.delete(entry); borrowed.delete(ref) }
    })
    if (!batch) this.device.queue.submit([encoder.finish()])
    this.passes += plan.passes.length
  }
  /** 释放自上次调用以来没有用到的中间纹理。 */
  releaseIdle(): void {
    this.releaseIdleLookups()
    for (let index = this.scratch.length - 1; index >= 0; index--) {
      const entry = this.scratch[index]
      if (entry.used) { entry.used = false; entry.idleFrames = 0; continue }
      if (++entry.idleFrames <= 1) continue
      this.allocator.release(entry.texture); this.scratch.splice(index, 1)
    }
  }
  private releaseIdleLookups(): void {
    // Sweep at the frame boundary, not between effects: every curve/LUT in a long
    // chain stays warm. Animated or removed lookups survive at most one idle frame.
    for (const [key, value] of this.lookups) {
      if (value.used) value.used = false
      else { value.texture.destroy(); this.lookups.delete(key) }
    }
  }
  /** 弃帧只归还本次新分配的附件，保留已经预热的池。 */
  abandon(batch: BuiltinEncodingBatch): void {
    for (let index = this.scratch.length - 1; index >= 0; index--) {
      const entry = this.scratch[index]
      if (batch.created?.has(entry)) { this.allocator.release(entry.texture); this.scratch.splice(index, 1) }
    }
    batch.taken.clear()
    this.releaseIdleLookups()
  }
  releaseScratch(): void {
    for (const entry of this.scratch) this.allocator.release(entry.texture)
    this.scratch.length = 0
  }
  dispose(): void {
    this.disposed = true
    for (const value of this.lookups.values()) value.texture.destroy()
    this.lookups.clear(); this.fallbackLut?.destroy(); this.fallbackLut = undefined
    this.releaseScratch()
    for (const buffer of this.uniforms) buffer.destroy()
    this.uniforms.length = 0; this.pipelines.clear(); this.layout = undefined; this.module = undefined
    this.gaussianLayout = undefined
  }
}
