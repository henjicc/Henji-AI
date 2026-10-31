import { Planner, ZERO, type Vec4, type VideoEditBuiltinPlan } from './effectPlan'
export type { VideoEditBuiltinTexture, VideoEditBuiltinPass, VideoEditBuiltinPlan } from './effectPlan'
export { videoEditGrainSeed } from './basicEffectPlanners'
import { VIDEO_EDIT_EFFECT_PLANNER_BY_ID } from './effectPlanners'
import type { EffectPlannerInput, EffectPlannerFrame } from './effectPlanner'
import { resolveVideoEditBuiltinParams, type VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinTransitionInput } from '@/core/videoEdit/transitions'
import { planLensBlur, planUniformBlur } from './blur'
import { planDissolveReveal } from './dissolveReveal'
import { DISSOLVE_REVEAL_EFFECT_DEFINITION } from '@/core/videoEdit/dissolveReveal'
import { DISSOLVE_TRANSITION_PATTERNS, isDissolveTransitionSource } from '@/core/videoEdit/transitionSources'
import { GAUSSIAN_EFFECT, type GaussianParameters, type ResolvedGaussianPlan } from '@/core/imaging/effects/gaussian'
import type { EffectEvaluationContext } from '@/core/imaging/effects/descriptor'

const number = (params: VideoEditBuiltinParams, key: string): number => params[key] as number
function hexColor(value: string): [number, number, number] { return [1, 3, 5].map(index => parseInt(value.slice(index, index + 2), 16) / 255) as [number, number, number] }
export function resolveVideoGaussianPlan(parameters: GaussianParameters, context: EffectEvaluationContext): ResolvedGaussianPlan { return GAUSSIAN_EFFECT.resolve(parameters, context) }
export function planVideoEditBuiltinEffect(instance: EffectPlannerInput, frame: EffectPlannerFrame): VideoEditBuiltinPlan {
  if (![frame.width, frame.height].every(value => Number.isInteger(value) && value >= 1)) throw new Error('内置效果需要有效的画面尺寸。')
  const planner = VIDEO_EDIT_EFFECT_PLANNER_BY_ID.get(instance.id)
  if (!planner) throw new Error(`内置效果“${instance.id}”没有渲染实现。`)
  return planner.plan(resolveVideoEditBuiltinParams(instance), frame, instance)
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
  if (isDissolveTransitionSource(input.kind)) {
    const params = { ...Object.fromEntries(DISSOLVE_REVEAL_EFFECT_DEFINITION.params.map(param => [param.key, param.default])), ...input.params, mode: DISSOLVE_TRANSITION_PATTERNS[input.kind], progress: input.progress * 100 }
    return planDissolveReveal(params, width, height, undefined, false, input)
  }
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

/** pose.blur 使用编码预乘颜色，模糊效果的均匀方式仍在线性光处理。`radius` 是高斯标准差或镜头圆盘半径（像素）。 */
export function planAuthorDefocus(width: number, height: number, radius: number, lens: boolean, preserveZeroAlpha = false): VideoEditBuiltinPlan {
  // 亮点加权取模糊效果的默认值，pose.blur 的镜头散焦与“模糊”效果的镜头方式观感一致。
  if (lens) return planLensBlur(radius, 50, false, width, height)
  const plan = planUniformBlur(radius / height, 'both', false, width, height, { frame: 0, quality: 'final' })
  // 光纹理的 RGB 独立于覆盖率；只有此输入允许在零 alpha 下参与共用高斯核。
  for (const pass of plan.passes) {
    if (pass.entry === 'gaussian_linear' || pass.entry === 'gaussian_encoded') pass.entry = 'gaussian_copy'
    if (pass.entry === 'gaussian_blur' || pass.entry === 'gaussian_resample') pass.uniforms[11] = preserveZeroAlpha ? 1 : 0
  }
  return plan
}
