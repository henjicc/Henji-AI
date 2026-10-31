import { definePlanner, type EffectPlannerFrame } from './effectPlanner'
/**
 * 渐变映射、色调分离的工序规划与 WGSL（剪辑内置效果 ABI），都是逐点一道，图层与片段同一份。
 *
 * 渐变映射的位置用与“黑白”相同的明暗（编码值上的 BT.709 亮度），黑场、白场、中间调位置都在这把尺子上。
 * 感知插值的色度（OkLab a、b）按位置线性插，两种彩色之间不发灰；明度换成“同样 OkLab 明度的灰的编码值”再线性插，
 * 暗端斜率有限，深色色标不会把最暗几级的噪点放大成色带；黑→白两种插值都与“黑白”逐位一致。
 * 色标在规划里换好插值空间；双色等于中间点落在两端连线中点的三色，着色器只有一条路径。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { linearSrgbToOklab, linearToSrgb } from '@/core/imaging/adjustments/colorScience'
import { Planner, type VideoEditBuiltinPlan, type Vec4 } from './effectPlan'
import { COLOR_MATH_BLOCK, EFFECT_MATH_BLOCK } from './effectShaderPrelude'
import { linearHex } from './lightSweep'

const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)

/** 色标换到插值空间：感知为（同明度灰的编码值, OkLab a, OkLab b），标准为 sRGB 编码值。 */
function stop(value: unknown, perceptual: boolean): [number, number, number] {
  const linear = linearHex(value)
  if (!perceptual) return linear.map(linearToSrgb) as [number, number, number]
  const [lightness, a, b] = linearSrgbToOklab(linear)
  return [linearToSrgb(lightness ** 3), a, b]
}

const GRADIENT_MAP_WGSL = `
// 渐变映射：a = (暗部色标, 黑场)，b = (亮部色标, 白场)，c = (中间色标, 中间点)；色标已在插值空间里。
fn gradientMapPosition(c: vec4f) -> f32 {
 let y = dot(straight(c), LUMA);
 if (u.b.w > u.a.w) { return clamp((y - u.a.w) / (u.b.w - u.a.w), 0.0, 1.0); }
 return select(0.0, 1.0, y >= u.a.w);
}
fn gradientMapColor(s: f32) -> vec3f {
 let knot = u.c.w;
 if (s < knot) { return mix(u.a.rgb, u.c.rgb, s / knot); }
 return mix(u.c.rgb, u.b.rgb, select(1.0, (s - knot) / (1.0 - knot), knot < 1.0));
}
@fragment fn gradient_map(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v));
 let p = gradientMapColor(gradientMapPosition(c));
 return premul(cgEnc(cgFromOklab(vec3f(cgCbrt(cgLin1(p.x)), p.yz))), c.a);
}
@fragment fn gradient_map_srgb(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v));
 return premul(gradientMapColor(gradientMapPosition(c)), c.a);
}
`

const POSTERIZE_WGSL = `
// 色调分离：a = (色阶 n, 平滑)。n 个等宽区间映射到 0..1 上均匀的 n 级；平滑让最近的台阶在它两侧各半个过渡宽度里渐变，最宽一个区间。
fn posterizeLevel(x: f32) -> f32 {
 let levels = u.a.x; let half = u.a.y * 0.5 / levels;
 let k = clamp(round(x * levels), 1.0, levels - 1.0);
 return (k - 1.0 + ramp(k / levels - half, k / levels + half, x)) / (levels - 1.0);
}
@fragment fn posterize(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); let rgb = straight(c);
 return premul(vec3f(posterizeLevel(rgb.r), posterizeLevel(rgb.g), posterizeLevel(rgb.b)), c.a);
}
@fragment fn posterize_luminance(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); let lab = cgOklab(cgLin(straight(c)));
 let l = posterizeLevel(lab.x);
 // 压暗时色度按明度同比收小，暗部不出超色域的怪色；提亮时保留原色度。
 return premul(cgEnc(cgFromOklab(vec3f(l, lab.yz * min(1.0, l / max(lab.x, 0.0001))))), c.a);
}
`

function planGradientMap(params: VideoEditBuiltinParams, frame: EffectPlannerFrame): VideoEditBuiltinPlan {
  const plan = new Planner(frame.width, frame.height)
  const perceptual = params.interpolation !== 'srgb'
  const dark = stop(params.dark_color, perceptual), light = stop(params.light_color, perceptual)
  const three = params.mode === 'three'
  const knot = three ? n(params, 'mid_point') / 100 : 0.5
  const mid = three ? stop(params.mid_color, perceptual) : [0, 1, 2].map(index => (dark[index] + light[index]) / 2) as [number, number, number]
  plan.pass(perceptual ? 'gradient_map' : 'gradient_map_srgb', 'input', 'output', [...dark, n(params, 'black_point') / 100] as Vec4, [...light, n(params, 'white_point') / 100] as Vec4, undefined, [...mid, knot] as Vec4)
  return { width: frame.width, height: frame.height, scratch: plan.scratch, passes: plan.passes }
}

function planPosterize(params: VideoEditBuiltinParams, frame: EffectPlannerFrame): VideoEditBuiltinPlan {
  const plan = new Planner(frame.width, frame.height)
  // 色阶做关键帧时中间值取整，台阶数始终是整数。
  plan.pass(params.by === 'luminance' ? 'posterize_luminance' : 'posterize', 'input', 'output', [Math.round(n(params, 'levels')), n(params, 'smooth') / 100, 0, 0])
  return { width: frame.width, height: frame.height, scratch: plan.scratch, passes: plan.passes }
}

export const COLOR_MAP_PLANNERS = [
  definePlanner({ id: 'gradient_map', entries: ['gradient_map', 'gradient_map_srgb'], shared: [COLOR_MATH_BLOCK, EFFECT_MATH_BLOCK], wgsl: GRADIENT_MAP_WGSL, plan: planGradientMap }),
  definePlanner({ id: 'posterize', entries: ['posterize', 'posterize_luminance'], shared: [COLOR_MATH_BLOCK, EFFECT_MATH_BLOCK], wgsl: POSTERIZE_WGSL, plan: planPosterize }),
] as const
