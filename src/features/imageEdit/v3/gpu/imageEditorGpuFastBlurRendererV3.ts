import { effect, type Effect, type Gpu, type Target } from 'vgpu'

import { boxSizesForGaussian } from '@/core/imageEdit/v3/effects/fastBlur'
import exactBlurShader from './shaders/imageEditorGpuFastBlurV3.wgsl?raw'
import type { ImageEditorGpuEffectTargetPoolV3 } from './imageEditorGpuEffectTargetPoolV3'

const CLEAR = [0, 0, 0, 0] as const
/** UI schema 的最大 sigma 为 1000，对应三方框最大半径不超过 1000。 */
const MAX_LEGAL_BOX_RADIUS = 1000

interface BlurPassV3 { target: Target; drawable: Effect }

/** 在同一 Frame 内逐维执行 CPU 参考实现相同的三次方框卷积。 */
export class ImageEditorGpuFastBlurRendererV3 {
  private readonly effects: Effect[]
  private prepared: { output: Target; passes: readonly BlurPassV3[] } | null = null
  private compiled = false

  constructor(
    private readonly gpu: Gpu,
    private readonly targets: ImageEditorGpuEffectTargetPoolV3,
    private readonly onCompiled: () => void,
  ) {
    this.effects = Array.from({ length: 6 }, (_, index) => effect(gpu, exactBlurShader,
      { label: `image-editor-fast-blur-exact:${index}` }))
  }

  prepare(input: Target, radius: number, output: Target): Target {
    if (radius <= 0) {
      this.prepared = { output: input, passes: [] }
      return input
    }
    return this.prepareExact(input, radius, boxSizesForGaussian(radius), output)
  }

  async compile(): Promise<void> {
    if (this.compiled) return
    await Promise.all(this.effects.map((value, index) => value.compile(
      this.targets.full(index % 2 as 0 | 1),
    )))
    this.compiled = true
    this.onCompiled()
  }

  encode(currentFrame: ReturnType<typeof import('vgpu').frame>): Target {
    if (!this.prepared) throw new Error('GPU fast blur 未准备')
    for (const pass of this.prepared.passes) currentFrame.pass({ target: pass.target, clear: CLEAR }, pass.drawable)
    return this.prepared.output
  }

  dispose(): void {
    this.prepared = null
  }

  private prepareExact(input: Target, radius: number, sizes: readonly [number, number, number],
    output: Target): Target {
    const passes: BlurPassV3[] = []
    let source = input
    const append = (direction: readonly [number, number], support: number, sigma: number): void => {
      if (support > MAX_LEGAL_BOX_RADIUS) throw new Error(`GPU fast blur 半径超出正式范围: ${support}`)
      const passOutput = passes.length === (radius < 1 ? 1 : 5)
        ? output
        : this.targets.full(passes.length % 2 as 0 | 1, input.size)
      const drawable = this.effects[passes.length]
      drawable.set({ source, params: { direction, radius: support, sigma } })
      passes.push({ target: passOutput, drawable })
      source = passOutput
    }
    if (radius < 1) {
      const support = Math.max(1, Math.ceil(3 * radius))
      append([1, 0], support, radius)
      append([0, 1], support, radius)
    } else {
      for (const size of sizes) {
        const support = (size - 1) / 2
        append([1, 0], support, 0)
        append([0, 1], support, 0)
      }
    }
    this.prepared = { output: source, passes }
    return source
  }
}
