import { definePlanner } from './effectPlanner'
/**
 * 镜头光晕的工序规划与 WGSL（剪辑内置效果 ABI）。
 *
 * 光核、星芒、横向拉丝与鬼影都是一个点光源的解析式，逐点直接求值，任何分辨率下都锐利、不靠取样。
 * 光晕交给发光金字塔（来源“光源纹理”）：`flare_source` 在半分辨率写光核与星芒，金字塔把它散成光雾，
 * 拖尾 70、核心发白 50 固定。片段上 `flare_image` 先把锐利的光加到画面上，金字塔的合成再叠光雾；
 * 图层拆输出时主图只在内容范围内加光，下层是完整的零 alpha 光（光雾 + 锐利的光）。
 * 不在效果内部抖动：出光即要求高精度（以规划为准），色带由高精度帧的末道抖动处理。锐利的光与光雾用同一个“核心发白”。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { lightGlowParams } from '@/core/videoEdit/glow'
import type { VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'
import { appendGlow, createGlowPlanner, GLOW_COMPOSITE_BLOCK, glowLevelWeights, glowLevels } from './glow'
import { linearHex } from './lightSweep'

export const LENS_FLARE_ENTRIES = ['flare_source', 'flare_image', 'flare_layer_image', 'flare_light'] as const
const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)

/** 光核的标准差（画面高度的比例）。 */
const CORE_SIGMA = 0.003
/**
 * 各部分在亮度 100、对应参数 100 时的峰值（线性光，乘光色之前）。光核要远超 1 才在中心留下一小片白；
 * 送进金字塔的光核更亮，金字塔把它摊到几个倍频程上，光雾本身大多不到 1，不会堆成一个实心的白球。
 */
const CORE_GAIN = 40
const HALO_GAIN = 150
const RAY_GAIN = 1.5
const STREAK_GAIN = 3
const GHOST_GAIN = 0.6
/** 拉丝在水平方向衰减到 1/e 的距离与中心细线的标准差（画面高度的比例）。 */
const STREAK_LENGTH = 0.45
const STREAK_SIGMA = 0.0012

/**
 * 光源在画外时送进金字塔的发光点：贴在最近的画面边缘，按离开的距离 a 摊开（标准差 √(σ² + a²/4)），
 * 峰值按发光每层的权重与宽度换算，让边上的光雾与真实点光源在画外 a 处照到边缘的亮度相同、随 a 连续变暗。
 * 只改亮度不守能量：摊开的发光点被粗层整块接住，守能量会在边上堆出一团过亮的光球。
 */
function haloEmitter(halo: VideoEditBuiltinParams, width: number, height: number, sigma: number, away: number): { spread: number; gain: number } {
  if (away <= 0) return { spread: sigma, gain: 1 }
  const resolution = Number(halo.resolution) / 100
  const { count, reach } = glowLevels(Number(halo.radius), width, height, resolution)
  const weights = glowLevelWeights(count, reach, resolution, height, 0.45 + 0.55 * Number(halo.falloff) / 100, 0, [1, 1, 1], [1, 1, 1])
  const spread = Math.sqrt(sigma * sigma + away * away / 4)
  let real = 0, placed = 0
  weights.forEach(([weight], index) => {
    // 每层高斯约覆盖全分辨率 1.5 / 缩放 像素（发光金字塔的层宽）。
    const level = (1.5 * 2 ** index / resolution) ** 2
    real += weight * sigma * sigma / (sigma * sigma + level) * Math.exp(-away * away / (2 * (sigma * sigma + level)))
    placed += weight * spread * spread / (spread * spread + level)
  })
  return { spread, gain: real / placed }
}

/** `params` 已补齐默认值；`split` 为图层拆输出。 */
export function planLensFlare(params: VideoEditBuiltinParams, width: number, height: number, split = false): VideoEditBuiltinPlan {
  const glow = createGlowPlanner(width, height)
  const light = linearHex(params.color).map(value => value * n(params, 'brightness') / 100)
  if (light.every(value => value <= 0)) { glow.pass('copy', 'input', 'output'); return glow.plan }
  const halo: VideoEditBuiltinParams = { ...lightGlowParams({}), strength: 100, radius: n(params, 'size'), dither: 0 }
  const haloResolution = Number(halo.resolution) / 100
  // 星芒长度跟着光晕大小走：“光晕大小”按发光半径换算出的光晕距离（像素）。
  const reach = 1.5 * 2 ** (glowLevels(Number(halo.radius), width, height, haloResolution).reach - 1) / haloResolution
  const position = [n(params, 'light_x') / 100 * width, n(params, 'light_y') / 100 * height]
  const away = Math.hypot(position[0] - Math.min(width, Math.max(0, position[0])), position[1] - Math.min(height, Math.max(0, position[1])))
  const rays = Math.min(32, Math.max(2, Math.round(n(params, 'ray_count'))))
  // 细节在小尺寸渲染（预览降分辨率）时不能细过取样间距，否则光源挪动不到一个像素就忽亮忽暗：
  // 光核至少 0.75 个纹素宽、拉丝至少 0.6 像素粗，变宽时按能量不变压低峰值。
  const sigma = CORE_SIGMA * height
  const streak = Math.max(STREAK_SIGMA * height, 0.6)
  const uniforms = (target: number, gain: number): Float32Array => {
    const { width: tw, height: th } = glow.plan.scratch[target]
    const core = Math.max(sigma, 0.75 * width / tw)
    const emitter = haloEmitter(halo, width, height, core, away)
    return new Float32Array([tw, th, width, height,
      ...position, core, 0.05 * height + 0.5 * reach,
      ...light, RAY_GAIN * n(params, 'rays') / 100,
      rays, Number(halo.core_white) / 100, 0, 0,
      gain * (sigma / core) ** 2, STREAK_GAIN * n(params, 'streak') / 100 * STREAK_SIGMA * height / streak, STREAK_LENGTH * height, streak,
      GHOST_GAIN * n(params, 'ghosts') / 100, n(params, 'ghost_dispersion') / 100, emitter.spread, emitter.gain])
  }
  const source = glow.alloc(Math.ceil(width / 2), Math.ceil(height / 2), 0.5)
  const image = glow.alloc(width, height)
  glow.plan.passes.push(
    { entry: 'flare_source', source: 'input', target: source, uniforms: uniforms(source, HALO_GAIN) },
    { entry: split ? 'flare_layer_image' : 'flare_image', source: 'input', target: image, uniforms: uniforms(image, CORE_GAIN) },
  )
  appendGlow(glow, halo, width, height, undefined, split, 'light', source, image)
  if (split) {
    const sharp = glow.alloc(width, height)
    glow.plan.passes.push({ entry: 'flare_light', source: glow.plan.underlay!, target: sharp, uniforms: uniforms(sharp, CORE_GAIN) })
    glow.plan.underlay = sharp
  }
  return glow.plan
}

export const LENS_FLARE_WGSL = `
// a = (光源（全分辨率像素）, 光核标准差（已按本道纹素放宽）, 星芒衰减距离)，b = (光色 × 亮度（线性）, 星芒强度)，c = (星芒数量, 核心发白, 0, 0)，
// layer = (光核峰值, 拉丝强度, 拉丝衰减距离, 拉丝粗细)，grid = (鬼影强度, 色散, 画外发光点的标准差, 画外发光点的峰值倍数)；长度都是全分辨率像素。
fn flarePixel(v: Vertex) -> vec2f { return v.position.xy * u.size.zw / u.size.xy; }
fn flareCore(d: vec2f) -> f32 { return exp(-dot(d, d) / (2.0 * u.a.z * u.a.z)); }
fn flareRays(d: vec2f) -> f32 {
 if (u.b.w <= 0.0) { return 0.0; }
 let r2 = dot(d, d);
 // 正好落在光源上的像素没有角度（atan2(0, 0) 无定义），这里本来就只有光核。
 if (r2 < 0.0001) { return 0.0; }
 let r = sqrt(r2);
 // 星芒是细光线：按到最近一道光线的垂直距离取高斯，宽度随距离缓慢变宽，不是越远越胖的扇形。
 let spacing = 6.28318531 / u.c.x; let angle = atan2(d.y, d.x);
 let across = r * sin(abs(angle - round(angle / spacing) * spacing));
 let nominal = 0.6 * u.a.z + 0.004 * r; let width = max(nominal, 0.7 * u.size.z / u.size.x);
 // 贴着光核的一小段让给光核：星芒从光核外缘长出来，中心没有角度突变。
 return u.b.w * nominal / width * exp(-0.5 * across * across / (width * width)) * exp(-r / u.a.w) * (1.0 - exp(-r2 / (4.0 * u.a.z * u.a.z)));
}
fn flareStreak(d: vec2f) -> f32 {
 if (u.layer.y <= 0.0) { return 0.0; }
 let w = u.layer.w; let y2 = d.y * d.y;
 return u.layer.y * exp(-abs(d.x) / u.layer.z) * (0.6 * exp(-y2 / (2.0 * w * w)) + 0.4 * exp(-y2 / (50.0 * w * w)));
}
// 鬼影沿光源与画面中心的连线排开（s = 0.3、0.6、−0.4、1.2）：一层很淡的薄光加一圈柔和的亮边；色散把亮边按颜色错开，红在外、蓝在内。
fn flareGhosts(p: vec2f) -> vec3f {
 if (u.grid.x <= 0.0) { return vec3f(0.0); }
 let center = u.size.zw * 0.5; let axis = center - u.a.xy;
 let scales = array<f32, 4>(0.3, 0.6, -0.4, 1.2);
 let radii = array<f32, 4>(0.035, 0.06, 0.025, 0.09);
 let weights = array<f32, 4>(0.6, 0.35, 0.8, 0.25);
 let spread = 1.0 + vec3f(0.12, 0.0, -0.12) * u.grid.y;
 var sum = vec3f(0.0);
 for (var k = 0; k < 4; k++) {
  let q = vec3f(length(p - center - axis * scales[k]) / (radii[k] * u.size.w)) / spread;
  let rim = (q - 0.85) / 0.1;
  sum += weights[k] * (0.25 * (1.0 - smoothstep(vec3f(0.7), vec3f(1.0), q)) + 0.75 * exp(-rim * rim));
 }
 return sum * u.grid.x;
}
fn flareSharp(p: vec2f) -> vec3f {
 let d = p - u.a.xy;
 return u.b.rgb * (u.layer.x * flareCore(d) + flareRays(d) + flareStreak(d) + flareGhosts(p));
}
// 送进金字塔的光源（预乘线性光）。金字塔只看得到画面里的光，光源在画外时发光点贴着最近的边缘（摊开与亮度见 haloEmitter）。
@fragment fn flare_source(v: Vertex) -> @location(0) vec4f {
 let p = flarePixel(v);
 let e = p - clamp(u.a.xy, vec2f(0.0), u.size.zw);
 let core = exp(-dot(e, e) / (2.0 * u.grid.z * u.grid.z)) * u.grid.w;
 return vec4f(u.b.rgb * (u.layer.x * core + flareRays(p - u.a.xy)), 1.0);
}
@fragment fn flare_image(v: Vertex) -> @location(0) vec4f { let base = tap(uvOf(v)); return glowOnto(straight(base), base.a, flareSharp(flarePixel(v)), false, v.position.xy); }
@fragment fn flare_layer_image(v: Vertex) -> @location(0) vec4f { let base = tap(uvOf(v)); return glowWithin(straight(base), base.a, flareSharp(flarePixel(v)), false, v.position.xy); }
// 图层下层：金字塔交出的光雾（零 alpha 光）上再加锐利的光。
@fragment fn flare_light(v: Vertex) -> @location(0) vec4f { return vec4f(glowColor(tap(uvOf(v)).rgb, flareSharp(flarePixel(v)), false, v.position.xy), 0.0); }
`

export const LENS_FLARE_PLANNER = definePlanner({
  id: 'lens_flare', entries: LENS_FLARE_ENTRIES, shared: [GLOW_COMPOSITE_BLOCK], wgsl: LENS_FLARE_WGSL,
  plan: (params, frame) => planLensFlare(params, frame.width, frame.height, frame.split),
})
