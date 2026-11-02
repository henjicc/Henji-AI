import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'
import { VideoEditBuiltinEffectsGpu, type VideoEditBuiltinScratchAllocator } from './videoEditBuiltinEffectsGpu'
import { planAuthorDefocus, type VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'
import type { ColorLutAsset } from '@/core/videoEdit/colorLutAsset'
import { VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES } from './videoEditGpuBudget'
import type { SpatialMaterialPlan, SpatialPictureLease, SpatialTargetSpec } from './videoEditSpatialContracts'

const levelView = (texture: GpuTexture): unknown => (texture as GpuTexture & { createView(descriptor: unknown): unknown }).createView({ baseMipLevel: 0, mipLevelCount: 1 })
export interface SpatialGpuTarget {
  readonly spec: SpatialTargetSpec
  readonly texture: GpuTexture
  completion: Promise<void>
}
export interface SpatialTextureAllocator {
  trimIdle?(budgetBytes: number): void
  allocate(spec: Omit<SpatialTargetSpec, 'format'> & { format: SpatialTargetSpec['format'] | 'rgba32float' | 'rg32float' }, mipLevelCount: number, clear?: boolean): GpuTexture
  release(texture: GpuTexture): void
}
/**
 * 统一三维渲染器用到的宿主 GPU 工作：卡片材料的目标与租约、带 mip 的材料面、卡片整张虚化、内置效果编码。
 * 纹理预算、根队列及最终呈现继续由调用方持有。
 */
export class VideoEditSpatialGpu {
  private readonly mip: VideoEditAuthorGpu
  private readonly effects: VideoEditBuiltinEffectsGpu
  private readonly sampler: unknown
  private readonly retired = new Set<Promise<void>>()
  private readonly releaseFailures: unknown[] = []
  private readonly references = new Map<GpuTexture, number>()
  private readonly mipTextures = new WeakSet<GpuTexture>()
  private readonly identities = new WeakMap<object, number>()
  private identitySequence = 0
  constructor(private readonly device: GpuDevice, private readonly allocator: SpatialTextureAllocator) {
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 16 })
    this.mip = new VideoEditAuthorGpu(device)
    const scratch: VideoEditBuiltinScratchAllocator = {
      allocate: (width, height, format, mipLevelCount = 1) => {
        if (format !== 'rgba8unorm' && format !== 'rgba16float' && format !== 'rgba32float' && format !== 'rg32float') throw new Error(`空间效果不支持纹理格式 ${format}。`)
        return allocator.allocate({ key: 'spatial:effect', width, height, format, usage: 1 | 2 | 4 | 16 }, mipLevelCount)
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
  completion(): Promise<void> { return this.device.queue.onSubmittedWorkDone() }
  /** 一帧画完：归还效果的空闲暂存纹理，纹理池按工作集预算收缩。 */
  endFrame(): void { this.effects.releaseIdle(); this.allocator.trimIdle?.(VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES) }
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
  target(spec: SpatialTargetSpec): SpatialGpuTarget {
    const texture = this.allocator.allocate(spec, 1, false)
    this.mipTextures.delete(texture)
    this.retain(texture)
    return { spec, texture, completion: Promise.resolve() }
  }
  async releaseTarget(target: SpatialGpuTarget): Promise<void> {
    const done = target.completion.finally(() => { this.drop(target.texture) })
    this.retired.add(done)
    void done.then(() => this.retired.delete(done), error => { this.retired.delete(done); this.releaseFailures.push(error) })
  }
  picture(target: SpatialGpuTarget, carriesLight: boolean): SpatialPictureLease {
    return this.lease(target.texture, target.spec, target.completion, carriesLight)
  }
  /** 收下一张借来的画面：复制进自有的带完整 mip 的纹理（卡片斜着、缩小时按需取级）。已是自有 mip 纹理且尺寸格式相同的直接沿用。 */
  async consume(picture: SpatialPictureLease, spec: SpatialTargetSpec): Promise<SpatialPictureLease> {
    const actual = { ...spec, format: picture.highPrecision || picture.carriesLight ? 'rgba16float' as const : spec.format }
    if (this.mipTextures.has(picture.texture) && picture.width === actual.width && picture.height === actual.height && picture.format === actual.format) return this.lease(picture.texture, actual, picture.completion, picture.carriesLight)
    const levels = 1 + Math.floor(Math.log2(Math.max(actual.width, actual.height)))
    const texture = this.allocator.allocate(actual, levels, false)
    this.mipTextures.delete(texture)
    try {
      await this.mip.begin(undefined, actual.format)
      this.mip.copy(picture.texture, { format: actual.format, createView: () => levelView(texture), destroy: () => texture.destroy() }, actual.width, actual.height)
      this.mip.mipmaps(texture, actual.width, actual.height)
      this.mip.finish()
      this.mipTextures.add(texture)
      return this.lease(texture, actual, this.device.queue.onSubmittedWorkDone(), picture.carriesLight)
    } catch (error) { this.mip.abandon(); this.allocator.release(texture); throw error }
  }
  /** 卡片按自身视深整张虚化（与空间求值同一弥散半径）。 */
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
    this.effects.dispose(); this.mip.dispose()
    if (this.releaseFailures.length) throw new AggregateError(this.releaseFailures.splice(0), '空间 GPU 工作失败。')
  }
}
