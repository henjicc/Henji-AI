import { definePlanner, effectClockSeconds, type EffectPlannerFrame } from './effectPlanner'
/**
 * 渐变的工序规划与 WGSL（剪辑内置效果 ABI），逐点一道。
 *
 * 位置按内容框（图层上是未外扩的 bounds，片段上是整张纹理）的百分比换成纹理像素，距离在像素空间里算；
 * 两端颜色在规划里换到插值空间（感知为 OkLab，标准为编码 sRGB），着色器按预乘插值，透明端不发黑。
 * 正常模式在内容 alpha 内直接换成渐变；其余模式在直通色上混合，渐变的透明度是作用强弱，内容透明度不变。
 * 多点方式按反距离加权（幂 1.5）混合四个颜色点，颜色点经查找表传入。漂移用片段时钟（与着色器效果同一时钟）。
 */
import { gradientVaries } from '@/core/videoEdit/gradient'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { linearSrgbToOklab, linearToSrgb } from '@/core/imaging/adjustments/colorScience'
import type { VideoEditBuiltinPlan } from './effectPlan'
import { COLOR_MATH_BLOCK } from './effectShaderPrelude'
import { contentBox, linearHex } from './lightSweep'

const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)
const MODES: Readonly<Record<string, number>> = { linear: 0, radial: 1, conic: 2, diamond: 3 }
const REPEATS: Readonly<Record<string, number>> = { none: 0, repeat: 1, mirror: 2 }
const BLENDS: Readonly<Record<string, number>> = { normal: 0, multiply: 1, screen: 2, overlay: 3, soft_light: 4 }
/** 漂移满格时颜色点游动的幅度（内容框高度的比例），以及两组正弦的频率（Hz）：周期十秒上下，缓慢不重复。 */
const DRIFT_REACH = 0.03
const DRIFT_HZ = [0.071, 0.113] as const

/** #rrggbb(aa) → 插值空间三个分量与 alpha。 */
function stop(value: unknown, perceptual: boolean): [number, number, number, number] {
  const text = typeof value === 'string' ? value : ''
  const alpha = /^#[0-9a-f]{8}$/i.test(text) ? parseInt(text.slice(7, 9), 16) / 255 : 1
  const linear = linearHex(text)
  const space = perceptual ? linearSrgbToOklab(linear) : linear.map(linearToSrgb)
  return [space[0], space[1], space[2], alpha]
}

/** 颜色点在时刻 t 的游动（-1..1 两个分量）：两组无理比频率的正弦叠加，可任意跳帧。 */
function gradientDrift(index: number, time: number): [number, number] {
  const wave = (phase: number): number => 0.6 * Math.sin(2 * Math.PI * DRIFT_HZ[0] * time + phase) + 0.4 * Math.sin(2 * Math.PI * DRIFT_HZ[1] * time + phase * 1.7)
  return [wave(index * 2.1 + 0.3), wave(index * 1.3 + 2.4)]
}

function planGradient(params: VideoEditBuiltinParams, frame: EffectPlannerFrame): VideoEditBuiltinPlan {
  const { width, height } = frame
  const box = contentBox(width, height, frame.layer)
  const at = (x: number, y: number): [number, number] => [box.x + x / 100 * box.width, box.y + y / 100 * box.height]
  const perceptual = params.interpolation !== 'srgb'
  const blend = BLENDS[String(params.blend_mode)] ?? 0
  const head = [width, height, width, height]
  if (params.mode === 'points') {
    const time = effectClockSeconds(frame.frameDuration, n(params, 'drift') > 0 && gradientVaries(params) ? frame.frame : 0), reach = n(params, 'drift') / 100 * DRIFT_REACH * box.height
    const points = [1, 2, 3, 4].flatMap(index => {
      const [x, y] = at(n(params, `p${index}_x`), n(params, `p${index}_y`))
      const [dx, dy] = reach > 0 ? gradientDrift(index, time) : [0, 0]
      return [x + dx * reach, y + dy * reach]
    })
    const data = new Float32Array([1, 2, 3, 4].flatMap(index => stop(params[`p${index}_color`], perceptual)))
    return { width, height, scratch: [], passes: [{
      entry: 'gradient_points', source: 'input', target: 'output',
      lookup: { kind: 'table', data, width: 4, height: 1, key: `gradient:${Array.from(data).join(',')}` },
      uniforms: new Float32Array([...head, ...points, blend, perceptual ? 1 : 0, 0, 0]),
    }] }
  }
  const midpoint = Math.min(99, Math.max(1, n(params, 'midpoint'))) / 100
  const conic = params.mode === 'conic'
  const start = at(n(params, 'start_x'), n(params, 'start_y'))
  const end = conic ? start : at(n(params, 'end_x'), n(params, 'end_y'))
  return { width, height, scratch: [], passes: [{
    entry: 'gradient', source: 'input', target: 'output',
    uniforms: new Float32Array([...head, ...start, ...end, ...stop(params.start_color, perceptual), ...stop(params.end_color, perceptual),
      MODES[String(params.mode)] ?? 0, REPEATS[String(params.repeat)] ?? 0, Math.log(0.5) / Math.log(midpoint), n(params, 'angle') * Math.PI / 180,
      blend, perceptual ? 1 : 0, 0, 0]),
  }] }
}

const GRADIENT_WGSL = `
/** W3C 混合公式，编码 sRGB 直通色：1 正片叠底，2 滤色，3 叠加，4 柔光。 */
fn gradientBlend(c: vec3f, g: vec3f, mode: f32) -> vec3f {
 if (mode < 1.5) { return c * g; }
 if (mode < 2.5) { return 1.0 - (1.0 - c) * (1.0 - g); }
 if (mode < 3.5) { return select(1.0 - 2.0 * (1.0 - c) * (1.0 - g), 2.0 * c * g, c < vec3f(0.5)); }
 let d = select(sqrt(c), ((16.0 * c - 12.0) * c + 4.0) * c, c <= vec3f(0.25));
 return select(c + (2.0 * g - 1.0) * (d - c), c - (1.0 - 2.0 * g) * c * (1.0 - c), g <= vec3f(0.5));
}
/** 插值空间里的预乘颜色 → (编码 sRGB 直通色, alpha)。 */
fn gradientDecode(p: vec4f, perceptual: bool) -> vec4f {
 if (p.a <= 0.000001) { return vec4f(0.0); }
 let x = p.rgb / p.a;
 if (perceptual) { return vec4f(cgEnc(cgFromOklab(x)), p.a); }
 return vec4f(x, p.a);
}
/** 正常模式在内容 alpha 内直接换成渐变；其余模式渐变 alpha 是作用强弱，内容 alpha 不变。 */
fn gradientOut(base: vec4f, g: vec4f, mode: f32) -> vec4f {
 if (mode < 0.5) { return premul(g.rgb, g.a * base.a); }
 let c = straight(base);
 return premul(mix(c, gradientBlend(c, g.rgb, mode), g.a), base.a);
}
// a = (起点, 终点)（纹理像素），b、c = 起点、终点颜色（插值空间 + alpha），layer = (方式, 重复, 中点指数, 起始角度)，grid = (混合模式, 感知)。
fn gradientT(p: vec2f) -> f32 {
 let q = p - u.a.xy; let d = u.a.zw - u.a.xy; let span = length(d); let mode = u.layer.x;
 var t = 1.0;
 if (mode > 1.5 && mode < 2.5) {
  t = fract((atan2(q.y, q.x) - u.layer.w) / 6.283185307179586);
  if (u.layer.y > 1.5) { t = 1.0 - abs(2.0 * t - 1.0); }
 } else {
  if (span > 0.5) {
   let axis = d / span;
   if (mode < 0.5) { t = dot(q, axis) / span; }
   else if (mode < 1.5) { t = length(q) / span; }
   else { t = (abs(dot(q, axis)) + abs(dot(q, vec2f(-axis.y, axis.x)))) / span; }
  }
  if (u.layer.y < 0.5) { t = clamp(t, 0.0, 1.0); }
  else if (u.layer.y < 1.5) { t = fract(t); }
  else { let m = fract(t * 0.5) * 2.0; t = select(m, 2.0 - m, m > 1.0); }
 }
 return pow(t, u.layer.z);
}
@fragment fn gradient(v: Vertex) -> @location(0) vec4f {
 let base = tap(uvOf(v));
 let t = gradientT(v.position.xy);
 let p = mix(vec4f(u.b.rgb * u.b.a, u.b.a), vec4f(u.c.rgb * u.c.a, u.c.a), t);
 return gradientOut(base, gradientDecode(p, u.grid.y > 0.5), u.grid.x);
}
// a = (点 1, 点 2)，b = (点 3, 点 4)（纹理像素），c = (混合模式, 感知)；original 绑定 4×1 颜色表（插值空间 + alpha）。
@fragment fn gradient_points(v: Vertex) -> @location(0) vec4f {
 let base = tap(uvOf(v)); let p = v.position.xy;
 let points = array<vec2f, 4>(u.a.xy, u.a.zw, u.b.xy, u.b.zw);
 var sum = vec4f(0.0); var weight = 0.0; var exact = -1;
 for (var i = 0; i < 4; i++) {
  let d = distance(p, points[i]);
  if (d < 0.5) { exact = i; }
  let c = textureLoad(original, vec2i(i, 0), 0); let w = 1.0 / pow(max(d, 0.5), 1.5);
  sum += vec4f(c.rgb * c.a, c.a) * w; weight += w;
 }
 if (exact >= 0) { let c = textureLoad(original, vec2i(exact, 0), 0); sum = vec4f(c.rgb * c.a, c.a); weight = 1.0; }
 return gradientOut(base, gradientDecode(sum / weight, u.c.y > 0.5), u.c.x);
}
`

export const GRADIENT_PLANNER = definePlanner({
  id: 'gradient', entries: ['gradient', 'gradient_points'], shared: [COLOR_MATH_BLOCK], wgsl: GRADIENT_WGSL,
  plan: (params, frame) => planGradient(params, frame),
})
