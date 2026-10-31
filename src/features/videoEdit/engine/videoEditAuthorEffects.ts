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
    environment: AuthorEffectEnvironment, contentKey: string | undefined, defocus: { radius: number; lens: boolean }, mipmaps: (texture: GpuTexture) => void, needsFloat = defocus.radius > 0 || effects.some(effect => videoEditEffectNeedsFloat(effect, { width, height, referenceSize: context.referenceSize, renderScale: 1, layer: context }))): Promise<AuthorEffectOutput> {
    if (!this.batch) throw new Error('图层效果尚未开始编码。')
    this.used.add(slot)
    const format = input.format === 'rgba16float' || needsFloat ? 'rgba16float' : 'rgba8unorm'
    const key = JSON.stringify([format, contentKey, width, height, context, authorEffectsFingerprint(effects, environment), defocus])
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
      const underlays: GpuTexture[] = []
      const producesLight = effects.some(effect => effect.id === 'glow' && effect.params.view !== 'source' && Number(effect.params.strength) > 0)
      for (const [index, effect] of effects.entries()) {
        const plan = planVideoEditBuiltinEffect(effect, { width, height, frame: 0, layer: context, splitGlow: true })
        const needsMips = effects[index + 1]?.id === 'lens_blur' || index === effects.length - 1 && (defocus.radius > 0 ? defocus.lens : !producesLight)
        let target = take(needsMips && effect.amount === 1), light = plan.underlay === undefined ? undefined : take(defocus.radius > 0 && defocus.lens && effect.amount === 1)
        await encode(plan, image, target, undefined, light)
        if (effect.amount !== 1) {
          const blended = take(needsMips); await encode(mix(effect.amount), target, blended, image); target = blended
          if (light) {
            const scaled = take(defocus.radius > 0 && defocus.lens)
            const opacity = mix(effect.amount); opacity.passes[0].entry = 'effect_opacity'
            await encode(opacity, light, scaled); light = scaled
          }
        }
        if (light) underlays.push(light)
        image = target
      }
      if (defocus.radius > 0) {
        const plan = planAuthorDefocus(width, height, defocus.radius, defocus.lens)
        const blurred = take(!underlays.length); await encode(plan, image, blurred); image = blurred
        const lightPlan = underlays.length ? planAuthorDefocus(width, height, defocus.radius, defocus.lens, true) : plan
        for (let index = 0; index < underlays.length; index++) {
          const blurredLight = take(); await encode(lightPlan, underlays[index], blurredLight); underlays[index] = blurredLight
        }
      }
      // 在透明层内完成 over，再统一应用曝光权重与不透明度，避免背景提前饱和。
      let picture = image
      if (underlays.length) {
        picture = underlays[0]
        for (const source of [...underlays.slice(1), image]) {
          const composed = take(source === image), over = mix(1); over.passes[0].entry = 'effect_over'
          await encode(over, source, composed, picture); picture = composed
        }
      }
      const output = { picture, carriesLight: underlays.length > 0 }
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
