import type { GpuBuffer, GpuDevice, GpuTexture, GpuRenderPipeline } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { SpatialMat4 } from '@/core/videoEdit/spatialTypes'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'
import { VideoEditBuiltinEffectsGpu, type VideoEditBuiltinScratchAllocator } from './videoEditBuiltinEffectsGpu'
import { planAuthorDefocus, type VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'
import type { ColorLutAsset } from '@/core/videoEdit/colorLutAsset'
import { VIDEO_EDIT_SPATIAL_LAYER_SHADER } from './videoEditSpatialShaders'
import { VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES } from './videoEditGpuBudget'
import { spatialAccumulatorBrand, type SpatialAccumulator, type SpatialCompositeHost, type SpatialDrawItem, type SpatialFrameRequest, type SpatialMaterialPlan, type SpatialPictureLease, type SpatialSample, type SpatialTargetSpec, type SpatialExposurePlan } from './videoEditSpatialContracts'

const SCREEN_FROM_UV: SpatialMat4 = [2, 0, 0, 0, 0, -2, 0, 0, 0, 0, 1, 0, -1, 1, 0, 1]
type SpatialGpuDrawItem = Omit<SpatialDrawItem, 'geometry'> & { geometry: Pick<SpatialDrawItem['geometry'], 'clipFromUv'> }
interface SpatialDrawBatch {
  encoder: ReturnType<GpuDevice['createCommandEncoder']>
  completion: Promise<void>
  resolve(): void
  reject(error: unknown): void
  uniformIndex: number
}
const levelView = (texture: GpuTexture): unknown => (texture as GpuTexture & { createView(descriptor: unknown): unknown }).createView({ baseMipLevel: 0, mipLevelCount: 1 })
export interface SpatialGpuTarget {
  readonly spec: SpatialTargetSpec
  readonly texture: GpuTexture
  readonly multisample?: GpuTexture
  initialized: boolean
  completion: Promise<void>
}
export interface SpatialTextureAllocator {
  residentBytes?(): number
  trimIdle?(budgetBytes: number): void
  allocate(spec: Omit<SpatialTargetSpec, 'format'> & { format: SpatialTargetSpec['format'] | 'rgba32float' | 'rg32float' }, mipLevelCount: number, sampleCount: number, clear?: boolean): GpuTexture
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
  private readonly materials = new Map<string, { picture: SpatialPictureLease; bytes: number; slot: string }>()
  private readonly materialSlots = new Map<string, string>()
  private readonly mipTextures = new WeakSet<GpuTexture>()
  private readonly completedMaterials = new WeakMap<GpuTexture, string>()
  private readonly identities = new WeakMap<object, number>()
  private identitySequence = 0
  private materialBytes = 0
  private readonly cacheCounts = { hits: 0, misses: 0, evictions: 0 }
  private readonly drawUniforms: GpuBuffer[] = []
  private readonly drawBindings = new WeakMap<GpuTexture, Map<GpuRenderPipeline, Map<GpuBuffer, unknown>>>()
  private batch?: SpatialDrawBatch
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
  identity(value: object): number {
    let id = this.identities.get(value)
    if (id === undefined) { id = ++this.identitySequence; this.identities.set(value, id) }
    return id
  }
  materialDiagnostics(): { hits: number; misses: number; evictions: number; entries: number; bytes: number } {
    return { ...this.cacheCounts, entries: this.materials.size, bytes: this.materialBytes }
  }
  private trimMaterials(): void {
    this.allocator.trimIdle?.(VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES)
    for (const [key, entry] of this.materials) {
      if (this.materialBytes <= VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES && (this.allocator.residentBytes?.() ?? this.materialBytes) <= VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES) break
      // 当前曝光的借用仍在消费，必要工作集不因缓存预算被销毁。
      if (this.references.get(entry.picture.texture) !== 1) continue
      this.evictMaterial(key, entry)
      this.allocator.trimIdle?.(VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES)
    }
  }
  private evictMaterial(key: string, entry: { picture: SpatialPictureLease; bytes: number; slot: string }): void {
    this.materials.delete(key); this.materialBytes -= entry.bytes
    if (this.materialSlots.get(entry.slot) === key) this.materialSlots.delete(entry.slot)
    this.drop(entry.picture.texture); this.cacheCounts.evictions++
  }
  private cachedMaterial(key: string): SpatialPictureLease | undefined {
    const entry = this.materials.get(key)
    if (!entry) { this.cacheCounts.misses++; return }
    this.materials.delete(key); this.materials.set(key, entry); this.cacheCounts.hits++
    const picture = entry.picture
    return this.lease(picture.texture, { key, width: picture.width, height: picture.height, format: picture.format, usage: 1 | 2 | 4 | 16 }, picture.completion, picture.carriesLight)
  }
  private cacheMaterial(key: string, picture: SpatialPictureLease, levels: number, slot: string): void {
    let pixels = 0
    for (let level = 0; level < levels; level++) pixels += Math.max(1, Math.floor(picture.width / 2 ** level)) * Math.max(1, Math.floor(picture.height / 2 ** level))
    const bytes = pixels * (picture.format === 'rgba16float' ? 8 : 4)
    if (bytes > VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES) return
    this.retain(picture.texture); this.materials.set(key, { picture, bytes, slot }); this.materialSlots.set(slot, key); this.materialBytes += bytes
    this.trimMaterials()
  }
  private retirePicture(picture: SpatialPictureLease, afterUse: Promise<void>): void {
    const releasing = picture.release(afterUse)
    this.retired.add(releasing)
    void releasing.then(() => this.retired.delete(releasing), error => { this.retired.delete(releasing); this.releaseFailures.push(error) })
  }
  async material(key: string | undefined, material: SpatialMaterialPlan, create: () => Promise<SpatialPictureLease>, slot: string): Promise<SpatialPictureLease> {
    const completedKey = key === undefined ? undefined : JSON.stringify([key, material.defocus])
    const previous = this.materialSlots.get(slot)
    // 动画的旧版本无法在连续播放中命中；只保留当前版本，避免历史材料挤占静止卡片。
    if (previous !== undefined && previous !== completedKey) {
      const entry = this.materials.get(previous)!
      this.evictMaterial(previous, entry)
    }
    const cached = completedKey === undefined ? undefined : this.cachedMaterial(completedKey)
    if (cached) return cached
    this.flush()
    const raw = await create()
    let consumed: SpatialPictureLease | undefined, picture: SpatialPictureLease | undefined
    try {
      consumed = await this.consume(raw, material.target)
      picture = completedKey === undefined ? consumed : await this.defocus(consumed, material)
      if (completedKey !== undefined) {
        // 缓存直接参与投影的材料，避免同时驻留整面 mip 和同尺寸景深结果。
        this.completedMaterials.set(picture.texture, JSON.stringify(material.defocus))
        this.cacheMaterial(completedKey, picture, material.defocus.bypass ? 1 + Math.floor(Math.log2(Math.max(picture.width, picture.height))) : 1, slot)
      }
      return picture
    } finally {
      this.retirePicture(raw, consumed?.completion ?? this.completion())
      if (consumed && consumed !== picture) this.retirePicture(consumed, picture?.completion ?? this.completion())
    }
  }
  reserveWorkingSet(plan: SpatialExposurePlan, signal: AbortSignal): void {
    signal.throwIfAborted()
    this.trimMaterials()
    if (this.workingSet) throw new Error('同一空间合成会话的曝光工作集尚未释放。')
    const limits = (this.device as GpuDevice & { limits?: { maxTextureDimension2D?: number } }).limits
    const sizes = [...plan.materials.map(material => material.target), plan.centerFrame.output]
    if (limits?.maxTextureDimension2D && sizes.some(size => Math.max(size.width, size.height) > limits.maxTextureDimension2D!)) throw new Error(`空间材料面超过 GPU 纹理尺寸 ${limits.maxTextureDimension2D}，需要分块处理。`)
    this.workingSet = plan
  }
  releaseWorkingSet(): void { this.flush(); this.workingSet = undefined; this.effects.releaseIdle(); this.trimMaterials() }
  completion(): Promise<void> { this.flush(); return this.device.queue.onSubmittedWorkDone() }
  private drawBatch(): SpatialDrawBatch {
    if (!this.batch) {
      let resolve!: () => void, reject!: (error: unknown) => void
      const completion = new Promise<void>((ok, fail) => { resolve = ok; reject = fail })
      // 编码期间取消仍由曝光清理释放租约；拒绝不能成为未观察的 Promise。
      void completion.catch(() => undefined)
      this.batch = { encoder: this.device.createCommandEncoder(), completion, resolve, reject, uniformIndex: 0 }
    }
    return this.batch
  }
  flush(): void {
    const batch = this.batch
    if (!batch) return
    this.batch = undefined
    try {
      this.device.queue.submit([batch.encoder.finish()])
      void this.device.queue.onSubmittedWorkDone().then(batch.resolve, batch.reject)
    } catch (error) { batch.reject(error); throw error }
  }
  private drawBinding(texture: GpuTexture, pipeline: GpuRenderPipeline, buffer: GpuBuffer): unknown {
    let pipelines = this.drawBindings.get(texture)
    if (!pipelines) { pipelines = new Map(); this.drawBindings.set(texture, pipelines) }
    let buffers = pipelines.get(pipeline)
    if (!buffers) { buffers = new Map(); pipelines.set(pipeline, buffers) }
    let binding = buffers.get(buffer)
    if (!binding) {
      binding = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: texture.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer } },
      ] })
      buffers.set(buffer, binding)
    }
    return binding
  }
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
  target(spec: SpatialTargetSpec, multisample = false, coverage?: GpuTexture): SpatialGpuTarget {
    // 每个目标的首道 pass 自带 clear，避免从池里取回时再单独提交一次清零。
    const texture = this.allocator.allocate(spec, 1, 1, false)
    this.completedMaterials.delete(texture); this.mipTextures.delete(texture)
    this.retain(texture)
    try {
      const aa = multisample ? coverage ?? this.allocator.allocate({ ...spec, key: `${spec.key}:coverage`, usage: 16 }, 1, 4) : undefined
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
    if ((this.mipTextures.has(picture.texture) || this.completedMaterials.has(picture.texture)) && picture.width === actual.width && picture.height === actual.height && picture.format === actual.format) return this.lease(picture.texture, actual, picture.completion, picture.carriesLight)
    this.flush()
    const levels = 1 + Math.floor(Math.log2(Math.max(actual.width, actual.height)))
    const texture = this.allocator.allocate(actual, levels, 1, false)
    this.completedMaterials.delete(texture); this.mipTextures.delete(texture)
    try {
      await this.mip.begin(undefined, actual.format)
      this.mip.copy(picture.texture, { format: actual.format, createView: () => levelView(texture), destroy: () => texture.destroy() }, actual.width, actual.height)
      this.mip.mipmaps(texture, actual.width, actual.height)
      this.mip.finish()
      this.mipTextures.add(texture)
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
    const batch = this.drawBatch()
    const pass = batch.encoder.beginRenderPass({ colorAttachments: [{ view: levelView(target.multisample ?? target.texture), ...(target.multisample ? { resolveTarget: levelView(target.texture) } : {}),
      clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: target.initialized ? 'load' : 'clear', storeOp: 'store' }] })
    pass.setPipeline(pipeline)
    for (const item of items) {
      const index = batch.uniformIndex++
      const buffer = this.drawUniforms[index] ??= this.device.createBuffer({ size: 80, usage: 0x08 | 0x40 })
      this.device.queue.writeBuffer(buffer, 0, new Float32Array([...(item.projection === 'screen' ? SCREEN_FROM_UV : item.geometry.clipFromUv), item.opacity, weight, Number(item.picture.carriesLight), 0]))
      pass.setBindGroup(0, this.drawBinding(item.picture.texture, pipeline, buffer))
      pass.draw(6)
    }
    pass.end(); target.completion = batch.completion; target.initialized = true
    if (!this.workingSet) this.flush()
    return { completion: batch.completion }
  }
  async defocus(picture: SpatialPictureLease, material: SpatialMaterialPlan): Promise<SpatialPictureLease> {
    if (material.defocus.bypass || this.completedMaterials.get(picture.texture) === JSON.stringify(material.defocus)) return this.lease(picture.texture, { ...material.target, format: picture.format }, picture.completion, picture.carriesLight)
    this.flush()
    const target = this.target({ ...material.target, format: 'rgba16float' })
    try {
      const plan = planAuthorDefocus(target.spec.width, target.spec.height, material.defocus.materialRadiusPx[0], true, picture.carriesLight, { radiusY: material.defocus.materialRadiusPx[1], outputRadius: material.defocus.centerCocRadiusPx })
      await this.effects.encodePlan(plan, target.spec.format, picture.texture, target.texture)
      target.completion = this.device.queue.onSubmittedWorkDone()
      return this.picture(target, picture.carriesLight)
    } finally { await this.releaseTarget(target) }
  }
  async encodeBuiltin(plan: VideoEditBuiltinPlan, input: GpuTexture, output: GpuTexture, format: string, luts: readonly ColorLutAsset[], subject?: { texture: GpuTexture }): Promise<void> {
    this.flush()
    await this.effects.encodePlan(plan, format, input, output, undefined, luts, undefined, undefined, subject?.texture)
  }
  async dispose(): Promise<void> {
    this.flush()
    await this.device.queue.onSubmittedWorkDone()
    await Promise.allSettled(this.retired)
    for (const entry of this.materials.values()) this.drop(entry.picture.texture)
    this.materials.clear(); this.materialSlots.clear(); this.materialBytes = 0
    this.drawUniforms.forEach(buffer => buffer.destroy()); this.drawUniforms.length = 0
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
  const groupTargets = new Map<string, SpatialGpuTarget>()
  const groupCoverage = new Map<string, GpuTexture>()
  const requireTarget = (handle: SpatialAccumulator) => {
    const state = targets.get(handle)
    if (!state) throw new Error('空间曝光累积器已释放。')
    return state
  }
  return {
    ...callbacks,
    async releaseWorkingSet() {
      gpu.flush()
      for (const target of groupTargets.values()) await gpu.releaseTarget(target)
      groupTargets.clear()
      groupCoverage.clear()
      await callbacks.releaseWorkingSet()
    },
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
    async finishLayer(handle) {
      const state = requireTarget(handle)
      // 层的全部样本合成一次提交；进入下一层前归还独占的覆盖率附件，驻留量不随样本/层数放大。
      gpu.flush(); await state.target.completion
      return gpu.picture(state.target, state.carriesLight)
    },
    async compositeGroup(group, sample, items) {
      const temporary: SpatialPictureLease[] = []
      const combined: SpatialDrawItem[] = []
      const spec: SpatialTargetSpec = { key: `${group.id}:sample`, width: request.output.width, height: request.output.height, format: items.some(item => item.picture.highPrecision || item.picture.carriesLight) ? 'rgba16float' : 'rgba8unorm', usage: 1 | 2 | 4 | 16 }
      const key = `${group.id}:${spec.format}`
      let target = groupTargets.get(key)
      if (!target) {
        target = gpu.target(spec, true, groupCoverage.get(spec.format)); groupTargets.set(key, target)
        groupCoverage.set(spec.format, target.multisample!)
      }
      // 组样本总是先合成再累积；同一 encoder 的读取排在下一次覆写之前。
      // 各组目标独立，交给整帧合成的组图不会被其他组覆盖。
      // 覆盖率附件只供当道 pass 解析颜色，各组可顺序共用；曝光累积器的附件仍独占。
      target.initialized = false
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
        if (temporary.length) gpu.flush()
        await Promise.all(temporary.map(picture => picture.release(completion)))
      }
    },
    async accumulate(handle, picture, weight) {
      const state = requireTarget(handle)
      state.carriesLight ||= picture.carriesLight
      const geometry = { clipFromUv: SCREEN_FROM_UV }
      return gpu.draw(state.target, [{ itemId: 'exposure', sourceKey: 'exposure', clipId: 'exposure', kind: 'card', picture, geometry, opacity: 1, groupId: 'exposure', ordinal: 0, projection: 'screen' }], weight, true)
    },
    async finish(handle) {
      const state = requireTarget(handle)
      gpu.flush(); await state.target.completion
      return gpu.picture(state.target, state.carriesLight)
    },
    async releaseAccumulation(handle) {
      const state = targets.get(handle)
      if (!state) return
      targets.delete(handle); await gpu.releaseTarget(state.target)
    },
  }
}
