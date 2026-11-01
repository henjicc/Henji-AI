import { definePlanner, type EffectShaderBlock } from './effectPlanner'
import { glowLevelWeights, GLOW_GAIN } from '@/core/videoEdit/glowEnergy'
export { glowLevelWeights } from '@/core/videoEdit/glowEnergy'
import { glowLevels, type LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
export { glowLevels } from '@/core/videoEdit/layerEffectGeometry'
/**
 * 发光的工序规划与 WGSL（剪辑内置效果 ABI：u.size/a/b/c、source/original/sampler，预乘 sRGB 编码）。
 *
 * 工序：按“分辨率”提取发光内容 → 13 点降采样金字塔 → 每层可分离高斯 → 自最粗层逐级 tent 升采样、按层权重累加
 * →（色差）→ 全分辨率合成。中间纹理一律 rgba16float：光在线性光里累加，可以超过 1，到合成时才压回画面范围。
 * 每层高斯在本层纹素里的宽度固定，层越粗覆盖越远，所以大光晕的代价只比小光晕多几道很小的工序。
 * 着色折算成每层的 RGB 权重；色差调用“色差”效果的同一道工序，只作用在累加好的光晕上。
 * 轮廓方式的轮廓来源为主体时，发光内容与光核改读人物蒙版（工序纹理 `subject`），光被人物挡住、叠到人物身后的背景上。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinPlan, VideoEditBuiltinTexture } from './videoEditBuiltinEffectPasses'
import type { VideoEditBuiltinEffectEntry } from './videoEditBuiltinEffectShaders'
import { WHITE_HEX } from '@/core/theme/colorTokens'
import { GLOW_ABERRATION_PREFIX } from '@/core/videoEdit/glow'
import { includedEffectValues } from '@/core/videoEdit/effectIncludes'
import { chromaticAberrationPass } from './chromaticAberration'

export const GLOW_ENTRIES = ['glow_prefilter', 'glow_down', 'glow_blur', 'glow_up', 'glow_composite', 'glow_shape_composite', 'glow_shape_light', 'glow_subject_composite', 'glow_source', 'glow_layer_image', 'glow_layer_light'] as const
type V3 = [number, number, number]
type V4 = readonly [number, number, number, number]
const ZERO: V4 = [0, 0, 0, 0]

/** 每层高斯在本层纹素里的标准差；加上降采样本身的模糊，缩放为 s 的一层约覆盖全分辨率 1.5 / s 像素。 */
const LEVEL_SIGMA = 1
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

const taps = (sigma: number): number => Math.min(48, Math.ceil(sigma * 3))

/** 发光来源：亮部（过阈值的亮处）、轮廓（内容的 alpha）、光源纹理（扫光、溶解显影先画好的预乘线性光）。 */
export type GlowEmission = 'bright' | 'shape' | 'light'
export interface GlowPlanner {
  plan: VideoEditBuiltinPlan
  alloc(width: number, height: number, scale?: number): number
  scale(texture: VideoEditBuiltinTexture): number
  pass(entry: VideoEditBuiltinEffectEntry, source: VideoEditBuiltinTexture, target: VideoEditBuiltinTexture, a?: V4, b?: V4, c?: V4, original?: VideoEditBuiltinTexture): void
}

/** 发光的工序记录器：每道工序带上局部坐标与按层缩放的取样网格；扫光、溶解显影在同一份规划里先画光再接发光。 */
export function createGlowPlanner(width: number, height: number, context?: LayerEffectReference): GlowPlanner {
  const plan: VideoEditBuiltinPlan = { width, height, scratch: [], passes: [], linearScratch: true }
  const scales: number[] = []
  const alloc = (w: number, h: number, scale = 1): number => { plan.scratch.push({ width: w, height: h }); scales.push(scale); return plan.scratch.length - 1 }
  const size = (texture: VideoEditBuiltinTexture): { width: number; height: number } => typeof texture === 'number' ? plan.scratch[texture] : plan
  const scale = (texture: VideoEditBuiltinTexture): number => typeof texture === 'number' ? scales[texture] : 1
  const pass = (entry: VideoEditBuiltinEffectEntry, source: VideoEditBuiltinTexture, target: VideoEditBuiltinTexture, a: V4 = ZERO, b: V4 = ZERO, c: V4 = ZERO, original?: VideoEditBuiltinTexture): void => {
    const from = size(source); const to = size(target)
    const spatial = context ? [context.rasterOrigin[0], context.rasterOrigin[1], context.referenceSize.height * context.rasterScale, 0] : [0, 0, 0, 0]
    const fromScale = scale(source)
    const toScale = scale(target)
    const ratio = fromScale / toScale
    const grid = context ? [ratio, ...context.rasterOrigin.map(origin => Math.ceil(origin * fromScale) - Math.ceil(origin * toScale) * ratio), 1 / toScale] : [0, 0, 0, 0]
    plan.passes.push({ entry, source, target, ...(original !== undefined ? { original } : {}), uniforms: new Float32Array([to.width, to.height, from.width, from.height, ...a, ...b, ...c, ...(context ? [...spatial, ...grid] : [])]) })
  }
  return { plan, alloc, scale, pass }
}

/** a = (阈值, 过渡半宽, 原画不透明度, 着色量)：提取、合成与“发光来源”视图共用；轮廓与光源纹理用负的阈值标记来源。 */
function emissionUniform(params: VideoEditBuiltinParams, emission: GlowEmission): V4 {
  const sourceOpacity = numeric(params, 'source_opacity', 100) / 100
  if (emission === 'shape') return [-1, 0.001, sourceOpacity, 1]
  if (emission === 'light') return [-2, 0.001, 1, 0]
  return [numeric(params, 'threshold') / 100, Math.max(0.001, numeric(params, 'threshold_smoothness') / 100 * 0.5), sourceOpacity, numeric(params, 'tint') / 100]
}

/** `params` 已补齐默认值。 */
export function planGlow(params: VideoEditBuiltinParams, width: number, height: number, context?: LayerEffectReference, split = false): VideoEditBuiltinPlan {
  const glow = createGlowPlanner(width, height, context)
  const emission: GlowEmission = params.mode === 'shape' ? 'shape' : 'bright'
  const source: VideoEditBuiltinTexture = emission === 'shape' && params.contour === 'subject' ? 'subject' : 'input'
  const strength = numeric(params, 'strength') / 100
  const sourceOpacity = numeric(params, 'source_opacity', 100) / 100
  if (params.view === 'source') { glow.pass('glow_source', source, 'output', emissionUniform(params, emission)); return glow.plan }
  if (split && strength === 0) { glow.pass('effect_opacity', 'input', 'output', [sourceOpacity, 0, 0, 0]); return glow.plan }
  if (strength === 0 && sourceOpacity === 1) { glow.pass('copy', 'input', 'output'); return glow.plan }
  appendGlow(glow, params, width, height, context, split, emission, source, 'input')
  return glow.plan
}

/**
 * 在 `glow` 里接上金字塔与合成，写到 'output'（图层拆输出时另写 `plan.underlay`）。
 * `source` 是发光来源的纹理；`base` 是光要叠上去的画面（亮部、轮廓都是效果输入，光源纹理时是扫光、溶解画好的主图）。
 * 轮廓方式的光在内容后面：主图只按原画不透明度，光不给内容加核心提亮。
 */
export function appendGlow(glow: GlowPlanner, params: VideoEditBuiltinParams, width: number, height: number, context: LayerEffectReference | undefined, split: boolean, emission: GlowEmission, source: VideoEditBuiltinTexture, base: VideoEditBuiltinTexture): void {
  const { plan, alloc, pass } = glow
  const strength = numeric(params, 'strength') / 100
  const sourceOpacity = numeric(params, 'source_opacity', 100) / 100
  const uniform = emissionUniform(params, emission)
  const tint = uniform[3]
  const original = base === 'input' ? undefined : base

  const resolution = Math.min(1, Math.max(0.25, numeric(params, 'resolution', 50) / 100))
  const inner = linearColor(params.tint_inner); const outer = linearColor(params.tint_outer)
  const referenceHeight = context ? context.referenceSize.height * context.rasterScale : height
  const { first, count, reach } = glowLevels(numeric(params, 'radius'), width, height, resolution, referenceHeight)
  const weights = glowLevelWeights(count, reach, resolution, referenceHeight, 0.45 + 0.55 * numeric(params, 'falloff') / 100, tint, inner, outer)
  const gain = strength * strength * GLOW_GAIN
  const core = emission === 'light' ? [0, 0, 0] as V3 : inner.map(value => (1 + (value - 1) * tint) * CORE * gain) as V3

  const levels: number[] = [alloc(first.width, first.height, resolution)]
  for (let index = 1; index < count; index++) { const previous = plan.scratch[levels[index - 1]]; levels.push(alloc(Math.max(1, Math.ceil(previous.width / 2)), Math.max(1, Math.ceil(previous.height / 2)), resolution / 2 ** index)) }
  pass('glow_prefilter', source, levels[0], uniform)
  for (let index = 1; index < count; index++) pass('glow_down', levels[index - 1], levels[index])

  // 长宽比为正时沿“角度”拉长，为负时沿与它垂直的方向拉长。
  const aspectValue = numeric(params, 'aspect')
  const aspect = ASPECT_MAX ** (Math.min(100, Math.abs(aspectValue)) / 100)
  const angle = (numeric(params, 'angle') + (aspectValue < 0 ? 90 : 0)) * Math.PI / 180
  const along: [number, number] = [Math.cos(angle), Math.sin(angle)]; const across: [number, number] = [-along[1], along[0]]
  const middles: number[] = []
  const blurred = levels.map(level => {
    const { width: lw, height: lh } = plan.scratch[level]
    const middle = alloc(lw, lh, glow.scale(level)); const out = alloc(lw, lh, glow.scale(level)); middles.push(middle)
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
  const aberration = chromaticAberrationPass(includedEffectValues(params, GLOW_ABERRATION_PREFIX), context ? first.width : width, context ? first.height : height, true, context ? { ...context, rasterScale: context.rasterScale * resolution, rasterOrigin: context.rasterOrigin.map(value => Math.ceil(value * resolution)) as [number, number] } : undefined)
  if (aberration) {
    pass(aberration.entry, accumulated, middles[0], aberration.a, aberration.b, aberration.c)
    if (context) plan.passes.at(-1)!.uniforms.set(aberration.spatial, 16)
    accumulated = middles[0]
  }
  const b: V4 = [...core, params.blend === 'screen' ? 1 : 0]
  const c: V4 = [gain, numeric(params, 'core_white') / 100, numeric(params, 'dither', 50) / 100, params.dither_mono === true ? 1 : 0]
  if (emission === 'shape') {
    if (source === 'subject' && !split) {
      // 片段不透明度在效果链之后整体乘，光跟着片段一起淡入淡出。
      pass('glow_subject_composite', accumulated, 'output', uniform, b, c)
      plan.passes.at(-1)!.mask = 'subject'
      return
    }
    if (!split) { pass('glow_shape_composite', accumulated, 'output', uniform, b, c); return }
    const light = alloc(width, height)
    pass('glow_shape_light', accumulated, light, uniform, b, c)
    plan.underlay = light
    if (sourceOpacity === 1) pass('copy', 'input', 'output')
    else pass('effect_opacity', 'input', 'output', [sourceOpacity, 0, 0, 0])
    return
  }
  pass('glow_composite', accumulated, 'output', uniform, b, c, original)
  if (split && strength > 0) {
    const image = plan.passes.at(-1)!
    image.entry = 'glow_layer_image'
    const light = alloc(width, height)
    plan.passes.push({ ...image, entry: 'glow_layer_light', target: light, uniforms: image.uniforms.slice() })
    plan.underlay = light
  }
}

export const GLOW_WGSL = `
// 局部纹理按内容原点定位采样网格，外扩尺寸变化不缩放网格或移动噪声。
fn glowUv(v: Vertex) -> vec2f {
 if (u.grid.x > 0.0) { return (v.position.xy * u.grid.x + u.grid.yz) / u.size.zw; }
 return uvOf(v);
}

// 发光内容（预乘线性光）。a = (阈值, 过渡半宽, 原画不透明度, 着色量)。
// 阈值按直通色最亮的通道比较，纯红、纯蓝的霓虹和白光一样容易过阈值；着色量把颜色先褪成同样亮度的白光，再在各层上色。
// 阈值为负标记另外两种来源：-1 轮廓（只看 alpha 的白光，颜色由层权重给出），-2 光源纹理（输入已是预乘线性光）。
fn glowEmission(c: vec4f) -> vec3f {
 if (u.a.x < -1.5) { return c.rgb; }
 if (c.a <= 0.00001) { return vec3f(0.0); }
 if (u.a.x < -0.5) { return vec3f(c.a); }
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
 return vec4f(glowBoxes(glowUv(v), select(0.5 / u.size.xy, vec2f(0.5 * u.grid.w) / u.size.zw, u.grid.x > 0.0), true), 1.0);
}
@fragment fn glow_down(v: Vertex) -> @location(0) vec4f {
 return vec4f(glowBoxes(glowUv(v), 1.0 / u.size.zw, false), 1.0);
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
 return vec4f(tapOriginal(uv).rgb * u.a.rgb + glowTent(glowUv(v), 1.0 / u.size.zw) * u.b.rgb, 1.0);
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
// 光核：贴着发光内容的那一点光，取发光内容在 1.5/1080 画面高度内的小十字平均。
fn glowCore(image: texture_2d<f32>, v: Vertex) -> vec3f {
 let uv = uvOf(v);
 let dims = vec2f(textureDimensions(image));
 let h = select(dims.y, u.layer.z, u.layer.z > 0.0);
 let step = vec2f(1.5 / 1080.0 * h) / dims;
 return glowEmission(textureSampleLevel(image, s, uv, 0.0)) * 0.5 + (glowEmission(textureSampleLevel(image, s, uv + vec2f(step.x, 0.0), 0.0)) + glowEmission(textureSampleLevel(image, s, uv - vec2f(step.x, 0.0), 0.0)) + glowEmission(textureSampleLevel(image, s, uv + vec2f(0.0, step.y), 0.0)) + glowEmission(textureSampleLevel(image, s, uv - vec2f(0.0, step.y), 0.0))) * 0.125;
}
// 光核与光晕共用正式提取、shoulder 与抖动公式；输出方式由宿主合成语义决定。
fn glowLight(v: Vertex) -> vec3f {
 return glowTent(glowUv(v), 1.0 / u.size.zw) * u.c.x + glowCore(original, v) * u.b.rgb;
}
fn glowColor(before: vec3f, light: vec3f, screen: bool, position: vec2f) -> vec3f {
 let b = toLinear(before);
 var rgb: vec3f;
 if (screen) { rgb = vec3f(1.0) - (vec3f(1.0) - b) * exp(-light); }
 else {
  let room = max(vec3f(1.0) - b, vec3f(0.0001));
  rgb = b + room * glowShoulder(light / room);
  let overflow = max(light - (rgb - b), vec3f(0.0));
  rgb = mix(rgb, vec3f(1.0), clamp(glowLuma(overflow) * u.c.y, 0.0, 1.0));
 }
 let encoded = toSrgb(rgb);
 let changed = clamp(glowPeak(encoded - before) * 510.0, 0.0, 1.0);
 return clamp(encoded + glowNoise(position - u.layer.xy, u.c.w > 0.5) * (u.c.z * 2.0 / 255.0) * changed, vec3f(0.0), vec3f(1.0));
}
@fragment fn glow_composite(v: Vertex) -> @location(0) vec4f {
 let base = tapOriginal(uvOf(v));
 return glowOnto(straight(base), base.a * u.a.z, glowLight(v), u.b.w > 0.5, v.position.xy);
}
// 轮廓方式：光在内容后面，按显示出来的 alpha 挡住（原画不透明度为 0 时光完整露出，与图层拆输出一致）。
@fragment fn glow_shape_composite(v: Vertex) -> @location(0) vec4f {
 let base = tapOriginal(uvOf(v)) * u.a.z;
 let lit = glowColor(vec3f(0.0), glowLight(v), u.b.w > 0.5, v.position.xy);
 return base + vec4f(lit, glowPeak(lit)) * (1.0 - base.a);
}
// 轮廓来源为主体：光核来自人物蒙版（gradeMask 的 a），光被人物挡住（乘 1 − 人物），按混合模式叠到人物身后的原画上，
// 只照亮片段画面内（乘 r 片段覆盖）：画中画里人物被片段边裁断时，边外不出光带。
@fragment fn glow_subject_composite(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let base = tapOriginal(uv);
 let matte = textureSampleLevel(gradeMask, s, uv, 0.0);
 let light = (glowTent(glowUv(v), 1.0 / u.size.zw) * u.c.x + glowCore(gradeMask, v) * u.b.rgb) * (1.0 - matte.a) * matte.r;
 return glowOnto(straight(base), base.a * u.a.z, light, u.b.w > 0.5, v.position.xy);
}
// 轮廓方式的图层下层：光整个在内容后面，与片段入口一样按混合模式叠到黑底上（相加或滤色），再作为零 alpha 光交出去。
@fragment fn glow_shape_light(v: Vertex) -> @location(0) vec4f {
 return vec4f(glowColor(vec3f(0.0), glowLight(v), u.b.w > 0.5, v.position.xy), 0.0);
}
@fragment fn glow_layer_image(v: Vertex) -> @location(0) vec4f {
 let base = tapOriginal(uvOf(v));
 return glowWithin(straight(base), base.a * u.a.z, glowLight(v), u.b.w > 0.5, v.position.xy);
}
@fragment fn glow_layer_light(v: Vertex) -> @location(0) vec4f {
 return vec4f(glowColor(vec3f(0.0), glowLight(v), false, v.position.xy), 0.0);
}
// “发光来源”视图：只显示过了阈值、会发光的部分，其余为黑。
@fragment fn glow_source(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); if (c.a <= 0.00001) { return vec4f(0.0); }
 return premul(toSrgb(glowEmission(c) / c.a), c.a);
}
`

/**
 * 光加到画面上的规则（glowColor 的相加或滤色），发光、镜头光晕、漏光共用。`color` 是直通色，`shown` 是显示出来的不透明度。
 * glowOnto：片段上光可以照亮透明处，不透明度升到光的峰值；glowWithin：图层拆输出的主图，光只加在内容范围内，内容外的光由零 alpha 的下层交出。
 */
export const GLOW_COMPOSITE_BLOCK: EffectShaderBlock = { name: 'glow-composite', wgsl: `
fn glowOnto(color: vec3f, shown: f32, light: vec3f, screen: bool, position: vec2f) -> vec4f {
 let lit = glowColor(color * shown, light, screen, position);
 let alpha = max(shown, glowPeak(lit));
 if (alpha <= 0.00001) { return vec4f(0.0); }
 return vec4f(min(lit, vec3f(alpha)), alpha);
}
fn glowWithin(color: vec3f, shown: f32, light: vec3f, screen: bool, position: vec2f) -> vec4f {
 return vec4f(glowColor(color, light, screen, position) * shown, shown);
}
` }

export const GLOW_PLANNER = definePlanner({
  id: 'glow', entries: GLOW_ENTRIES, shared: [GLOW_COMPOSITE_BLOCK], wgsl: GLOW_WGSL,
  plan: (params, frame, instance) => planGlow(params, frame.width, frame.height, frame.layer, frame.split),
})
