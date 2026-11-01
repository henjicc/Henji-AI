import { definePlanner } from './effectPlanner'
import { effectHash } from './effectShaderMath'
/**
 * 溶解显影的工序规划与 WGSL（剪辑内置效果 ABI）。
 *
 * 图案场 f ∈ [0,1] 锚在内容坐标上（图层移动时图案跟着走）：噪声是 64×64 蓝噪声（`blueNoise64.generated.ts`，按 textureLoad
 * 手动环绕双线性，平铺接缝与内部一样连续）；点阵是每格一个随机时刻开始长大的圆点；半调是整齐网格上的网点，亮的地方先长满。
 * 进度换成阈值时把柔边与亮边宽度算进去，进度 0 处处看不见、100 与原画逐位相同。
 * 亮边宽度与发光强度都大于 0 时，`dissolve_light` 另写一张预乘线性光，交给发光金字塔（来源“光源纹理”）。
 */
import { WHITE_HEX } from '@/core/theme/colorTokens'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { dissolveCellSize } from '@/core/videoEdit/dissolveReveal'
import { lightGlowParams } from '@/core/videoEdit/glow'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import type { AdjustmentLookup } from '@/core/imaging/adjustments/plan'
import type { VideoEditBuiltinPass, VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'
import { appendGlow, createGlowPlanner } from './glow'
import { linearHex } from './lightSweep'
import { BLUE_NOISE_64_RANKS } from './blueNoise64.generated'

export const DISSOLVE_REVEAL_ENTRIES = ['dissolve_image', 'dissolve_light', 'dissolve_transition'] as const
const MODES: Readonly<Record<string, number>> = { noise: 0, dots: 1, halftone: 2, blocks: 3 }
const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)

let blueNoise: AdjustmentLookup | undefined
/** 蓝噪声阈值表，按 `table` 查找表上传（键固定，常驻缓存）。 */
export function blueNoiseLookup(): AdjustmentLookup {
  if (!blueNoise) {
    const data = new Float32Array(64 * 64 * 4)
    BLUE_NOISE_64_RANKS.forEach((rank, index) => { data[index * 4] = (rank + 0.5) / 4096 })
    blueNoise = { kind: 'table', data, width: 64, height: 64, key: 'blue-noise-64' }
  }
  return blueNoise
}

/** 种子 → 整数平移（蓝噪声）与哈希偏移（点阵）。 */
export function seedOffset(seed: number): [number, number, number] {
  const h = effectHash(Math.floor(seed), 0)
  return [h % 64, (h >>> 8) % 64, h % 65_521]
}

function encodedHex(value: unknown): [number, number, number] {
  const hex = typeof value === 'string' && /^#[0-9a-f]{6}/i.test(value) ? value : WHITE_HEX
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]
}

/** `params` 已补齐默认值；`split` 为图层拆输出。 */
export function planDissolveReveal(params: VideoEditBuiltinParams, width: number, height: number, context?: LayerEffectReference, split = false, transition?: { emptyOutgoing?: boolean; emptyIncoming?: boolean }): VideoEditBuiltinPlan {
  const glow = createGlowPlanner(width, height, context)
  const progress = n(params, 'progress') / 100
  if (!transition && progress >= 1) { glow.pass('copy', 'input', 'output'); return glow.plan }
  if (!transition && progress <= 0) { glow.pass('effect_opacity', 'input', 'output'); return glow.plan }
  const h = context ? context.referenceSize.height * context.rasterScale : height
  const mode = MODES[String(params.mode)] ?? 0
  const edge = n(params, 'edge_width') / 100 * 0.3
  const [shiftX, shiftY, hashSeed] = seedOffset(n(params, 'seed'))
  const origin = context ? context.rasterOrigin : [0, 0]
  const lookup = mode === 0 ? blueNoiseLookup() : undefined
  const pass = (entry: 'dissolve_image' | 'dissolve_light', target: number | 'output'): VideoEditBuiltinPass => {
    const [tw, th] = typeof target === 'number' ? [glow.plan.scratch[target].width, glow.plan.scratch[target].height] : [width, height]
    const color = entry === 'dissolve_image' ? encodedHex(params.edge_color) : linearHex(params.edge_color)
    return {
      entry: transition && entry === 'dissolve_image' ? 'dissolve_transition' : entry, source: 'input', target, ...(lookup ? { lookup } : {}), ...(transition ? { mask: 'second' } : {}),
      uniforms: new Float32Array([tw, th, width, height, mode, dissolveCellSize(n(params, 'size')) * h, progress, n(params, 'softness') / 100 * 0.5, ...color, edge, shiftX, shiftY, hashSeed, 0, origin[0], origin[1], 0, 0, transition ? 1 : 0, transition?.emptyOutgoing ? 1 : 0, transition?.emptyIncoming ? 1 : 0, 0]),
    }
  }
  const glowParams = lightGlowParams(params)
  if (edge <= 0 || Number(glowParams.strength) <= 0 || progress <= 0 || progress >= 1) { glow.plan.passes.push(pass('dissolve_image', 'output')); return glow.plan }
  const image = glow.alloc(width, height), light = glow.alloc(width, height)
  glow.plan.passes.push(pass('dissolve_image', image), pass('dissolve_light', light))
  appendGlow(glow, glowParams, width, height, context, split, 'light', light, image)
  return glow.plan
}

export const DISSOLVE_REVEAL_WGSL = `
// a = (方式 0 噪声 / 1 点阵 / 2 半调, 格子边长（像素）, 进度, 柔和半宽)，b = (亮边颜色, 亮边宽度)，
// c = (蓝噪声平移 x, y, 点阵哈希种子, 0)，layer.xy = 内容原点。噪声方式的蓝噪声表绑定在 original。
fn dissolveNoise(q: vec2f) -> f32 {
 let at = q + u.c.xy - 0.5; let lo = vec2i(floor(at)); let t = fract(at);
 let wrap = vec2i(64);
 let p00 = textureLoad(original, ((lo % wrap) + wrap) % wrap, 0).r;
 let p10 = textureLoad(original, ((lo + vec2i(1, 0)) % wrap + wrap) % wrap, 0).r;
 let p01 = textureLoad(original, ((lo + vec2i(0, 1)) % wrap + wrap) % wrap, 0).r;
 let p11 = textureLoad(original, ((lo + vec2i(1, 1)) % wrap + wrap) % wrap, 0).r;
 return mix(mix(p00, p10, t.x), mix(p01, p11, t.x), t.y);
}
fn dissolveField(v: Vertex, c: vec4f) -> f32 {
 let q = (v.position.xy - u.layer.xy) / u.a.y;
 if (u.a.x < 0.5) { return dissolveNoise(q); }
 if (u.a.x > 2.5) { return hash(vec2u(vec2i(floor(q)) + vec2i(32768)), u32(u.c.z)); }
 let d = length(fract(q) - 0.5) * 2.0 / sqrt(2.0);
 if (u.a.x < 1.5) { return 0.65 * hash(vec2u(vec2i(floor(q)) + vec2i(32768)), u32(u.c.z)) + 0.35 * d; }
 return 0.6 * d + 0.4 * (1.0 - dot(straight(c), LUMA));
}
// 返回 (显现 m, 亮边 e)；e ≤ 1 − m。柔和度为 0 且图案在本像素不变时过渡宽度为 0，ramp 给出确定的阶跃。
fn dissolveMask(v: Vertex, c: vec4f) -> vec2f {
 let f = dissolveField(v, c);
 let s = max(u.a.w, fwidth(f)); let w = u.b.w;
 let t = u.a.z * (1.0 + 2.0 * s + w) - s - w;
 let m = 1.0 - ramp(t - s, t + s, f);
 var e = 0.0;
 if (w >= 0.0001) { e = (1.0 - m) * (1.0 - ramp(t + s, t + s + w, f)) * smoothstep(0.0, 0.05, w); }
 return vec2f(m, e);
}
// grid = (双输入过渡, 前段为空, 后段为空, 0)；gradeMask 绑定后一段，original 留给蓝噪声表。
fn dissolveOutgoing(v: Vertex) -> vec4f { return select(tap(uvOf(v)), vec4f(0.0), u.grid.y > 0.5); }
fn dissolveIncoming(v: Vertex) -> vec4f { return select(textureSampleLevel(gradeMask, s, uvOf(v), 0.0), vec4f(0.0), u.grid.z > 0.5); }
fn dissolveTransitionReference(v: Vertex) -> vec4f { return select(dissolveIncoming(v), dissolveOutgoing(v), u.grid.z > 0.5); }
@fragment fn dissolve_transition(v: Vertex) -> @location(0) vec4f {
 let a = dissolveOutgoing(v); let b = dissolveIncoming(v);
 if (u.a.z <= 0.0) { return a; }
 if (u.a.z >= 1.0) { return b; }
 let mask = dissolveMask(v, dissolveTransitionReference(v)); let base = mix(a, b, mask.x);
 return vec4f(mix(base.rgb, u.b.rgb * base.a, mask.y), base.a);
}
@fragment fn dissolve_image(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); let mask = dissolveMask(v, c);
 return vec4f(straight(c) * c.a * mask.x + u.b.rgb * c.a * mask.y, c.a * (mask.x + mask.y));
}
@fragment fn dissolve_light(v: Vertex) -> @location(0) vec4f {
 if (u.grid.x > 0.5) {
  let mask = dissolveMask(v, dissolveTransitionReference(v));
  let alpha = mix(dissolveOutgoing(v).a, dissolveIncoming(v).a, mask.x);
  return vec4f(u.b.rgb * alpha * mask.y, 1.0);
 }
 let c = tap(uvOf(v)); let mask = dissolveMask(v, c);
 return vec4f(u.b.rgb * c.a * mask.y, 1.0);
}
`

export const DISSOLVE_REVEAL_PLANNER = definePlanner({
  id: 'dissolve_reveal', entries: DISSOLVE_REVEAL_ENTRIES, wgsl: DISSOLVE_REVEAL_WGSL,
  plan: (params, frame) => planDissolveReveal(params, frame.width, frame.height, frame.layer, frame.split),
})
