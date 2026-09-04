import { effect, sampler, type Effect, type Gpu, type Target } from 'vgpu'

import bloomShaderSource from '@/core/imageEdit/shaders/vgpuGlowBloom.wgsl?raw'
import compositeShaderSource from '@/core/imageEdit/shaders/vgpuGlowComposite.wgsl?raw'
import upsampleShaderSource from '@/core/imageEdit/shaders/vgpuGlowUpsample.wgsl?raw'
import type { VgpuGlowRecipe } from '@/core/imageEdit/vgpuGlowRecipe'
import unpremultiplyShaderSource from './shaders/imageEditorGpuUnpremultiplyV3.wgsl?raw'
import type { ImageEditorGpuEffectTargetPoolV3 } from './imageEditorGpuEffectTargetPoolV3'

const MAX_LEVELS = 12
const CLEAR = [0, 0, 0, 0] as const
const UNIT_RGB = [1, 1, 1] as const

interface GlowPassV3 { effect: Effect; target: Target }

/** VgpuGlowRenderer 的共享 Gpu/Target 入口；不再经过 ImageBitmap 上传或 CPU readback。 */
export class ImageEditorGpuGlowRendererV3 {
  private readonly unpremultiply: Effect
  private readonly extract: Effect
  private readonly downsample: Effect[]
  private readonly upsample: Effect[]
  private readonly composite: Effect
  private readonly linearSampler: ReturnType<typeof sampler>
  private prepared: GlowPassV3[] = []
  private compiled = false
  private output: Target | null = null

  constructor(private readonly gpu: Gpu, private readonly targets: ImageEditorGpuEffectTargetPoolV3,
    private readonly onCompiled: () => void) {
    this.unpremultiply = effect(gpu, unpremultiplyShaderSource, { label: 'image-editor-glow-unpremultiply' })
    this.extract = effect(gpu, emitterShader(), { label: 'image-editor-glow-extract' })
    this.downsample = Array.from({ length: MAX_LEVELS }, (_, index) => effect(gpu, bloomShaderSource,
      { label: `image-editor-glow-down:${index}` }))
    this.upsample = Array.from({ length: MAX_LEVELS - 1 }, (_, index) => effect(gpu, upsampleShaderSource,
      { label: `image-editor-glow-up:${index}` }))
    this.composite = effect(gpu, premultipliedCompositeShader(), { label: 'image-editor-glow-composite' })
    this.linearSampler = sampler(gpu, { minFilter: 'linear', magFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
  }

  prepare(input: Target, recipe: VgpuGlowRecipe, output: Target): Target {
    const count = recipe.scatterLevels.length
    this.prepared = []
    this.output = output
    const straight = this.targets.full(0, input.size)
    const emitter = this.targets.full(1, input.size)
    for (let index = 0; index < MAX_LEVELS; index += 1) {
      const level = recipe.scatterLevels[index]
      const size = level ? scaled(input.size, level.divisor) : [1, 1] as const
      this.targets.level(index, size)
      this.targets.accumulation(index, level && index < count - 1 ? size : [1, 1])
    }
    this.unpremultiply.set({ source: input })
    this.prepared.push({ effect: this.unpremultiply, target: straight })
    setBloom(this.extract, straight, recipe, 0, this.linearSampler)
    this.prepared.push({ effect: this.extract, target: emitter })
    for (let index = 0; index < count; index += 1) {
      const levelTarget = this.targets.level(index, scaled(input.size, recipe.scatterLevels[index].divisor))
      setBloom(this.downsample[index], index === 0 ? emitter
        : this.targets.level(index - 1, scaled(input.size, recipe.scatterLevels[index - 1].divisor)),
      recipe, 1, this.linearSampler)
      this.prepared.push({ effect: this.downsample[index], target: levelTarget })
    }
    let low = this.targets.level(count - 1, scaled(input.size, recipe.scatterLevels[count - 1].divisor))
    for (let index = count - 2; index >= 0; index -= 1) {
      const first = index === count - 2
      this.upsample[index].set({
        highLevel: this.targets.level(index, scaled(input.size, recipe.scatterLevels[index].divisor)),
        lowAccumulation: low, linearSampler: this.linearSampler,
        accumulate: {
          highWeight: [...recipe.scatterLevels[index].weight, recipe.scatterLevels[index].whiteCoreWeight],
          lowWeight: [
            ...(first ? recipe.scatterLevels[index + 1].weight : UNIT_RGB),
            first ? recipe.scatterLevels[index + 1].whiteCoreWeight : 1,
          ],
        },
      })
      low = this.targets.accumulation(index, scaled(input.size, recipe.scatterLevels[index].divisor))
      this.prepared.push({ effect: this.upsample[index], target: low })
    }
    this.composite.set({
      scene: straight, bloomPyramid: this.targets.accumulation(0,
        scaled(input.size, recipe.scatterLevels[0].divisor)), linearSampler: this.linearSampler,
      composite: {
        params: [recipe.intensity, recipe.responseExposure,
          recipe.chromaticChannelIndices[0], recipe.chromaticChannelIndices[1]],
        optics: [1 / input.size[0], 1 / input.size[1],
          recipe.chromaticOffsetPx, recipe.chromaticAberration],
        finish: [recipe.ditherAmount, 0, 0, 0], scatterRegion: [0, 0, 1, 1],
        scatterGeometry: [input.size[0], input.size[1],
          this.targets.accumulation(0, scaled(input.size, recipe.scatterLevels[0].divisor)).size[0],
          this.targets.accumulation(0, scaled(input.size, recipe.scatterLevels[0].divisor)).size[1]],
      },
    })
    this.prepared.push({ effect: this.composite, target: output })
    return output
  }

  async compile(): Promise<void> {
    if (this.compiled) return
    await Promise.all([
      this.extract.compile(this.targets.full(1)),
      this.composite.compile(this.output ?? this.targets.full(2)),
      this.unpremultiply.compile(this.targets.full(0)),
      ...this.downsample.map((value, index) => value.compile(this.targets.level(index))),
      ...this.upsample.map((value, index) => value.compile(this.targets.accumulation(index))),
    ])
    this.compiled = true
    this.onCompiled()
  }

  encode(currentFrame: ReturnType<typeof import('vgpu').frame>): Target {
    for (const pass of this.prepared) currentFrame.pass({ target: pass.target, clear: CLEAR }, pass.effect)
    if (!this.output) throw new Error('GPU glow 未准备')
    return this.output
  }

  dispose(): void {
    this.output = null
  }
}

function setBloom(pass: Effect, source: Target, recipe: VgpuGlowRecipe, mode: 0 | 1,
  linearSampler: ReturnType<typeof sampler>): void {
  pass.set({ source, linearSampler, bloom: {
    params: [recipe.sourceThresholdDisplay, recipe.sourceKneeDisplay,
      recipe.sourceMaximumRadiance, mode === 0 ? recipe.sourceGain : -1],
    optics: [recipe.whiteHeat, 0, 0, 0], tint: [...recipe.tintLinear, recipe.tintEnabled ? 1 : 0],
  } })
}

function premultipliedCompositeShader(): string {
  const entry = '@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {'
  const helper = 'fn compositeStraight(position: vec4f) -> vec4f {'
  const body = compositeShaderSource.replace(entry, helper)
  return `${body}\n@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {\n  let straight = compositeStraight(position);\n  return vec4f(straight.rgb * straight.a, straight.a);\n}`
}

function emitterShader(): string {
  return bloomShaderSource
    .replace('let sourceUv = position.xy * 2.0 / sourceDimensions;', 'let sourceUv = position.xy / sourceDimensions;')
    .replace('return downsample13(sourceUv, bloom.params.w >= 0.0);',
      'return sampleSource(sourceUv, vec2f(0.0), true);')
}

function scaled(size: readonly [number, number], divisor: number): readonly [number, number] {
  return [Math.max(1, Math.ceil(size[0] / divisor)), Math.max(1, Math.ceil(size[1] / divisor))]
}
