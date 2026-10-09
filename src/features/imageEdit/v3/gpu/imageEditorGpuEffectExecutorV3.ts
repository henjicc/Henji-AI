import { createBuiltInImageEditRenderNodeRegistry, gaussianParametersFromNodeV3 } from '@/core/imageEdit/v3/builtInRenderNodes'
import { resolveImageGaussianPlan } from '@/core/imageEdit/v3/effects/gaussianBlur'
import type { EffectEvaluationContext } from '@/core/imaging/effects/descriptor'
import { effect, target, type Effect, type Gpu, type Target, type Texture } from 'vgpu'

import type { ImageEditorGpuGraphEffectNodeV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { ImageEditorGpuFastBlurRendererV3 } from './imageEditorGpuFastBlurRendererV3'
import { ImageEditorGpuDiffusionRendererV3 } from './imageEditorGpuDiffusionRendererV3'
import { ImageEditorGpuGlowRendererV3 } from './imageEditorGpuGlowRendererV3'
import { ImageEditorGpuGaussianBlurRendererV3 } from './imageEditorGpuGaussianBlurRendererV3'
import { ImageEditorGpuEffectTargetPoolV3 } from './imageEditorGpuEffectTargetPoolV3'
import { DIFFUSION_V4_RECIPE_ADAPTER, VGPU_GLOW_V4_RECIPE_ADAPTER } from '@/core/imageEdit/v3/effects'
import type { ImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import { IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3 } from '@/core/imageEdit/v3/colorTypes'
import { IMAGE_EDITOR_GPU_TRANSFER_CODE_V3 } from './imageEditorGpuColorPipelineV3'
import mixShader from './shaders/imageEditorGpuEffectMixV3.wgsl?raw'
import type { GaussianRegion } from '@/core/imaging/effects/cpu/gaussian'
import type { ImageEditorGpuGaussianRegionV3 } from './imageEditorGpuGaussianRegionsV3'

export interface ImageEditorGpuPreparedEffectV3 {
  readonly rendererKey: string
  readonly node: ImageEditorGpuGraphEffectNodeV3
  readonly input: Target
  readonly mask: Target | null
  readonly output: Target
  readonly processed: Target
  readonly fingerprint: string
  readonly dependencies: readonly unknown[]
  readonly renderer: ImageEditorGpuTargetEffectRendererV3
  readonly pending: boolean
  readonly direct: boolean
  readonly ownsOutput: boolean
}

interface ImageEditorGpuTargetEffectRendererV3 {
  compile(): Promise<void>
  encode(currentFrame: ReturnType<typeof import('vgpu').frame>): Target
  dispose(): void
}

interface RetainedEffectV3 {
  output: Target
  fingerprint: string
  dependencies: readonly unknown[]
  ownsOutput: boolean
}

/** 全部内置效果的 Target 调度入口；渲染器共享常驻 scratch，不经 CPU 往返。 */
export class ImageEditorGpuEffectExecutorV3 {
  private readonly mix: Effect
  private readonly renderers = new Map<string, ImageEditorGpuTargetEffectRendererV3>()
  private readonly retained = new Map<string, RetainedEffectV3>()
  private readonly targets: ImageEditorGpuEffectTargetPoolV3
  private mixCompiled = false

  constructor(
    private readonly gpu: Gpu,
    private readonly fallbackMask: Texture,
    private readonly onCompiled: () => void,
  ) {
    this.mix = effect(gpu, mixShader, { label: 'image-editor-graph-effect-mix' })
    this.targets = new ImageEditorGpuEffectTargetPoolV3(gpu)
  }

  prepare(
    node: ImageEditorGpuGraphEffectNodeV3,
    input: Target,
    mask: Target | null,
    fingerprint: string,
    outputPixelsPerDocumentPixel = 1,
    effectRecipeSize?: readonly [number, number],
    documentColor?: ImageEditColorModeV3,
    evaluation?: EffectEvaluationContext,
    region?: { input: GaussianRegion; gaussian: ImageEditorGpuGaussianRegionV3 },
  ): ImageEditorGpuPreparedEffectV3 {
    const dependencies = [input, mask, evaluation?.quality, evaluation?.outputSize.width, evaluation?.outputSize.height]
    const existing = this.retained.get(node.nodeId)
    const direct = node.opacity === 1 && node.blendMode === 'normal' && node.mask === null
    const rendererKey = `${node.nodeId}:${node.definitionId}`
    const kernel = createBuiltInImageEditRenderNodeRegistry().get(node.definitionId)?.gpu?.kernel
    const binding = kernel ? EFFECT_KERNELS[kernel] : undefined
    if (!binding) throw new Error(`GPU 不支持效果 ${node.definitionId}：没有宿主 kernel 绑定`)
    const renderer = this.renderers.get(rendererKey) ?? binding.create(this.gpu, this.targets, this.onCompiled)
    this.renderers.set(rendererKey, renderer)
    if (existing && existing.fingerprint === fingerprint && sameDependencies(existing.dependencies, dependencies)) {
      return { rendererKey, node, input, mask, output: existing.output, processed: existing.output,
        fingerprint, dependencies, renderer, pending: false, direct, ownsOutput: existing.ownsOutput }
    }
    const output = existing?.ownsOutput ? existing.output : target(this.gpu, {
      size: input.size, format: 'rgba16float', clearColor: [0, 0, 0, 0],
      label: `image-editor-graph-effect:${node.nodeId}`,
    })
    output.resize(input.size)
    const processedOutput = direct ? output : this.targets.full(2, input.size)
    const processed = binding.prepare(renderer, { node, input, output: processedOutput,
      scale: outputPixelsPerDocumentPixel, recipeSize: effectRecipeSize, color: documentColor, evaluation, region })
    const finalOutput = direct ? processed : output
    const ownsOutput = finalOutput === output
    if (!ownsOutput) output.color.destroy()
    return { rendererKey, node, input, mask, processed, fingerprint, dependencies, renderer,
      pending: true, output: finalOutput, direct, ownsOutput }
  }

  async compile(prepared: readonly ImageEditorGpuPreparedEffectV3[]): Promise<void> {
    const pending = prepared.filter((entry) => entry.pending)
    if (pending.length === 0) return
    await Promise.all(pending.map((entry) => entry.renderer.compile()))
    if (!this.mixCompiled) {
      await this.mix.compile(pending[0].output)
      this.mixCompiled = true
      this.onCompiled()
    }
  }

  encode(currentFrame: ReturnType<typeof import('vgpu').frame>, entry: ImageEditorGpuPreparedEffectV3): void {
    if (!entry.pending) return
    const processed = entry.renderer.encode(currentFrame)
    if (entry.direct) return
    this.mix.set({
      originalTexture: entry.input, processedTexture: processed,
      maskTexture: entry.mask ?? this.fallbackMask,
      params: { options: [entry.node.opacity, blendIndex(entry.node.blendMode), 0, 0],
        maskOptions: [entry.node.mask ? 1 : 0, entry.node.mask?.defaultValue ?? 1,
          entry.node.mask?.inverted ? 1 : 0, 0] },
    })
    currentFrame.pass({ target: entry.output, clear: [0, 0, 0, 0] }, this.mix)
  }

  commit(prepared: readonly ImageEditorGpuPreparedEffectV3[]): void {
    for (const entry of prepared) {
      if (!entry.pending) continue
      const previous = this.retained.get(entry.node.nodeId)
      if (previous?.ownsOutput && previous.output !== entry.output) previous.output.color.destroy()
      this.retained.set(entry.node.nodeId, { output: entry.output, fingerprint: entry.fingerprint,
        dependencies: entry.dependencies, ownsOutput: entry.ownsOutput })
    }
  }

  prune(activeNodes: ReadonlySet<string>, activeRenderers: ReadonlySet<string>): void {
    for (const [nodeId, value] of this.retained) {
      if (activeNodes.has(nodeId)) continue
      if (value.ownsOutput) value.output.color.destroy()
      this.retained.delete(nodeId)
    }
    for (const [key, renderer] of this.renderers) {
      if (activeRenderers.has(key)) continue
      renderer.dispose()
      this.renderers.delete(key)
    }
  }

  discard(prepared: readonly ImageEditorGpuPreparedEffectV3[]): void {
    for (const entry of prepared) {
      if (entry.pending && entry.ownsOutput) {
        if (this.retained.get(entry.node.nodeId)?.output === entry.output) this.retained.delete(entry.node.nodeId)
        entry.output.color.destroy()
      }
    }
  }

  dispose(): void {
    for (const value of this.retained.values()) if (value.ownsOutput) value.output.color.destroy()
    for (const renderer of this.renderers.values()) renderer.dispose()
    this.targets.dispose()
    this.retained.clear(); this.renderers.clear()
  }
}

function numberParameter(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
function blendIndex(mode: ImageEditorGpuGraphEffectNodeV3['blendMode']): number {
  return mode === 'multiply' ? 1 : mode === 'screen' ? 2 : mode === 'overlay' ? 3 : mode === 'soft-light' ? 4 : 0
}
function sameDependencies(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

interface EffectKernelPreparation {
  node: ImageEditorGpuGraphEffectNodeV3;
  input: Target;
  output: Target;
  scale: number;
  recipeSize?: readonly [number, number];
  color?: ImageEditColorModeV3;
  evaluation?: EffectEvaluationContext;
  region?: { input: GaussianRegion; gaussian: ImageEditorGpuGaussianRegionV3 };
}
interface EffectKernelBinding {
  create(gpu: Gpu, targets: ImageEditorGpuEffectTargetPoolV3, compiled: () => void): ImageEditorGpuTargetEffectRendererV3;
  prepare(renderer: ImageEditorGpuTargetEffectRendererV3, context: EffectKernelPreparation): Target;
}
/** 绑定 GPU 宿主 ABI，与 operation ID 无关；未知 kernel 明确失败。 */
const EFFECT_KERNELS: Readonly<Record<string, EffectKernelBinding>> = {
  gaussian: {
    create: (gpu, pool, compiled) => new ImageEditorGpuGaussianBlurRendererV3(gpu, pool, compiled),
    prepare: (renderer, context) => {
      if (!context.evaluation) throw new Error('GPU 高斯缺少完整文档网格与质量档')
      if (context.region) return (renderer as ImageEditorGpuGaussianBlurRendererV3).prepareRegion(context.input,
        context.region.gaussian.plan, context.output, context.region.input, context.region.gaussian.output)
      const plan = resolveImageGaussianPlan(gaussianParametersFromNodeV3(context.node.parameters), context.evaluation)
      return (renderer as ImageEditorGpuGaussianBlurRendererV3).prepareResolved(context.input, plan, context.output)
    },
  },
  'legacy-gaussian': {
    create: (gpu, pool, compiled) => new ImageEditorGpuGaussianBlurRendererV3(gpu, pool, compiled),
    prepare: (renderer, context) => (renderer as ImageEditorGpuGaussianBlurRendererV3).prepare(
      context.input, numberParameter(context.node.parameters.radiusPixels, 0) * context.scale, 0,
      context.output, true, IMAGE_EDITOR_GPU_TRANSFER_CODE_V3[context.color?.transferFunction ?? 'srgb'],
      context.color?.hdrMetadata?.referenceWhiteNits ?? IMAGE_EDIT_HDR_REFERENCE_WHITE_NITS_V3),
  },
  'fast-blur': {
    create: (gpu, pool, compiled) => new ImageEditorGpuFastBlurRendererV3(gpu, pool, compiled),
    prepare: (renderer, context) => (renderer as ImageEditorGpuFastBlurRendererV3).prepare(context.input,
      numberParameter(context.node.parameters.radius, 0) * context.scale / 2 ** numberParameter(context.node.parameters.mip, 0), context.output),
  },
  diffusion: {
    create: (gpu, pool, compiled) => new ImageEditorGpuDiffusionRendererV3(gpu, pool, compiled),
    prepare: (renderer, context) => (renderer as ImageEditorGpuDiffusionRendererV3).prepare(context.input,
      DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(context.node.parameters),
        { width: context.recipeSize?.[0] ?? context.input.size[0], height: context.recipeSize?.[1] ?? context.input.size[1], quality: 'high' }), context.output),
  },
  glow: {
    create: (gpu, pool, compiled) => new ImageEditorGpuGlowRendererV3(gpu, pool, compiled),
    prepare: (renderer, context) => (renderer as ImageEditorGpuGlowRendererV3).prepare(context.input,
      VGPU_GLOW_V4_RECIPE_ADAPTER.compileRecipe(VGPU_GLOW_V4_RECIPE_ADAPTER.parseParameters(context.node.parameters),
        { width: context.recipeSize?.[0] ?? context.input.size[0], height: context.recipeSize?.[1] ?? context.input.size[1] }), context.output),
  },
}
