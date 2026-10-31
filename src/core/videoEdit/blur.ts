/**
 * 模糊：一个效果四种方式（均匀、方向、放射、镜头），同一个“模糊度”在四种方式下糊的程度相近。
 * 实现在剪辑内置效果着色器（`features/videoEdit/engine/blur.ts`），预览与导出同一路径。
 *
 * 模糊度先换成“相当于多大的高斯标准差”（画面高度的比例），各方式再按自己的形状换算：
 * 方向是等权直线，长度 √12·σ 时方差与高斯相同；放射在离中心半个画面高处拉出同样长的线；
 * 镜头是均匀圆盘，半径 2σ 时方差与高斯相同。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { gaussianSupport, type LayerEffectReference } from './layerEffectGeometry'

export type BlurMode = 'uniform' | 'directional' | 'radial' | 'lens'
/** 放射模糊的缩放取样不能越过中心，再往上画面已经全糊。 */
const RADIAL_LIMIT = 0.8
const SQRT12 = Math.sqrt(12)
/**
 * 模糊度能输入的上限：标准差约 100 个画面高，旧高斯模糊再大的标准差画面也只是整幅平均色，换算过来都落在这里以内。
 * 常用只到 100（滑块范围）。
 */
export const BLUR_AMOUNT_MAX = 450

/**
 * 模糊度 → 高斯标准差（画面高度的比例）。指数曲线让滑块每一段的观感变化差不多：
 * 10 约 0.16%（轻微柔化），40 约 0.9%（背景虚化），100 约 5%，200 约 48%，450 约 100 个画面高。
 */
export function blurSigma(amount: number): number { return 0.0066 * Math.expm1(2.15 * Math.max(0, amount) / 100) }
/** `blurSigma` 的反函数（宿主把 pose.blur 的像素半径报成效果参数时用）。 */
export function blurAmountForSigma(sigma: number): number { return Math.log1p(Math.max(0, sigma) / 0.0066) / 2.15 * 100 }
/** 方向模糊的直线长度（画面高度的比例）。 */
export function blurLineLength(amount: number): number { return SQRT12 * blurSigma(amount) }
/** 放射模糊的最大缩放量：离中心 d 的像素向中心拉出约 d·k 长的线。 */
export function blurZoomRange(amount: number): number { return Math.min(RADIAL_LIMIT, 2 * SQRT12 * blurSigma(amount)) }
/** 镜头模糊的圆盘半径（画面高度的比例）。 */
export function blurLensRadius(amount: number): number { return 2 * blurSigma(amount) }

const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)

// 旧参数的负数本来就不合法，换算后仍留负数，让校验照样报错。
const rounded = (sigma: number): number => sigma < 0 ? sigma : Math.round(blurAmountForSigma(sigma) * 100) / 100
const numeric = (convert: (value: number) => number) => (value: unknown): unknown => typeof value === 'number' && Number.isFinite(value) ? convert(value) : value
const same = (value: unknown): unknown => value
/**
 * 并进“模糊”的旧效果：方式、旧默认值，以及每个旧参数换成哪个新参数、数值怎么换。换算只写这一份，
 * 存档迁移与旧版作者库（henji-effects 1.0.0 的 blur() 产出旧 ID）运行时共用；第三项为 true 的换算不是线性的。
 * 换算不截断：超出模糊度上限的旧值照样换算，使用时按上限钳制。
 */
export const RETIRED_BLUR_EFFECTS: Readonly<Record<string, { mode: BlurMode; defaults: Readonly<Record<string, unknown>>; keys: Readonly<Record<string, readonly [string, (value: unknown) => unknown, boolean?]>> }>> = {
  gaussian_blur: {
    mode: 'uniform', defaults: { sigma_fraction_height: 0.009, axis: 'both', edge_mode: 'clamp' },
    keys: { sigma_fraction_height: ['amount', numeric(rounded), true], axis: ['axis', same], edge_mode: ['repeat_edges', value => value !== 'transparent'] },
  },
  // 旧长度 100 为画面高度的 10%；新模糊度按直线长度 √12·σ 换算。
  directional_blur: {
    mode: 'directional', defaults: { direction: 0, length: 30 },
    keys: { direction: ['angle', same], length: ['amount', numeric(length => rounded(length / 100 * 0.1 / SQRT12)), true] },
  },
  // 旧强度 100 为 20% 的缩放拖影；新模糊度按缩放量 2√12·σ 换算。
  zoom_blur: {
    mode: 'radial', defaults: { strength: 30, center_x: 50, center_y: 50 },
    keys: { strength: ['amount', numeric(strength => rounded(strength / 100 * 0.2 / (2 * SQRT12))), true], center_x: ['center_x', same], center_y: ['center_y', same] },
  },
  // 旧镜头模糊直接给圆盘半径（画面高度的比例），新圆盘半径是 2σ；旧着色器的亮点加权就是新的默认 50，画面外按重复边缘取样。
  lens_blur: {
    mode: 'lens', defaults: { radius_fraction_height: 0.009 },
    keys: { radius_fraction_height: ['amount', numeric(radius => rounded(radius / 2)), true] },
  },
}
/** 旧模糊效果的静态参数换成“模糊”的参数；不是并进模糊的旧效果返回 undefined。 */
export function retiredBlurParams(id: string, params: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  const rule = RETIRED_BLUR_EFFECTS[id]
  if (!rule) return undefined
  const result: Record<string, unknown> = { mode: rule.mode }
  for (const [key, [target, convert]] of Object.entries(rule.keys)) result[target] = convert(key in params ? params[key] : rule.defaults[key])
  return result
}

/** 外扩边距（逻辑画面高度的比例），保守取每种方式取样能到的最远处。 */
export function blurBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference): number {
  const h = ref.referenceSize.height * ref.rasterScale
  const w = Math.ceil(ref.contentBounds.width * ref.rasterScale), bh = Math.ceil(ref.contentBounds.height * ref.rasterScale)
  // 与渲染一样按上限钳制模糊度。拖影、圆盘、高斯尾巴伸出图层超过一个画面对角线时，那里只剩极淡的一层，
  // 三种方式的外扩都封顶在一个画面对角线，避免很大的模糊把图层纹理撑到设备上限。
  const amount = Math.min(BLUR_AMOUNT_MAX, Math.max(0, n(params, 'amount')))
  const cap = Math.hypot(ref.referenceSize.width, ref.referenceSize.height) / ref.referenceSize.height
  switch (params.mode) {
    // 各道半宽依次是 15/32、15/512……，合计不超过直线长度的 1/2。
    case 'directional': return Math.min(cap, blurLineLength(amount) / 2) + 2 / h
    // 反向采样的最远边界为 distance * k / (1 - k)，而非 distance * k。
    case 'radial': {
      const k = blurZoomRange(amount)
      if (k * h < 1) return 0
      const distance = Math.max(w * Math.max(n(params, 'center_x') / 100, 1 - n(params, 'center_x') / 100), bh * Math.max(n(params, 'center_y') / 100, 1 - n(params, 'center_y') / 100))
      return (distance * k / (1 - k) + 2) / h
    }
    case 'lens': return Math.min(cap, blurLensRadius(amount) * 1.5) + 2 / h
    default: return Math.min(cap * h, gaussianSupport(blurSigma(amount) * h, w, bh, ref.quality)) / h
  }
}

const DESCRIPTION = '让画面变糊。均匀用来柔化、做背景虚化或遮住细节；方向沿一个方向拉出拖影，表现速度；放射从中心向四周拉丝，表现冲刺和聚焦；镜头像相机失焦，亮点散成圆形光斑。'
const { amount, choice, angle, percent, toggle } = effectParam
const only = (mode: BlurMode) => ({ visibleWhen: { param: 'mode', in: [mode] } })

export const BLUR_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  precision: (_params, plan) => plan.passes.some(pass => pass.entry !== 'copy'),
  space: 'layer', author: { factory: 'blur' }, bleed: blurBleed, id: 'blur', name: '模糊', group: 'blur', description: DESCRIPTION,
  aliases: ['高斯模糊', '方向模糊', '运动模糊', '缩放模糊', '径向模糊', '镜头模糊', '镜头虚化', '虚化', '柔化', 'gaussian blur', 'directional blur', 'motion blur', 'zoom blur', 'radial blur', 'lens blur', 'bokeh'],
  params: [
    amount('amount', 40, { name: '模糊度', text: '画面糊得多厉害。0 不模糊；10 轻微柔化；40（默认）背景虚化，约为画面高度的 1%；70 只剩大块颜色。四种方式下同一个数值糊的程度相近，可以输入更大的值。' }, BLUR_AMOUNT_MAX),
    choice('mode', 'uniform', [{ value: 'uniform', label: '均匀' }, { value: 'directional', label: '方向' }, { value: 'radial', label: '放射' }, { value: 'lens', label: '镜头' }], { name: '方式', text: '均匀（默认）整体柔化；方向沿一个角度拉出拖影；放射从中心向四周拉丝；镜头像失焦，亮点散成圆形光斑。' }),
    { ...choice('axis', 'both', [{ value: 'both', label: '水平和垂直' }, { value: 'horizontal', label: '水平' }, { value: 'vertical', label: '垂直' }], { name: '模糊方向', text: '只往哪个方向糊。水平和垂直（默认）各方向一样；只选水平或垂直时，另一个方向保持清楚。' }), ...only('uniform') },
    { ...angle('angle', 0, { name: '角度', text: '拖影的方向。0（默认）左右拉，90 上下拉，45 斜着拉。' }), ...only('directional') },
    { ...percent('center_x', 50, 0, { name: '中心（水平）', text: '放射的中心。默认在画面正中；挪到主体上，主体保持清楚、四周向外拉丝。' }), ...only('radial') },
    { ...percent('center_y', 50, 0, { name: '中心（垂直）', text: '放射中心的上下位置，0 在顶边，100 在底边。' }), ...only('radial') },
    { ...amount('highlights', 50, { name: '亮点加亮', text: '亮点散开后有多亮。0 亮点和其他地方一样被抹平；50（默认）亮点散成明显的圆形光斑；100 光斑更亮更醒目。' }), ...only('lens') },
    toggle('repeat_edges', true, { name: '重复边缘像素', text: '画面边缘外面当作什么来糊。打开（默认）沿用边缘的颜色，整幅画面的四边不会发黑变透明；关闭时外面当作透明，给文字、图形加模糊时边缘自然淡出。' }),
  ],
}
