import { effect, type Effect, type Gpu, type Target } from 'vgpu'

import { resolveGaussianBlurV2Geometry } from '@/core/imageEdit/v3/effects/gaussianBlur'
import type { ImageEditorGpuEffectTargetPoolV3 } from './imageEditorGpuEffectTargetPoolV3'
import gaussianShader from './shaders/imageEditorGpuGaussianBlurV3.wgsl?raw'

const CLEAR = [0, 0, 0, 0] as const
const MAX_LEVELS = 8

interface GaussianPassV3 { effect: Effect; target: Target }

/** 与 Gaussian V2 CPU 真值相同的 2x 金字塔、截断核和一次双线性重建。 */
export class ImageEditorGpuGaussianBlurRendererV3 {
  private readonly encodeDomain: Effect
  private readonly decodeDomain: Effect
  private readonly downsample: Effect[]
  private readonly horizontal: Effect
  private readonly vertical: Effect
  private readonly upsample: Effect
  private prepared: GaussianPassV3[] = []
  private output: Target | null = null
  private compiled = false

  constructor(
    gpu: Gpu,
    private readonly targets: ImageEditorGpuEffectTargetPoolV3,
    private readonly onCompiled: () => void,
  ) {
    const make = (label: string): Effect => effect(gpu, gaussianShader, { label })
    this.encodeDomain = make('image-editor-gaussian-domain-encode')
    this.decodeDomain = make('image-editor-gaussian-domain-decode')
    this.downsample = Array.from({ length: MAX_LEVELS }, (_, index) => (
      make(`image-editor-gaussian-down:${index}`)
    ))
    this.horizontal = make('image-editor-gaussian-horizontal')
    this.vertical = make('image-editor-gaussian-vertical')
    this.upsample = make('image-editor-gaussian-upsample')
  }

  prepare(
    input: Target,
    radius: number,
    mip: number,
    output: Target,
    legacyPerceptual: boolean,
    transferCode: number,
    referenceWhiteNits: number,
  ): Target {
    if (radius <= 0) {
      this.prepared = []
      this.output = input
      return input
    }
    const boundedRadius = legacyPerceptual ? Math.min(120, radius) : radius
    const geometry = resolveGaussianBlurV2Geometry({ radius: boundedRadius, mip })
    if (geometry.pyramidLevel > MAX_LEVELS) {
      throw new Error(`GPU Gaussian 金字塔层级超出正式范围: ${geometry.pyramidLevel}`)
    }
    this.prepared = []
    let source = input
    if (legacyPerceptual) {
      source = this.targets.full(0, input.size)
      this.encodeDomain.set(parameters(input, 3, [0, 0], 0, input.size,
        transferCode, referenceWhiteNits))
      this.prepared.push({ effect: this.encodeDomain, target: source })
    }
    for (let index = 0; index < geometry.pyramidLevel; index += 1) {
      const target = this.targets.level(index, half(source.size))
      this.downsample[index].set(parameters(source, 1))
      this.prepared.push({ effect: this.downsample[index], target })
      source = target
    }
    const horizontal = geometry.pyramidLevel > 0
      ? this.targets.accumulation(geometry.pyramidLevel - 1, source.size)
      : this.targets.full(legacyPerceptual ? 1 : 0, source.size)
    this.horizontal.set(parameters(source, 0, [1, 0], geometry.radiusAtPyramidLevel))
    this.prepared.push({ effect: this.horizontal, target: horizontal })

    const blurred = geometry.pyramidLevel > 0
      ? this.targets.level(geometry.pyramidLevel - 1, source.size)
      : legacyPerceptual ? this.targets.full(2, source.size) : output
    this.vertical.set(parameters(horizontal, 0, [0, 1], geometry.radiusAtPyramidLevel))
    this.prepared.push({ effect: this.vertical, target: blurred })

    let reconstructed = blurred
    if (geometry.pyramidLevel > 0) {
      reconstructed = legacyPerceptual ? this.targets.full(1, input.size) : output
      this.upsample.set(parameters(blurred, 2, [0, 0], 0, input.size))
      this.prepared.push({ effect: this.upsample, target: reconstructed })
    }
    if (legacyPerceptual) {
      this.decodeDomain.set(parameters(reconstructed, 4, [0, 0], 0, reconstructed.size,
        transferCode, referenceWhiteNits))
      this.prepared.push({ effect: this.decodeDomain, target: output })
    }
    this.output = output
    return output
  }

  async compile(): Promise<void> {
    if (this.compiled) return
    await Promise.all([
      this.encodeDomain.compile(this.targets.full(0)),
      this.decodeDomain.compile(this.output ?? this.targets.full(2)),
      this.horizontal.compile(this.targets.full(1)),
      this.vertical.compile(this.targets.full(2)),
      this.upsample.compile(this.output ?? this.targets.full(2)),
      ...this.downsample.map((entry, index) => entry.compile(this.targets.level(index))),
    ])
    this.compiled = true
    this.onCompiled()
  }

  encode(currentFrame: ReturnType<typeof import('vgpu').frame>): Target {
    for (const pass of this.prepared) {
      currentFrame.pass({ target: pass.target, clear: CLEAR }, pass.effect)
    }
    if (!this.output) throw new Error('GPU Gaussian 模糊未准备')
    return this.output
  }

  dispose(): void {
    this.prepared = []
    this.output = null
  }
}

function parameters(
  source: Target,
  operation: 0 | 1 | 2 | 3 | 4,
  direction: readonly [number, number] = [0, 0],
  sigma = 0,
  targetSize: readonly [number, number] = source.size,
  transferCode = 1,
  referenceWhiteNits = 203,
): { source: Target; params: { operation: number[]; transfer: number[]; domain: number[] } } {
  return {
    source,
    params: {
      operation: [operation, direction[0], direction[1], Math.ceil(3 * sigma)],
      transfer: [sigma, targetSize[0], targetSize[1], 0],
      domain: [transferCode, referenceWhiteNits, 0, 0],
    },
  }
}

function half(size: readonly [number, number]): readonly [number, number] {
  return [Math.max(1, Math.ceil(size[0] / 2)), Math.max(1, Math.ceil(size[1] / 2))]
}
