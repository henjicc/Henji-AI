import { definePlanner } from './effectPlanner'
/**
 * 描边的工序规划与 WGSL（剪辑内置效果 ABI）。Jump Flood 距离场（Rong & Tan 2006；Ben Golus《The Quest for Very Wide Outlines》）：
 *
 * 1. `stroke_seed`：与 4 邻分居 alpha 0.5 两侧的像素，沿两像素连线线性插值出等值线的交点，最近的一个作为种子（亚像素位置）。
 *    硬直边的交点正好在两像素中点；轮廓两侧记的是同一个交点；孤立像素、单像素细线四边都有交点，没有零梯度的退化。
 *    纹理以外按透明：整幅不透明的片段四边就是轮廓。
 * 2. `stroke_jfa`：步长从覆盖距离向上取 2 的幂逐道减半，最后多一道 1（JFA+1，降低误差，不是精确算法）。
 * 3. `stroke_shade`：有符号距离 → 膨胀 D、腐蚀 E 覆盖（夹到原画 alpha，保证 E ≤ a ≤ D），三块互不重叠的区域直接相加。
 * 成本只随粗细的对数增长；种子用 rg32float（half 精度在大纹理坐标上不够亚像素），只用 textureLoad 读。
 *
 * 细描边（覆盖距离 R ≤ 3 像素）走 `stroke_near` 一道：以 0.5 像素为间距取同心圈、每圈 16 个方向，累积最大（最小）alpha 随半径的变化，
 * 找它越过 0.5 的半径就是到轮廓的距离，与距离场同一个定义、同一个着色公式。1080p 同一粗细实测（含提交等待）单道约 0.4 ms，距离场 6 道约 0.75 ms。
 * R 在 3–4 像素之间两路都算、距离按 R 线性混合，粗细与柔和度连续变化时画面连续。
 *
 * 轮廓来源为主体时，距离场与邻域取样改读人物蒙版（工序纹理 `subject`）的 alpha，其余工序不变；
 * 原画通常不透明，描边按普通透明度叠在原画之上（外侧的边落在人物外的背景上）。片段画面外（`subject` 的 r）的取样不产生轮廓，
 * 描边也只画在片段画面内：画中画里人物在片段边上被裁断时，裁切线上不描边。
 */
import { BLACK_HEX } from '@/core/theme/colorTokens'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { strokeGeometry } from '@/core/videoEdit/stroke'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import type { VideoEditBuiltinPlan, VideoEditBuiltinTexture } from './videoEditBuiltinEffectPasses'
import type { VideoEditBuiltinEffectEntry } from './videoEditBuiltinEffectShaders'

export const STROKE_ENTRIES = ['stroke_seed', 'stroke_jfa', 'stroke_shade', 'stroke_near'] as const
/** 只用 textureLoad 读 `source` 的描边工序（种子是不可过滤的 rg32float）。 */
export const STROKE_FIELD_ENTRIES = ['stroke_seed', 'stroke_jfa', 'stroke_shade'] as const
/** 覆盖距离（纹理像素）不超过它只走邻域取样，超过 `STROKE_NEAR_BLEND` 只走距离场，中间两路混合。 */
export const STROKE_NEAR_MAX = 3
const STROKE_NEAR_BLEND = 4
type V4 = readonly [number, number, number, number]
const ZERO: V4 = [0, 0, 0, 0]
const POSITIONS: Readonly<Record<string, number>> = { outside: 0, inside: 1, center: 2 }

/** JFA 的步长：从不小于 `reach` 的 2 的幂逐道减半到 1，再多一道 1。 */
export function strokeJumpSteps(reach: number): number[] {
  const steps: number[] = []
  for (let step = 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(1, reach)))); step >= 1; step /= 2) steps.push(step)
  return [...steps, 1]
}

function encodedColor(value: unknown): [number, number, number] {
  const hex = typeof value === 'string' && /^#[0-9a-f]{6}/i.test(value) ? value : BLACK_HEX
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]
}

/** `params` 已补齐默认值。 */
export function planStroke(params: VideoEditBuiltinParams, width: number, height: number, context?: LayerEffectReference): VideoEditBuiltinPlan {
  const plan: VideoEditBuiltinPlan = { width, height, scratch: [], passes: [] }
  const pass = (entry: VideoEditBuiltinEffectEntry, source: VideoEditBuiltinTexture, target: VideoEditBuiltinTexture, a: V4 = ZERO, b: V4 = ZERO, original?: VideoEditBuiltinTexture): void => {
    plan.passes.push({ entry, source, target, ...(original !== undefined ? { original } : {}), uniforms: new Float32Array([width, height, width, height, ...a, ...b, ...ZERO]) })
  }
  const sourceOpacity = Number(params.source_opacity ?? 100) / 100
  const h = context ? context.referenceSize.height * context.rasterScale : height
  const geometry = strokeGeometry(params, h)
  if (Number(params.width ?? 0) <= 0 || geometry.width <= 0) {
    if (sourceOpacity === 1) pass('copy', 'input', 'output'); else pass('effect_opacity', 'input', 'output', [sourceOpacity, 0, 0, 0])
    return plan
  }
  const shade: [V4, V4] = [[geometry.radius, geometry.feather, geometry.reach, POSITIONS[String(params.position)] ?? 0], [...encodedColor(params.color), Number(params.opacity ?? 100) / 100]]
  const subject = params.contour === 'subject'
  // 距离场在混合区里的权重；0 时只走邻域取样。
  const field = Math.min(1, Math.max(0, (geometry.reach - STROKE_NEAR_MAX) / (STROKE_NEAR_BLEND - STROKE_NEAR_MAX)))
  if (field === 0) {
    pass('stroke_near', 'input', 'output', ...shade)
    plan.passes.at(-1)!.uniforms.set([sourceOpacity, 0, subject ? 1 : 0], 12)
    if (subject) plan.passes.at(-1)!.mask = 'subject'
    return plan
  }
  plan.scratchFormat = 'rg32float'; plan.scratch.push({ width, height }, { width, height })
  pass('stroke_seed', subject ? 'subject' : 'input', 0)
  if (subject) plan.passes.at(-1)!.uniforms[14] = 1
  let current = 0
  for (const step of strokeJumpSteps(geometry.reach)) { pass('stroke_jfa', current, 1 - current, [step, 0, 0, 0]); current = 1 - current }
  pass('stroke_shade', current, 'output', ...shade, 'input')
  plan.passes.at(-1)!.uniforms.set([sourceOpacity, field, subject ? 1 : 0], 12)
  if (subject) plan.passes.at(-1)!.mask = 'subject'
  return plan
}

export const STROKE_WGSL = `
// 轮廓来源为主体（c.z = 1）时，片段画面外（r < 0.5）的纹素不算数。
fn strokeInFrame(p: vec2i) -> bool {
 let size = vec2i(textureDimensions(source));
 if (u.c.z < 0.5) { return true; }
 return all(p >= vec2i(0)) && all(p < size) && textureLoad(source, p, 0).r >= 0.5;
}
// 纹理外按透明。
fn strokeAlpha(p: vec2i) -> f32 {
 let size = vec2i(textureDimensions(source));
 if (any(p < vec2i(0)) || any(p >= size)) { return 0.0; }
 return textureLoad(source, p, 0).a;
}
const STROKE_NONE = -1.0e9;
@fragment fn stroke_seed(v: Vertex) -> @location(0) vec4f {
 let p = vec2i(v.position.xy); let a = strokeAlpha(p); let inside = a >= 0.5;
 let center = vec2f(p) + 0.5;
 var best = vec2f(STROKE_NONE); var nearest = 2.0;
 let around = array<vec2i, 4>(vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1));
 for (var i = 0; i < 4; i++) {
  let b = strokeAlpha(p + around[i]);
  if ((b >= 0.5) != inside && strokeInFrame(p) && strokeInFrame(p + around[i])) {
   let t = (0.5 - a) / (b - a);
   if (t < nearest) { nearest = t; best = center + vec2f(around[i]) * t; }
  }
 }
 return vec4f(best, 0.0, 0.0);
}
// a.x = 步长（像素）。9 个候选里留离本像素中心最近的种子。
@fragment fn stroke_jfa(v: Vertex) -> @location(0) vec4f {
 let p = vec2i(v.position.xy); let center = vec2f(p) + 0.5; let size = vec2i(textureDimensions(source));
 let step = i32(u.a.x);
 var best = vec2f(STROKE_NONE); var distance = 3.4e38;
 for (var y = -1; y <= 1; y++) {
  for (var x = -1; x <= 1; x++) {
   let q = p + vec2i(x, y) * step;
   if (any(q < vec2i(0)) || any(q >= size)) { continue; }
   let seed = textureLoad(source, q, 0).xy;
   if (seed.x <= STROKE_NONE * 0.5) { continue; }
   let d = dot(seed - center, seed - center);
   if (d < distance) { distance = d; best = seed; }
  }
 }
 return vec4f(best, 0.0, 0.0);
}
// 邻域取样估计有符号距离：以 0.5 像素为间距的同心圈、每圈 16 个方向，按半径累积最大（轮廓外）或最小（轮廓内）alpha，
// 它越过 0.5 的半径就是到 alpha 0.5 等值线的距离（直边上双线性 alpha 是 1 像素宽的线性坡，交点正好在等值线上）。
// 画幅外的纹素一律按透明做双线性取样（与种子“纹理外 a = 0”同一定义），不让 clamp 把边缘像素延伸出去。
// 轮廓来源为主体时（frame）片段画面外（r < 0.5）的纹素按本像素的 alpha 算，不在片段边上形成轮廓。
fn strokeAlphaAt(image: texture_2d<f32>, uv: vec2f, own: f32, frame: bool) -> f32 {
 let size = vec2i(textureDimensions(image));
 let at = uv * vec2f(size) - 0.5; let lo = vec2i(floor(at)); let t = fract(at);
 var value = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
 let offsets = array<vec2i, 4>(vec2i(0, 0), vec2i(1, 0), vec2i(0, 1), vec2i(1, 1));
 for (var i = 0; i < 4; i++) {
  let p = lo + offsets[i];
  if (all(p >= vec2i(0)) && all(p < size)) {
   let texel = textureLoad(image, p, 0);
   value[i] = select(texel.a, own, frame && texel.r < 0.5);
  } else if (frame) { value[i] = own; }
 }
 return mix(mix(value[0], value[1], t.x), mix(value[2], value[3], t.x), t.y);
}
fn strokeNearDistance(image: texture_2d<f32>, uv: vec2f, a: f32, reach: f32, frame: bool) -> f32 {
 let texel = 1.0 / vec2f(textureDimensions(image));
 let within = a >= 0.5;
 var previous = a; var radius = 0.0;
 let rings = i32(ceil(reach / 0.5));
 for (var ring = 1; ring <= rings; ring++) {
  let r = f32(ring) * 0.5;
  var extreme = previous;
  for (var k = 0; k < 16; k++) {
   let angle = f32(k) * 0.39269908;
   let q = uv + vec2f(cos(angle), sin(angle)) * r * texel;
   let t = strokeAlphaAt(image, q, a, frame);
   extreme = select(max(extreme, t), min(extreme, t), within);
  }
  if ((extreme >= 0.5) != within) {
   let crossing = radius + (0.5 - previous) / (extreme - previous) * 0.5;
   return select(crossing, -crossing, within);
  }
  previous = extreme; radius = r;
 }
 return select(reach + 1.0, -(reach + 1.0), within);
}
// a = (半径, 羽化宽, 覆盖最远处, 位置 0 外侧 / 1 内侧 / 2 居中)，b = (描边色（编码值）, 不透明度)，c = (原画不透明度, 距离场权重, 1 轮廓来源为主体, 片段不透明度)。
// 返回 (D, E)：D = 膨胀覆盖、E = 腐蚀覆盖，都夹到轮廓的 alpha（E ≤ a ≤ D）。
fn strokeCover(a: f32, sd: f32) -> vec2f {
 let r = u.a.x; let f = u.a.y;
 var dilate = clamp((r - sd) / f + 0.5, 0.0, 1.0);
 var erode = clamp((-r - sd) / f + 0.5, 0.0, 1.0);
 if (u.a.w < 0.5) { erode = a; dilate = max(dilate, a); }
 else if (u.a.w < 1.5) { dilate = a; erode = min(erode, a); }
 else { dilate = max(dilate, a); erode = min(erode, a); }
 return vec2f(dilate, erode);
}
// 轮廓就是内容的 alpha：内容核心 E、描边带 D−E、带里被描边盖住一部分的内容 a−E 三块相加。
fn strokeColor(base: vec4f, sd: f32) -> vec4f {
 let a = base.a; let c = straight(base);
 let cover = strokeCover(a, sd); let dilate = cover.x; let erode = cover.y;
 let k = u.b.w; let s = u.c.x;
 let rgb = c * s * erode + u.b.rgb * k * (dilate - erode) + c * s * (1.0 - k) * (a - erode);
 let alpha = s * erode + k * (dilate - erode) + s * (1.0 - k) * (a - erode);
 return vec4f(min(rgb, vec3f(alpha)), alpha);
}
// 轮廓是人物蒙版（a 人物，r 片段画面覆盖），与原画的 alpha 无关：描边带 D−E 按普通透明度叠在原画之上，只画在片段画面内。
// 片段不透明度在效果链之后整体乘，这里按完整不透明的原画叠描边。
fn strokeOver(base: vec4f, matte: vec4f, sd: f32) -> vec4f {
 let cover = strokeCover(matte.a, sd); let k = u.b.w * (cover.x - cover.y) * matte.r;
 return vec4f(u.b.rgb, 1.0) * k + base * u.c.x * (1.0 - k);
}
// 距离场着色；c.y 是距离场的权重，小于 1 时与邻域取样的距离混合（3–4 像素的过渡区）。
@fragment fn stroke_shade(v: Vertex) -> @location(0) vec4f {
 let p = vec2i(v.position.xy); let center = vec2f(p) + 0.5;
 let base = textureLoad(original, p, 0);
 let seed = textureLoad(source, p, 0).xy;
 var d = u.a.z + 1.0;
 if (seed.x > STROKE_NONE * 0.5) { d = min(d, length(seed - center)); }
 if (u.c.z > 0.5) {
  let matte = textureLoad(gradeMask, p, 0);
  var sd = select(d, -d, matte.a >= 0.5);
  if (u.c.y < 1.0) { sd = mix(strokeNearDistance(gradeMask, uvOf(v), matte.a, u.a.z, true), sd, u.c.y); }
  return strokeOver(base, matte, sd);
 }
 var sd = select(d, -d, base.a >= 0.5);
 if (u.c.y < 1.0) { sd = mix(strokeNearDistance(original, uvOf(v), base.a, u.a.z, false), sd, u.c.y); }
 return strokeColor(base, sd);
}
@fragment fn stroke_near(v: Vertex) -> @location(0) vec4f {
 let p = vec2i(v.position.xy);
 let base = textureLoad(source, p, 0);
 if (u.c.z > 0.5) {
  let matte = textureLoad(gradeMask, p, 0);
  return strokeOver(base, matte, strokeNearDistance(gradeMask, uvOf(v), matte.a, u.a.z, true));
 }
 return strokeColor(base, strokeNearDistance(source, uvOf(v), base.a, u.a.z, false));
}
`

export const STROKE_PLANNER = definePlanner({
  id: 'stroke', entries: STROKE_ENTRIES, wgsl: STROKE_WGSL,
  plan: (params, frame, instance) => planStroke(params, frame.width, frame.height, frame.layer),
  unfilteredSourceEntries: STROKE_FIELD_ENTRIES,
})
