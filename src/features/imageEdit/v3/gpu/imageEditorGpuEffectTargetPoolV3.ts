import { target, type Gpu, type Target } from 'vgpu'

const CLEAR = [0, 0, 0, 0] as const
const MAX_LEVELS = 12

/** RenderGraph 内三类效果共用的常驻 scratch；节点只单独保留最终结果。 */
export class ImageEditorGpuEffectTargetPoolV3 {
  private readonly fullTargets: readonly Target[]
  private readonly levelTargets: readonly Target[]
  private readonly accumulationTargets: readonly Target[]

  constructor(gpu: Gpu) {
    const make = (): Target => target(gpu, {
      size: [1, 1], format: 'rgba16float', clearColor: CLEAR,
    })
    this.fullTargets = Array.from({ length: 3 }, make)
    this.levelTargets = Array.from({ length: MAX_LEVELS }, make)
    this.accumulationTargets = Array.from({ length: MAX_LEVELS }, make)
  }

  full(index: 0 | 1 | 2, size?: readonly [number, number]): Target {
    const value = this.fullTargets[index]
    if (size) value.resize(size)
    return value
  }

  level(index: number, size?: readonly [number, number]): Target {
    const value = this.levelTargets[index]
    if (size) value.resize(size)
    return value
  }

  accumulation(index: number, size?: readonly [number, number]): Target {
    const value = this.accumulationTargets[index]
    if (size) value.resize(size)
    return value
  }

  compileTargets(): readonly Target[] {
    return [...this.fullTargets, ...this.levelTargets, ...this.accumulationTargets]
  }

  dispose(): void {
    for (const value of this.compileTargets()) value.color.destroy()
  }
}
