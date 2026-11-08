import { definePlanner, effectClockSeconds, type EffectPlannerFrame, type EffectShaderBlock } from './effectPlanner'
import { EFFECT_MATH_BLOCK } from './effectShaderPrelude'
import { effectHash } from './effectShaderMath'
import { Planner, ZERO, type Vec4, type VideoEditBuiltinPlan } from './effectPlan'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { cornerPinQuad, displaceNoiseSize, mirrorNormal, repeatLayout, repeatLinearStep, warpDistance, waveLength, warpFrameSeed } from '@/core/videoEdit/warps'
import { invertVideoEditTrackMatrix, isVideoEditTrackQuad, videoEditCornerPinMatrix } from '@/core/videoEdit/tracking'
/**
 * 变形的工序规划与 WGSL（剪辑内置效果 ABI）：七个效果各一道工序；噪声位移（流动、置换·噪声）多一道缩小的位移场。
 *
 * 坐标统一是“内容像素”：纹理像素减去内容原点。片段上内容就是整张纹理；图层上是 `rasterOrigin` 起、
 * 内容框乘栅格比例那么大的一块，四周是外扩。uniform 在 a、b、c 之后追加 layer = (内容原点, 内容框大小)、
 * grid = (边缘方式, 画面高度（纹理像素）, 变形种类, 0)。
 */

const number = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)
const EDGE_MODES: Record<string, number> = { transparent: 0, clamp: 1, mirror: 2 }
const WAVEFORMS: Record<string, number> = { sine: 0, triangle: 1, square: 2, sawtooth: 3 }
/** 着色器里 `u.grid.z` 的变形种类。 */
const WARP_KIND = { mirror: 0, bulge: 1, twirl: 2, wave: 3, cornerPin: 4, displace: 5 } as const
type WarpKind = typeof WARP_KIND[keyof typeof WARP_KIND]
const REPEAT_KIND = { grid: 0, linear: 1, ring: 2 } as const

interface WarpGeometry { origin: readonly [number, number]; box: readonly [number, number]; H: number }
function geometryOf(frame: EffectPlannerFrame): WarpGeometry {
  const layer = frame.layer
  if (!layer) return { origin: [0, 0], box: [frame.width, frame.height], H: frame.height }
  return { origin: layer.rasterOrigin, box: [layer.contentBounds.width * layer.rasterScale, layer.contentBounds.height * layer.rasterScale], H: layer.referenceSize.height * layer.rasterScale }
}
function withGeometry(plan: Planner, geometry: WarpGeometry, grid: Vec4): void {
  for (const pass of plan.passes) pass.uniforms = Float32Array.from([...pass.uniforms, ...geometry.origin, ...geometry.box, ...grid])
}
/** 变形规划都标 `remap`（拆出的光与影跟着一起变形），只有按自身亮度置换不标：它的位移场取决于输入画面。 */
function single(frame: EffectPlannerFrame, entry: 'warp' | 'warp_repeat' | 'copy' | 'effect_opacity', geometry?: WarpGeometry, grid: Vec4 = ZERO, a: Vec4 = ZERO, b: Vec4 = ZERO, c: Vec4 = ZERO, remap = entry !== 'copy'): VideoEditBuiltinPlan {
  const plan = new Planner(frame.width, frame.height)
  plan.pass(entry, 'input', 'output', a, b, undefined, c)
  if (geometry) withGeometry(plan, geometry, grid)
  return { width: frame.width, height: frame.height, scratch: plan.scratch, passes: plan.passes, ...(remap ? { remap } : {}) }
}
const copy = (frame: EffectPlannerFrame): VideoEditBuiltinPlan => single(frame, 'copy')
/** 边缘方式只在整幅画面（片段、调整层）上生效；代码图层一律透明，见 warps.ts 的 EDGES。 */
const gridOf = (frame: EffectPlannerFrame, params: VideoEditBuiltinParams, geometry: WarpGeometry, kind: WarpKind): Vec4 => [frame.layer ? 0 : EDGE_MODES[String(params.edges)] ?? 0, geometry.H, kind, 0]
function warp(frame: EffectPlannerFrame, params: VideoEditBuiltinParams, kind: WarpKind, a: Vec4, b: Vec4 = ZERO, c: Vec4 = ZERO, remap = true): VideoEditBuiltinPlan {
  const geometry = geometryOf(frame)
  return single(frame, 'warp', geometry, gridOf(frame, params, geometry, kind), a, b, c, remap)
}
/**
 * 噪声位移（流动、置换·噪声）：位移场平滑，先在缩小的网格上算一次（每个最细的起伏至少六个点，最多缩到四分之一），
 * 变形工序按三次 B 样条取回。每个像素不再各算四到六次单形噪声，多点取样时也只多取几次位移场。
 * `finest` 是最细一层起伏的大小（纹理像素）。
 */
function noiseWarp(frame: EffectPlannerFrame, params: VideoEditBuiltinParams, kind: WarpKind, finest: number, a: Vec4, b: Vec4, c: Vec4): VideoEditBuiltinPlan {
  const geometry = geometryOf(frame), factor = Math.max(1, Math.min(4, Math.floor(finest / 6)))
  const plan = new Planner(frame.width, frame.height)
  const field = plan.alloc(Math.ceil(frame.width / factor), Math.ceil(frame.height / factor))
  plan.pass('warp_field', 'input', field, a, b, undefined, c)
  plan.pass('warp', 'input', 'output', a, b, field, c)
  withGeometry(plan, geometry, gridOf(frame, params, geometry, kind))
  const [fieldPass, warpPass] = plan.passes, { width, height } = plan.scratch[field]
  return {
    width: frame.width, height: frame.height, scratch: plan.scratch, passes: plan.passes, linearScratch: true, remap: true,
    remapField: {
      format: 'rgba16float',
      field: { width, height, scratch: [], passes: [{ ...fieldPass, target: 'output' }] },
      warp: { width: frame.width, height: frame.height, scratch: [], passes: [{ ...warpPass, original: 'second' }], remap: true },
    },
  }
}
const centerOf = (params: VideoEditBuiltinParams, { box }: WarpGeometry): [number, number] => [number(params, 'center_x') / 100 * box[0], number(params, 'center_y') / 100 * box[1]]
/** 随机种子 → 噪声平面上的偏移（0–200 个噪声格），`salt` 区分各层各分量。 */
const offset = (seed: number, salt: number): number => effectHash(Math.round(seed), salt) / 2 ** 32 * 200
/**
 * 共用单形噪声按 289 取模，在输入平面上以六边形格子为周期：G = (3 − √3) / 6，A = (289 − 289G, −289G)，B = (−289G, 289 − 289G)。
 * 漂移沿格子方向走、按格子长度取余，时钟走多久传给着色器的数都在一个周期以内，不会因 f32 精度按台阶走。
 * 流动两层沿 A + B 与 B（同长约 236），置换沿 A + 4B（约 851，接近竖直向上）；着色器里的单位方向与这里一致。
 */
const NOISE_G = (3 - Math.sqrt(3)) / 6
const FLOW_DRIFT_PERIOD = Math.hypot(289 * NOISE_G, 289 - 289 * NOISE_G)
const DISPLACE_DRIFT_PERIOD = Math.hypot(289 - 289 * NOISE_G - 4 * 289 * NOISE_G, -289 * NOISE_G + 4 * (289 - 289 * NOISE_G))
const wrapDrift = (value: number, period: number): number => value - Math.floor(value / period) * period
/** 相位（周数）：相位参数加上时钟乘速度（100 每秒一周）。时钟是 effectClockSeconds 求出的秒数：片段按片段内帧号，代码图层按源时间帧位置（慢放带小数），static 模块为 0。 */
function cycles(params: VideoEditBuiltinParams, time: number | undefined, phase = true): number {
  return (phase ? number(params, 'phase') / 360 : 0) + number(params, 'speed') / 100 * (time ?? 0)
}

export function planMirror(params: VideoEditBuiltinParams, frame: EffectPlannerFrame): VideoEditBuiltinPlan {
  const [cx, cy] = centerOf(params, geometryOf(frame)), [nx, ny] = mirrorNormal(params)
  return warp(frame, params, WARP_KIND.mirror, [cx, cy, nx, ny], [params.side === 'back' ? 1 : 0, 0, 0, 0])
}

export function planBulge(params: VideoEditBuiltinParams, frame: EffectPlannerFrame): VideoEditBuiltinPlan {
  const geometry = geometryOf(frame), radius = number(params, 'radius') / 100 * geometry.H, value = number(params, 'amount') / 100
  if (radius < 0.5 || value === 0) return copy(frame)
  return warp(frame, params, WARP_KIND.bulge, [...centerOf(params, geometry), radius, value], [params.shape === 'sphere' ? 1 : 0, 0, 0, 0])
}

export function planTwirl(params: VideoEditBuiltinParams, frame: EffectPlannerFrame): VideoEditBuiltinPlan {
  const geometry = geometryOf(frame), radius = number(params, 'radius') / 100 * geometry.H, turn = number(params, 'angle') * Math.PI / 180
  if (radius < 0.5 || turn === 0) return copy(frame)
  const rings = params.mode === 'rings'
  return warp(frame, params, WARP_KIND.twirl, [...centerOf(params, geometry), radius, turn],
    [rings ? 1 : 0, Math.max(2, Math.round(number(params, 'rings'))), number(params, 'ring_random') / 100, number(params, 'ring_softness') / 100], [effectHash(Math.round(number(params, 'seed')), 0) % 65_521, 0, 0, 0])
}

export function planWave(params: VideoEditBuiltinParams, frame: EffectPlannerFrame, time?: number): VideoEditBuiltinPlan {
  const geometry = geometryOf(frame), amplitude = warpDistance(number(params, 'amount')) * geometry.H
  if (amplitude <= 0) return copy(frame)
  const length = Math.max(1, waveLength(number(params, 'wavelength')) * geometry.H), phase = cycles(params, time)
  if (params.mode === 'flow') {
    const seed = number(params, 'seed')
    // 单形噪声一格里有两三个漩涡，噪声格取三倍波长，漩涡大小与波浪方式的一道波相当；细节层的漩涡约为它的 1/5。
    return noiseWarp(frame, params, WARP_KIND.wave, length * 3 / 2.3 / 2, [0, 0, length * 3, amplitude], [1, 0, wrapDrift(phase, FLOW_DRIFT_PERIOD), number(params, 'detail') / 100], [offset(seed, 1), offset(seed, 2), offset(seed, 3), offset(seed, 4)])
  }
  const direction = number(params, 'direction') * Math.PI / 180
  // 波浪方式只用相位的小数部分：时钟走得再久，传给着色器的数也不丢精度。
  return warp(frame, params, WARP_KIND.wave, [Math.cos(direction), Math.sin(direction), length, amplitude], [0, WAVEFORMS[String(params.waveform)] ?? 0, phase - Math.floor(phase), 0])
}

export function planCornerPin(params: VideoEditBuiltinParams, frame: EffectPlannerFrame): VideoEditBuiltinPlan {
  const quad = cornerPinQuad(params)
  if (quad.every(([x, y], index) => x === [0, 1, 1, 0][index] && y === [0, 0, 1, 1][index])) return copy(frame)
  // 交叉或退化的四边形没有把整块内容贴上去的透视，内容消失（说明里写明要围成凸四边形）。
  if (!isVideoEditTrackQuad(quad)) return single(frame, 'effect_opacity')
  const m = invertVideoEditTrackMatrix(videoEditCornerPinMatrix(quad))
  return warp(frame, params, WARP_KIND.cornerPin, [m[0], m[1], m[2], m[3]], [m[4], m[5], m[6], m[7]], [m[8], 0, 0, 0])
}

export function planDisplace(params: VideoEditBuiltinParams, frame: EffectPlannerFrame, time?: number): VideoEditBuiltinPlan {
  const geometry = geometryOf(frame), amplitude = warpDistance(number(params, 'amount')) * geometry.H
  if (amplitude <= 0) return copy(frame)
  if (params.source === 'luma') {
    const direction = number(params, 'angle') * Math.PI / 180
    return warp(frame, params, WARP_KIND.displace, [amplitude, 1, Math.cos(direction), Math.sin(direction)], ZERO, ZERO, false)
  }
  const seed = number(params, 'seed'), size = Math.max(1, displaceNoiseSize(number(params, 'scale')) * geometry.H)
  return noiseWarp(frame, params, WARP_KIND.displace, size / 2.3, [amplitude, 0, 0, 0], [size, number(params, 'detail') / 100, wrapDrift(cycles(params, time, false), DISPLACE_DRIFT_PERIOD), 0], [offset(seed, 5), offset(seed, 6), offset(seed, 7), offset(seed, 8)])
}

export function planRepeat(params: VideoEditBuiltinParams, frame: EffectPlannerFrame): VideoEditBuiltinPlan {
  const geometry = geometryOf(frame), layout = repeatLayout(params), [width, height] = geometry.box
  const grid = (kind: number): Vec4 => [0, geometry.H, kind, 0]
  if (layout.mode === 'grid') {
    if (layout.columns === 1 && layout.rows === 1) return copy(frame)
    const cellWidth = width * (1 + layout.spacing), cellHeight = height * (1 + layout.spacing)
    return single(frame, 'warp_repeat', geometry, grid(REPEAT_KIND.grid), [layout.columns, layout.rows, cellWidth, cellHeight],
      [layout.stagger * cellWidth, layout.scale, layout.fade, 1 + layout.spacing], [(width - layout.columns * cellWidth) / 2, (height - layout.rows * cellHeight) / 2, 0, 0])
  }
  if (layout.mode === 'linear') {
    if (layout.count === 1) return copy(frame)
    const [sx, sy] = repeatLinearStep(params, width, height)
    return single(frame, 'warp_repeat', geometry, grid(REPEAT_KIND.linear), [layout.count, sx, sy, 0], [layout.scale, layout.fade, 0, 0])
  }
  return single(frame, 'warp_repeat', geometry, grid(REPEAT_KIND.ring), [layout.count, number(params, 'radius') / 100 * geometry.H, params.face_center === true ? 1 : 0, 0], [layout.scale, layout.fade, 0, 0])
}

export const WARP_WGSL = `
// —— 变形 ——
// 内容像素 p = 纹理像素 − u.layer.xy；内容框大小 u.layer.zw；u.grid = (边缘 0 透明 / 1 重复边缘 / 2 镜像, 画面高度, 种类, 0)。
fn warpCover(q: vec2f, size: vec2f) -> f32 {
 let lo = clamp(q + 0.5, vec2f(0.0), vec2f(1.0)); let hi = clamp(size - q + 0.5, vec2f(0.0), vec2f(1.0));
 return lo.x * lo.y * hi.x * hi.y;
}
// 取纹理（纹理像素坐标）：纹理外透明，边界一像素内按零边框的双线性渐隐，变形后的边缘不出锯齿、不发黑。
fn warpTexel(q: vec2f) -> vec4f {
 let cover = warpCover(q, u.size.zw);
 if (cover <= 0.0) { return vec4f(0.0); }
 return textureSampleLevel(source, s, q / u.size.zw, 0.0) * cover;
}
fn warpReflect(x: vec2f, size: vec2f) -> vec2f { let t = x - 2.0 * size * floor(x / (2.0 * size)); return select(t, 2.0 * size - t, t > size); }
// 取内容 q 处的颜色。“重复边缘 / 镜像”只出现在整幅画面上（规划在图层上一律给透明），那里内容框就是整张纹理。
fn warpTap(q: vec2f) -> vec4f {
 let box = u.layer.zw;
 var at = q;
 if (u.grid.x > 0.5) {
  if (u.grid.x > 1.5) { at = warpReflect(at, box); }
  at = clamp(at, vec2f(0.5), max(box - 0.5, vec2f(0.5)));
 }
 return warpTexel(at + u.layer.xy);
}
fn warpRotate(q: vec2f, turn: f32) -> vec2f { let c = cos(turn); let n = sin(turn); return vec2f(q.x * c - q.y * n, q.x * n + q.y * c); }
// 一周内 f 处的波形，−1..1：正弦、三角、方波、锯齿，都从 0 起往上走。
fn warpWaveform(f: f32, form: f32) -> f32 {
 if (form < 0.5) { return sin(f * 6.2831853); }
 if (form < 1.5) { return 4.0 * abs(fract(f - 0.25) - 0.5) - 1.0; }
 if (form < 2.5) { return select(-1.0, 1.0, fract(f) < 0.5); }
 return 2.0 * fract(f + 0.5) - 1.0;
}
// 单形噪声的旋度（无散的流动场），按平均坡度约 2.9 归一：平均位移等于幅度（最远处见 waveFlowReach）。
fn warpCurl(q: vec2f) -> vec2f {
 let e = 0.01; let base = simplexNoise(q);
 return vec2f(simplexNoise(q + vec2f(0.0, e)) - base, base - simplexNoise(q + vec2f(e, 0.0))) / (e * 2.9);
}
// 噪声位移场（除以幅度），在缩小的网格上算：流动是两层单形噪声的旋度，置换·噪声是两层单形噪声，
// 细节层频率 2.3 倍、权重为细节的一半。b.z 是漂移（已按噪声周期取余），c 是随机偏移。
// 漂移方向是噪声周期格子的单位方向（见 warp.ts 的 FLOW_DRIFT_PERIOD），倍数取整数，取余后画面连续。
fn warpNoise(p: vec2f) -> vec2f {
 if (u.grid.z < 3.5) {
  let q = p / u.a.z; let drift = u.b.z;
  return warpCurl(q + u.c.xy + drift * vec2f(0.70710678, 0.70710678)) + warpCurl(q * 2.3 + u.c.zw - drift * vec2f(-0.25881905, 0.96592583)) * u.b.w * 0.5;
 }
 // 置换往上漂：沿接近竖直的周期方向，细节层快三倍。
 let q = p / u.b.x; let rise = u.b.z * vec2f(-0.01923433, 0.99981500);
 return vec2f(simplexNoise(q + u.c.xy + rise), simplexNoise(q + u.c.zw + rise))
  + vec2f(simplexNoise(q * 2.3 + u.c.yx + rise * 3.0), simplexNoise(q * 2.3 + u.c.wz + rise * 3.0)) * u.b.y * 0.5;
}
// 位移场网格的像素中心对应原尺寸的同一位置：p = 网格坐标 × (原尺寸 / 网格尺寸) − 内容原点。
@fragment fn warp_field(v: Vertex) -> @location(0) vec4f { return vec4f(warpNoise(v.position.xy * u.size.zw / u.size.xy - u.layer.xy), 0.0, 1.0); }
// 变形工序里位移场绑在 original 上，B 样条取回保持平滑，细线弯过去不出折角。
fn warpField(p: vec2f) -> vec2f { return sampleBSpline(original, s, (p + u.layer.xy) / u.size.zw).xy; }
// 同心环第 i 圈转的角度：环外不转，最里面一圈以内沿用第一圈。
fn warpRingTurn(i: f32) -> f32 {
 if (i >= u.b.y) { return 0.0; }
 return u.a.w * (1.0 - u.b.z * 2.0 * hash(vec2u(u32(max(i, 0.0)), 0u), u32(u.c.x)));
}
// 输出像素 p 要取的内容位置与权重（权重 0：这一点没有内容，例如边角定位的地平线以外）。
fn warpMap(p: vec2f) -> vec3f {
 let kind = u.grid.z;
 if (kind < 0.5) {
  // 镜像：a = (镜面经过的点, 法线)，b.x 保留后侧。
  let d = dot(p - u.a.xy, u.a.zw);
  let keep = select(d <= 0.0, d >= 0.0, u.b.x > 0.5);
  return vec3f(select(p - 2.0 * d * u.a.zw, p, keep), 1.0);
 }
 if (kind < 1.5) {
  // 膨胀：a = (中心, 半径, 数量 −1..1)，b.x 球面。
  let q = p - u.a.xy; let r = length(q); let x = r / u.a.z;
  if (x >= 1.0 || r <= 0.0) { return vec3f(p, 1.0); }
  var t = x * (1.0 - min(u.a.w, 0.95) * (1.0 - x * x) * (1.0 - x * x));
  if (u.b.x > 0.5) { t = select(x + (sin(x * 1.5707963) - x) * -u.a.w, x + (asin(x) * 0.63661977 - x) * u.a.w, u.a.w >= 0.0); }
  return vec3f(u.a.xy + q * (t / x), 1.0);
 }
 if (kind < 2.5) {
  // 旋转扭曲：a = (中心, 半径, 角度（弧度）)，b = (同心环, 环数, 随机, 柔和度)，c.x 种子。
  let q = p - u.a.xy; let x = length(q) / u.a.z;
  var turn = 0.0;
  if (u.b.x > 0.5) {
   // 每圈中线上转满本圈的角度，两圈交界处按柔和度过渡；最外一圈与环外之间同样过渡。
   let ring = x * u.b.y - 0.5; let below = floor(ring);
   turn = mix(warpRingTurn(below), warpRingTurn(below + 1.0), ramp(0.5 - u.b.w * 0.5, 0.5 + u.b.w * 0.5, ring - below));
  } else if (x < 1.0) { turn = u.a.w * (1.0 - x) * (1.0 - x); }
  return vec3f(u.a.xy + warpRotate(q, -turn), 1.0);
 }
 if (kind < 3.5) {
  // 波动：a = (波浪的前进方向, 波长（流动时是噪声格）, 幅度)，b = (流动, 波形, 相位（周）, 细节)，c = 流动的随机偏移；流动按位移场。
  if (u.b.x < 0.5) {
   let f = dot(p, u.a.xy) / u.a.z - u.b.z;
   return vec3f(p - vec2f(-u.a.y, u.a.x) * u.a.w * warpWaveform(f, u.b.y), 1.0);
  }
  return vec3f(p - warpField(p) * u.a.w, 1.0);
 }
 if (kind < 4.5) {
  // 边角定位：a、b、c.x 是输出（内容框比例）到原内容的逆透视矩阵，按行存放。
  let box = u.layer.zw; let x = p / box;
  let w = u.b.z * x.x + u.b.w * x.y + u.c.x;
  if (w <= 0.000001) { return vec3f(p, 0.0); }
  return vec3f(vec2f(u.a.x * x.x + u.a.y * x.y + u.a.z, u.a.w * x.x + u.b.x * x.y + u.b.y) / w * box, 1.0);
 }
 // 置换：a = (数量, 自身亮度, 方向)；噪声时按位移场。
 if (u.a.y > 0.5) {
  // 透明处按中间亮度，不挪；亮度夹在 0–1，高精度画面里超过白的光也不会挪出外扩。
  let c = warpTexel(p + u.layer.xy);
  let l = clamp(dot(c.rgb, LUMA) + 0.5 * (1.0 - c.a), 0.0, 1.0);
  return vec3f(p - u.a.zw * u.a.x * 2.0 * (l - 0.5), 1.0);
 }
 return vec3f(p - warpField(p) * u.a.x, 1.0);
}
fn warpSample(p: vec2f) -> vec4f { let m = warpMap(p); return warpTap(m.xy) * m.z; }
@fragment fn warp(v: Vertex) -> @location(0) vec4f {
 let p = v.position.xy - u.layer.xy;
 let m = warpMap(p);
 // 相邻像素的取样点相距超过约 1.5 个像素（缩得很小、跨过断口）时，渐渐换成旋转网格四点平均：不闪、不出锯齿。
 // 用 dpdx/dpdy 而不是 Fine 版：WebGPU 兼容模式不支持 Fine 导数；这里只作软阈值，粗细导数的差别看不出。
 let footprint = max(length(dpdx(m.xy)), length(dpdy(m.xy)));
 let one = warpTap(m.xy) * m.z;
 let blend = smoothstep(1.5, 2.5, footprint);
 if (blend <= 0.0) { return one; }
 let four = warpSample(p + vec2f(0.125, 0.375)) + warpSample(p + vec2f(0.375, -0.125)) + warpSample(p + vec2f(-0.125, -0.375)) + warpSample(p + vec2f(-0.375, 0.125));
 return mix(one, four * 0.25, blend);
}

// —— 重复阵列 ——
fn repeatPow(x: f32, k: f32) -> f32 { if (k <= 0.0) { return 1.0; } if (x <= 0.0) { return 0.0; } return pow(x, k); }
// 一个副本：原内容绕内容中心缩放、旋转后平移 offset，反变换回原内容取样；缩到一半以下时渐渐换成四点平均。
fn repeatCopy(p: vec2f, offset: vec2f, scale: f32, turn: f32, fade: f32) -> vec4f {
 if (scale <= 0.0001 || fade <= 0.0) { return vec4f(0.0); }
 let center = u.layer.zw * 0.5;
 let at = warpRotate(p - center - offset, -turn) / scale + center + u.layer.xy;
 // 落在纹理外的副本直接跳过，副本多时只给真正盖到这个像素的几份取样。
 let reach = 0.5 + 0.5 / scale;
 if (any(at < vec2f(-reach)) || any(at > u.size.zw + reach)) { return vec4f(0.0); }
 let one = warpTexel(at);
 let blend = smoothstep(1.5, 2.5, 1.0 / scale);
 if (blend <= 0.0) { return one * fade; }
 let tap = 1.0 / scale;
 let four = warpTexel(at + warpRotate(vec2f(0.125, 0.375), -turn) * tap) + warpTexel(at + warpRotate(vec2f(0.375, -0.125), -turn) * tap)
  + warpTexel(at + warpRotate(vec2f(-0.125, -0.375), -turn) * tap) + warpTexel(at + warpRotate(vec2f(-0.375, 0.125), -turn) * tap);
 return mix(one, four * 0.25, blend) * fade;
}
// 网格：a = (列数, 行数, 格宽, 格高)，b = (错位（像素）, 每圈缩放倍数, 每圈淡出倍数, 放大上限)，c.xy 阵列左上角。
// 副本在格子正中；从原内容往外数第几圈（切比雪夫距离）决定缩放与淡出，放大最多长满一格。
fn repeatCell(p: vec2f, column: f32, row: f32) -> vec4f {
 let shifted = (i32(row) - i32(floor(u.a.y * 0.5))) % 2 != 0;
 let corner = u.c.xy + vec2f(column * u.a.z + select(0.0, u.b.x, shifted), row * u.a.w);
 let k = max(abs(column - (u.a.x - 1.0) * 0.5), abs(row - (u.a.y - 1.0) * 0.5));
 return repeatCopy(p, corner + u.a.zw * 0.5 - u.layer.zw * 0.5, min(repeatPow(u.b.y, k), u.b.w), 0.0, repeatPow(u.b.z, k));
}
fn repeatColumn(p: vec2f, row: f32) -> vec2f {
 let shift = select(0.0, u.b.x, (i32(row) - i32(floor(u.a.y * 0.5))) % 2 != 0);
 let x = (p.x - u.c.x - shift) / u.a.z;
 let column = clamp(floor(x), 0.0, u.a.x - 1.0);
 return vec2f(column, clamp(column + select(-1.0, 1.0, x - column >= 0.5), 0.0, u.a.x - 1.0));
}
// 本格的副本盖在最上面；离得最近的相邻三格只露出伸进本格的部分（前面效果留下的模糊、描边）。
// 阵列外的像素归最外一圈的格子，外圈副本往外伸的部分不被切掉。
fn repeatGrid(p: vec2f) -> vec4f {
 let y = (p.y - u.c.y) / u.a.w;
 let row = clamp(floor(y), 0.0, u.a.y - 1.0);
 let near = clamp(row + select(-1.0, 1.0, y - row >= 0.5), 0.0, u.a.y - 1.0);
 let own = repeatColumn(p, row); let other = repeatColumn(p, near);
 var result = vec4f(0.0);
 if (near != row) {
  result = repeatCell(p, other.x, near);
  if (other.y != other.x) { let c = repeatCell(p, other.y, near); result = c + result * (1.0 - c.a); }
 }
 if (own.y != own.x) { let c = repeatCell(p, own.y, row); result = c + result * (1.0 - c.a); }
 let c = repeatCell(p, own.x, row);
 return c + result * (1.0 - c.a);
}
@fragment fn warp_repeat(v: Vertex) -> @location(0) vec4f {
 let p = v.position.xy - u.layer.xy;
 if (u.grid.z < 0.5) { return repeatGrid(p); }
 let count = i32(u.a.x);
 var result = vec4f(0.0);
 if (u.grid.z < 1.5) {
  // 直线：a = (数量, 相邻副本的间隔)，b = (每个缩放倍数, 每个淡出倍数)；原内容在正中，由外往里叠，越靠中间越在上面。
  for (var t = 0; t < count; t++) {
   let index = select(count - 1 - t / 2, t / 2, t % 2 == 0);
   let f = f32(index) - (f32(count) - 1.0) * 0.5; let k = abs(f);
   let c = repeatCopy(p, u.a.yz * f, repeatPow(u.b.x, k), 0.0, repeatPow(u.b.y, k));
   result = c + result * (1.0 - c.a);
  }
  return result;
 }
 // 环形：a = (数量, 半径, 朝向中心)；从正上方起顺时针，第一个在最上面，往后逐个缩放、淡出。
 for (var t = 0; t < count; t++) {
  let index = count - 1 - t;
  let theta = -1.5707963 + f32(index) / f32(count) * 6.2831853; let k = f32(index);
  let c = repeatCopy(p, vec2f(cos(theta), sin(theta)) * u.a.y, repeatPow(u.b.x, k), select(0.0, theta + 1.5707963, u.a.z > 0.5), repeatPow(u.b.y, k));
  result = c + result * (1.0 - c.a);
 }
 return result;
}
`

/** 七个效果共用的取样工序与噪声位移场：具名共享块，按块名只装配一次；依赖共用数学里的 ramp、hash、单形噪声与 B 样条取样。 */
export const WARP_BLOCK: EffectShaderBlock = { name: 'warp', wgsl: WARP_WGSL }
const shared = [EFFECT_MATH_BLOCK, WARP_BLOCK]
export const WARP_PLANNERS = [
  definePlanner({ id: 'mirror', entries: ['warp'], shared, plan: (params, frame) => planMirror(params, frame) }),
  definePlanner({ id: 'repeat', entries: ['warp_repeat'], shared, plan: (params, frame) => planRepeat(params, frame) }),
  definePlanner({ id: 'bulge', entries: ['warp'], shared, plan: (params, frame) => planBulge(params, frame) }),
  definePlanner({ id: 'twirl', entries: ['warp'], shared, plan: (params, frame) => planTwirl(params, frame) }),
  definePlanner({ id: 'wave', entries: ['warp', 'warp_field'], shared, plan: (params, frame) => planWave(params, frame, effectClockSeconds(frame.frameDuration, warpFrameSeed(params, frame.frame))) }),
  definePlanner({ id: 'corner_pin', entries: ['warp'], shared, plan: (params, frame) => planCornerPin(params, frame) }),
  definePlanner({ id: 'displace', entries: ['warp', 'warp_field'], shared, plan: (params, frame) => planDisplace(params, frame, effectClockSeconds(frame.frameDuration, warpFrameSeed(params, frame.frame))) }),
]
