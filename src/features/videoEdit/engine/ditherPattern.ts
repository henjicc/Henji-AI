import { definePlanner } from './effectPlanner'
/**
 * 抖动点阵的工序规划与 WGSL（剪辑内置效果 ABI：预乘 sRGB 编码）。
 *
 * 两道：`cell_average`（与半调网点共用）把画面按点的边长盒式降采样，每个点一个纹素；`dither_pattern` 逐像素取所在点的平均色，
 * 用 8×8 方格或溶解显影同一张 64×64 蓝噪声表作阈值量化，再最近邻放大。点的边长取整到栅格像素，点阵大小均匀、不出拍频纹。
 * 透明度用点的平均，透明底正确；点阵锚在内容左上角，图层移动时跟着走。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { ditherPixelSize } from '@/core/videoEdit/ditherPattern'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import { Planner, type VideoEditBuiltinPlan, type VideoEditBuiltinTexture } from './effectPlan'
import { blueNoiseLookup } from './dissolveReveal'
import { CELL_AVERAGE_BLOCK, cellAveragePass } from './halftone'
import { COLOR_MATH_BLOCK, EFFECT_MATH_BLOCK } from './effectShaderPrelude'
import { contentBox, linearHex } from './lightSweep'

export const DITHER_PATTERN_ENTRIES = ['cell_average', 'dither_pattern'] as const
const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)

/** `params` 已补齐默认值。 */
export function planDitherPattern(params: VideoEditBuiltinParams, width: number, height: number, context?: LayerEffectReference): VideoEditBuiltinPlan {
  const plan = new Planner(width, height)
  const h = context ? context.referenceSize.height * context.rasterScale : height
  const box = contentBox(width, height, context)
  const size = Math.max(1, Math.round(ditherPixelSize(n(params, 'pixel_size')) * h))
  const anchor = [Math.round(box.x), Math.round(box.y)]
  // 小图原点退到不大于 0 的点格边界；内容左上角落在第 before 个点上，图案从那里数起。
  const before = anchor.map(value => Math.ceil(value / size)) as [number, number]
  const origin = anchor.map((value, axis) => value - before[axis] * size) as [number, number]
  let cells: { target: VideoEditBuiltinTexture; size: readonly [number, number] } = { target: 'input', size: [width, height] }
  if (size > 1) cells = cellAveragePass(plan, origin, size)
  const blueNoise = params.pattern === 'blue_noise'
  plan.passes.push({
    entry: 'dither_pattern', source: cells.target, target: 'output', ...(blueNoise ? { lookup: blueNoiseLookup() } : {}),
    uniforms: new Float32Array([width, height, cells.size[0], cells.size[1], origin[0], origin[1], size, Math.round(n(params, 'levels')),
      before[0], before[1], blueNoise ? 1 : 0, params.color_mode === 'original' ? 1 : 0, (50 - n(params, 'threshold')) / 100, 0, 0, 0,
      ...linearHex(params.dark), 0, ...linearHex(params.light), 0]),
  })
  return { width, height, scratch: plan.scratch, passes: plan.passes }
}

export const DITHER_PATTERN_WGSL = `
// 抖动点阵：source 是每个点一纹素的平均色，蓝噪声时 original 是 64×64 阈值表。
// a = (小图原点, 点的边长（像素）, 色阶)，b = (内容左上角所在的点, 图案 0 方格 / 1 蓝噪声, 颜色 0 双色 / 1 原色)，
// c.x 明暗偏移，layer.rgb 暗色，grid.rgb 亮色（线性光）。
// 8×8 方格阈值：x⊕y 与 y 的位交错后倒序（标准 Bayer 矩阵）。
fn ditherBayer(c: vec2u) -> f32 {
 let x = c.x & 7u; let y = c.y & 7u; let z = x ^ y;
 let rank = ((z & 1u) << 5u) | ((y & 1u) << 4u) | ((z & 2u) << 2u) | ((y & 2u) << 1u) | ((z & 4u) >> 1u) | ((y & 4u) >> 2u);
 return (f32(rank) + 0.5) / 64.0;
}
fn ditherLevel(v: f32, t: f32) -> f32 { let steps = u.a.w - 1.0; return clamp(floor(v * steps + t), 0.0, steps) / steps; }
@fragment fn dither_pattern(v: Vertex) -> @location(0) vec4f {
 let cell = vec2i(floor((v.position.xy - u.a.xy) / u.a.z));
 let q = textureLoad(source, clamp(cell, vec2i(0), vec2i(u.size.zw) - 1), 0);
 let index = cell - vec2i(u.b.xy);
 var t = ditherBayer(vec2u(((index % vec2i(8)) + vec2i(8)) % vec2i(8)));
 if (u.b.z > 0.5) { let wrap = vec2i(64); t = textureLoad(original, ((index % wrap) + wrap) % wrap, 0).r; }
 let c = clamp(straight(q) + u.c.x, vec3f(0.0), vec3f(1.0));
 if (u.b.w > 0.5) { return premul(vec3f(ditherLevel(c.r, t), ditherLevel(c.g, t), ditherLevel(c.b, t)), q.a); }
 let level = ditherLevel(clamp(dot(straight(q), LUMA) + u.c.x, 0.0, 1.0), t);
 return premul(interpolateColor(cgEnc(u.layer.rgb), cgEnc(u.grid.rgb), level, true), q.a);
}
`

export const DITHER_PATTERN_PLANNER = definePlanner({
  id: 'dither_pattern', entries: DITHER_PATTERN_ENTRIES, shared: [CELL_AVERAGE_BLOCK, COLOR_MATH_BLOCK, EFFECT_MATH_BLOCK], wgsl: DITHER_PATTERN_WGSL,
  plan: (params, frame) => planDitherPattern(params, frame.width, frame.height, frame.layer),
})
