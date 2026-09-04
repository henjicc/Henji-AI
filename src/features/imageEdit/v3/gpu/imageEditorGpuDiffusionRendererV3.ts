import { draw, sampler, type Draw, type Gpu, type Target } from 'vgpu'

import type { DiffusionRecipe } from '@/core/imageEdit/diffusionRecipe'
import diffusionShader from '@/core/imageEdit/shaders/diffusion.wgsl?raw'
import {
  createDiffusionCompositeUniform,
  createDiffusionSourceUniform,
} from '@/core/imageEdit/webgpu/diffusionRenderer'
import {
  createDiffusionDownsampleUniform,
  createDiffusionUpsampleUniform,
} from '@/core/imageEdit/webgpu/scatterPyramidRenderer'
import type { ImageEditorGpuEffectTargetPoolV3 } from './imageEditorGpuEffectTargetPoolV3'

const BUFFER_COPY_DST = 0x08
const BUFFER_UNIFORM = 0x40
const CLEAR = [0, 0, 0, 0] as const
const MAX_LEVELS = 12
type NativeBuffer = ReturnType<Gpu['gpu']['createBuffer']>
type NativeBindGroup = ReturnType<Gpu['gpu']['createBindGroup']>

interface DiffusionPassV3 { drawable: Draw; target: Target }

/** WebGpuDiffusionRenderer 的同 Frame/vGPU Target 入口，沿用原 WGSL 与 uniform recipe。 */
export class ImageEditorGpuDiffusionRendererV3 {
  private readonly sourceDraw: Draw
  private readonly downsample: Draw[]
  private readonly upsample: Draw[]
  private readonly composite: Draw
  private readonly linearSampler: ReturnType<typeof sampler>
  private readonly buffers: NativeBuffer[] = []
  private prepared: DiffusionPassV3[] = []
  private compiled = false

  private output: Target | null = null

  constructor(private readonly gpu: Gpu, private readonly targets: ImageEditorGpuEffectTargetPoolV3,
    private readonly onCompiled: () => void) {
    const shaders = premultipliedDiffusionShaders()
    const options = (shader: string, fragment: string, label: string) => ({ shader, vertices: 6,
      entry: { vertex: 'vertex_main', fragment }, label }) as const
    this.sourceDraw = draw(gpu, options(shaders.source, 'fragment_source', 'image-editor-diffusion-source'))
    this.downsample = Array.from({ length: MAX_LEVELS }, (_, index) => draw(gpu,
      options(shaders.scatter, 'fragment_scatter_downsample', `image-editor-diffusion-down:${index}`)))
    this.upsample = Array.from({ length: MAX_LEVELS }, (_, index) => draw(gpu,
      options(shaders.scatter, 'fragment_scatter_upsample', `image-editor-diffusion-up:${index}`)))
    this.composite = draw(gpu, options(shaders.composite, 'fragment_composite', 'image-editor-diffusion-composite'))
    this.linearSampler = sampler(gpu, { minFilter: 'linear', magFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
  }

  prepare(input: Target, recipe: DiffusionRecipe, output: Target): Target {
    this.clearBuffers()
    this.prepared = []
    this.output = output
    const source = this.targets.full(0, input.size)
    const sourceUniform = this.uniform(createDiffusionSourceUniform(recipe))
    this.bind(this.sourceDraw, [
      [0, input.color.view], [1, this.linearSampler], [2, { buffer: sourceUniform }],
    ])
    this.prepared.push({ drawable: this.sourceDraw, target: source })
    let previous = source
    for (let index = 0; index < recipe.scatterLevels.length; index += 1) {
      const level = recipe.scatterLevels[index]
      const size = scaled(input.size, level.divisor)
      const levelTarget = this.targets.level(index, size)
      const uniform = this.uniform(createDiffusionDownsampleUniform())
      this.bind(this.downsample[index], [
        [0, previous.color.view], [1, this.linearSampler], [2, { buffer: uniform }],
      ])
      this.prepared.push({ drawable: this.downsample[index], target: levelTarget })
      previous = levelTarget
    }
    let accumulated = this.targets.level(recipe.scatterLevels.length - 1,
      scaled(input.size, recipe.scatterLevels.at(-1)?.divisor ?? 1))
    let accumulatedWeight = recipe.scatterLevels[recipe.scatterLevels.length - 1].weight
    for (let index = recipe.scatterLevels.length - 2; index >= 0; index -= 1) {
      const highLevel = this.targets.level(index, scaled(input.size, recipe.scatterLevels[index].divisor))
      const accumulation = this.targets.accumulation(index, highLevel.size)
      const uniform = this.uniform(createDiffusionUpsampleUniform(
        recipe.scatterLevels[index].weight, accumulatedWeight,
      ))
      this.bind(this.upsample[index], [
        [0, highLevel.color.view], [1, this.linearSampler], [2, { buffer: uniform }],
        [10, accumulated.color.view],
      ])
      this.prepared.push({ drawable: this.upsample[index], target: accumulation })
      accumulated = accumulation
      accumulatedWeight = [1, 1, 1]
    }
    const compositeUniform = this.uniform(createDiffusionCompositeUniform(recipe))
    this.bind(this.composite, [
      [0, input.color.view], [1, this.linearSampler], [2, accumulated.color.view],
      [8, { buffer: compositeUniform }], [9, source.color.view],
    ])
    this.prepared.push({ drawable: this.composite, target: output })
    return output
  }

  async compile(): Promise<void> {
    if (this.compiled) return
    await Promise.all([
      this.sourceDraw.compile(this.targets.full(0)),
      this.composite.compile(this.output ?? this.targets.full(1)),
      ...this.downsample.map((entry, index) => entry.compile(this.targets.level(index))),
      ...this.upsample.map((entry, index) => entry.compile(this.targets.accumulation(index))),
    ])
    this.compiled = true
    this.onCompiled()
  }

  encode(currentFrame: ReturnType<typeof import('vgpu').frame>): Target {
    for (const pass of this.prepared) currentFrame.pass({ target: pass.target, clear: CLEAR }, pass.drawable)
    if (!this.output) throw new Error('GPU diffusion 未准备')
    return this.output
  }

  dispose(): void {
    this.clearBuffers()
    this.output = null
  }

  private uniform(values: Float32Array): NativeBuffer {
    const buffer = this.gpu.gpu.createBuffer({ size: Math.ceil(values.byteLength / 16) * 16,
      usage: BUFFER_UNIFORM | BUFFER_COPY_DST })
    this.gpu.gpu.queue.writeBuffer(buffer, 0, values)
    this.buffers.push(buffer)
    return buffer
  }

  private bind(drawable: Draw, resources: readonly (readonly [number, unknown])[]): NativeBindGroup {
    const group = this.gpu.gpu.createBindGroup({ layout: drawable.layout(0), entries: resources.map(
      ([binding, resource]) => ({ binding, resource }),
    ) })
    drawable.group(0, group)
    return group
  }

  private clearBuffers(): void {
    for (const buffer of this.buffers) buffer.destroy()
    this.buffers.length = 0
  }
}

function premultipliedDiffusionShaders(): { source: string; scatter: string; composite: string } {
  const sourceStart = diffusionShader.indexOf('struct SourceUniforms')
  const scatterStart = diffusionShader.indexOf('struct ScatterUniforms')
  const compositeStart = diffusionShader.indexOf('struct CompositeUniforms')
  if (sourceStart < 0 || scatterStart < 0 || compositeStart < 0) {
    throw new Error('Diffusion WGSL entry 边界失效')
  }
  const common = diffusionShader.slice(0, sourceStart)
  const straightSample = 'let color = textureSampleLevel(source_input, source_sampler, uv, 0.0);'
  const premultSample = 'let sampled_color = textureSampleLevel(source_input, source_sampler, uv, 0.0);\n  let color = vec4<f32>(sampled_color.rgb / max(sampled_color.a, 0.000001), sampled_color.a);'
  const straightBase = 'let base = textureSampleLevel(composite_base, composite_sampler, uv, 0.0);'
  const premultBase = 'let sampled_base = textureSampleLevel(composite_base, composite_sampler, uv, 0.0);\n  let base = vec4<f32>(sampled_base.rgb / max(sampled_base.a, 0.000001), sampled_base.a);'
  const straightEntry = '@fragment\nfn fragment_composite(input: VertexOutput) -> @location(0) vec4<f32> {'
  const helperEntry = 'fn fragment_composite_straight(input: VertexOutput) -> vec4<f32> {'
  const source = `${common}${diffusionShader.slice(sourceStart, scatterStart)}`
    .replace(straightSample, premultSample)
  const scatter = `${common}${diffusionShader.slice(scatterStart, compositeStart)}`
  const compositeBody = `${common}${diffusionShader.slice(compositeStart)}`
    .replace(straightBase, premultBase).replace(straightEntry, helperEntry)
  if (source === diffusionShader || !compositeBody.includes('fragment_composite_straight')) {
    throw new Error('Diffusion WGSL 共享 Target 预乘适配点失效')
  }
  const composite = `${compositeBody}\n@fragment\nfn fragment_composite(input: VertexOutput) -> @location(0) vec4<f32> {\n  let straight = fragment_composite_straight(input);\n  return vec4<f32>(straight.rgb * straight.a, straight.a);\n}`
  return { source, scatter, composite }
}

function scaled(size: readonly [number, number], divisor: number): readonly [number, number] {
  return [Math.max(1, Math.ceil(size[0] / divisor)), Math.max(1, Math.ceil(size[1] / divisor))]
}
