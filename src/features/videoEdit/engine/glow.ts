/**
 * 发光的工序规划与 WGSL（剪辑内置效果 ABI：u.size/a/b/c、source/original/sampler，预乘 sRGB 编码）。
 *
 * 工序：按“分辨率”提取发光内容 → 13 点降采样金字塔 → 每层可分离高斯 → 自最粗层逐级 tent 升采样、按层权重累加
 * →（色差）→ 全分辨率合成。中间纹理一律 rgba16float：光在线性光里累加，可以超过 1，到合成时才压回画面范围。
 * 每层高斯在本层纹素里的宽度固定，层越粗覆盖越远，所以大光晕的代价只比小光晕多几道很小的工序。
 * 着色折算成每层的 RGB 权重；色差调用“色差”效果的同一道工序，只作用在累加好的光晕上。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinPlan, VideoEditBuiltinTexture } from './videoEditBuiltinEffectPasses'
import type { VideoEditBuiltinEffectEntry } from './videoEditBuiltinEffectShaders'
import { WHITE_HEX } from '@/core/theme/colorTokens'
import { GLOW_ABERRATION_PREFIX } from '@/core/videoEdit/glow'
import { includedEffectValues } from '@/core/videoEdit/effectIncludes'
import { chromaticAberrationPass } from './chromaticAberration'

export const GLOW_ENTRIES = ['glow_prefilter', 'glow_down', 'glow_blur', 'glow_up', 'glow_composite', 'glow_source'] as const
type V3 = [number, number, number]
type V4 = readonly [number, number, number, number]
const ZERO: V4 = [0, 0, 0, 0]

/** 每层高斯在本层纹素里的标准差；加上降采样本身的模糊，缩放为 s 的一层约覆盖全分辨率 1.5 / s 像素。 */
const LEVEL_SIGMA = 1
const LEVEL_RADIUS = 1.5
/**
 * 权重的基准层覆盖画面高度的 3/1080（1080 下 3 像素）。按画面高度的比例算，回放降分辨率、导出、换“分辨率”档位时，
 * 每个覆盖尺寸拿到的能量都一样，光晕亮度和形状不变。
 */
const REFERENCE_RADIUS = 3 / 1080
/** 半径 0 与 100 对应的光晕半径（占画面高度），中间按对数插值，滑块每段的观感变化均匀。 */
const RADIUS_MIN = 0.004
const RADIUS_MAX = 0.6
/** 强度按平方映射，低强度段调得细；100 是 50 的 4 倍。整体倍数让默认参数在 1080 下的光晕总量约为 3.2。 */
const GAIN = 3.2
/** 光核（全分辨率、贴着发光内容的那一点光）相对光晕的权重。 */
const CORE = 0.35
/** 长宽比 ±100 时长轴是短轴的倍数。 */
const ASPECT_MAX = 8

const numeric = (params: VideoEditBuiltinParams, key: string, fallback = 0): number => typeof params[key] === 'number' ? params[key] as number : fallback

/** sRGB 编码的 #rrggbb → 线性光。 */
function linearColor(value: unknown): V3 {
  const hex = typeof value === 'string' && /^#[0-9a-f]{6}/i.test(value) ? value : WHITE_HEX
  return [1, 3, 5].map(index => {
    const c = parseInt(hex.slice(index, index + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as V3
}

/**
 * 金字塔：第一层按 `resolution`（0–1]缩放，之后每层减半，共 `count` 层。`reach` 是光晕半径折算成的层数（可以小于 1，
 * 也带小数）：第 i 层只计入 reach - i 那么多（0–1），半径连续变化时光晕连续长大，不会一档一档跳。
 * 层数不超过最小边还剩 2 个像素的深度。
 */
export function glowLevels(radius: number, width: number, height: number, resolution: number): { first: { width: number; height: number }; count: number; reach: number } {
  const first = { width: Math.max(1, Math.ceil(width * resolution)), height: Math.max(1, Math.ceil(height * resolution)) }
  const pixels = height * RADIUS_MIN * (RADIUS_MAX / RADIUS_MIN) ** (Math.min(100, Math.max(0, radius)) / 100)
  const reach = Math.log2(pixels * resolution / LEVEL_RADIUS) + 1
  const limit = Math.max(1, Math.floor(Math.log2(Math.min(first.width, first.height) / 2)) + 1)
  return { first, count: Math.min(limit, Math.max(1, Math.ceil(reach - 1e-9))), reach }
}

/**
 * 每层的 RGB 权重。覆盖半径每翻一倍，能量乘 `falloff`：falloff 为 1 时每个倍频程能量相同，光强按平方反比衰减；
 * 比基准更细的部分每细一倍能量减半。金字塔算不到的更细的那些倍频程，能量并进第一层；各倍频程都按半径截断。
 * 所以总亮度不随渲染尺寸和分辨率档位变。着色把每层乘上从内圈到外圈渐变的颜色（`tint` 为混合量）。
 */
export function glowLevelWeights(count: number, reach: number, resolution: number, height: number, falloff: number, tint: number, inner: V3, outer: V3): V3[] {
  const energy = (octave: number): number => octave >= 0 ? falloff ** octave : 2 ** octave
  const covered = (index: number): number => Math.min(1, Math.max(0, reach - index))
  const first = Math.log2(LEVEL_RADIUS / resolution / (REFERENCE_RADIUS * height))
  let finer = 0
  for (let step = 1; step <= 24; step++) finer += energy(first - step) * covered(-step)
  return Array.from({ length: count }, (_, index) => {
    const weight = energy(first + index) * covered(index) + (index === 0 ? finer : 0)
    const position = count > 1 ? index / (count - 1) : 0
    return [0, 1, 2].map(channel => weight * (1 + (inner[channel] + (outer[channel] - inner[channel]) * position - 1) * tint)) as V3
  })
}

const taps = (sigma: number): number => Math.min(48, Math.ceil(sigma * 3))

/** `params` 已补齐默认值。 */
export function planGlow(params: VideoEditBuiltinParams, width: number, height: number): VideoEditBuiltinPlan {
  const plan: VideoEditBuiltinPlan = { width, height, scratch: [], passes: [], linearScratch: true }
  const alloc = (w: number, h: number): number => { plan.scratch.push({ width: w, height: h }); return plan.scratch.length - 1 }
  const size = (texture: VideoEditBuiltinTexture): { width: number; height: number } => typeof texture === 'number' ? plan.scratch[texture] : plan
  const pass = (entry: VideoEditBuiltinEffectEntry, source: VideoEditBuiltinTexture, target: VideoEditBuiltinTexture, a: V4 = ZERO, b: V4 = ZERO, c: V4 = ZERO, original?: VideoEditBuiltinTexture): void => {
    const from = size(source); const to = size(target)
    plan.passes.push({ entry, source, target, ...(original !== undefined ? { original } : {}), uniforms: new Float32Array([to.width, to.height, from.width, from.height, ...a, ...b, ...c]) })
  }
  const strength = numeric(params, 'strength') / 100
  const sourceOpacity = numeric(params, 'source_opacity', 100) / 100
  const tint = numeric(params, 'tint') / 100
  // a = (阈值, 过渡半宽, 原画不透明度, 着色量)：提取、合成与“发光来源”视图共用。
  const emission: V4 = [numeric(params, 'threshold') / 100, Math.max(0.001, numeric(params, 'threshold_smoothness') / 100 * 0.5), sourceOpacity, tint]
  if (params.view === 'source') { pass('glow_source', 'input', 'output', emission); return plan }
  if (strength === 0 && sourceOpacity === 1) { pass('copy', 'input', 'output'); return plan }

  const resolution = Math.min(1, Math.max(0.25, numeric(params, 'resolution', 50) / 100))
  const inner = linearColor(params.tint_inner); const outer = linearColor(params.tint_outer)
  const { first, count, reach } = glowLevels(numeric(params, 'radius'), width, height, resolution)
  const weights = glowLevelWeights(count, reach, resolution, height, 0.45 + 0.55 * numeric(params, 'falloff') / 100, tint, inner, outer)
  const gain = strength * strength * GAIN
  const core = inner.map(value => (1 + (value - 1) * tint) * CORE * gain) as V3

  const levels: number[] = [alloc(first.width, first.height)]
  for (let index = 1; index < count; index++) { const previous = plan.scratch[levels[index - 1]]; levels.push(alloc(Math.max(1, Math.ceil(previous.width / 2)), Math.max(1, Math.ceil(previous.height / 2)))) }
  pass('glow_prefilter', 'input', levels[0], emission)
  for (let index = 1; index < count; index++) pass('glow_down', levels[index - 1], levels[index])

  // 长宽比为正时沿“角度”拉长，为负时沿与它垂直的方向拉长。
  const aspectValue = numeric(params, 'aspect')
  const aspect = ASPECT_MAX ** (Math.min(100, Math.abs(aspectValue)) / 100)
  const angle = (numeric(params, 'angle') + (aspectValue < 0 ? 90 : 0)) * Math.PI / 180
  const along: [number, number] = [Math.cos(angle), Math.sin(angle)]; const across: [number, number] = [-along[1], along[0]]
  const middles: number[] = []
  const blurred = levels.map(level => {
    const { width: lw, height: lh } = plan.scratch[level]
    const middle = alloc(lw, lh); const out = alloc(lw, lh); middles.push(middle)
    pass('glow_blur', level, middle, [along[0] / lw, along[1] / lh, LEVEL_SIGMA * aspect, taps(LEVEL_SIGMA * aspect)])
    pass('glow_blur', middle, out, [across[0] / lw, across[1] / lh, LEVEL_SIGMA, taps(LEVEL_SIGMA)])
    return out
  })

  // 自最粗层往回累加，写回已经用完的提取层，省下一组中间纹理；只有一层时也走一道，把它的权重乘上。
  let accumulated = blurred[count - 1]; let lowWeight: V3 = [0, 0, 0]
  for (let index = count - 1; index >= 0; index--) {
    if (index === count - 1 && count > 1) { lowWeight = weights[index]; continue }
    pass('glow_up', accumulated, levels[index], [...weights[index], 0], [...lowWeight, 0], ZERO, blurred[index])
    accumulated = levels[index]; lowWeight = [1, 1, 1]
  }
  const aberration = chromaticAberrationPass(includedEffectValues(params, GLOW_ABERRATION_PREFIX), width, height, true)
  if (aberration) {
    pass(aberration.entry, accumulated, middles[0], aberration.a, aberration.b, aberration.c)
    accumulated = middles[0]
  }
  pass('glow_composite', accumulated, 'output', emission, [...core, params.blend === 'screen' ? 1 : 0], [gain, numeric(params, 'core_white') / 100, numeric(params, 'dither', 50) / 100, params.dither_mono === true ? 1 : 0])
  return plan
}

export const GLOW_WGSL = `
// 发光内容（预乘线性光）。a = (阈值, 过渡半宽, 原画不透明度, 着色量)。
// 阈值按直通色最亮的通道比较，纯红、纯蓝的霓虹和白光一样容易过阈值；着色量把颜色先褪成同样亮度的白光，再在各层上色。
fn glowEmission(c: vec4f) -> vec3f {
 if (c.a <= 0.00001) { return vec3f(0.0); }
 let s = straight(c);
 let mask = smoothstep(u.a.x - u.a.y, u.a.x + u.a.y, max(s.r, max(s.g, s.b)));
 let e = toLinear(s) * mask;
 return mix(e, vec3f(max(e.r, max(e.g, e.b))), u.a.w) * c.a;
}
fn glowLuma(c: vec3f) -> f32 { return dot(c, LUMA); }
fn glowPeak(c: vec3f) -> f32 { return max(c.r, max(c.g, c.b)); }
// 13 点降采样：中心 2×2 盒占一半，四个角上的 2×2 盒各占八分之一。
fn glowBoxes(uv: vec2f, t: vec2f, prefilter: bool) -> vec3f {
 var p: array<vec3f, 13>;
 var offsets = array<vec2f, 13>(vec2f(-2.0, -2.0), vec2f(0.0, -2.0), vec2f(2.0, -2.0), vec2f(-2.0, 0.0), vec2f(0.0, 0.0), vec2f(2.0, 0.0), vec2f(-2.0, 2.0), vec2f(0.0, 2.0), vec2f(2.0, 2.0), vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(1.0, 1.0));
 for (var i = 0; i < 13; i++) {
  let c = tap(uv + offsets[i] * t);
  p[i] = select(c.rgb, glowEmission(c), prefilter);
 }
 var boxes = array<vec3f, 5>((p[9] + p[10] + p[11] + p[12]) * 0.25, (p[0] + p[1] + p[3] + p[4]) * 0.25, (p[1] + p[2] + p[4] + p[5]) * 0.25, (p[3] + p[4] + p[6] + p[7]) * 0.25, (p[4] + p[5] + p[7] + p[8]) * 0.25);
 var shares = array<f32, 5>(0.5, 0.125, 0.125, 0.125, 0.125);
 var sum = vec3f(0.0); var total = 0.0;
 for (var i = 0; i < 5; i++) {
  // 只压超过 1 的高光：孤立的超亮像素不再在运动中闪烁，普通画面（≤1）的细线与小字照常发光。
  let weight = shares[i] / select(1.0, 1.0 + max(glowLuma(boxes[i]) - 1.0, 0.0), prefilter);
  sum += boxes[i] * weight; total += weight;
 }
 return sum / total;
}
// 提取时输入是整幅画面，按目标纹素取样：目标与输入同样大小时（分辨率 100%）是一道柔化，缩小时是降采样。
@fragment fn glow_prefilter(v: Vertex) -> @location(0) vec4f {
 return vec4f(glowBoxes(uvOf(v), 0.5 / u.size.xy, true), 1.0);
}
@fragment fn glow_down(v: Vertex) -> @location(0) vec4f {
 return vec4f(glowBoxes(uvOf(v), 1.0 / u.size.zw, false), 1.0);
}
// 一维高斯：a = (每步 u, 每步 v, 标准差（纹素）, 单侧取样数)。
@fragment fn glow_blur(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let n = i32(u.a.w); let k = -0.5 / (u.a.z * u.a.z);
 var sum = vec3f(0.0); var total = 0.0;
 for (var i = -n; i <= n; i++) {
  let x = f32(i); let weight = exp(k * x * x);
  sum += tap(uv + u.a.xy * x).rgb * weight; total += weight;
 }
 return vec4f(sum / total, 1.0);
}
fn glowTent(uv: vec2f, t: vec2f) -> vec3f {
 var low = tap(uv).rgb * 4.0;
 low += (tap(uv + vec2f(t.x, 0.0)).rgb + tap(uv - vec2f(t.x, 0.0)).rgb + tap(uv + vec2f(0.0, t.y)).rgb + tap(uv - vec2f(0.0, t.y)).rgb) * 2.0;
 low += tap(uv + t).rgb + tap(uv - t).rgb + tap(uv + vec2f(t.x, -t.y)).rgb + tap(uv + vec2f(-t.x, t.y)).rgb;
 return low / 16.0;
}
// 本层（original）乘 a.rgb，加上粗一层（source）tent 升采样乘 b.rgb。
@fragment fn glow_up(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v);
 return vec4f(tapOriginal(uv).rgb * u.a.rgb + glowTent(uv, 1.0 / u.size.zw) * u.b.rgb, 1.0);
}
// 相加：发光在原画剩余的亮度空间里线性叠加，快到顶时才平滑压缩；原画本身一点不改。
fn glowShoulder(x: vec3f) -> vec3f {
 let knee = 0.75;
 return select(knee + (1.0 - knee) * (1.0 - exp(-(x - knee) / (1.0 - knee))), x, x <= vec3f(knee));
}
fn glowHash(p: vec2f, seed: vec2f) -> f32 { return fract(sin(dot(p, seed)) * 43758.5453); }
// 两个哈希相加的三角分布噪声（-1..1）。按像素位置取值，同一帧每次渲染相同。
fn glowNoise(p: vec2f, mono: bool) -> vec3f {
 let r = glowHash(p, vec2f(12.9898, 78.233)) + glowHash(p, vec2f(39.3468, 11.135)) - 1.0;
 if (mono) { return vec3f(r); }
 let g = glowHash(p, vec2f(73.156, 52.235)) + glowHash(p, vec2f(27.017, 91.733)) - 1.0;
 let b = glowHash(p, vec2f(17.873, 63.719)) + glowHash(p, vec2f(85.341, 23.553)) - 1.0;
 return vec3f(r, g, b);
}
// 合成：source 为累加好的光晕；b.rgb 光核权重，b.w 滤色；c = (光晕权重, 核心发白, 抖动量, 单色抖动)。
@fragment fn glow_composite(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let base = tapOriginal(uv);
 // 光核取样距离按画面高度的比例（1080 下 1.5 像素），任何渲染尺寸下一样。
 let dims = vec2f(textureDimensions(original));
 let step = vec2f(1.5 / 1080.0 * dims.y / dims.x, 1.5 / 1080.0);
 let core = glowEmission(base) * 0.5 + (glowEmission(tapOriginal(uv + vec2f(step.x, 0.0))) + glowEmission(tapOriginal(uv - vec2f(step.x, 0.0))) + glowEmission(tapOriginal(uv + vec2f(0.0, step.y))) + glowEmission(tapOriginal(uv - vec2f(0.0, step.y)))) * 0.125;
 let light = glowTent(uv, 1.0 / u.size.zw) * u.c.x + core * u.b.rgb;
 // 合成器在 sRGB 编码值上按预乘透明度叠加。所以先算出“叠到黑底上该有的样子”：原画按合成器的方式叠到黑底上，再把光加进去；
 // 输出就是这个编码颜色，透明度取它与保留原画中较大的。不透明处等于原画加光；透明处叠到黑底上和不透明黑底上一样亮。
 let shown = base.a * u.a.z;
 let before = straight(base) * shown;
 let b = toLinear(before);
 var rgb: vec3f;
 if (u.b.w > 0.5) {
  rgb = vec3f(1.0) - (vec3f(1.0) - b) * exp(-light);
 } else {
  // 光在原画剩余的亮度空间里线性叠加，快到顶时才平滑压缩。
  let room = max(vec3f(1.0) - b, vec3f(0.0001));
  rgb = b + room * glowShoulder(light / room);
  // 某个通道饱和后放不下的能量把其余通道往白推，像曝光过度的光核。
  let overflow = max(light - (rgb - b), vec3f(0.0));
  rgb = mix(rgb, vec3f(1.0), clamp(glowLuma(overflow) * u.c.y, 0.0, 1.0));
 }
 let encoded = toSrgb(rgb);
 // 抖动只加在被光改动了半个色阶以上的像素上，抖动量 50 约一个 8 位色阶：光晕的平滑渐变不出色带，光没碰到的原画一点不变。
 let changed = clamp(glowPeak(encoded - before) * 510.0, 0.0, 1.0);
 let lit = clamp(encoded + glowNoise(v.position.xy, u.c.w > 0.5) * (u.c.z * 2.0 / 255.0) * changed, vec3f(0.0), vec3f(1.0));
 let alpha = max(shown, glowPeak(lit));
 if (alpha <= 0.00001) { return vec4f(0.0); }
 return vec4f(min(lit, vec3f(alpha)), alpha);
}
// “发光来源”视图：只显示过了阈值、会发光的部分，其余为黑。
@fragment fn glow_source(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); if (c.a <= 0.00001) { return vec4f(0.0); }
 return premul(toSrgb(glowEmission(c) / c.a), c.a);
}
`
