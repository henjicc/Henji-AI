import { definePlanner, effectClockSeconds } from './effectPlanner'
import { EFFECT_MATH_BLOCK } from './effectShaderPrelude'
/**
 * 漏光的工序规划与 WGSL（剪辑内置效果 ABI）。
 *
 * `leak_light` 在 1/4 分辨率逐点求光：离起点的距离衰减（沿边方向拉宽）× 两层极低频、域扭曲的单形噪声，
 * 得到不规则的大片光形；条纹是横向起伏、沿光向拉长的一维噪声。颜色从边缘色过渡到中心色（按亮度的平方）。
 * 合成按 B 样条放大回全尺寸（二阶连续，暗底拉高对比度也看不到放大的网格），用发光的相加规则叠到画面上；
 * 合成用发光的同一套规则（具名块 `GLOW_COMPOSITE_BLOCK`）。
 * 光形随效果时钟流动：时间（种子帧位置 × 帧时长）× 速度推动两层噪声各自朝不同方向漂移，形状在变而不是整体平移；闪烁是随时间平滑起伏的亮度。
 * 不在效果内部抖动：出光即要求高精度（以规划为准），色带由高精度帧的末道抖动处理。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { lightGlowParams } from '@/core/videoEdit/glow'
import { Planner, type VideoEditBuiltinPlan } from './effectPlan'
import { linearHex } from './lightSweep'
import { lightLeakFrameSeed } from '@/core/videoEdit/lightLeak'
import { GLOW_COMPOSITE_BLOCK } from './glow'

const LIGHT_LEAK_ENTRIES = ['leak_light', 'leak_composite', 'leak_layer_image', 'leak_layer_light'] as const
const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)

/** 强度 100 时最亮处的线性光。 */
const LEAK_GAIN = 1.6
/** 速度 100 时噪声每秒漂移的量（噪声坐标；光形按画面高度 0.7 倍的频率取噪声）。 */
const FLOW_RATE = 0.35
/** 很亮处推向白色的程度，与发光、镜头光晕同一默认（漏光没有单独的参数）。 */
const CORE_WHITE = Number(lightGlowParams({}).core_white) / 100
const DIAGONAL = Math.SQRT1_2
/** 方向 → 起点（画面宽高的比例）、射入方向、沿边方向的收窄（越小光沿边铺得越开）。 */
const SIDES: Record<string, { at: readonly [number, number]; toward: readonly [number, number]; narrow: number }> = {
  top_left: { at: [0, 0], toward: [DIAGONAL, DIAGONAL], narrow: 0.8 }, top: { at: [0.5, 0], toward: [0, 1], narrow: 0.5 },
  top_right: { at: [1, 0], toward: [-DIAGONAL, DIAGONAL], narrow: 0.8 }, right: { at: [1, 0.5], toward: [-1, 0], narrow: 0.5 },
  bottom_right: { at: [1, 1], toward: [-DIAGONAL, -DIAGONAL], narrow: 0.8 }, bottom: { at: [0.5, 1], toward: [0, -1], narrow: 0.5 },
  bottom_left: { at: [0, 1], toward: [DIAGONAL, -DIAGONAL], narrow: 0.8 }, left: { at: [0, 0.5], toward: [1, 0], narrow: 0.5 },
}

/** 整数格点上的确定随机值（0–1），预览与导出同一帧取值相同。 */
function lattice(index: number, seed: number): number {
  let h = Math.imul(index ^ Math.imul(seed + 0x9e3779b9, 0x85ebca6b), 0xc2b2ae35)
  h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13
  return (h >>> 0) / 4294967295
}
/** 一维平滑值噪声（0–1）。 */
function smoothNoise(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i, w = f * f * (3 - 2 * f)
  return lattice(i, seed) * (1 - w) + lattice(i + 1, seed) * w
}
/** 闪烁：随时间平滑起伏的亮度倍数，闪烁 0 时恒为 1。 */
export function lightLeakFlicker(flicker: number, time: number, seed: number): number {
  if (flicker <= 0) return 1
  const wave = 0.65 * smoothNoise(time * 1.3, seed) + 0.35 * smoothNoise(time * 3.7, seed + 7919)
  return 1 - flicker * 0.75 * wave
}

/** `params` 已补齐默认值；`time` 是效果时钟的秒数；`split` 为图层拆输出。 */
function planLightLeak(params: VideoEditBuiltinParams, width: number, height: number, time: number, split = false): VideoEditBuiltinPlan {
  const plan = new Planner(width, height)
  const finish = (underlay?: number): VideoEditBuiltinPlan => ({ width, height, scratch: plan.scratch, passes: plan.passes, linearScratch: true, ...(underlay !== undefined ? { underlay } : {}) })
  const seed = Math.round(n(params, 'seed'))
  const gain = n(params, 'amount') / 100 * LEAK_GAIN * lightLeakFlicker(n(params, 'flicker') / 100, time, seed)
  const hot = linearHex(params.hot_color).map(value => value * gain), edge = linearHex(params.edge_color).map(value => value * gain)
  if ([...hot, ...edge].every(value => value <= 0)) { plan.pass('copy', 'input', 'output'); return finish() }
  const side = SIDES[String(params.side)] ?? SIDES.top_left
  // 深度：沿射入方向到画面对边的长度乘范围；50% 约到三分之一。
  const extent = Math.abs(side.toward[0]) * width + Math.abs(side.toward[1]) * height
  const depth = (0.06 + 0.6 * n(params, 'spread') / 100) * extent
  const light = plan.alloc(Math.max(1, Math.ceil(width / 4)), Math.max(1, Math.ceil(height / 4)))
  const [lw, lh] = plan.size(light)
  plan.passes.push({ entry: 'leak_light', source: 'input', target: light, uniforms: new Float32Array([lw, lh, width, height,
    side.at[0] * width, side.at[1] * height, ...side.toward,
    depth, side.narrow, n(params, 'streaks') / 100, (seed * 37.37) % 200,
    time * n(params, 'speed') / 100 * FLOW_RATE, 0, 0, 0,
    ...hot, 0, ...edge, 0]) })
  const composite = (entry: typeof LIGHT_LEAK_ENTRIES[number], target: number | 'output'): void => {
    plan.pass(entry, light, target, undefined, undefined, undefined, [0, CORE_WHITE, 0, 0])
  }
  if (!split) { composite('leak_composite', 'output'); return finish() }
  composite('leak_layer_image', 'output')
  const underlay = plan.alloc(width, height)
  composite('leak_layer_light', underlay)
  return finish(underlay)
}

const LIGHT_LEAK_WGSL = `
// a = (起点（全分辨率像素）, 射入方向)，b = (深度（全分辨率像素）, 沿边收窄, 条纹, 种子偏移)，c.x = 流动时间，
// layer.rgb / grid.rgb = 中心色 / 边缘色（线性光，乘过强度与闪烁）。
fn leakNoise(p: vec2f) -> f32 { return 0.7 * simplexNoise(p) + 0.3 * simplexNoise(p * 1.9 + vec2f(17.1, 3.7)); }
@fragment fn leak_light(v: Vertex) -> @location(0) vec4f {
 let h = u.size.w;
 let p = (v.position.xy * u.size.zw / u.size.xy - u.a.xy) / h;
 let along = dot(p, u.a.zw); let across = dot(p, vec2f(-u.a.w, u.a.z));
 let t = u.c.x; let q = p * 0.7 + vec2f(u.b.w, u.b.w * 0.7);
 // 第一层扭曲坐标，第二层在扭曲后的坐标上取值：光形边缘不规则，随时间变形而不是整片平移。
 let warp = vec2f(leakNoise(q + vec2f(0.0, t)), leakNoise(q + vec2f(5.2, 1.3) - vec2f(t * 0.7, 0.0)));
 let shape = leakNoise(q * 0.9 + warp * 0.6 + vec2f(t * 0.4, -t * 0.25));
 let dist = length(vec2f(along, across * u.b.y)) / (u.b.x / h);
 let reach = max(dist * (1.0 + 0.3 * shape) + 0.12 * warp.x, 0.0);
 let body = exp(-2.3 * reach * reach) * (0.75 + 0.25 * shape);
 // 条纹沿射入方向拉长、横向起伏，比光团伸得更深。
 let stripe = 0.5 + 0.35 * simplexNoise(vec2f(across * 3.5 + u.b.w, t * 0.2)) + 0.15 * simplexNoise(vec2f(across * 9.0 - u.b.w, t * 0.3));
 let bands = stripe * exp(-2.3 * 0.36 * reach * reach);
 let f = body * (1.0 - 0.4 * u.b.z) + 0.55 * u.b.z * bands * bands;
 return vec4f(mix(u.grid.rgb, u.layer.rgb, min(f * f, 1.0)) * f, 1.0);
}
fn leakLight(v: Vertex) -> vec3f { return sampleBSpline(source, s, uvOf(v)).rgb; }
@fragment fn leak_composite(v: Vertex) -> @location(0) vec4f { let base = tapOriginal(uvOf(v)); return glowOnto(straight(base), base.a, leakLight(v), false, v.position.xy); }
@fragment fn leak_layer_image(v: Vertex) -> @location(0) vec4f { let base = tapOriginal(uvOf(v)); return glowWithin(straight(base), base.a, leakLight(v), false, v.position.xy); }
@fragment fn leak_layer_light(v: Vertex) -> @location(0) vec4f { return vec4f(glowColor(vec3f(0.0), leakLight(v), false, v.position.xy), 0.0); }
`

export const LIGHT_LEAK_PLANNER = definePlanner({
  id: 'light_leak', entries: LIGHT_LEAK_ENTRIES, shared: [EFFECT_MATH_BLOCK, GLOW_COMPOSITE_BLOCK], wgsl: LIGHT_LEAK_WGSL,
  plan: (params, frame) => planLightLeak(params, frame.width, frame.height, effectClockSeconds(frame.frameDuration, lightLeakFrameSeed(params, frame.frame)), frame.split),
})
