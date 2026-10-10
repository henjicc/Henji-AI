import { effect, target, type Effect, type Gpu, type Target } from 'vgpu'
import { MOSAIC_AVERAGE_WGSL, MOSAIC_EXPAND_WGSL } from '@/core/imaging/effects/wgsl/mosaic'
import type { MosaicPlan } from '@/core/imaging/effects/mosaic'

/** 每个渲染器持有自己的缩小网格；不与其他效果的 scratch 生命周期混用。 */
export class ImageEditorGpuMosaicRendererV3 {
  private readonly average: Effect
  private readonly expand: Effect
  private readonly grid: Target
  private output: Target | null = null
  private compiled = false
  constructor(gpu: Gpu, private readonly onCompiled: () => void) {
    this.average = effect(gpu, MOSAIC_AVERAGE_WGSL, { label: 'image-editor-mosaic-average' })
    this.expand = effect(gpu, MOSAIC_EXPAND_WGSL, { label: 'image-editor-mosaic-expand' })
    this.grid = target(gpu, { size: [1, 1], format: 'rgba16float', clearColor: [0,0,0,0] })
  }
  prepare(input: Target, output: Target, plan: MosaicPlan, origin: readonly [number, number]): Target {
    const firstBlock = origin.map(value => Math.floor(value / plan.blockSize))
    this.grid.resize([Math.ceil((origin[0] + input.size[0]) / plan.blockSize) - firstBlock[0],
      Math.ceil((origin[1] + input.size[1]) / plan.blockSize) - firstBlock[1]])
    const params = { origin, firstBlock, fullSize: [plan.width, plan.height], blockSize: plan.blockSize, padding: 0 }
    this.average.set({ source: input, params })
    this.expand.set({ source: this.grid, params })
    this.output = output
    return output
  }
  async compile(): Promise<void> {
    if (this.compiled) return
    if (!this.output) throw new Error('GPU 马赛克未准备')
    await Promise.all([this.average.compile(this.grid), this.expand.compile(this.output)])
    this.compiled = true; this.onCompiled()
  }
  encode(currentFrame: ReturnType<typeof import('vgpu').frame>): Target {
    if (!this.output) throw new Error('GPU 马赛克未准备')
    currentFrame.pass({ target: this.grid, clear: [0,0,0,0] }, this.average)
    currentFrame.pass({ target: this.output, clear: [0,0,0,0] }, this.expand)
    return this.output
  }
  dispose(): void { this.grid.color.destroy(); this.output = null }
}
