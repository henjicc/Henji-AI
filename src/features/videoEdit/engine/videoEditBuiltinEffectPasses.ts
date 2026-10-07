import { resolveVideoEditBuiltinParams, type VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinEffectInstance } from '@/core/videoEdit/compositing'
import type { VideoEditBuiltinTransitionInput } from '@/core/videoEdit/transitions'
import type { VideoEditBuiltinEffectEntry } from './videoEditBuiltinEffectShaders'
import { LUMETRI_CURVE_CHANNELS, LUMETRI_HUE_CURVES, LUMETRI_WHEEL_REGIONS, lumetriWhiteBalance } from '@/core/videoEdit/lumetri'
import { lumetriCurveLut, lumetriCurvePoints, parseLumetriCurve } from '@/core/videoEdit/lumetriCurves'
import { planShaderLibraryEffect, planShaderLibraryTransition, shaderLibraryDelegatedEffect, type ShaderLibraryClock } from './shaderLibrary/planner'

/**
 * 把一个内置效果实例翻译成 GPU 工序（纯函数，可单测）：每道工序是一个着色器入口、输入、输出和 16 个 float 的参数。
 * 空间量一律按“输入画面高度”换算成像素，再按需降采样：同一个效果在任何渲染尺寸下看起来一样，大半径模糊的代价也有上限。
 */
/** `second` 只在过渡里出现：后一段画面（`input` 是前一段）。 */
export type VideoEditBuiltinTexture = 'input' | 'second' | 'output' | number
export interface VideoEditBuiltinPass {
  lookup?: { kind: 'curve'; data: Float32Array } | { kind: 'cube'; ref: string }
  entry: VideoEditBuiltinEffectEntry
  source: VideoEditBuiltinTexture
  /** 第二个输入（`original` 绑定）；没有时绑定效果的原始输入。 */
  original?: VideoEditBuiltinTexture
  target: VideoEditBuiltinTexture
  /** (目标宽, 目标高, 输入宽, 输入高, a.xyzw, b.xyzw, c.xyzw)。 */
  uniforms: Float32Array
}
export interface VideoEditBuiltinPlan { width: number; height: number; scratch: Array<{ width: number; height: number }>; passes: VideoEditBuiltinPass[] }
type Vec4 = readonly [number, number, number, number]
const ZERO: Vec4 = [0, 0, 0, 0]
/** 一维高斯工序里允许的最大 sigma（输入像素）；更大时先降采样。 */
const MAX_DIRECT_SIGMA = 3
const MAX_LEVELS = 7
const LINE_TAPS = 16

class Planner {
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
    let current = source; let [width, height] = this.size(source)
    let factorX = 1; let factorY = 1; let varianceX = 0; let varianceY = 0
    for (let level = 0; level < MAX_LEVELS; level++) {
      const halveX = sigmaX / factorX > MAX_DIRECT_SIGMA && width >= 16
      const halveY = sigmaY / factorY > MAX_DIRECT_SIGMA && height >= 16
      if (!halveX && !halveY) break
      if (halveX) { varianceX += factorX ** 2 / 4; factorX *= 2; width = Math.ceil(width / 2) }
      if (halveY) { varianceY += factorY ** 2 / 4; factorY *= 2; height = Math.ceil(height / 2) }
      const next = this.alloc(width, height); this.pass('copy', current, next); current = next
    }
    const residual = (sigma: number, factor: number, variance: number): number => Math.sqrt(Math.max(0, sigma ** 2 - variance - (factor > 1 ? factor ** 2 / 6 : 0))) / factor
    const steps: Array<{ axis: 'x' | 'y'; sigma: number }> = [{ axis: 'x' as const, sigma: residual(sigmaX, factorX, varianceX) }, { axis: 'y' as const, sigma: residual(sigmaY, factorY, varianceY) }].filter(step => step.sigma >= 0.3)
    const upsample = factorX > 1 || factorY > 1
    if (!steps.length && !upsample) { this.pass('copy', current, target); return }
    steps.forEach((step, index) => {
      const last = index === steps.length - 1 && !upsample
      const next = last ? target : this.alloc(width, height)
      const radius = Math.min(32, Math.ceil(step.sigma * 3))
      this.pass('blur', current, next, [step.axis === 'x' ? 1 / width : 0, step.axis === 'y' ? 1 / height : 0, step.sigma, radius], [repeatEdges ? 1 : 0, 0, 0, 0])
      current = next
    })
    if (upsample) this.pass('copy', current, target)
  }
  /** 两道等权取样组成的平滑直线模糊：第二道填满第一道取样之间的空隙（等效 16×16 次取样）。 */
  line(source: VideoEditBuiltinTexture, target: VideoEditBuiltinTexture, dx: number, dy: number): void {
    const middle = this.alloc()
    this.pass('line', source, middle, [dx / LINE_TAPS / this.width, dy / LINE_TAPS / this.height, LINE_TAPS, 0])
    this.pass('line', middle, target, [dx / LINE_TAPS ** 2 / this.width, dy / LINE_TAPS ** 2 / this.height, LINE_TAPS, 0])
  }
}

const number = (params: VideoEditBuiltinParams, key: string): number => params[key] as number
function hexColor(value: string): [number, number, number] { return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16) / 255) as [number, number, number] }
/** 胶片颗粒的种子：只与帧号有关（同一帧预览与导出一致，逐帧变化）。 */
export function videoEditGrainSeed(frame: number): number { return (Math.max(0, Math.floor(frame)) * 7 + 1) % 65_521 }

/**
 * `renderScale` is the drawn height over the sequence height (below 1 only at a reduced playback resolution, task 4.9).
 * Spatial amounts already follow the drawn height; it is needed only where a pixel is the smallest unit.
 */
export function planVideoEditBuiltinEffect(instance: VideoEditBuiltinEffectInstance & ShaderLibraryClock, frame: { width: number; height: number; frame: number; renderScale?: number }): VideoEditBuiltinPlan {
  const { width, height } = frame
  if (![width, height].every(value => Number.isInteger(value) && value >= 1)) throw new Error('内置效果需要有效的画面尺寸。')
  const delegated = shaderLibraryDelegatedEffect(instance)
  if (delegated) return planVideoEditBuiltinEffect(delegated, frame)
  const shader = planShaderLibraryEffect(instance, width, height)
  if (shader) return shader
  const params = resolveVideoEditBuiltinParams(instance)
  const plan = new Planner(width, height)
  const H = height
  switch (instance.id) {
    case 'lumetri_color': {
      const n = (key: string): number => number(params, key)
      const stages: Array<{ entry: VideoEditBuiltinEffectEntry; a: Vec4; b?: Vec4; c?: Vec4; lookup?: VideoEditBuiltinPass['lookup'] }> = []
      if (params.input_lut && n('input_lut_strength')) stages.push({ entry: 'lumetri_lut', a: [n('input_lut_strength') / 100, 0, 0, 0], lookup: { kind: 'cube', ref: params.input_lut as string } })
      if (['temperature', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'saturation', 'vibrance'].some(key => n(key) !== 0)) {
        const gain = 2 ** n('exposure'); const wb = lumetriWhiteBalance(n('temperature'), n('tint')); const contrast = n('contrast') / 100
        stages.push({ entry: 'lumetri_basic', a: [wb[0] * gain, wb[1] * gain, wb[2] * gain, contrast >= 0 ? 1 + contrast * 2 : 1 + contrast], b: [n('highlights') / 100, n('shadows') / 100, n('whites') / 100, n('blacks') / 100], c: [n('saturation') / 100, n('vibrance') / 100, 0, 0] })
      }
      if (params.look_lut && n('look_lut_strength')) stages.push({ entry: 'lumetri_lut', a: [n('look_lut_strength') / 100, 0, 0, 0], lookup: { kind: 'cube', ref: params.look_lut as string } })
      if (n('faded_film') || n('creative_shadow_strength') || n('creative_highlight_strength')) stages.push({ entry: 'lumetri_creative', a: [n('faded_film') / 100, n('creative_shadow_hue'), n('creative_shadow_strength') / 100, n('creative_highlight_hue')], b: [n('creative_highlight_strength') / 100, 0, 0, 0] })
      // Two full-resolution ping-pong surfaces regardless of the number of color sections.
      let current: VideoEditBuiltinTexture = 'input'; const ping = plan.alloc(); const pong = plan.alloc()
      const target = (): number => current === ping ? pong : ping
      const draw = (stage: typeof stages[number]): void => { const next = target(); plan.pass(stage.entry, current, next, stage.a, stage.b ?? ZERO, undefined, stage.c ?? ZERO); if (stage.lookup) plan.passes[plan.passes.length - 1].lookup = stage.lookup; current = next }
      stages.forEach(draw)
      if (n('sharpen')) {
        const blurred = plan.alloc(); const sigma = Math.max(.6, .0015 * H)
        plan.gaussian(current, blurred, sigma, sigma, true)
        const next = target(); plan.pass('unsharp', blurred, next, [n('sharpen') / 100 * 3, 0, 0, 0], ZERO, current); current = next
      }
      LUMETRI_CURVE_CHANNELS.forEach((channel, index) => {
        const points = lumetriCurvePoints(params, channel)
        if (points.some(point => point.y !== point.x)) draw({ entry: 'lumetri_curve', a: ZERO, b: [0, index, 0, 0], lookup: { kind: 'curve', data: lumetriCurveLut(points) } })
      })
      LUMETRI_HUE_CURVES.forEach((channel, index) => {
        const points = parseLumetriCurve(params[`curve_${channel}_points`])
        if (points.some(point => point.y !== 50)) draw({ entry: 'lumetri_hue_curve', a: [index, 0, 0, 0], lookup: { kind: 'curve', data: lumetriCurveLut(points) } })
      })
      LUMETRI_WHEEL_REGIONS.forEach((region, index) => { if (n(`${region}_strength`) || n(`${region}_luminance`)) draw({ entry: 'lumetri_wheel', a: [n(`${region}_hue`), n(`${region}_strength`) / 100, n(`${region}_luminance`) / 100, index] }) })
      if (n('vignette_amount')) draw({ entry: 'lumetri_vignette', a: [n('vignette_amount') / 100, n('vignette_midpoint') / 100, n('vignette_roundness') / 100, n('vignette_feather') / 100], b: [width / height, 0, 0, 0] })
      plan.pass('copy', current, 'output')
      if (current === 'input') plan.scratch.length = 0
      break
    }
    case 'gaussian_blur': {
      const sigma = number(params, 'strength') / 100 * 0.06 * H / 2
      const dimensions = params.dimensions
      plan.gaussian('input', 'output', dimensions === 'vertical' ? 0 : sigma, dimensions === 'horizontal' ? 0 : sigma, params.repeat_edges !== false)
      break
    }
    case 'directional_blur': {
      const length = number(params, 'length') / 100 * 0.1 * H
      if (length < 1) { plan.pass('copy', 'input', 'output'); break }
      const angle = number(params, 'direction') * Math.PI / 180
      plan.line('input', 'output', Math.cos(angle) * length, Math.sin(angle) * length)
      break
    }
    case 'zoom_blur': {
      const range = number(params, 'strength') / 100 * 0.2
      if (range * H < 1) { plan.pass('copy', 'input', 'output'); break }
      const center: Vec4 = [number(params, 'center_x') / 100, number(params, 'center_y') / 100, 0, 0]
      const middle = plan.alloc()
      plan.pass('zoom', 'input', middle, [center[0], center[1], range / LINE_TAPS, LINE_TAPS])
      plan.pass('zoom', middle, 'output', [center[0], center[1], range / LINE_TAPS ** 2, LINE_TAPS])
      break
    }
    case 'sharpen': {
      const blurred = plan.alloc()
      const sigma = Math.max(0.6, 0.0015 * H)
      plan.gaussian('input', blurred, sigma, sigma, true)
      plan.pass('unsharp', blurred, 'output', [number(params, 'amount') / 100 * 3, 0, 0, 0], ZERO, 'input')
      break
    }
    case 'brightness_contrast': {
      const contrast = number(params, 'contrast') / 100
      plan.pass('brightness_contrast', 'input', 'output', [number(params, 'brightness') / 100 * 0.5, contrast >= 0 ? 1 + contrast * 2 : 1 + contrast, 0, 0])
      break
    }
    case 'exposure': { const gain = 2 ** number(params, 'exposure'); plan.pass('gain_linear', 'input', 'output', [gain, gain, gain, 0]); break }
    case 'white_balance': {
      const temperature = number(params, 'temperature') / 100; const tint = number(params, 'tint') / 100
      const gains = [1 + 0.3 * temperature, 1 - 0.25 * tint, 1 - 0.3 * temperature]
      const luma = gains[0] * 0.2126 + gains[1] * 0.7152 + gains[2] * 0.0722
      plan.pass('gain_linear', 'input', 'output', [gains[0] / luma, gains[1] / luma, gains[2] / luma, 0])
      break
    }
    case 'hue_saturation': {
      const hue = number(params, 'hue') * Math.PI / 180
      plan.pass('hue_saturation', 'input', 'output', [Math.cos(hue), Math.sin(hue), 1 + number(params, 'saturation') / 100, number(params, 'lightness') / 100])
      break
    }
    case 'black_white': plan.pass('hue_saturation', 'input', 'output', [1, 0, 0, 0]); break
    case 'invert': plan.pass('invert', 'input', 'output'); break
    case 'mosaic': {
      const block = number(params, 'block_size') / 100 * 0.1 * H
      if (block < 1) { plan.pass('copy', 'input', 'output'); break }
      plan.pass('mosaic', 'input', 'output', [block / width, block / height, 0, 0])
      break
    }
    case 'vignette': plan.pass('vignette', 'input', 'output', [number(params, 'amount') / 100, 0.15 + number(params, 'midpoint') / 100 * 0.8, 0.05 + number(params, 'feather') / 100 * 0.9, width / height]); break
    case 'film_grain': {
      // Grain cannot be finer than a pixel. At a reduced resolution each drawn pixel stands for several sequence pixels
      // whose grain would average out, so the amplitude falls with the number of independent grain units it covers
      // (a unit is one grain cell, at least one sequence pixel). At full resolution the factor is 1.
      const cell = (0.0005 + number(params, 'size') / 100 * 0.0035) * H; const scale = Math.min(1, Math.max(1e-3, frame.renderScale ?? 1))
      const visible = Math.min(1, scale * Math.max(1, cell / scale))
      plan.pass('grain', 'input', 'output', [number(params, 'amount') / 100 * 0.25 * visible, cell, videoEditGrainSeed(frame.frame), params.monochrome === false ? 0 : 1]); break
    }
    case 'chromatic_aberration': {
      const offset = number(params, 'amount') / 100 * 0.02 * H; const radial = params.mode !== 'directional'
      const angle = number(params, 'direction') * Math.PI / 180
      plan.pass('chromatic', 'input', 'output', radial ? [offset / width, offset / height, 1, 0] : [Math.cos(angle) * offset / width, Math.sin(angle) * offset / height, 0, 0])
      break
    }
    case 'glow': {
      const bright = plan.alloc(); const blurred = plan.alloc()
      const threshold = number(params, 'threshold') / 100
      plan.pass('glow_extract', 'input', bright, [threshold * 0.9, 0.1, 0, 0])
      const sigma = (0.005 + number(params, 'radius') / 100 * 0.075) * H / 2
      plan.gaussian(bright, blurred, sigma, sigma, true)
      plan.pass('glow_add', blurred, 'output', [number(params, 'intensity') / 100 * 2, 0, 0, 0], ZERO, 'input')
      break
    }
    case 'crop': {
      const feather = Math.max(1, number(params, 'feather') / 100 * 0.05 * H)
      plan.pass('crop', 'input', 'output', [number(params, 'left') / 100, number(params, 'top') / 100, 1 - number(params, 'right') / 100, 1 - number(params, 'bottom') / 100], [feather / width, feather / height, 0, 0])
      break
    }
    case 'flip': plan.pass('flip', 'input', 'output', [params.axis !== 'vertical' ? 1 : 0, params.axis !== 'horizontal' ? 1 : 0, 0, 0]); break
    case 'chroma_key': {
      const [r, g, b] = hexColor(String(params.key_color)); const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
      plan.pass('chroma_key', 'input', 'output', [(b - y) / 1.8556, (r - y) / 1.5748, 0.02 + number(params, 'tolerance') / 100 * 0.3, 0.002 + number(params, 'softness') / 100 * 0.2], [number(params, 'spill') / 100, 0, 0, 0])
      break
    }
    default: throw new Error(`内置效果“${instance.id}”没有渲染实现。`)
  }
  return { width, height, scratch: plan.scratch, passes: plan.passes }
}

const DIAGONAL = Math.SQRT1_2
/** 方向选项 → 运动方向（像素空间单位向量，y 向下）：`from_left` 从左侧开始、向右运动。 */
const DIRECTIONS: Record<string, readonly [number, number]> = {
  from_left: [1, 0], from_right: [-1, 0], from_top: [0, 1], from_bottom: [0, -1],
  from_top_left: [DIAGONAL, DIAGONAL], from_top_right: [-DIAGONAL, DIAGONAL], from_bottom_left: [DIAGONAL, -DIAGONAL], from_bottom_right: [-DIAGONAL, -DIAGONAL],
}
const ease = (t: number): number => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x) }
/** 在 [from, to] 区间内平滑地从 0 升到 1。 */
const window01 = (t: number, from: number, to: number): number => ease((t - from) / (to - from))

/**
 * 带参数的视频过渡（任务 4.7）翻译成工序：`input` 是前一段、`second` 是后一段，单侧过渡空着的一侧在着色器里按透明处理。
 * 空间量（羽化、边框、模糊）与内置效果一样按画面高度换算；进度、缓动与中点权重都在这里算好，着色器只做取样与混合。
 */
export function planVideoEditBuiltinTransition(input: VideoEditBuiltinTransitionInput, frame: { width: number; height: number }): VideoEditBuiltinPlan {
  const { width, height } = frame
  if (![width, height].every(value => Number.isInteger(value) && value >= 1)) throw new Error('过渡需要有效的画面尺寸。')
  if (!Number.isFinite(input.progress) || input.progress < 0 || input.progress > 1) throw new Error('过渡进度必须在 0 到 1 之间。')
  const shader = planShaderLibraryTransition(input, width, height)
  if (shader) return shader
  const plan = new Planner(width, height); const params = input.params; const H = height; const t = input.progress
  const empty = (mode = 0): Vec4 => [t, input.emptyOutgoing ? 1 : 0, input.emptyIncoming ? 1 : 0, mode]
  const direction = (): readonly [number, number] => DIRECTIONS[String(params.direction)] ?? DIRECTIONS.from_left
  const edge = (): [number, number] => [number(params, 'feather') / 100 * 0.2 * H, number(params, 'border') / 100 * 0.03 * H]
  switch (input.kind) {
    case 'wipe': {
      const [dx, dy] = direction(); const [feather, border] = edge()
      plan.pass('tr_wipe', 'input', 'output', [dx, dy, feather, border], [...hexColor(String(params.border_color)), 0], 'second', empty())
      break
    }
    case 'iris_round': {
      const [feather, border] = edge()
      plan.pass('tr_iris', 'input', 'output', [number(params, 'center_x') / 100, number(params, 'center_y') / 100, feather, border], [...hexColor(String(params.border_color)), 0], 'second', empty(params.mode === 'close' ? 1 : 0))
      break
    }
    case 'push': case 'slide': {
      const [dx, dy] = direction()
      // 单侧滑动的出点：后面是空白，前一段自己滑出画面（否则它一直盖着不动，看不出过渡）。
      const carry = input.kind === 'push' || input.emptyIncoming
      plan.pass('tr_move', 'input', 'output', [dx, dy, params.smooth === false ? t : ease(t), carry ? 1 : 0], ZERO, 'second', empty())
      break
    }
    case 'cross_zoom': {
      const zoom = number(params, 'zoom') / 100 * 2; const e = ease(t)
      const spread = number(params, 'blur') / 100 * 0.6 * zoom * 4 * e * (1 - e)
      plan.pass('tr_zoom', 'input', 'output', [number(params, 'center_x') / 100, number(params, 'center_y') / 100, 1 + zoom * e, 1 + zoom * (1 - e)], [spread, window01(t, 0.35, 0.65), 0, 0], 'second', empty())
      break
    }
    case 'blur_dissolve': {
      // 两段各自按当前模糊度做高斯（与“高斯模糊”同一换算），中点最模糊，再在中段溶过去。
      const sigma = number(params, 'blur') / 100 * 0.06 * H / 2 * Math.sin(Math.PI * t)
      const outgoing = input.emptyOutgoing ? 'input' : plan.alloc(); const incoming = input.emptyIncoming ? 'second' : plan.alloc()
      if (!input.emptyOutgoing) plan.gaussian('input', outgoing, sigma, sigma, true)
      if (!input.emptyIncoming) plan.gaussian('second', incoming, sigma, sigma, true)
      plan.pass('tr_mix', outgoing, 'output', [window01(t, 0.3, 0.7), 0, 0, 0], ZERO, incoming, empty())
      break
    }
    case 'flash': {
      // 闪光集中在切点附近（高斯形），进度 0 与 1 时为零；画面在闪光最亮时换过去。
      const bell = (x: number): number => Math.exp(-(((x - 0.5) / 0.15) ** 2)); const floor = bell(0)
      const amount = number(params, 'intensity') / 100 * Math.max(0, (bell(t) - floor) / (1 - floor))
      plan.pass('tr_flash', 'input', 'output', [...hexColor(String(params.color)), amount], [window01(t, 0.4, 0.6), 0, 0, 0], 'second', empty())
      break
    }
    default: throw new Error(`过渡“${String(input.kind)}”没有渲染实现。`)
  }
  return { width, height, scratch: plan.scratch, passes: plan.passes }
}
