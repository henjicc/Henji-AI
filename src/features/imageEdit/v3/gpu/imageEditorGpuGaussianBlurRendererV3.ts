import { effect, target, type Effect, type Gpu, type Target } from 'vgpu'
import { resolveGaussianPixelPlan } from '@/core/imageEdit/v3/effects/gaussianBlur'
import { gaussianExecutionWindows, type GaussianPixelWindow, type GaussianRegion } from '@/core/imaging/effects/cpu/gaussian'
import type { ResolvedGaussianPlan } from '@/core/imaging/effects/gaussian'
import type { EffectQuality } from '@/core/imaging/effects/descriptor'
import { GAUSSIAN_WGSL } from '@/core/imaging/effects/wgsl/gaussian'
import type { ImageEditorGpuEffectTargetPoolV3 } from './imageEditorGpuEffectTargetPoolV3'
import gaussianShader from './shaders/imageEditorGpuGaussianBlurV3.wgsl?raw'

const CLEAR = [0, 0, 0, 0] as const
interface GaussianPassV3 { effect: Effect; target: Target }

/** 只包装共享计划与 WGSL；设备、Target、提交和取消仍归图片宿主。 */
export class ImageEditorGpuGaussianBlurRendererV3 {
  private readonly effects: Effect[] = []
  private prepared: GaussianPassV3[] = []
  private output: Target | null = null
  private readonly compiledFormats = new Map<number, string>()
  private readonly regionScratch: Target[] = []
  constructor(private readonly gpu: Gpu, private readonly targets: ImageEditorGpuEffectTargetPoolV3, private readonly onCompiled: () => void) {}

  /** 旧 dispatch 的内部像素 ABI。输入已经是线性预乘，legacy 不再改变滤波域。 */
  prepare(input: Target, radius: number, mip: number, output: Target, _legacyPerceptual: boolean, _transferCode: number, _referenceWhiteNits: number, quality: EffectQuality = 'final'): Target {
    return this.prepareResolved(input, resolveGaussianPixelPlan({ radius: radius / (2 ** mip), mip: 0, quality }, input.size[0], input.size[1]), output)
  }

  /** R04 调用此接口；plan 必须由完整文档/输出网格解析，不能按 tile 重新选择质量计划。 */
  prepareResolved(input: Target, plan: ResolvedGaussianPlan, output: Target, inputWindow: Pick<GaussianPixelWindow, 'x' | 'y' | 'width' | 'height'> = { x: 0, y: 0, width: input.size[0], height: input.size[1] }, outputRegion?: GaussianRegion): Target {
    const windows = gaussianExecutionWindows(plan, outputRegion)
    const required = windows[0]
    if (inputWindow.x > required.x || inputWindow.y > required.y || inputWindow.x + inputWindow.width < required.x + required.width || inputWindow.y + inputWindow.height < required.y + required.height) throw new Error('GPU Gaussian 输入缺少共享计划要求的真实 halo')
    if (input.size[0] !== inputWindow.width || input.size[1] !== inputWindow.height) throw new Error('GPU Gaussian 输入窗口与纹理尺寸不同')
    const final = windows.at(-1)!
    if (output.size[0] !== final.width || output.size[1] !== final.height) throw new Error('GPU Gaussian 输出纹理与计划区域不同')
    this.prepared = []
    const scratchCount = outputRegion || plan.quality === 'final' ? Math.max(0, plan.passes.length - 1) : 0
    for (const owned of this.regionScratch.slice(scratchCount)) owned?.color.destroy()
    this.regionScratch.length = Math.min(this.regionScratch.length, scratchCount)
    let source = input; let sourceWindow = inputWindow; let level = -1
    for (const [index, pass] of plan.passes.entries()) {
      const step = pass.operation; const window = windows[index + 1]
      const size = [window.width, window.height] as const
      const last = index === plan.passes.length - 1
      let destination: Target
      if (last) destination = output
      else if (outputRegion || plan.quality === 'final') {
        // halo 反向窗口逐工序缩小，不能在 encode 前反复 resize 同一池 target。
        if (this.regionScratch[index]?.format !== plan.intermediateFormat) { this.regionScratch[index]?.color.destroy(); this.regionScratch[index] = target(this.gpu, { size, format: plan.intermediateFormat }) }
        const owned = this.regionScratch[index]
        owned.resize(size)
        destination = owned
      }
      else if (step.kind === 'downsample') destination = this.targets.level(++level, size)
      else if (level >= 0) {
        const accumulation = this.targets.accumulation(level, size)
        destination = accumulation === source ? this.targets.level(level, size) : accumulation
      } else {
        const first = this.targets.full(0, size)
        destination = first === source ? this.targets.full(1, size) : first
      }
      const instance = this.effects[index] ??= effect(this.gpu, `${GAUSSIAN_WGSL}\n${gaussianShader}`, { label: `image-editor-gaussian:${index}` })
      instance.set({ source, params: {
        operation: [step.kind === 'blur' ? 0 : 1, step.kind === 'blur' && step.axis === 'x' ? 1 : 0, step.kind === 'blur' && step.axis === 'y' ? 1 : 0, step.kind === 'blur' ? step.radius : 0],
        transfer: [step.kind === 'blur' ? step.sigma : 0, ...pass.sampleScale, plan.parameters.edge_mode === 'clamp' ? 1 : 0],
        domain: [step.sourceWidth, step.sourceHeight, sourceWindow.x, sourceWindow.y],
        targetOrigin: [window.x, window.y, 0, 0],
      } })
      this.prepared.push({ effect: instance, target: destination })
      source = destination; sourceWindow = window
    }
    this.output = plan.passes.length ? output : input
    return this.output
  }

  async compile(): Promise<void> {
    const pending = this.prepared.map((pass, index) => ({ pass, index })).filter(({ pass, index }) => this.compiledFormats.get(index) !== pass.target.format)
    if (!pending.length) return
    await Promise.all(pending.map(({ pass }) => pass.effect.compile(pass.target)))
    for (const { pass, index } of pending) this.compiledFormats.set(index, pass.target.format)
    this.onCompiled()
  }
  encode(currentFrame: ReturnType<typeof import('vgpu').frame>): Target {
    for (const pass of this.prepared) currentFrame.pass({ target: pass.target, clear: CLEAR }, pass.effect)
    if (!this.output) throw new Error('GPU Gaussian 模糊未准备')
    return this.output
  }
  dispose(): void { this.prepared = []; this.output = null; this.compiledFormats.clear(); for (const owned of this.regionScratch) owned?.color.destroy(); this.regionScratch.length = 0 }
}
