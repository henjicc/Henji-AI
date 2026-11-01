import type { GpuDevice, GpuTexture, GpuRenderPipeline } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { SpatialMat4 } from '@/core/videoEdit/spatialTypes'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'
import { VideoEditBuiltinEffectsGpu, type VideoEditBuiltinScratchAllocator } from './videoEditBuiltinEffectsGpu'
import { planAuthorDefocus, type VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'
import type { ColorLutAsset } from '@/core/videoEdit/colorLutAsset'
import { VIDEO_EDIT_SPATIAL_LAYER_SHADER } from './videoEditSpatialShaders'
import { spatialAccumulatorBrand, type SpatialAccumulator, type SpatialCompositeHost, type SpatialDrawItem, type SpatialFrameRequest, type SpatialMaterialPlan, type SpatialPictureLease, type SpatialSample, type SpatialTargetSpec, type SpatialExposurePlan } from './videoEditSpatialContracts'

const SCREEN_FROM_UV: SpatialMat4 = [2, 0, 0, 0, 0, -2, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]
type SpatialGpuDrawItem = Omit<SpatialDrawItem, 'geometry'> & { geometry: Pick<SpatialDrawItem['geometry'], 'clipFromUv'> }
const levelView = (texture: GpuTexture): unknown => (texture as GpuTexture & { createView(descriptor: unknown): unknown }).createView({ baseMipLevel: 0, mipLevelCount: 1 })
export interface SpatialGpuTarget {
  readonly spec: SpatialTargetSpec
  readonly texture: GpuTexture
  readonly multisample?: GpuTexture
  initialized: boolean
  completion: Promise<void>
}
export interface SpatialTextureAllocator {
  allocate(spec: Omit<SpatialTargetSpec, 'format'> & { format: SpatialTargetSpec['format'] | 'rgba32float' | 'rg32float' }, mipLevelCount: number, sampleCount: number): GpuTexture
  release(texture: GpuTexture): void
}
/** 只编码宿主合成 GPU 工作；纹理预算、根队列及最终呈现继续由调用方持有。 */
export class VideoEditSpatialGpu {
  private readonly mip: VideoEditAuthorGpu
  private readonly effects: VideoEditBuiltinEffectsGpu
  private readonly sampler: unknown
  private readonly pipelines = new Map<string, Promise<GpuRenderPipeline>>()
  private readonly retired = new Set<Promise<void>>()
  private readonly releaseFailures: unknown[] = []
  private readonly references = new Map<GpuTexture, number>()
  private workingSet?: SpatialExposurePlan
  constructor(private readonly device: GpuDevice, private readonly allocator: SpatialTextureAllocator) {
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 16 })
    this.mip = new VideoEditAuthorGpu(device)
    const scratch: VideoEditBuiltinScratchAllocator = {
      allocate: (width, height, format, mipLevelCount = 1) => {
        if (format !== 'rgba8unorm' && format !== 'rgba16float' && format !== 'rgba32float' && format !== 'rg32float') throw new Error(`空间效果不支持纹理格式 ${format}。`)
        return allocator.allocate({ key: 'spatial:effect', width, height, format, usage: 1 | 2 | 4 | 16 }, mipLevelCount, 1)
      },
      release: texture => allocator.release(texture),
    }
    this.effects = new VideoEditBuiltinEffectsGpu(device, this.sampler, scratch)
  }
  private retain(texture: GpuTexture): void { this.references.set(texture, (this.references.get(texture) ?? 0) + 1) }
  reserveWorkingSet(plan: SpatialExposurePlan, signal: AbortSignal): void {
    signal.throwIfAborted()
    if (this.workingSet) throw new Error('同一空间合成会话的曝光工作集尚未释放。')
    const limits = (this.device as GpuDevice & { limits?: { maxTextureDimension2D?: number } }).limits
    const sizes = [...plan.materials.map(material => material.target), plan.centerFrame.output]
    if (limits?.maxTextureDimension2D && sizes.some(size => Math.max(size.width, size.height) > limits.maxTextureDimension2D!)) throw new Error(`空间材料面超过 GPU 纹理尺寸 ${limits.maxTextureDimension2D}，需要分块处理。`)
    this.workingSet = plan
  }
  releaseWorkingSet(): void { this.workingSet = undefined; this.effects.releaseIdle() }
  completion(): Promise<void> { return this.device.queue.onSubmittedWorkDone() }
  private drop(texture: GpuTexture): void {
    const remaining = this.references.get(texture)! - 1
    if (remaining) this.references.set(texture, remaining)
    else { this.references.delete(texture); this.allocator.release(texture) }
  }
  private lease(texture: GpuTexture, spec: SpatialTargetSpec, completion: Promise<void>, carriesLight: boolean): SpatialPictureLease {
    this.retain(texture)
    let released = false
    return { texture, owner: 'composite-host', width: spec.width, height: spec.height, format: spec.format, highPrecision: spec.format === 'rgba16float', carriesLight, completion,
      release: async afterUse => {
        if (released) return
        released = true
        try { await Promise.all([completion, afterUse]) } finally { this.drop(texture) }
      } }
  }
  target(spec: SpatialTargetSpec, multisample = false): SpatialGpuTarget {
    const texture = this.allocator.allocate(spec, 1, 1)
    this.retain(texture)
    try {
      const aa = multisample ? this.allocator.allocate({ ...spec, key: `${spec.key}:coverage`, usage: 16 }, 1, 4) : undefined
      if (aa) this.retain(aa)
      return { spec, texture, ...(aa ? { multisample: aa } : {}), initialized: false, completion: Promise.resolve() }
    } catch (error) { this.drop(texture); throw error }
  }
  async releaseTarget(target: SpatialGpuTarget): Promise<void> {
    const done = target.completion.finally(() => { this.drop(target.texture); if (target.multisample) this.drop(target.multisample) })
    this.retired.add(done)
    void done.then(() => this.retired.delete(done), error => { this.retired.delete(done); this.releaseFailures.push(error) })
  }
  picture(target: SpatialGpuTarget, carriesLight: boolean): SpatialPictureLease {
    return this.lease(target.texture, target.spec, target.completion, carriesLight)
  }
  async consume(picture: SpatialPictureLease, spec: SpatialTargetSpec): Promise<SpatialPictureLease> {
    const actual = { ...spec, format: picture.highPrecision || picture.carriesLight ? 'rgba16float' as const : spec.format }
    const levels = 1 + Math.floor(Math.log2(Math.max(actual.width, actual.height)))
    const texture = this.allocator.allocate(actual, levels, 1)
    try {
      await this.mip.begin(undefined, actual.format)
      this.mip.copy(picture.texture, { format: actual.format, createView: () => levelView(texture), destroy: () => texture.destroy() }, actual.width, actual.height)
      this.mip.mipmaps(texture, actual.width, actual.height)
      this.mip.finish()
      return this.lease(texture, actual, this.device.queue.onSubmittedWorkDone(), picture.carriesLight)
    } catch (error) { this.mip.abandon(); this.allocator.release(texture); throw error }
  }
  private pipeline(format: string, additive: boolean, samples: number): Promise<GpuRenderPipeline> {
    const key = `${format}:${additive}:${samples}`
    let pipeline = this.pipelines.get(key)
    if (!pipeline) {
      const module = this.device.createShaderModule({ code: VIDEO_EDIT_SPATIAL_LAYER_SHADER })
      const blend = { srcFactor: 'one', dstFactor: additive ? 'one' : 'one-minus-src-alpha', operation: 'add' }
      const descriptor = { layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: blend, alpha: blend } }] }, primitive: { topology: 'triangle-list', cullMode: 'none' }, multisample: { count: samples } }
      pipeline = Promise.resolve(this.device.createRenderPipelineAsync ? this.device.createRenderPipelineAsync(descriptor) : this.device.createRenderPipeline(descriptor))
      this.pipelines.set(key, pipeline)
      pipeline.catch(() => { this.pipelines.delete(key) })
    }
    return pipeline
  }
  async draw(target: SpatialGpuTarget, items: readonly SpatialGpuDrawItem[], weight = 1, additive = false): Promise<{ completion: Promise<void> }> {
    const pipeline = await this.pipeline(target.spec.format, additive, target.multisample ? 4 : 1)
    const buffers: ReturnType<GpuDevice['createBuffer']>[] = []
    const encoder = this.device.createCommandEncoder()
    let completion: Promise<void> | undefined
    try {
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: levelView(target.multisample ?? target.texture), ...(target.multisample ? { resolveTarget: levelView(target.texture) } : {}),
        clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: target.initialized ? 'load' : 'clear', storeOp: 'store' }] })
      pass.setPipeline(pipeline)
      for (const item of items) {
        const buffer = this.device.createBuffer({ size: 80, usage: 0x08 | 0x40 }); buffers.push(buffer)
        this.device.queue.writeBuffer(buffer, 0, new Float32Array([...(item.projection === 'screen' ? SCREEN_FROM_UV : item.geometry.clipFromUv), item.opacity, weight, Number(item.picture.carriesLight), 0]))
        pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
          { binding: 0, resource: item.picture.texture.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer } },
        ] }))
        pass.draw(6)
      }
      pass.end(); this.device.queue.submit([encoder.finish()])
      completion = this.device.queue.onSubmittedWorkDone(); target.completion = completion; target.initialized = true
      const submitted = completion
      void submitted.then(() => buffers.forEach(buffer => buffer.destroy()), () => buffers.forEach(buffer => buffer.destroy()))
      return { completion }
    } finally { if (!completion) buffers.forEach(buffer => buffer.destroy()) }
  }
  async defocus(picture: SpatialPictureLease, material: SpatialMaterialPlan): Promise<SpatialPictureLease> {
    if (material.defocus.bypass) return this.lease(picture.texture, { ...material.target, format: picture.format }, picture.completion, picture.carriesLight)
    const target = this.target({ ...material.target, format: 'rgba16float' })
    try {
      const plan = planAuthorDefocus(target.spec.width, target.spec.height, material.defocus.materialRadiusPx[0], true, picture.carriesLight, { radiusY: material.defocus.materialRadiusPx[1], outputRadius: material.defocus.centerCocRadiusPx })
      await this.effects.encodePlan(plan, target.spec.format, picture.texture, target.texture)
      target.completion = this.device.queue.onSubmittedWorkDone()
      return this.picture(target, picture.carriesLight)
    } finally { await this.releaseTarget(target) }
  }
  async encodeBuiltin(plan: VideoEditBuiltinPlan, input: GpuTexture, output: GpuTexture, format: string, luts: readonly ColorLutAsset[], subject?: { texture: GpuTexture }): Promise<void> {
    await this.effects.encodePlan(plan, format, input, output, undefined, luts, undefined, undefined, subject?.texture)
  }
  async dispose(): Promise<void> {
    await this.device.queue.onSubmittedWorkDone()
    await Promise.allSettled(this.retired)
    this.effects.dispose(); this.mip.dispose(); this.pipelines.clear()
    if (this.releaseFailures.length) throw new AggregateError(this.releaseFailures.splice(0), '空间 GPU 工作失败。')
  }
}

export interface SpatialCompositeCallbacks extends Pick<SpatialCompositeHost, 'prepareCardMaterial' | 'compositeFrame' | 'generatorTargetCapacity' | 'reserveWorkingSet' | 'releaseWorkingSet'> {
  compositeTransition(items: readonly SpatialDrawItem[], sample: SpatialSample): Promise<SpatialPictureLease>
}
/** 合成树/效果准备由正式合成入口注入，曝光累积与 GPU 借用仅在这里实现。 */
export function createVideoEditSpatialHost(request: SpatialFrameRequest, gpu: VideoEditSpatialGpu, callbacks: SpatialCompositeCallbacks): SpatialCompositeHost {
  const targets = new Map<SpatialAccumulator, { target: SpatialGpuTarget; carriesLight: boolean }>()
  const requireTarget = (handle: SpatialAccumulator) => {
    const state = targets.get(handle)
    if (!state) throw new Error('空间曝光累积器已释放。')
    return state
  }
  return {
    ...callbacks,
    consumePicture: (picture, target) => gpu.consume(picture, target),
    applyCenterDefocus: (picture, material) => gpu.defocus(picture, material),
    async beginAccumulation(spec) {
      const handle: SpatialAccumulator = { [spatialAccumulatorBrand]: true }
      targets.set(handle, { target: gpu.target(spec, true), carriesLight: false })
      return handle
    },
    async accumulateLayerSample(handle, item, weight) {
      const state = requireTarget(handle)
      state.carriesLight ||= item.picture.carriesLight
      return gpu.draw(state.target, [item], weight, true)
    },
    async finishLayer(handle) { const state = requireTarget(handle); return gpu.picture(state.target, state.carriesLight) },
    async compositeGroup(group, sample, items) {
      const temporary: SpatialPictureLease[] = []
      const combined: SpatialDrawItem[] = []
      const spec: SpatialTargetSpec = { key: `${group.id}:sample`, width: request.output.width, height: request.output.height, format: items.some(item => item.picture.highPrecision || item.picture.carriesLight) ? 'rgba16float' : 'rgba8unorm', usage: 1 | 2 | 4 | 16 }
      const target = gpu.target(spec, true)
      let completion = Promise.resolve()
      try {
        for (let index = 0; index < items.length;) {
          const item = items[index++]
          if (item.kind !== 'transition') { combined.push(item); continue }
          const endpoints = [item]
          while (index < items.length && items[index].itemId === item.itemId) endpoints.push(items[index++])
          const picture = await callbacks.compositeTransition(endpoints, sample)
          temporary.push(picture)
          combined.push({ ...item, picture, projection: 'screen', opacity: 1 })
        }
        completion = (await gpu.draw(target, combined)).completion
        return gpu.picture(target, combined.some(item => item.picture.carriesLight))
      } finally {
        await Promise.all(temporary.map(picture => picture.release(completion)))
        await gpu.releaseTarget(target)
      }
    },
    async accumulate(handle, picture, weight) {
      const state = requireTarget(handle)
      state.carriesLight ||= picture.carriesLight
      const geometry = { clipFromUv: SCREEN_FROM_UV }
      return gpu.draw(state.target, [{ itemId: 'exposure', sourceKey: 'exposure', clipId: 'exposure', kind: 'card', picture, geometry, opacity: 1, groupId: 'exposure', ordinal: 0, projection: 'screen' }], weight, true)
    },
    async finish(handle) { const state = requireTarget(handle); return gpu.picture(state.target, state.carriesLight) },
    async releaseAccumulation(handle) {
      const state = targets.get(handle)
      if (!state) return
      targets.delete(handle); await gpu.releaseTarget(state.target)
    },
  }
}
