import { definePlanner, type EffectShaderBlock } from './effectPlanner'
/**
 * 半调网点的工序规划与 WGSL（剪辑内置效果 ABI：预乘 sRGB 编码）。
 *
 * 两道：`cell_average` 把画面盒式降采样成“每格 2×2 纹素”的小图（格心正好落在四个纹素的公共角上，双线性取样就是整格平均）；
 * `halftone_dots` 逐像素看最近的四个格心，网点半径 (g/√2)·√色调；色调接近 1 时再补 0.7 像素，连格角的抗锯齿边也盖满，纯色是实心的。
 * 网点面积只随色调变、不随格子像素数变，格子退成平均色调时用同一条面积曲线，预览缩小与导出的浓淡一致。
 * 原色按亮度乘透明度定网点大小、网点之间透明；双色与彩色印刷印在纸上，纸与墨都按原画逐像素的透明度裁切。
 * 彩色印刷四版网角为青 15°、品红 75°、黄 0°、黑 45°，在线性光里减色叠印。格子小到 2–4 像素时渐渐退成远看的平均色调，
 * 网点细到像素以下也不出摩尔纹。抖动点阵复用 `cell_average`。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { dissolveCellSize } from '@/core/videoEdit/dissolveReveal'
import { dropShadowOffset } from '@/core/videoEdit/dropShadow'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import { Planner, type VideoEditBuiltinPlan, type VideoEditBuiltinTexture } from './effectPlan'
import { contentBox, linearHex, linearHexAlpha } from './lightSweep'

export const HALFTONE_ENTRIES = ['cell_average', 'halftone_dots'] as const
const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)
/** 每个纹素盒式平均最多取 24×24 个双线性样本（纹素再大也只是略微欠采样的平均色）。 */
const MAX_AVERAGE_TAPS = 24

/**
 * 盒式降采样：小图纹素 (i, j) 是原画 [origin + (i, j)·cell, +cell) 方块的平均（越出画面的部分按边缘像素）。
 * `origin` 不大于 0，小图盖住整张输入。
 */
export function cellAveragePass(plan: Planner, origin: readonly [number, number], cell: number): { target: number; size: [number, number] } {
  const size: [number, number] = [Math.ceil((plan.width - origin[0]) / cell), Math.ceil((plan.height - origin[1]) / cell)]
  const target = plan.alloc(size[0], size[1])
  const taps = Math.min(MAX_AVERAGE_TAPS, Math.max(1, Math.ceil(cell / 2)))
  plan.passes.push({ entry: 'cell_average', source: 'input', target, uniforms: new Float32Array([size[0], size[1], plan.width, plan.height, origin[0], origin[1], cell, taps, 0, 0, 0, 0, 0, 0, 0, 0]) })
  return { target, size }
}

const smoothstep = (edge0: number, edge1: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0))); return t * t * (3 - 2 * t) }

/** `params` 已补齐默认值。 */
export function planHalftone(params: VideoEditBuiltinParams, width: number, height: number, context?: LayerEffectReference): VideoEditBuiltinPlan {
  const plan = new Planner(width, height)
  const finish = (): VideoEditBuiltinPlan => ({ width, height, scratch: plan.scratch, passes: plan.passes })
  const h = context ? context.referenceSize.height * context.rasterScale : height
  const box = contentBox(width, height, context)
  const g = dissolveCellSize(n(params, 'size')) * h
  const center: [number, number] = [box.x + box.width / 2, box.y + box.height / 2]
  const mode = params.mode === 'cmyk' ? 2 : params.color_mode === 'duo' ? 1 : 0
  const fade = 1 - smoothstep(2, 4, g)
  const misregister = mode === 2 ? dropShadowOffset(n(params, 'misregister')) * h : 0
  const dots = (source: VideoEditBuiltinTexture, size: readonly [number, number], origin: readonly [number, number], texel: number): void => {
    plan.passes.push({
      entry: 'halftone_dots', source, original: 'input', target: 'output',
      uniforms: new Float32Array([width, height, size[0], size[1], center[0], center[1], g, misregister, origin[0], origin[1], texel, 2 ** ((n(params, 'contrast') - 50) / 25),
        mode, params.shape === 'line' ? 1 : 0, fade, 0, ...linearHex(params.ink), 0, ...linearHexAlpha(params.paper)]),
    })
  }
  // 格子不到 2 像素时只剩平均色调，不再画网点。
  if (fade >= 1) { dots('input', [width, height], [0, 0], 1); return finish() }
  const texel = g / 2
  // 格子边界落在 中心 ± g/2 + k·g 上，格心是小图纹素的公共角；原点取不大于 0 的那条边界。
  const origin = center.map(value => { const start = value - g / 2; return start - g * Math.floor(start / g) - g }) as [number, number]
  const cells = cellAveragePass(plan, origin, texel)
  dots(cells.target, cells.size, origin, texel)
  return finish()
}

/** 盒式降采样入口，半调网点与抖动点阵共用（具名共享块，只装配一次）。 */
export const CELL_AVERAGE_BLOCK: EffectShaderBlock = { name: 'cell-average', wgsl: `
// 盒式降采样：a = (小图原点（原画像素）, 纹素边长（像素）, 每边取样数)。
@fragment fn cell_average(v: Vertex) -> @location(0) vec4f {
 let taps = max(1, i32(u.a.w)); let step = u.a.z / f32(taps);
 let start = u.a.xy + floor(v.position.xy) * u.a.z;
 var sum = vec4f(0.0);
 for (var y = 0; y < taps; y++) { for (var x = 0; x < taps; x++) { sum += tap((start + (vec2f(f32(x), f32(y)) + 0.5) * step) / u.size.zw); } }
 return sum / f32(taps * taps);
}
` }

export const HALFTONE_WGSL = `
// 半调网点：source 是每格 2×2 纹素的格子平均色，original 是原画。
// a = (内容中心, 格子边长, 套色偏移)（像素），b = (小图原点, 纹素边长, 对比度斜率)，
// c = (方式 0 原色 / 1 双色 / 2 彩色印刷, 形状 0 圆点 / 1 线条, 退成平均色调的比例, 0)，layer.rgb 墨色，grid 纸色（线性光直通色与 alpha）。
fn halftoneCell(p: vec2f) -> vec4f { return tap((p - u.b.xy) / u.b.z / u.size.zw); }
fn halftoneContrast(v: f32) -> f32 { return clamp((v - 0.5) * u.b.w + 0.5, 0.0, 1.0); }
// 朴素分色：黑版取 1 − max(rgb)，青、品红、黄各补红、绿、蓝；plate 0 青 / 1 品红 / 2 黄 / 3 黑。
fn halftoneInk(c: vec3f, plate: i32) -> f32 {
 let k = 1.0 - max(c.r, max(c.g, c.b));
 if (plate == 3) { return k; }
 return clamp((1.0 - c[plate] - k) / max(1.0 - k, 0.00001), 0.0, 1.0);
}
// 网点要表现的色调：原色按亮度，双色按暗度，彩色印刷按该色版的墨量；都乘格子的透明度，透明处没有网点也不上墨，
// 文字边上的半格只出小网点，不会把透明处当成黑色印出一圈墨边。
fn halftoneTone(q: vec4f, plate: i32) -> f32 {
 let c = clamp(straight(q), vec3f(0.0), vec3f(1.0));
 if (plate >= 0) { return halftoneContrast(halftoneInk(c, plate)) * q.a; }
 let l = halftoneContrast(dot(c, LUMA));
 return select(l, 1.0 - l, u.c.x > 0.5) * q.a;
}
// 远看时网点盖住的面积：线条就是色调；圆点是半径 (g/√2)√v 的圆在格子里的占比，v > 0.5 时减去伸出格子的四个弓形。
fn halftoneArea(v: f32) -> f32 {
 if (u.c.y > 0.5) { return v; }
 if (v <= 0.5) { return 1.5707963 * v; }
 let r2 = v * 0.5; let r = sqrt(r2);
 return min(1.0, 3.1415927 * r2 - 4.0 * (r2 * acos(min(1.0, 0.5 / r)) - 0.5 * sqrt(r2 - 0.25)));
}
// 色调接近 1 时补上的抗锯齿余量（像素），只影响几乎全满的格子。
fn halftoneSolid(v: f32) -> f32 { return 0.7 * smoothstep(0.9, 1.0, v); }
// 半径 r、距离 d（像素）的抗锯齿覆盖；半径小于抗锯齿宽时按面积变淡，半径 0 处完全没有。
fn halftoneEdge(r: f32, d: f32) -> f32 { return clamp((r - d) / 1.4 + 0.5, 0.0, 1.0) * clamp(r / 0.7, 0.0, 1.0); }
fn halftoneAxis(plate: i32) -> vec2f {
 switch plate {
  case 0: { return vec2f(0.9659258, 0.2588190); }
  case 1: { return vec2f(0.2588190, 0.9659258); }
  case 3: { return vec2f(0.7071068, 0.7071068); }
  default: { return vec2f(1.0, 0.0); }
 }
}
// 套色偏移：青、品红、黄三版朝互成 120° 的方向错开，黑版不动。
fn halftoneShift(plate: i32) -> vec2f {
 switch plate {
  case 0: { return vec2f(1.0, 0.0); }
  case 1: { return vec2f(-0.5, 0.8660254); }
  case 2: { return vec2f(-0.5, -0.8660254); }
  default: { return vec2f(0.0); }
 }
}
fn halftoneAbsorb(plate: i32) -> vec3f { if (plate == 3) { return vec3f(1.0); } var a = vec3f(0.0); a[plate] = 1.0; return a; }
// 一个色版在 p 处的 (覆盖, 网点颜色)；axis 是网线方向，plate = −1 为单色。重叠的网点按覆盖加权混色。
fn halftonePlate(p: vec2f, axis: vec2f, plate: i32) -> vec4f {
 let g = u.a.z; let normal = vec2f(-axis.y, axis.x);
 let at = vec2f(dot(p - u.a.xy, axis), dot(p - u.a.xy, normal)) / g;
 var miss = 1.0; var weight = 0.0; var color = vec3f(0.0);
 if (u.c.y < 0.5) {
  let base = floor(at);
  for (var i = 0u; i < 4u; i++) {
   let cell = base + vec2f(f32(i & 1u), f32(i >> 1u));
   let center = u.a.xy + (axis * cell.x + normal * cell.y) * g;
   let sample = halftoneCell(center);
   let tone = halftoneTone(sample, plate);
   let cover = halftoneEdge(sqrt(tone) * 0.7071068 * g + halftoneSolid(tone), distance(p, center));
   miss *= 1.0 - cover; weight += cover; color += straight(sample) * cover;
  }
 } else {
  for (var i = 0u; i < 2u; i++) {
   let row = floor(at.y) + f32(i);
   let sample = halftoneCell(u.a.xy + (axis * at.x + normal * row) * g);
   let tone = halftoneTone(sample, plate);
   let cover = halftoneEdge(tone * 0.5 * g + halftoneSolid(tone), abs(at.y - row) * g);
   miss *= 1.0 - cover; weight += cover; color += straight(sample) * cover;
  }
 }
 return vec4f(1.0 - miss, clamp(color / max(weight, 0.00001), vec3f(0.0), vec3f(1.0)));
}
@fragment fn halftone_dots(v: Vertex) -> @location(0) vec4f {
 let p = v.position.xy; let src = tapOriginal(p / u.size.xy);
 let base = clamp(straight(src), vec3f(0.0), vec3f(1.0));
 let fade = u.c.z;
 if (u.c.x > 1.5) {
  var light = vec3f(1.0);
  for (var plate = 0; plate < 4; plate++) {
   var cover = halftoneArea(halftoneContrast(halftoneInk(base, plate)));
   if (fade < 1.0) { cover = mix(halftonePlate(p - halftoneShift(plate) * u.a.w, halftoneAxis(plate), plate).x, cover, fade); }
   light *= 1.0 - cover * halftoneAbsorb(plate);
  }
  return vec4f(toSrgb(light) * src.a, src.a);
 }
 if (u.c.x > 0.5) {
  var cover = halftoneArea(1.0 - halftoneContrast(dot(base, LUMA)));
  if (fade < 1.0) { cover = mix(halftonePlate(p, vec2f(1.0, 0.0), -1).x, cover, fade); }
  let sheet = u.grid;
  let alpha = cover + sheet.a * (1.0 - cover);
  let light = u.layer.rgb * cover + sheet.rgb * sheet.a * (1.0 - cover);
  return vec4f(toSrgb(light / max(alpha, 0.00001)) * alpha * src.a, alpha * src.a);
 }
 let average = halftoneArea(halftoneContrast(dot(base, LUMA)) * src.a);
 let even = vec4f(base * average, average);
 if (fade >= 1.0) { return even; }
 let dots = halftonePlate(p, vec2f(1.0, 0.0), -1);
 return mix(vec4f(dots.yzw * dots.x, dots.x), even, fade);
}
`

export const HALFTONE_PLANNER = definePlanner({
  id: 'halftone', entries: HALFTONE_ENTRIES, shared: [CELL_AVERAGE_BLOCK], wgsl: HALFTONE_WGSL,
  plan: (params, frame) => planHalftone(params, frame.width, frame.height, frame.layer),
})
