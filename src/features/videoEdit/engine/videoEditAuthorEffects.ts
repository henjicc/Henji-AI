import { videoEditEffectNeedsFloat } from './videoEditRenderPrecision'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { authorEffectsFingerprint, type AuthorEffectEnvironment, type ResolvedAuthorEffect } from '@/core/videoEdit/authorEffects'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import { planAuthorDefocus, planVideoEditBuiltinEffect, type VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'
import { VideoEditBuiltinEffectsGpu, type BuiltinEncodingBatch, type VideoEditBuiltinScratchAllocator } from './videoEditBuiltinEffectsGpu'

export interface AuthorEffectOutput { picture: GpuTexture; carriesLight: boolean }
interface EffectTexture { texture: GpuTexture; width: number; height: number; format: string; mipLevelCount: number; touched: number }
interface CachedOutput { key: string; output: AuthorEffectOutput; textures: EffectTexture[] }

/** 每个作者实例持有资源；整帧共用一份编码批次，提交成功才发布缓存。 */
export class VideoEditAuthorEffects {
  private readonly gpu: VideoEditBuiltinEffectsGpu
  private cache = new Map<string, CachedOutput>()
  private pending = new Map<string, CachedOutput>()
  private used = new Set<string>()
  private batch?: BuiltinEncodingBatch
  private spare: EffectTexture[] = []
  private frame = 0
  private referenced = new Set<GpuTexture>()
  constructor(device: GpuDevice, private readonly allocator: VideoEditBuiltinScratchAllocator) {
    this.gpu = new VideoEditBuiltinEffectsGpu(device, device.createSampler({ minFilter: 'linear', magFilter: 'linear', mipmapFilter: 'linear' }), allocator)
  }
  begin(encoder: BuiltinEncodingBatch['encoder']): void {
    this.abandon(); this.frame++; this.used.clear(); this.referenced.clear()
    this.batch = { encoder, uniformIndex: 0, taken: new Set(), created: new Set() }
  }
  async encode(slot: string, input: GpuTexture, width: number, height: number, effects: readonly ResolvedAuthorEffect[], context: LayerEffectReference,
    environment: AuthorEffectEnvironment, contentKey: string | undefined, defocus: { radius: number; lens: boolean }, mipmaps: (texture: GpuTexture) => void, frame: number, frameDuration?: number, needsFloat = defocus.radius > 0 || effects.some(effect => videoEditEffectNeedsFloat(effect, { width, height, referenceSize: context.referenceSize, renderScale: 1, layer: context })), adjustment?: { opacity: number }): Promise<AuthorEffectOutput> {
    if (!this.batch) throw new Error('图层效果尚未开始编码。')
    this.used.add(slot)
    const format = input.format === 'rgba16float' || needsFloat ? 'rgba16float' : 'rgba8unorm'
    const key = JSON.stringify([format, contentKey, width, height, context, authorEffectsFingerprint(effects, environment, frame), frameDuration, defocus, adjustment])
    const cached = this.cache.get(slot)
    if (contentKey !== undefined && cached?.key === key) return cached.output
    // 内容键失效即撤销缓存资格；同尺寸像素可以覆写，取消后必须重新编码才能发布。
    if (cached) {
      for (const entry of cached.textures) {
        if (entry.width === width && entry.height === height) { entry.touched = this.frame; this.spare.push(entry); this.referenced.add(entry.texture) }
        else this.allocator.release(entry.texture)
      }
      this.cache.delete(slot)
    }
    const textures: EffectTexture[] = []
    const take = (mips = false): GpuTexture => {
      const mipLevelCount = mips ? 1 + Math.floor(Math.log2(Math.max(width, height))) : 1
      const index = this.spare.findIndex(entry => entry.width === width && entry.height === height && entry.format === format && entry.mipLevelCount === mipLevelCount)
      if (index < 0) this.releaseIdleSpare({ width, height })
      const entry = index < 0 ? { texture: this.allocator.allocate(width, height, format, mipLevelCount), width, height, format, mipLevelCount, touched: this.frame } : this.spare.splice(index, 1)[0]
      entry.touched = this.frame
      textures.push(entry); this.referenced.add(entry.texture); return entry.texture
    }
    const encode = async (plan: VideoEditBuiltinPlan, source: GpuTexture, target: GpuTexture, second?: GpuTexture, light?: GpuTexture): Promise<void> => {
      await this.gpu.encodePlan(plan, format, source, target, second, environment.luts, this.batch, light)
      if (textures.find(entry => entry.texture === target)!.mipLevelCount > 1) mipmaps(target)
      if (light && textures.find(entry => entry.texture === light)!.mipLevelCount > 1) mipmaps(light)
    }
    const mix = (amount: number): VideoEditBuiltinPlan => ({ width, height, scratch: [], passes: [{ entry: 'effect_mix', source: 'input', original: 'second', target: 'output', uniforms: new Float32Array([width, height, width, height, amount, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) }] })
    try {
      let image = input
      // 下层按产生顺序记录：光（零 alpha，相加照亮下方）与影（cover，普通预乘遮挡）。
      const underlays: Array<{ texture: GpuTexture; cover: boolean }> = []
      const plans = effects.map(effect => planVideoEditBuiltinEffect(effect, adjustment
        ? { width, height, frame, frameDuration, referenceSize: context.referenceSize, renderScale: context.rasterScale, quality: context.quality, split: true }
        : { width, height, frame, frameDuration, layer: context, split: true }))
      const hasUnderlay = plans.some(plan => plan.underlay !== undefined)
      for (const [index, effect] of effects.entries()) {
        // 调整层的每道效果都接收完整画面；拆出的光与影不能绕过后续调色。
        const plan = adjustment && plans[index].underlay !== undefined
          ? planVideoEditBuiltinEffect(effect, { width, height, frame, frameDuration, referenceSize: context.referenceSize, renderScale: context.rasterScale, quality: context.quality })
          : plans[index]
        // 只有交给合成器的最后一张图需要 mip（缩小绘制）；有 pose.blur 或下层时最后一张图还要再处理一道。
        const needsMips = !adjustment && index === effects.length - 1 && defocus.radius <= 0 && !hasUnderlay
        let target = take(needsMips && effect.amount === 1), light = plan.underlay === undefined ? undefined : take()
        await encode(plan, image, target, undefined, light)
        if (effect.amount !== 1) {
          const blended = take(needsMips); await encode(mix(effect.amount), target, blended, image); target = blended
          if (light) {
            const scaled = take()
            const opacity = mix(effect.amount); opacity.passes[0].entry = 'effect_opacity'
            await encode(opacity, light, scaled); light = scaled
          }
        }
        if (light) underlays.push({ texture: light, cover: plan.underlayKind === 'cover' })
        image = target
      }
      if (defocus.radius > 0) {
        const plan = planAuthorDefocus(width, height, defocus.radius, defocus.lens)
        const blurred = take(!underlays.length); await encode(plan, image, blurred); image = blurred
        const lightPlan = planAuthorDefocus(width, height, defocus.radius, defocus.lens, true)
        for (const underlay of underlays) {
          const blurredUnderlay = take(); await encode(underlay.cover ? plan : lightPlan, underlay.texture, blurredUnderlay); underlay.texture = blurredUnderlay
        }
      }
      // 在透明层内完成 over，再统一应用曝光权重与不透明度，避免背景提前饱和。
      let picture = image
      if (underlays.length) {
        picture = underlays[0].texture
        for (const source of [...underlays.slice(1).map(underlay => underlay.texture), image]) {
          const composed = take(source === image), over = mix(1); over.passes[0].entry = 'effect_over'
          await encode(over, source, composed, picture); picture = composed
        }
      }
      if (adjustment && adjustment.opacity < 1) {
        const blended = take()
        await encode(mix(adjustment.opacity), picture, blended, input)
        picture = blended
      }
      const output = { picture, carriesLight: underlays.some(underlay => !underlay.cover) || !!adjustment && plans.some(plan => plan.underlay !== undefined && plan.underlayKind !== 'cover') }
      // 跨层与跨帧只消费合成后的画面；主图、光与中间结果在本道链结束后即可供下一层覆写。
      this.spare.push(...textures.filter(entry => entry.texture !== picture))
      this.pending.set(slot, { key: contentKey === undefined ? '' : key, output, textures: textures.filter(entry => entry.texture === picture) })
      return output
    } catch (error) { textures.forEach(entry => this.allocator.release(entry.texture)); throw error }
  }
  commit(): void {
    this.releaseIdleSpare()
    for (const [slot, cached] of this.cache) if (!this.used.has(slot)) { cached.textures.forEach(entry => this.allocator.release(entry.texture)); this.cache.delete(slot) }
    for (const [slot, cached] of this.pending) this.cache.set(slot, cached)
    this.pending.clear(); this.batch = undefined; this.gpu.releaseIdle()
  }
  abandon(): void {
    if (this.batch) { this.releaseIdleSpare(); this.gpu.abandon(this.batch) }
    for (const cached of this.pending.values()) this.spare.push(...cached.textures)
    this.pending.clear(); this.batch = undefined
  }
  private releaseSpare(): void { for (const entry of this.spare) this.allocator.release(entry.texture); this.spare.length = 0 }
  private releaseIdleSpare(size?: { width: number; height: number }): void {
    for (let index = this.spare.length - 1; index >= 0; index--) {
      const entry = this.spare[index]
      if (this.referenced.has(entry.texture) || this.frame - entry.touched <= 1 && (!size || entry.width === size.width && entry.height === size.height)) continue
      this.allocator.release(entry.texture); this.spare.splice(index, 1)
    }
  }
  dispose(): void { this.abandon(); for (const cached of this.cache.values()) this.spare.push(...cached.textures); this.cache.clear(); this.releaseSpare(); this.gpu.dispose() }
}
