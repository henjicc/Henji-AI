/**
 * 模糊：一个效果五种方式（均匀、方向、放射、旋转、镜头），同一个“模糊度”在各方式下糊的程度相近。
 * 实现在剪辑内置效果着色器（`features/videoEdit/engine/blur.ts`），预览与导出同一路径。
 *
 * 模糊度先换成“相当于多大的高斯标准差”（画面高度的比例），各方式再按自己的形状换算：
 * 方向是等权直线，长度 √12·σ 时方差与高斯相同；放射在离中心半个画面高处拉出同样长的线；
 * 镜头是均匀圆盘，半径 2σ 时方差与高斯相同。旋转没有统一的长度（离中心越远弧越长），按转过的角度算。
 * 均匀与镜头可以只糊一部分（“范围”）：渐进与移轴按位置逐处改变模糊量，最糊处的模糊度与整幅相同。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParams } from './builtinEffects'
import { effectParam } from './effectIncludes'
import { gaussianSupport, type LayerEffectReference } from './layerEffectGeometry'

export type BlurMode = 'uniform' | 'directional' | 'radial' | 'spin' | 'lens'
type BlurRange = 'full' | 'progressive' | 'tilt'
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
/**
 * 范围金字塔第 `level` 层（边长减半 `level` 次）放大回全分辨率后的等效高斯标准差（像素）。
 * 13 点降采样每次在上一层纹素里加方差 7/4，B 样条放大每次在粗一层纹素里加 1/3；逐层累加得 (37/36)(4^level − 1)。
 */
export function blurRangeLevelSigma(level: number): number { return Math.sqrt(37 / 36 * (4 ** level - 1)) }
/** 范围（均匀）最糊处标准差为 `sigma`（像素）时实际用到的最粗一层的标准差：层数加到第一次盖住 `sigma` 为止。 */
export function blurRangeCoarsestSigma(sigma: number): number { let level = 1; while (blurRangeLevelSigma(level) < sigma) level++; return blurRangeLevelSigma(level) }
/** 旋转模糊转过的总角度（弧度）：每 1 模糊度 0.45°，40 约 18°，100 约 45°。 */
export function blurSpinAngle(amount: number): number { return Math.max(0, amount) * 0.45 * Math.PI / 180 }

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
    case 'spin': return blurSpinBleed(blurSpinAngle(amount) / 2, w, bh, n(params, 'center_x') / 100, n(params, 'center_y') / 100) / h
    case 'lens': return Math.min(cap, blurLensRadius(amount) * 1.5) + 2 / h
    default: {
      const sigma = blurSigma(amount) * h
      // 范围最糊处是相邻两层的混合，粗的那层标准差可到目标的约两倍，尾巴比同样标准差的高斯重；外扩按实际用到的最粗一层算。
      const ranged = (params.range === 'progressive' || params.range === 'tilt') && sigma > 0
      return Math.min(cap * h, gaussianSupport(ranged ? blurRangeCoarsestSigma(sigma) : sigma, w, bh, ref.quality)) / h
    }
  }
}

/**
 * 旋转的外扩（像素）：内容四角绕中心各转 ±half 扫出的圆弧超出内容框多远。各道转过的角度合计不超过 ±half。
 * 圆弧的最左、最右、最上、最下处在端点或正好经过水平、竖直方向的地方。
 */
function blurSpinBleed(half: number, width: number, height: number, cx: number, cy: number): number {
  const center = [cx * width, cy * height]
  if (half * Math.hypot(width, height) < 0.5) return 0
  let over = 0
  for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]]) {
    const r = Math.hypot(x - center[0], y - center[1]), start = Math.atan2(y - center[1], x - center[0])
    const turns = [start - half, start + half]
    for (let quarter = -4; quarter <= 4; quarter++) if (Math.abs(quarter * Math.PI / 2 - start) < half) turns.push(quarter * Math.PI / 2)
    for (const angle of turns) {
      const px = center[0] + r * Math.cos(angle), py = center[1] + r * Math.sin(angle)
      over = Math.max(over, -px, px - width, -py, py - height)
    }
  }
  return over + 2
}

const DESCRIPTION = '让画面变糊。均匀用来柔化、做背景虚化或遮住细节；方向沿一个方向拉出拖影，表现速度；放射从中心向四周拉丝，表现冲刺和聚焦；旋转绕中心转着糊开，像转盘、车轮；镜头像相机失焦，亮点散成圆形光斑。均匀和镜头可以用“范围”只糊一部分：渐进越往一边越糊，移轴只留一条清楚的带，像微缩模型。'
const { amount, choice, angle, percent, toggle } = effectParam
const only = (...modes: BlurMode[]) => ({ visibleWhen: { param: 'mode', in: modes } })
const RANGE_MODES = { param: 'mode', in: ['uniform', 'lens'] }
const ranged = (range: { equals: BlurRange } | { notEquals: BlurRange }) => ({ visibleWhen: { all: [RANGE_MODES, { param: 'range', ...range }] } })
/** 位置可以放到内容外面（渐进从画面外开始变糊），滑块只走 0–100%。 */
const position = (key: string, name: string, text: string) => ({ ...percent(key, 50, 0, { group: '范围', name, text }), min: -100, max: 200, softMin: 0, softMax: 100, ...ranged({ notEquals: 'full' }) })

export const BLUR_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  precision: (_params, plan) => plan.passes.some(pass => pass.entry !== 'copy'),
  space: 'layer', author: { factory: 'blur' }, bleed: blurBleed, id: 'blur', name: '模糊', group: 'blur', description: DESCRIPTION,
  aliases: ['高斯模糊', '方向模糊', '运动模糊', '缩放模糊', '径向模糊', '旋转模糊', '镜头模糊', '镜头虚化', '虚化', '柔化', '移轴', '微缩模型', '渐进模糊', 'gaussian blur', 'directional blur', 'motion blur', 'zoom blur', 'radial blur', 'spin blur', 'lens blur', 'bokeh', 'tilt shift', 'progressive blur'],
  params: [
    amount('amount', 40, { name: '模糊度', text: '画面糊得多厉害。0 不模糊；10 轻微柔化；40（默认）背景虚化，约为画面高度的 1%；70 只剩大块颜色。各方式下糊的程度相近；旋转按转过的角度算，40 约 18°，100 约 45°。可以输入更大的值。' }, BLUR_AMOUNT_MAX),
    choice('mode', 'uniform', [{ value: 'uniform', label: '均匀' }, { value: 'directional', label: '方向' }, { value: 'radial', label: '放射' }, { value: 'spin', label: '旋转' }, { value: 'lens', label: '镜头' }], { name: '方式', text: '均匀（默认）整体柔化；方向沿一个角度拉出拖影；放射从中心向四周拉丝；旋转让画面绕中心转着糊开，像转盘、车轮；镜头像失焦，亮点散成圆形光斑。' }),
    // 范围不是整幅时按位置逐处改变模糊量，两个方向一起糊，单方向不起作用。
    { ...choice('axis', 'both', [{ value: 'both', label: '水平和垂直' }, { value: 'horizontal', label: '水平' }, { value: 'vertical', label: '垂直' }], { name: '模糊方向', text: '只往哪个方向糊。水平和垂直（默认）各方向一样；只选水平或垂直时，另一个方向保持清楚。' }), visibleWhen: { all: [{ param: 'mode', in: ['uniform'] }, { param: 'range', equals: 'full' }] } },
    { ...angle('angle', 0, { name: '角度', text: '拖影的方向。0（默认）左右拉，90 上下拉，45 斜着拉。' }), ...only('directional') },
    { ...percent('center_x', 50, 0, { group: '中心', name: '水平', text: '放射、旋转的中心。默认在画面正中；挪到主体上，主体保持清楚，四周向外拉丝或绕着它转。' }), ...only('radial', 'spin') },
    { ...percent('center_y', 50, 0, { group: '中心', name: '垂直', text: '中心的上下位置，0 在顶边，100 在底边。' }), ...only('radial', 'spin') },
    { ...amount('highlights', 50, { name: '亮点加亮', text: '亮点散开后有多亮。0 亮点和其他地方一样被抹平；50（默认）亮点散成明显的圆形光斑；100 光斑更亮更醒目。' }), ...only('lens') },
    toggle('repeat_edges', true, { name: '重复边缘像素', text: '画面边缘外面当作什么来糊。打开（默认）沿用边缘的颜色，整幅画面的四边不会发黑变透明；关闭时外面当作透明，给文字、图形加模糊时边缘自然淡出。' }),
    { ...choice('range', 'full', [{ value: 'full', label: '整幅' }, { value: 'progressive', label: '渐进' }, { value: 'tilt', label: '移轴' }], { group: '范围', name: '范围', text: '哪里糊、哪里清楚。整幅（默认）处处一样；渐进从“位置”开始沿“角度”越来越糊；移轴只留一条清楚的带，两边渐糊，像微缩模型。' }), visibleWhen: RANGE_MODES },
    position('range_x', '位置（水平）', '渐进从哪里开始变糊，移轴清楚带的中心。50%、50%（默认）在正中；可以输入画面外的值。'),
    position('range_y', '位置（垂直）', '位置的上下，0% 在顶边，100% 在底边。'),
    { ...angle('range_angle', 90, { group: '范围', name: '角度', text: '越来越糊的方向。90°（默认）渐进往下加重、移轴是一条水平带；0° 往右加重、带是竖的。' }), ...ranged({ notEquals: 'full' }) },
    { ...percent('range_width', 30, 0, { group: '范围', name: '清晰范围', text: '移轴时清楚的带有多宽。30%（默认）约画面高度的三成；10% 只剩一窄条，微缩感最强。' }), ...ranged({ equals: 'tilt' }) },
    { ...percent('range_falloff', 40, 0, { group: '范围', name: '过渡', text: '从清楚到最糊经过多远。40%（默认）柔和；10% 很快糊到底；100% 拉满整个画面慢慢变。' }), ...ranged({ notEquals: 'full' }) },
  ],
}
