/**
 * 变形：镜像、重复阵列、膨胀、旋转扭曲、波动、边角定位、置换。实现在 `features/videoEdit/engine/warp.ts`。
 *
 * 七个效果共用一族取样工序：每个像素算出要从内容的哪里取色，双线性取样；缩得很小或跨过断口时自动多点取样。
 * 中心、角点按内容框的百分比，半径、幅度按画面高度换算，图层移动时变形跟着内容走。
 * 外扩按内容被推出原边界的最远处算：变形后伸出内容框的部分不会被图层纹理切掉。
 */
import type { VideoEditBuiltinEffectDefinition, VideoEditBuiltinParam, VideoEditBuiltinParams, VideoEditBuiltinUnit } from './builtinEffects'
import { effectParam, type EffectParamText } from './effectIncludes'
import { dropShadowOffset } from './dropShadow'
import { dissolveCellSize } from './dissolveReveal'
import type { LayerEffectReference } from './layerEffectGeometry'
import { isVideoEditTrackQuad, videoEditCornerPinMatrix, videoEditTrackProject } from './trackProjection'

const { amount, signed, percent, angle, choice, toggle } = effectParam
const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)

/** 距离尺（与投影的距离同一把）：幅度 → 画面高度的比例，20 约 1%，100 约 5%。 */
export const warpDistance = dropShadowOffset
/** 波长 → 画面高度的比例：0 约 1%，40 约 6%，100 约一个画面高。 */
export function waveLength(value: number): number { return 0.01 * 10 ** (Math.max(0, value) / 50) }
/** 置换噪声的起伏尺寸：格子尺（与溶解显影的大小同一把）放大六倍，50 约为画面高度的 8%。 */
export function displaceNoiseSize(value: number): number { return 6 * dissolveCellSize(value) }
/**
 * 流动方式的位移最远是幅度的几倍。旋度按单形噪声的平均坡度（约 2.9）归一，平均位移就是幅度；
 * 最陡处坡度约 7.4，所以单层最远约 2.6 倍，细节层再叠加细节的一半。
 */
export function waveFlowReach(detail: number): number { return 2.6 * (1 + Math.max(0, detail) / 200) }

interface NumberRange { unit: VideoEditBuiltinUnit; min: number; max: number; softMin?: number; softMax?: number }
const num = (key: string, value: number, range: NumberRange, words: EffectParamText, animatable = true): VideoEditBuiltinParam => ({ key, type: 'number', step: 1, ...range, default: value, animatable, name: words.name, description: words.text, ...(words.group ? { group: words.group } : {}) })
const PERCENT_400: NumberRange = { unit: 'percent', min: 0, max: 400, softMin: 0, softMax: 100 }
/** 速度不做动画：片段时钟乘速度就是相位，速度一变，已经走过的相位也跟着变，波会来回跳。 */
const SPEED: NumberRange = { unit: 'percent', min: -400, max: 400, softMin: -100, softMax: 100 }
const ints = (key: string, value: number, min: number, softMax: number, max: number, words: EffectParamText): VideoEditBuiltinParam => ({ key, type: 'number', unit: 'value', min, max, softMin: min, softMax, step: 1, default: value, animatable: true, name: words.name, description: words.text, ...(words.group ? { group: words.group } : {}) })
const seed = (group: string, words: string): VideoEditBuiltinParam => ({ key: 'seed', type: 'number', unit: 'value', min: 0, max: 9999, step: 1, default: 0, animatable: false, group, name: '随机种子', description: words })
/** 中心按内容框的百分比：软范围是内容以内，可以输入到内容外面一个内容的距离。 */
const center = (axis: 'x' | 'y', text: string): VideoEditBuiltinParam => ({ key: `center_${axis}`, type: 'number', unit: 'percent', min: -100, max: 200, softMin: 0, softMax: 100, step: 1, default: 50, animatable: true, name: axis === 'x' ? '中心（水平）' : '中心（垂直）', description: text })
const corner = (key: string, name: string, value: number, text: string): VideoEditBuiltinParam => ({ key, type: 'number', unit: 'percent', min: -1000, max: 1100, softMin: -50, softMax: 150, step: 1, default: value, animatable: true, name, description: text })
const only = (param: string, ...values: string[]) => ({ visibleWhen: { param, in: values } })
/**
 * 速度大于 0 时画面随时间在走，种子就是帧位置（代码图层慢放时带小数）；不动时（速度 0、幅度 0、置换按自身亮度）
 * 返回常量 0，输出复用与预渲染照常命中。规划按 effectClockSeconds(帧时长, 种子) 求秒数。
 */
export function warpFrameSeed(params: VideoEditBuiltinParams, frame: number): number {
  return n(params, 'speed') === 0 || n(params, 'amount') <= 0 || params.source === 'luma' ? 0 : frame
}
const EDGE_OPTIONS = [{ value: 'transparent', label: '透明' }, { value: 'clamp', label: '重复边缘' }, { value: 'mirror', label: '镜像' }]
/**
 * 边缘只用于整幅画面（片段、调整层）：那里内容框就是整张画面，默认重复边缘让四边不出空缺。
 * 代码图层的内容框贴着内容，框内框外按不同规则取样会把内容框的直边留在画面上，所以图层一律透明、不开放这个参数。
 */
const WHOLE_PICTURE = { spaces: ['clip', 'frame'] as const }
const EDGES = { ...choice('edges', 'clamp', EDGE_OPTIONS, { name: '边缘', text: '变形取到画面外面时怎么办。重复边缘（默认）把最外一圈像素拉长，四边不出空缺；透明露出下面的轨道；镜像把画面翻过来接上。代码图层上外面一律透明。' }), ...WHOLE_PICTURE }
/** 边角定位贴的是一块画面，四角以外默认透明才露得出屏幕、画框周围；拉长的边缘会铺满四周。 */
const CORNER_PIN_EDGES = { ...choice('edges', 'transparent', EDGE_OPTIONS, { name: '边缘', text: '四个角围成的范围以外怎么办。透明（默认）露出下面的轨道，贴屏幕、贴画框时用；重复边缘把最外一圈像素拉长；镜像把画面翻过来接上，铺成透视的地面。代码图层上外面一律透明。' }), ...WHOLE_PICTURE }

/** 图层纹理在逻辑画面上的换算：内容框（逻辑像素）、逻辑高度与纹理像素比、外扩封顶（一个画面对角线）。 */
/**
 * `prior` 是前面效果已经外扩的量（逻辑像素），传进来的内容框已含这一圈。这里还原真实内容框：规划按它定中心、角点，
 * 被变形的是“内容框外加这一圈”（前面效果留下的影子、光、模糊边）。
 */
function frameOf(ref: LayerEffectReference, prior = 0) {
  return { width: ref.contentBounds.width - 2 * prior, height: ref.contentBounds.height - 2 * prior, pad: prior, H: ref.referenceSize.height, guard: 2 / (ref.referenceSize.height * ref.rasterScale), cap: Math.hypot(ref.referenceSize.width, ref.referenceSize.height) }
}
/** 一组点伸出内容框的最远距离（逻辑像素）。 */
function overflow(points: Iterable<readonly [number, number]>, width: number, height: number): number {
  let reach = 0
  for (const [x, y] of points) reach = Math.max(reach, -x, x - width, -y, y - height)
  return reach
}
/** 变形后的内容伸出真实内容框 `reach`（逻辑像素）；减去前面已有的外扩，就是本效果要再加的。总量封顶一个画面对角线。 */
function bleedOf(ref: LayerEffectReference, reach: number, prior = 0): number {
  const frame = frameOf(ref, prior), total = Math.min(frame.cap, reach)
  return total > prior ? (total - prior) / frame.H + frame.guard : 0
}
/** 内容框外加一圈 `pad` 的四边采样点（逻辑像素）。 */
function* perimeter(width: number, height: number, pad: number, steps = 128): Generator<[number, number]> {
  for (let i = 0; i <= steps; i++) {
    const x = -pad + i / steps * (width + 2 * pad), y = -pad + i / steps * (height + 2 * pad)
    yield [x, -pad]; yield [x, height + pad]; yield [-pad, y]; yield [width + pad, y]
  }
}

// —— 镜像 ——
/** 镜面法线：角度 0° 指向右（竖直的镜面），90° 指向下。 */
export function mirrorNormal(params: VideoEditBuiltinParams): [number, number] { const a = n(params, 'angle') * Math.PI / 180; return [Math.cos(a), Math.sin(a)] }
/** 只有留下的那一半会被翻过去：把内容框按镜面切下留下的部分，翻过去后伸出内容框多少就外扩多少。 */
function mirrorBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference, prior = 0): number {
  const { width, height, pad } = frameOf(ref, prior)
  const c = [n(params, 'center_x') / 100 * width, n(params, 'center_y') / 100 * height], [nx, ny] = mirrorNormal(params)
  const side = params.side === 'back' ? -1 : 1
  const depth = ([x, y]: readonly [number, number]): number => ((x - c[0]) * nx + (y - c[1]) * ny) * side
  const box: Array<[number, number]> = [[-pad, -pad], [width + pad, -pad], [width + pad, height + pad], [-pad, height + pad]]
  const kept = box.flatMap((point, index): Array<[number, number]> => {
    const next = box[(index + 1) % 4], a = depth(point), b = depth(next)
    const result: Array<[number, number]> = a <= 0 ? [point] : []
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) { const t = a / (a - b); result.push([point[0] + (next[0] - point[0]) * t, point[1] + (next[1] - point[1]) * t]) }
    return result
  })
  return bleedOf(ref, overflow(kept.map(([x, y]): [number, number] => { const d = (x - c[0]) * nx + (y - c[1]) * ny; return [x - 2 * d * nx, y - 2 * d * ny] }), width, height), prior)
}
export const MIRROR_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', author: { factory: 'mirror' }, bleed: mirrorBleed, id: 'mirror', name: '镜像', group: 'distort',
  aliases: ['对称', '镜像对称', '对折', 'mirror', 'symmetry'],
  description: '沿一条线把画面对折，留下的一半换掉另一半，做左右或上下对称的画面。适合对称构图、倒影和图形装饰。',
  params: [
    angle('angle', 0, { name: '角度', text: '镜面朝哪个方向。0°（默认）沿竖线左右对称；90° 沿横线上下对称；45° 斜着对称。' }),
    center('x', '镜面经过的左右位置，按内容宽度算。50%（默认）在正中；70% 时左边留得多，镜像伸出右边；30% 时左边窄的一条翻过去，再往右的地方按“边缘”补（代码图层上是透明）。'),
    center('y', '镜面经过的上下位置，按内容高度算，0% 在顶边，100% 在底边。角度为 0° 时不起作用。'),
    choice('side', 'front', [{ value: 'front', label: '前侧' }, { value: 'back', label: '后侧' }], { name: '保留', text: '留下哪一半。前侧（默认）留左半边，角度 90° 时留上半边；后侧留另一半。' }),
    EDGES,
  ],
}

// —— 重复阵列 ——
export type RepeatMode = 'grid' | 'linear' | 'ring'
/** 副本个数与逐个递变：数量取整；逐个缩放、淡出按与原内容隔几个副本复合。 */
export function repeatLayout(params: VideoEditBuiltinParams): { mode: RepeatMode; columns: number; rows: number; count: number; spacing: number; stagger: number; scale: number; fade: number } {
  const mode = (['grid', 'linear', 'ring'] as const).find(value => value === params.mode) ?? 'grid'
  const count = (key: string): number => Math.max(1, Math.round(n(params, key)))
  return { mode, columns: count('columns'), rows: count('rows'), count: count('count'), spacing: Math.max(0, n(params, 'spacing')) / 100, stagger: n(params, 'stagger') / 100, scale: Math.max(0, 1 + n(params, 'scale_step') / 100), fade: Math.max(0, 1 - n(params, 'opacity_step') / 100) }
}
/** 直线方式相邻副本的间隔方向与距离（内容尺寸为单位）：沿方向的内容长度乘 1 + 间距，间距 0 时首尾相接。 */
export function repeatLinearStep(params: VideoEditBuiltinParams, width: number, height: number): [number, number] {
  const a = n(params, 'angle') * Math.PI / 180, { spacing } = repeatLayout(params)
  const length = (Math.abs(width * Math.cos(a)) + Math.abs(height * Math.sin(a))) * (1 + spacing)
  return [Math.cos(a) * length, Math.sin(a) * length]
}
/** 环形第 i 个副本的位置角：从正上方起顺时针均分。 */
export function repeatRingAngle(index: number, count: number): number { return -Math.PI / 2 + index / count * Math.PI * 2 }
function repeatBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference, prior = 0): number {
  const { width, height, pad, H } = frameOf(ref, prior)
  const layout = repeatLayout(params)
  // 每个副本连同前面效果外扩的一圈一起复制，最外的副本再往外带出这一圈。
  if (layout.mode === 'grid') {
    const cellWidth = width * (1 + layout.spacing), cellHeight = height * (1 + layout.spacing)
    const shift = layout.rows > 1 ? Math.abs(layout.stagger) * cellWidth : 0
    return bleedOf(ref, pad + Math.max((layout.columns * cellWidth - width) / 2 + shift, (layout.rows * cellHeight - height) / 2), prior)
  }
  const points: Array<[number, number]> = []
  const radius = n(params, 'radius') / 100 * H, half = Math.hypot(width / 2 + pad, height / 2 + pad)
  const [sx, sy] = repeatLinearStep(params, width, height)
  for (let i = 0; i < layout.count; i++) {
    const k = layout.mode === 'ring' ? i : Math.abs(i - (layout.count - 1) / 2)
    const scale = layout.scale ** k
    const [ox, oy] = layout.mode === 'ring' ? [Math.cos(repeatRingAngle(i, layout.count)) * radius, Math.sin(repeatRingAngle(i, layout.count)) * radius] : [(i - (layout.count - 1) / 2) * sx, (i - (layout.count - 1) / 2) * sy]
    // 环形朝向中心时副本会转，按半对角线算；直线方式副本不转，按半宽、半高算。
    const [hx, hy] = layout.mode === 'ring' ? [half * scale, half * scale] : [(width / 2 + pad) * scale, (height / 2 + pad) * scale]
    points.push([width / 2 + ox - hx, height / 2 + oy - hy], [width / 2 + ox + hx, height / 2 + oy + hy])
  }
  return bleedOf(ref, overflow(points, width, height), prior)
}
export const REPEAT_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', author: { factory: 'repeat' }, bleed: repeatBleed, id: 'repeat', name: '重复阵列', group: 'distort',
  aliases: ['重复', '阵列', '平铺', '复制', '排列', 'repeat', 'repeater', 'tile', 'array'],
  description: '把内容复制成一组排得整整齐齐的副本：网格铺成几行几列，直线排成一串，环形围成一圈。适合图标墙、重复的装饰和背景图案，副本可以逐个变小、变淡。原内容在阵列正中，副本按内容本身的大小排开。整幅画面的片段上副本会落到画外、看不到，这是正常的，先把内容做小（例如代码图层的文字、图标）再用。代码图层上前面加的投影、光晕会跟着复制，但都垫在所有副本下面，不会落到相邻副本上。',
  params: [
    choice('mode', 'grid', [{ value: 'grid', label: '网格' }, { value: 'linear', label: '直线' }, { value: 'ring', label: '环形' }], { name: '方式', text: '副本怎么排。网格（默认）铺成几行几列；直线沿一个方向排成一串；环形围着原来的位置排成一圈。' }),
    { ...ints('columns', 3, 1, 12, 100, { name: '列数', text: '网格横着排几个。3（默认）；1 只在竖直方向重复。可以输入到 100。' }), ...only('mode', 'grid') },
    { ...ints('rows', 3, 1, 12, 100, { name: '行数', text: '网格竖着排几行。3（默认）；1 只在水平方向重复。可以输入到 100。' }), ...only('mode', 'grid') },
    { ...ints('count', 5, 1, 12, 100, { name: '数量', text: '一共几个副本。5（默认）；环形排 12 个像钟面。可以输入到 100，越多越慢。' }), ...only('mode', 'linear', 'ring') },
    { ...num('spacing', 10, PERCENT_400, { group: '排列', name: '间距', text: '相邻副本之间空多少，按内容的宽和高算。0 紧挨着首尾相接；10%（默认）留一道窄缝；100% 空出一个内容那么宽。' }), ...only('mode', 'grid', 'linear') },
    { ...percent('stagger', 0, 0, { group: '排列', name: '错位', text: '隔一行往右错开多少，按一格的宽度算。0%（默认）上下对齐；50% 像砌砖一样错开半格。' }), ...only('mode', 'grid') },
    { ...angle('angle', 0, { group: '排列', name: '角度', text: '直线往哪个方向排。0°（默认）横着排；90° 竖着排；45° 斜着排。' }), ...only('mode', 'linear') },
    { ...num('radius', 30, PERCENT_400, { group: '排列', name: '半径', text: '环有多大，按画面高度算。30%（默认）约为画面高度的 30%；0 时副本都叠在一起。可以输入到 400%。' }), ...only('mode', 'ring') },
    { ...toggle('face_center', false, { group: '排列', name: '朝向中心', text: '副本跟着环转，底边都朝向圆心，像钟面上的刻度。默认关闭，副本都正着放。' }), ...only('mode', 'ring') },
    num('scale_step', 0, { unit: 'percent', min: -100, max: 100 }, { group: '递变', name: '逐个缩放', text: '每往外一个副本放大或缩小多少。0%（默认）一样大；−20% 越往外越小；往正越往外越大，网格里最多长满一格。' }),
    percent('opacity_step', 0, 0, { group: '递变', name: '逐个淡出', text: '每往外一个副本淡多少。0%（默认）都不透明；30% 越往外越淡，像渐渐消失的残影。' }),
  ],
}

// —— 膨胀 ——
/** 平滑与球面两种映射：输出半径 x（半径为 1）取内容的哪个半径。数量为正鼓起，为负凹进。 */
export function bulgeSourceRadius(x: number, value: number, shape: string): number {
  if (shape === 'sphere') return value >= 0 ? x + (Math.asin(Math.min(1, x)) * 2 / Math.PI - x) * value : x + (Math.sin(x * Math.PI / 2) - x) * -value
  // 数量 100 时中心放大约 20 倍，不让中心一点被拉成无限大。
  return x * (1 - Math.min(0.95, value) * (1 - x * x) ** 2)
}
function bulgeBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference, prior = 0): number {
  const value = n(params, 'amount') / 100
  if (value <= 0) return 0
  // 鼓起把内容往外推：推得最远处按映射逐点求出（平滑约为半径的 0.27 倍）。
  let push = 0
  for (let i = 1; i < 256; i++) { const x = i / 256; push = Math.max(push, x - bulgeSourceRadius(x, value, String(params.shape))) }
  return bleedOf(ref, prior + push * n(params, 'radius') / 100 * frameOf(ref, prior).H, prior)
}
export const BULGE_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', author: { factory: 'bulge' }, bleed: bulgeBleed, id: 'bulge', name: '膨胀', group: 'distort',
  aliases: ['膨胀收缩', '收缩', '凸起', '凹陷', '球面化', '放大镜', 'bulge', 'pinch', 'spherize'],
  description: '让一块圆形区域鼓起来或凹进去，像隔着放大镜或贴在球面上看。适合强调画面里的一处、做搞怪的变形，给数量打关键帧可以做出鼓起再弹回的动画。',
  params: [
    signed('amount', 50, { name: '数量', text: '鼓起或凹进多少。正数鼓起，中间被放大；负数凹进，向中心收缩；50（默认）明显鼓起，约放大两倍；0 不变形。' }),
    num('radius', 30, { unit: 'percent', min: 0, max: 200, softMin: 0, softMax: 100 }, { name: '半径', text: '变形的圆有多大，按画面高度算。30%（默认）约为画面高度的 30%；圆外的画面不动。可以输入到 200%。' }),
    center('x', '鼓起的中心左右位置，按内容宽度算。50%（默认）在正中。'),
    center('y', '鼓起的中心上下位置，按内容高度算，0% 在顶边，100% 在底边。'),
    choice('shape', 'smooth', [{ value: 'smooth', label: '平滑' }, { value: 'sphere', label: '球面' }], { name: '形状', text: '鼓起的样子。平滑（默认）中间放大、向圆边柔和过渡；球面像画面贴在一个球上，越靠近圆边压得越扁。' }),
    EDGES,
  ],
}

// —— 旋转扭曲 ——
/** 平滑方式：中心转满角度，到半径处不转。`x` 是到中心的距离与半径之比。 */
export function twirlTurn(x: number): number { return x >= 1 ? 0 : (1 - x) ** 2 }
function twirlBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference, prior = 0): number {
  const { width, height, pad, H } = frameOf(ref, prior)
  const radius = n(params, 'radius') / 100 * H, turn = n(params, 'angle') * Math.PI / 180
  if (radius <= 0 || turn === 0) return 0
  const c = [n(params, 'center_x') / 100 * width, n(params, 'center_y') / 100 * height]
  // 半径不变、只转角度：变形后的轮廓就是内容框四边各自转过去，按边上的点逐个转出最远处。
  // 同心环各环随机转，按整圈算；最外一圈与环外之间按柔和度过渡，过渡带一直转到 半径 × (1 + 柔和度 / (2 × 环数))。
  const rings = params.mode === 'rings'
  const reach = rings ? radius * (1 + n(params, 'ring_softness') / 100 / (2 * Math.max(2, Math.round(n(params, 'rings'))))) : radius
  const points = [...perimeter(width, height, pad, 256)].flatMap(([x, y]): Array<[number, number]> => {
    const dx = x - c[0], dy = y - c[1], r = Math.hypot(dx, dy)
    if (r >= reach) return [[x, y]]
    if (rings) return [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r]]
    const a = turn * twirlTurn(r / radius), cos = Math.cos(a), sin = Math.sin(a)
    return [[c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos]]
  })
  // 相邻采样点之间转出的弧长最多约为半径的 1%，留同样的余量。
  return bleedOf(ref, overflow(points, width, height) + (rings ? 0 : radius * 0.01), prior)
}
export const TWIRL_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', author: { factory: 'twirl' }, bleed: twirlBleed, id: 'twirl', name: '旋转扭曲', group: 'distort',
  aliases: ['旋转', '漩涡', '扭曲', '同心旋转', '旋涡', 'twirl', 'swirl', 'twist', 'concentric spin'],
  description: '把画面绕着一个中心拧成漩涡，中心转得最多、越往外越少。适合转场里的卷入卷出、梦境和眩晕感；同心环方式让一圈圈各自转开，像转动的密码锁。',
  params: [
    num('angle', 90, { unit: 'degrees', min: -1440, max: 1440, softMin: -360, softMax: 360 }, { name: '角度', text: '中心转多少度。90°（默认）明显的漩涡；正数顺时针、负数逆时针；360° 以上拧成一圈圈的螺旋，可以输入到 ±1440°。' }),
    num('radius', 40, { unit: 'percent', min: 0, max: 200, softMin: 0, softMax: 100 }, { name: '半径', text: '漩涡有多大，按画面高度算。40%（默认）约为画面高度的 40%；半径以外的画面不动。可以输入到 200%。' }),
    center('x', '漩涡中心的左右位置，按内容宽度算。50%（默认）在正中。'),
    center('y', '漩涡中心的上下位置，按内容高度算，0% 在顶边，100% 在底边。'),
    choice('mode', 'smooth', [{ value: 'smooth', label: '平滑' }, { value: 'rings', label: '同心环' }], { name: '方式', text: '怎么转。平滑（默认）从中心到半径连续地越转越少；同心环把圆分成一圈圈，各转各的角度。' }),
    EDGES,
    { ...ints('rings', 6, 2, 20, 100, { group: '同心环', name: '环数', text: '分成几圈。6（默认）；20 以上是细密的一圈圈纹路。可以输入到 100。' }), ...only('mode', 'rings') },
    { ...percent('ring_random', 50, 0, { group: '同心环', name: '随机', text: '各圈转的角度差多少。0% 全都转同样的角度；50%（默认）各圈在 0 到角度之间各转各的；100% 有的正转有的反转。' }), ...only('mode', 'rings') },
    { ...percent('ring_softness', 30, 0, { group: '同心环', name: '柔和度', text: '相邻两圈之间是断开还是连着。0% 一刀切开，边缘利落；30%（默认）稍有过渡；100% 圈与圈连成一片。' }), ...only('mode', 'rings') },
    { ...seed('同心环', '换一个数，各圈转的角度就换一种搭配，环数和最大角度不变。'), ...only('mode', 'rings') },
  ],
}

// —— 波动 ——
function waveBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference, prior = 0): number {
  const reach = warpDistance(n(params, 'amount')) * (params.mode === 'flow' ? waveFlowReach(n(params, 'detail')) : 1)
  return reach > 0 ? bleedOf(ref, prior + reach * frameOf(ref, prior).H, prior) : 0
}
export const WAVE_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', frameSeed: warpFrameSeed, author: { factory: 'wave' }, bleed: waveBleed, id: 'wave', name: '波动', group: 'distort',
  aliases: ['波浪', '波浪扭曲', '波纹', '流动', '流场扭曲', '水波', '旗帜飘动', 'wave', 'wave warp', 'flow field'],
  description: '让画面像水面、旗帜一样起伏。波浪方式是一道道整齐的波，可以选正弦、三角、方波和锯齿；流动方式是不规则的、像液体一样缓缓流动的扭曲。给相位打关键帧，或者给速度，波就会自己动起来。',
  params: [
    amount('amount', 20, { name: '幅度', text: '起伏有多大。0 不变形；20（默认）约为画面高度的 1%，轻轻荡漾；100 约 5%，大幅度扭动。可以输入到 400。' }, 400),
    amount('wavelength', 40, { name: '波长', text: '一道波有多宽。0 约为画面高度的 1%，细密的波纹；40（默认）约 6%；100 约一个画面高，整幅缓缓弯曲。' }),
    choice('mode', 'wave', [{ value: 'wave', label: '波浪' }, { value: 'flow', label: '流动' }], { name: '方式', text: '起伏的样子。波浪（默认）一道道平行、整齐的波；流动是不规则的漩流，像隔着流水看。' }),
    EDGES,
    { ...angle('direction', 0, { group: '波形', name: '方向', text: '波往哪个方向走。0°（默认）往右走，画面上下起伏；90° 往下走，画面左右摆动。' }), ...only('mode', 'wave') },
    { ...choice('waveform', 'sine', [{ value: 'sine', label: '正弦' }, { value: 'triangle', label: '三角' }, { value: 'square', label: '方波' }, { value: 'sawtooth', label: '锯齿' }], { group: '波形', name: '波形', text: '每道波的形状。正弦（默认）圆滑；三角是折线；方波一段段错开、断口整齐；锯齿缓缓推出再一下跳回。' }), ...only('mode', 'wave') },
    { ...percent('detail', 30, 0, { group: '流动', name: '细节', text: '大漩流里再加多少细碎的小漩涡。0% 只有大而缓的流动；30%（默认）自然；100% 细碎的扭动很多。' }), ...only('mode', 'flow') },
    { ...seed('流动', '换一个数，流动的花样就换一种，大小和幅度不变。'), ...only('mode', 'flow') },
    num('phase', 0, { unit: 'degrees', min: -100000, max: 100000, softMin: -180, softMax: 180 }, { group: '变化', name: '相位', text: '波走到了哪里。往大调，波浪往前推、流动往前流；转一整圈 360° 正好走过一道波。给它打关键帧让波动起来，可以输入到 ±100000°。' }),
    num('speed', 0, SPEED, { group: '变化', name: '速度', text: '播放时波自己走多快。0（默认）不动；100 每秒走过一道波；负数反着走。' }, false),
  ],
}

// —— 边角定位 ——
/** 四个角在内容框里的位置（比例），顺序为左上、右上、右下、左下。 */
export function cornerPinQuad(params: VideoEditBuiltinParams): [[number, number], [number, number], [number, number], [number, number]] {
  const at = (name: string): [number, number] => [n(params, `${name}_x`) / 100, n(params, `${name}_y`) / 100]
  return [at('tl'), at('tr'), at('br'), at('bl')]
}
/**
 * 内容框外加一圈前面效果的外扩，经同一个透视矩阵映射后伸出多少。透视不是仿射：框外的影子、光会按射影外推放大，
 * 不能把角点比例直接套在放大的框上。矩阵的 w 在矩形上线性变化，四个角都在地平线前，整块就都在前面；
 * 否则映射出去没有边界，按封顶（一个画面对角线）算。交叉、退化的四边形内容消失，不外扩。
 */
function cornerPinBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference, prior = 0): number {
  const { width, height, pad } = frameOf(ref, prior)
  const quad = cornerPinQuad(params)
  if (!isVideoEditTrackQuad(quad) || width <= 0 || height <= 0) return 0
  const m = videoEditCornerPinMatrix(quad)
  const corners = [[-pad / width, -pad / height], [1 + pad / width, -pad / height], [1 + pad / width, 1 + pad / height], [-pad / width, 1 + pad / height]]
  if (corners.some(([u, v]) => m[6] * u + m[7] * v + m[8] <= 1e-6)) return bleedOf(ref, Infinity, prior)
  return bleedOf(ref, overflow(corners.map(([u, v]): [number, number] => { const [x, y] = videoEditTrackProject(m, u, v); return [x * width, y * height] }), width, height), prior)
}
const CORNER = '按内容框的百分比，0% 在左边或顶边，100% 在右边或底边；可以拖到内容外面。'
export const CORNER_PIN_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', author: { factory: 'cornerPin' }, bleed: cornerPinBleed, id: 'corner_pin', name: '边角定位', group: 'distort',
  aliases: ['四角定位', '透视贴图', '贴屏幕', '透视', 'corner pin', 'perspective'],
  description: '把内容的四个角分别钉到指定位置，内容按透视变形贴上去，直线仍然是直的。适合把画面贴进手机、电脑屏幕或画框，或者做出平放、斜放的透视感。四个角要围成凸的四边形，拧成交叉时内容消失。',
  params: [
    corner('tl_x', '左上（水平）', 0, `左上角钉到的左右位置。0%（默认）就是原来的左边；${CORNER}`),
    corner('tl_y', '左上（垂直）', 0, `左上角钉到的上下位置。0%（默认）就是原来的顶边；${CORNER}`),
    corner('tr_x', '右上（水平）', 100, `右上角钉到的左右位置。100%（默认）就是原来的右边；${CORNER}`),
    corner('tr_y', '右上（垂直）', 0, `右上角钉到的上下位置。0%（默认）就是原来的顶边；${CORNER}`),
    corner('bl_x', '左下（水平）', 0, `左下角钉到的左右位置。0%（默认）就是原来的左边；${CORNER}`),
    corner('bl_y', '左下（垂直）', 100, `左下角钉到的上下位置。100%（默认）就是原来的底边；${CORNER}`),
    corner('br_x', '右下（水平）', 100, `右下角钉到的左右位置。100%（默认）就是原来的右边；${CORNER}`),
    corner('br_y', '右下（垂直）', 100, `右下角钉到的上下位置。100%（默认）就是原来的底边；${CORNER}`),
    CORNER_PIN_EDGES,
  ],
}

// —— 置换 ——
/** 噪声来源两层叠加后位移的最大倍数（相对幅度）。 */
export function displaceReach(params: VideoEditBuiltinParams): number { return params.source === 'luma' ? 1 : Math.SQRT2 * (1 + n(params, 'detail') / 100 * 0.5) }
function displaceBleed(params: VideoEditBuiltinParams, ref: LayerEffectReference, prior = 0): number {
  const reach = warpDistance(n(params, 'amount')) * displaceReach(params)
  return reach > 0 ? bleedOf(ref, prior + reach * frameOf(ref, prior).H, prior) : 0
}
export const DISPLACE_EFFECT_DEFINITION: VideoEditBuiltinEffectDefinition = {
  space: 'layer', frameSeed: warpFrameSeed, author: { factory: 'displace' }, bleed: displaceBleed, id: 'displace', name: '置换', group: 'distort',
  aliases: ['置换贴图', '热浪', '热空气', '水面扭曲', '扭曲', 'displace', 'displacement map', 'heat haze'],
  description: '按一张起伏图把画面挤来挤去。噪声来源像透过热空气或水面看东西，给速度会一直轻轻晃动；自身亮度让亮的地方往一个方向挪、暗的地方往反方向挪，做出浮雕错位的感觉。',
  params: [
    amount('amount', 20, { name: '数量', text: '挪得多远。0 不变形；20（默认）约为画面高度的 1%；100 约 5%，扭得认不出来。可以输入到 400。' }, 400),
    choice('source', 'noise', [{ value: 'noise', label: '噪声' }, { value: 'luma', label: '自身亮度' }], { name: '来源', text: '按什么挪。噪声（默认）是柔和起伏的随机图案，像热空气、水面；自身亮度按画面自己的明暗挪，亮处和暗处朝相反方向。' }),
    { ...angle('angle', 45, { name: '方向', text: '亮的地方往哪边挪，暗的地方往反方向。45°（默认）往右下；0° 往右；90° 往下。' }), ...only('source', 'luma') },
    EDGES,
    { ...amount('scale', 50, { group: '噪声', name: '大小', text: '起伏的一块有多大。0 约为画面高度的 1%，细碎的抖动；50（默认）约 8%，像热空气；100 约一半画面高，大片缓慢的弯曲。' }), ...only('source', 'noise') },
    { ...percent('detail', 30, 0, { group: '噪声', name: '细节', text: '大起伏里再叠多少细碎的小起伏。0% 只有平缓的大起伏；30%（默认）自然；100% 细碎、像水面的碎波。' }), ...only('source', 'noise') },
    { ...num('speed', 0, SPEED, { group: '噪声', name: '速度', text: '播放时起伏自己变得多快。0（默认）不动；30 像缓缓上升的热浪；100 每秒换一遍花样。' }, false), ...only('source', 'noise') },
    { ...seed('噪声', '换一个数，起伏的花样就换一种，大小和数量不变。'), ...only('source', 'noise') },
  ],
}

/** 设计目录顺序：镜像、重复阵列、膨胀、旋转扭曲、波动、边角定位、置换。 */
export const WARP_EFFECT_DEFINITIONS: readonly VideoEditBuiltinEffectDefinition[] = [MIRROR_EFFECT_DEFINITION, REPEAT_EFFECT_DEFINITION, BULGE_EFFECT_DEFINITION, TWIRL_EFFECT_DEFINITION, WAVE_EFFECT_DEFINITION, CORNER_PIN_EFFECT_DEFINITION, DISPLACE_EFFECT_DEFINITION]
