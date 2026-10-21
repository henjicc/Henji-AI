import { COLOR_GRADE_HSL_CORRECTION_KEYS, colorGradeWhiteBalance } from './colorGrade'
import { buildColorGradeTable } from './unifiedGrade'
import { MAX_GAUSSIAN_DIRECT_SIGMA as MAX_DIRECT_SIGMA, MAX_GAUSSIAN_LEVELS as MAX_LEVELS, planGaussian } from './gaussianPlan'
export type AdjustmentPassEntry = 'copy' | 'blur' | 'unsharp' | 'color_grade_unified' | 'color_grade_vignette' | 'color_grade_lut' | 'color_grade_hsl_key' | 'color_grade_hsl_correct' | 'color_grade_linear' | 'color_grade_hsl_sharpen'
export type AdjustmentTexture = 'input' | 'output' | number
export interface AdjustmentPass { entry: AdjustmentPassEntry; source: AdjustmentTexture; target: AdjustmentTexture; original?: AdjustmentTexture; mask?: AdjustmentTexture; uniforms: Float32Array; lookup?: AdjustmentLookup }
/** `table`: RGBA32F rows bound as `original` (unified grade parameters and curves); `cube`: imported LUT reference. */
export type AdjustmentLookup = { kind: 'table'; data: Float32Array; width: number; height: number; key: string } | { kind: 'cube'; ref: string }
export interface AdjustmentPlan { width: number; height: number; scratch: Array<{ width: number; height: number }>; passes: AdjustmentPass[] }
type Vec4 = readonly [number, number, number, number]
const ZERO: Vec4 = [0, 0, 0, 0]
class Planner {
  readonly scratch: Array<{ width: number; height: number }> = []
  readonly passes: AdjustmentPass[] = []
  constructor(readonly width: number, readonly height: number) {}
  size(texture: AdjustmentTexture): [number, number] {
    if (typeof texture === 'number') { const value = this.scratch[texture]; return [value.width, value.height] }
    return [this.width, this.height]
  }
  alloc(width = this.width, height = this.height): number { this.scratch.push({ width, height }); return this.scratch.length - 1 }
  pass(entry: AdjustmentPassEntry, source: AdjustmentTexture, target: AdjustmentTexture, a: Vec4 = ZERO, b: Vec4 = ZERO, original?: AdjustmentTexture, c: Vec4 = ZERO): void {
    const [targetWidth, targetHeight] = this.size(target); const [sourceWidth, sourceHeight] = this.size(source)
    const uniforms = new Float32Array(16)
    uniforms.set([targetWidth, targetHeight, sourceWidth, sourceHeight, ...a, ...b, ...c])
    this.passes.push({ entry, source, target, uniforms, ...(original !== undefined ? { original } : {}) })
  }
  /**
   * 可分离高斯（sigma 为全尺寸像素，按轴给）：先按轴把画面对半降采样到 sigma ≤ 3，再横竖两道一维高斯，最后双线性放大回目标。
   * 降采样与放大本身带来的模糊（方差）从剩余 sigma 里扣掉，整体仍是要求的 sigma。只模糊一个方向时另一方向不降采样。
   */
  gaussian(source: AdjustmentTexture, target: AdjustmentTexture, sigmaX: number, sigmaY: number, repeatEdges: boolean): void {
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

const number = (params: Readonly<Record<string, unknown>>, key: string): number => params[key] as number
export function planColorGrade(params: Readonly<Record<string, unknown>>, width: number, height: number, referenceSize: readonly [number, number] = [width, height]): AdjustmentPlan {
const H = referenceSize[1]
const plan = new Planner(width, height)
      const n = (key: string): number => number(params, key)
      const stages: Array<{ entry: AdjustmentPassEntry; a: Vec4; b?: Vec4; c?: Vec4; lookup?: AdjustmentPass['lookup'] }> = []
      if (params.input_lut && n('input_lut_strength')) stages.push({ entry: 'color_grade_lut', a: [n('input_lut_strength') / 100, 0, 0, 0], lookup: { kind: 'cube', ref: params.input_lut as string } })
      // Every pointwise operation runs in the unified pass; a Look LUT splits it into scene (A) and display (B) halves.
      const table = buildColorGradeTable(params)
      const lookup: AdjustmentPass['lookup'] = { kind: 'table', data: table.data, width: table.width, height: table.height, key: table.key }
      const look = Boolean(params.look_lut && n('look_lut_strength'))
      if (look) {
        if (table.stageA) stages.push({ entry: 'color_grade_unified', a: [1, 0, 0, 0], lookup })
        stages.push({ entry: 'color_grade_lut', a: [n('look_lut_strength') / 100, 0, 0, 0], lookup: { kind: 'cube', ref: params.look_lut as string } })
        if (table.stageB) stages.push({ entry: 'color_grade_unified', a: [2, 0, 0, 0], lookup })
      } else if (table.stageA || table.stageB) stages.push({ entry: 'color_grade_unified', a: [(table.stageA ? 1 : 0) + (table.stageB ? 2 : 0), 0, 0, 0], lookup })
      // Two full-resolution ping-pong surfaces regardless of the number of color sections.
      let current: AdjustmentTexture = 'input'; const ping = plan.alloc(); const pong = plan.alloc()
      const target = (): number => current === ping ? pong : ping
      const draw = (stage: typeof stages[number]): void => { const next = target(); plan.pass(stage.entry, current, next, stage.a, stage.b ?? ZERO, undefined, stage.c ?? ZERO); if (stage.lookup) plan.passes[plan.passes.length - 1].lookup = stage.lookup; current = next }
      stages.forEach(draw)
      if (n('sharpen')) {
        const blurred = plan.alloc(); const sigma = Math.max(.6, .0015 * H)
        plan.gaussian(current, blurred, sigma, sigma, true)
        const next = target(); plan.pass('unsharp', blurred, next, [n('sharpen') / 100 * 3, 0, 0, 0], ZERO, current); current = next
      }
      const showMask = params.hsl_show_mask === true
      if (showMask || COLOR_GRADE_HSL_CORRECTION_KEYS.some(key => n(key) !== 0)) {
        let mask = plan.alloc()
        plan.pass('color_grade_hsl_key', current, mask,
          [n('hsl_hue_start') / 360, n('hsl_hue_end') / 360, n('hsl_hue_feather') / 200, params.hsl_invert ? 1 : 0],
          [n('hsl_saturation_start') / 100, n('hsl_saturation_end') / 100, n('hsl_saturation_feather') / 100, 0],
          undefined, [n('hsl_luminance_start') / 100, n('hsl_luminance_end') / 100, n('hsl_luminance_feather') / 100, 0])
        // Both cleanup controls are Gaussian smoothing at distinct image-relative scales.
        // Compose variances and reuse the existing downsample/separable/upsample implementation.
        const sigma = H * Math.hypot(n('hsl_denoise') / 100 * .005, n('hsl_blur') / 100 * .02)
        if (sigma >= .3) { const cleaned = plan.alloc(); plan.gaussian(mask, cleaned, sigma, sigma, true); mask = cleaned }
        const wb = colorGradeWhiteBalance(n('hsl_temperature'), n('hsl_tint')); const contrast = n('hsl_contrast') / 100
        const next = target()
        plan.pass('color_grade_hsl_correct', current, next, [...wb, contrast >= 0 ? 1 + contrast * 2 : 1 + contrast],
          [n('hsl_saturation') / 100, n('hsl_grade_hue'), n('hsl_grade_strength') / 100, n('hsl_grade_luminance') / 100], mask, [showMask ? 1 : 0, 0, 0, 0])
        current = next
        if (showMask) { plan.pass('copy', current, 'output'); return plan }
        if (n('hsl_sharpen')) {
          const linear = plan.alloc(); const blurred = plan.alloc(); const radius = Math.max(.6, .0015 * H)
          plan.pass('color_grade_linear', current, linear)
          plan.gaussian(linear, blurred, radius, radius, true)
          const sharp = target(); plan.pass('color_grade_hsl_sharpen', blurred, sharp, [n('hsl_sharpen') / 100 * 3, 0, 0, 0], ZERO, current)
          plan.passes[plan.passes.length - 1].mask = mask
          current = sharp
        }
      }
      if (n('vignette_amount')) draw({ entry: 'color_grade_vignette', a: [n('vignette_amount') / 100, n('vignette_midpoint') / 100, n('vignette_roundness') / 100, n('vignette_feather') / 100], b: [referenceSize[0] / referenceSize[1], 0, 0, 0] })
      // A pointwise single stage can write straight to the supplied output.
      // Avoid reserving two full-size ping-pong textures for basic correction.
      if (plan.passes.length === 1 && plan.passes[0].source === 'input' && plan.passes[0].target === current) {
        plan.passes[0].target = 'output'
        plan.scratch.length = 0
        return plan
      }
      plan.pass('copy', current, 'output')
      if (current === 'input') plan.scratch.length = 0
      return plan
}

export function isNeutralAdjustmentPlan(plan: AdjustmentPlan): boolean { return plan.passes.length === 1 && plan.passes[0].entry === "copy" && plan.passes[0].source === "input" }

/** Sampling support in scaled document pixels; includes pyramid reconstruction support. */
export function colorGradeSpatialSupport(params: Readonly<Record<string, unknown>>, height: number): number {
  const n = (key: string): number => Number(params[key] ?? 0)
  const hslActive = params.hsl_show_mask === true || COLOR_GRADE_HSL_CORRECTION_KEYS.some(key => n(key) !== 0)
  const sigma = hslActive ? height * Math.hypot(n('hsl_denoise') / 100 * .005, n('hsl_blur') / 100 * .02) : 0
  const radius = Math.max(.6, .0015 * height)
  const sharp = (n('sharpen') ? radius : 0) + (n('hsl_sharpen') ? radius : 0)
  const level = Math.min(MAX_LEVELS, Math.max(0, Math.ceil(Math.log2(Math.max(1, Math.max(sigma, sharp) / MAX_DIRECT_SIGMA)))))
  return Math.ceil(3 * (sigma + sharp) + (level ? 4 * 2 ** level : 0))
}
