import { definePlanner } from './effectPlanner'
/**
 * 主体抠像的工序规划与 WGSL（剪辑内置效果 ABI）。人物蒙版是工序纹理 `subject`（智能区域的人物分析，按片段几何画到画面尺寸）。
 *
 * 1. `subject_choke`：收缩 / 扩展，横竖两道一维最小 / 最大值（方形结构元素，与智能区域“扩展”同一种做法）。
 * 2. 边缘柔化：蒙版走与均匀模糊同一份可分离高斯规划。
 * 3. 净化边缘颜色（与 Photoshop“净化颜色”同一做法）：半透明边缘的颜色换成附近完全保留的像素的颜色，越透明换得越多。
 *    附近的主体色用拉推法回填（Gortler 等 1996，Lumigraph）：`subject_key_gather` 在半分辨率上只收接近完全保留的像素，
 *    `subject_fill_pull` 逐级对半缩小，`subject_fill_push` 从最粗一级逐级放大、补上缺的颜色。任意远处都取到最近的主体色，
 *    没有取色范围的边界（固定半径的模糊在范围尽头会留下一圈色差）。
 *    不从原色里减背景色：人物蒙版只有长边 512，边缘带里有不少其实是纯主体的像素，减背景会把它们压成黑边。
 * 中间纹理一律 rgba16float。
 *
 * 工序纹理 `subject` 的 a 是人物覆盖、r 是片段画面覆盖（宿主用 `planSubjectFootprint` 从放好的蒙版换出来）。
 * 片段画面外的取样一律不算数（按画面里的值算）：画中画里人物在片段边上被裁断时，收缩不从裁切线吃进人物，
 * 描边不把裁切线当成轮廓，描边与光也只画在片段画面内。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { subjectChokeDistance, subjectFeatherSigma } from '@/core/videoEdit/subjectKey'
import { planGaussian } from '@/core/imaging/adjustments/gaussianPlan'
import { Planner, ZERO, type VideoEditBuiltinPlan, type VideoEditBuiltinTexture } from './effectPlan'

export const SUBJECT_KEY_ENTRIES = ['subject_choke', 'subject_key_gather', 'subject_fill_pull', 'subject_fill_push', 'subject_key_composite', 'subject_footprint'] as const
/** 拉推法缩小到长边不超过它就停：最粗一级已经覆盖整个画面。 */
const FILL_COARSEST = 8

/** 拉推回填：`gather` 已在半分辨率收好 (值 × 权重, 权重)，逐级对半缩小到长边不超过 FILL_COARSEST，再逐级放大补缺，返回半分辨率的回填结果。 */
function pullPush(plan: Planner, gathered: VideoEditBuiltinTexture): VideoEditBuiltinTexture {
  const levels = [gathered]
  for (let size = plan.size(gathered); Math.max(...size) > FILL_COARSEST; size = plan.size(levels.at(-1)!)) {
    const next = plan.alloc(Math.ceil(size[0] / 2), Math.ceil(size[1] / 2))
    plan.pass('subject_fill_pull', levels.at(-1)!, next)
    levels.push(next)
  }
  let filled = levels.at(-1)!
  for (let index = levels.length - 2; index >= 0; index--) {
    const [levelWidth, levelHeight] = plan.size(levels[index])
    const next = plan.alloc(levelWidth, levelHeight)
    plan.pass('subject_fill_push', filled, next, ZERO, ZERO, levels[index])
    filled = next
  }
  return filled
}

/** 放好的蒙版（r 人物 × 片段覆盖、a 片段覆盖）→ 工序纹理 `subject`（a 人物、r 片段覆盖）。 */
export function planSubjectFootprint(width: number, height: number): VideoEditBuiltinPlan {
  const plan = new Planner(width, height)
  plan.pass('subject_footprint', 'input', 'output')
  return { width, height, scratch: plan.scratch, passes: plan.passes }
}

/** `params` 已补齐默认值。“去掉主体”时保留量是 1 − 蒙版：收缩 / 扩展作用在保留的部分上，所以对人物蒙版反向。 */
export function planSubjectKey(params: VideoEditBuiltinParams, width: number, height: number): VideoEditBuiltinPlan {
  const plan = new Planner(width, height)
  const invert = params.invert === true
  const choke = Number(params.choke ?? 0)
  const radius = subjectChokeDistance(choke) * height
  let matte: VideoEditBuiltinTexture = 'subject'
  if (radius > 0) {
    const grow = (choke > 0) !== invert ? 1 : 0
    const across = plan.alloc(); plan.pass('subject_choke', matte, across, [1 / width, 0, radius, grow])
    const along = plan.alloc(); plan.pass('subject_choke', across, along, [0, 1 / height, radius, grow])
    matte = along
  }
  const flag = [invert ? 1 : 0, 0, 0, 0] as const
  // 主体色只从柔化前的蒙版里完全保留的地方取：柔化会把边缘外的背景像素也带到接近完全保留。
  const gathered = plan.alloc(Math.ceil(width / 2), Math.ceil(height / 2))
  plan.pass('subject_key_gather', 'input', gathered, flag, ZERO, matte)
  const filled = pullPush(plan, gathered)
  const sigma = subjectFeatherSigma(Number(params.feather ?? 0)) * height
  const feather = planGaussian({ width, height, sigmaX: sigma, sigmaY: sigma, repeatEdges: true }).passes
  if (!(feather.length === 1 && feather[0].kind === 'copy')) { const soft = plan.alloc(); plan.gaussian(matte, soft, sigma, sigma, true); matte = soft }
  plan.pass('subject_key_composite', filled, 'output', flag, ZERO, 'input')
  plan.passes.at(-1)!.mask = matte
  return { width, height, scratch: plan.scratch, passes: plan.passes, linearScratch: true }
}

export const SUBJECT_KEY_WGSL = `
// 一维最大（扩展）/ 最小（收缩）值：a = (每步 u, 每步 v, 半径（像素，可带小数）, 1 扩展 / 0 收缩)，只看 alpha。
// 半径的小数部分是最外一对取样的权重，参数连续变化时边缘连续移动。取样落在纹素中心，画面外按边缘像素延伸。
fn subjectExtreme(a: f32, b: f32, grow: bool) -> f32 { return select(min(a, b), max(a, b), grow); }
// 输入输出都是 a 人物、r 片段覆盖；片段画面外的取样按本像素的值算（不参与最小 / 最大）。
fn subjectChokeTap(uv: vec2f, own: f32) -> f32 { let c = tap(uv); return select(own, c.a, c.r >= 0.5); }
@fragment fn subject_choke(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let grow = u.a.w > 0.5; let n = i32(floor(u.a.z));
 let center = tap(uv); var inner = center.a;
 for (var i = 1; i <= n; i++) {
  let d = u.a.xy * f32(i);
  inner = subjectExtreme(inner, subjectExtreme(subjectChokeTap(uv + d, center.a), subjectChokeTap(uv - d, center.a), grow), grow);
 }
 let d = u.a.xy * f32(n + 1);
 let outer = subjectExtreme(inner, subjectExtreme(subjectChokeTap(uv + d, center.a), subjectChokeTap(uv - d, center.a), grow), grow);
 return vec4f(vec3f(center.r), mix(inner, outer, fract(u.a.z)));
}
// a.x = 1 去掉主体（保留背景）。
fn subjectKeep(m: f32) -> f32 { return select(m, 1.0 - m, u.a.x > 0.5); }
// 拉推法的每一格存 (颜色 × 权重, 权重)：颜色是预乘画面，权重就是 alpha 通道。权重和超过 1 时归一到 1，
// 已经确定的格子不再被更粗一级改动。奇数尺寸的最后一行、列按边缘纹素补齐。
fn subjectLimit(c: vec4f) -> vec4f { return select(c, c / c.a, c.a > 1.0); }
fn subjectChild(image: texture_2d<f32>, p: vec2i, i: i32) -> vec2i { return min(p * 2 + vec2i(i & 1, i >> 1), vec2i(textureDimensions(image)) - 1); }
// source = 画面（预乘），original = 柔化前的蒙版。权重是保留量的 16 次方：只有接近完全保留的像素算数，
// 蒙版边缘那圈其实是背景的像素不掺进主体色。
@fragment fn subject_key_gather(v: Vertex) -> @location(0) vec4f {
 let p = vec2i(v.position.xy); var sum = vec4f(0.0);
 for (var i = 0; i < 4; i++) {
  let q = subjectChild(source, p, i);
  let keep = subjectKeep(textureLoad(original, q, 0).a); let k2 = keep * keep; let k4 = k2 * k2; let k8 = k4 * k4;
  sum += textureLoad(source, q, 0) * (k8 * k8);
 }
 return subjectLimit(sum);
}
@fragment fn subject_fill_pull(v: Vertex) -> @location(0) vec4f {
 let p = vec2i(v.position.xy); var sum = vec4f(0.0);
 for (var i = 0; i < 4; i++) { sum += textureLoad(source, subjectChild(source, p, i), 0); }
 return subjectLimit(sum);
}
// source = 粗一级（已回填），original = 本级拉取的结果：本级缺多少权重，就用粗一级的颜色补多少。
@fragment fn subject_fill_push(v: Vertex) -> @location(0) vec4f {
 let fine = textureLoad(original, vec2i(v.position.xy), 0);
 return fine + tap(uvOf(v)) * (1.0 - fine.a);
}
// source = 放好的蒙版（人物蒙版写成不透明灰度后按片段几何画上：r = 人物 × 片段覆盖，a = 片段覆盖）→ a 人物、r 片段覆盖。
@fragment fn subject_footprint(v: Vertex) -> @location(0) vec4f {
 let c = textureLoad(source, vec2i(v.position.xy), 0);
 return vec4f(vec3f(c.a), select(0.0, min(1.0, c.r / c.a), c.a > 0.0));
}
// source = 回填好的主体色（半分辨率），original = 画面，gradeMask = 柔化后的蒙版。
// 越透明的边缘越多地换成附近的主体色（保留原色的比例是保留量²），原背景透出来的颜色随之去掉；完全保留处原样不动。
// 整个画面都没有完全保留的像素时只按蒙版相乘。
@fragment fn subject_key_composite(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let c = tapOriginal(uv);
 let keep = subjectKeep(textureSampleLevel(gradeMask, s, uv, 0.0).a);
 let alpha = c.a * keep;
 if (alpha <= 0.0) { return vec4f(0.0); }
 let b = tap(uv);
 let nearby = mix(straight(c), b.rgb / max(b.a, 0.000001), smoothstep(0.00002, 0.0002, b.a));
 return premul(mix(nearby, straight(c), keep * keep), alpha);
}
`

export const SUBJECT_KEY_PLANNER = definePlanner({
  id: 'subject_key', entries: SUBJECT_KEY_ENTRIES, wgsl: SUBJECT_KEY_WGSL,
  plan: (params, frame) => planSubjectKey(params, frame.width, frame.height),
})
