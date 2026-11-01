import type { AdjustmentLookup } from '@/core/imaging/adjustments/plan'
import { planGaussian } from '@/core/imaging/adjustments/gaussianPlan'
import type { ResolvedGaussianPlan } from '@/core/imaging/effects/gaussian'
import type { VideoEditBuiltinEffectEntry } from './videoEditBuiltinEffectShaders'

/**
 * 把一个内置效果实例翻译成 GPU 工序（纯函数，可单测）：每道工序是一个着色器入口、输入、输出和 16 个 float 的参数。
 * 空间量一律按“输入画面高度”换算成像素，再按需降采样：同一个效果在任何渲染尺寸下看起来一样，大半径模糊的代价也有上限。
 */
/**
 * `second` 只在过渡里出现：后一段画面（`input` 是前一段）。
 * `subject` 是片段素材这一帧的人物蒙版，与 `input` 同尺寸、逐像素对齐：a 为人物的覆盖，r 为片段画面的覆盖
 * （片段画面外的取样不算数，叠加的描边、光只画在片段画面内）。只有声明 `subjectMatte` 的效果会用到。
 */
export type VideoEditBuiltinTexture = 'input' | 'second' | 'output' | 'subject' | number
export interface VideoEditBuiltinPass {
  /** 第三个输入（`gradeMask` 绑定）：HSL 选区蒙版（局部锐化同时需要原画面、线性模糊画面和蒙版），或人物蒙版。 */
  mask?: VideoEditBuiltinTexture
  lookup?: AdjustmentLookup
  entry: VideoEditBuiltinEffectEntry
  source: VideoEditBuiltinTexture
  /** 第二个输入（`original` 绑定）；没有时绑定效果的原始输入。 */
  original?: VideoEditBuiltinTexture
  target: VideoEditBuiltinTexture
  /** (目标宽, 目标高, 输入宽, 输入高, a.xyzw, b.xyzw, c.xyzw)。 */
  uniforms: Float32Array
}
/**
 * `underlay`：图层拆输出时叠在主图下面的那张 scratch。缺省是零 alpha 的光（相加照亮下方画面，`carriesLight`）；
 * `underlayKind: 'cover'` 是普通预乘画面（投影），按普通透明度遮挡。
 * `scratchFormat`：中间纹理不是画面而是数据时的格式（描边的种子坐标），优先于 `linearScratch`。
 * `remap`：只按与输入无关的坐标变换重排像素、不改颜色（变形）。同一份规划可以原样作用在前面效果拆出的光与影上，
 * 零 alpha 的光按预乘值取样照样成立。
 * `remapField`：重排靠一张与输入无关的位移场时，拆成两段——`field` 只画位移场（输出格式 `format`），
 * `warp` 按 `second` 上的位移场重排；主图与拆出的光影共用同一张位移场。
 */
export interface VideoEditBuiltinPlan { underlay?: number; underlayKind?: 'cover'; width: number; height: number; scratch: Array<{ width: number; height: number }>; passes: VideoEditBuiltinPass[]; resolvedGaussian?: ResolvedGaussianPlan; linearScratch?: boolean; scratchFormat?: 'rg32float'; remap?: boolean; remapField?: { format: 'rgba16float'; field: VideoEditBuiltinPlan; warp: VideoEditBuiltinPlan } }
export type Vec4 = readonly [number, number, number, number]
export const ZERO: Vec4 = [0, 0, 0, 0]

export class Planner {
  readonly scratch: Array<{ width: number; height: number }> = []
  readonly passes: VideoEditBuiltinPass[] = []
  constructor(readonly width: number, readonly height: number) {}
  size(texture: VideoEditBuiltinTexture): [number, number] {
    if (typeof texture === 'number') { const value = this.scratch[texture]; return [value.width, value.height] }
    return [this.width, this.height]
  }
  alloc(width = this.width, height = this.height): number { this.scratch.push({ width, height }); return this.scratch.length - 1 }
  pass(entry: VideoEditBuiltinEffectEntry, source: VideoEditBuiltinTexture, target: VideoEditBuiltinTexture, a: Vec4 = ZERO, b: Vec4 = ZERO, original?: VideoEditBuiltinTexture, c: Vec4 = ZERO): void {
    const [targetWidth, targetHeight] = this.size(target); const [sourceWidth, sourceHeight] = this.size(source)
    const uniforms = new Float32Array(16)
    uniforms.set([targetWidth, targetHeight, sourceWidth, sourceHeight, ...a, ...b, ...c])
    this.passes.push({ entry, source, target, uniforms, ...(original !== undefined ? { original } : {}) })
  }
  /**
   * 可分离高斯（sigma 为全尺寸像素，按轴给）：先按轴把画面对半降采样到 sigma ≤ 3，再横竖两道一维高斯，最后双线性放大回目标。
   * 降采样与放大本身带来的模糊（方差）从剩余 sigma 里扣掉，整体仍是要求的 sigma。只模糊一个方向时另一方向不降采样。
   */
  gaussian(source: VideoEditBuiltinTexture, target: VideoEditBuiltinTexture, sigmaX: number, sigmaY: number, repeatEdges: boolean): void {
    const [width, height] = this.size(source); const [targetWidth, targetHeight] = this.size(target)
    const { passes } = planGaussian({ width, height, sigmaX, sigmaY, repeatEdges, targetSize: { width: targetWidth, height: targetHeight } })
    let current = source
    passes.forEach((step, index) => {
      const next = index === passes.length - 1 ? target : this.alloc(step.width, step.height)
      if (step.kind === 'blur') this.pass('blur', current, next, [step.axis === 'x' ? 1 / step.sourceWidth : 0, step.axis === 'y' ? 1 / step.sourceHeight : 0, step.sigma, step.radius], [step.repeatEdges ? 1 : 0, 0, 0, 0])
      else this.pass('copy', current, next)
      current = next
    })
  }
}
