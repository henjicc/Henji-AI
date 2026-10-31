import { definePlanner } from './effectPlanner'
/**
 * 纸张的工序规划与 WGSL（剪辑内置效果 ABI：预乘 sRGB 编码）。
 *
 * 一道逐点：高度场 = 细纤维（三层沿随机方向拉长 6:1 的值噪声）与颗粒（三层逐层加倍频率的值噪声）按粗糙度混合，
 * 用共享数学里带解析梯度的值噪声（noiseGradient），不用多次取样求导。颜色在线性光里乘 1 − 强度·0.3·(h − 0.5)，再加一点按梯度的方向光（只给起伏感，不做浮雕）。
 * 边缘毛糙按梯度挪动透明度的取样位置，内部颜色仍取原位置，内容不会被扭动；挪动距离封顶在外扩以内。
 * 纹理锚在内容左上角，静态，不随时间变化。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { paperCellSize, paperEdgeReach } from '@/core/videoEdit/paper'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import { Planner, type VideoEditBuiltinPlan } from './effectPlan'
import { seedOffset } from './dissolveReveal'
import { contentBox } from './lightSweep'
import { EFFECT_MATH_BLOCK } from './effectShaderPrelude'

export const PAPER_ENTRIES = ['paper'] as const
const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)

/** `params` 已补齐默认值。 */
export function planPaper(params: VideoEditBuiltinParams, width: number, height: number, context?: LayerEffectReference): VideoEditBuiltinPlan {
  const plan = new Planner(width, height)
  const finish = (): VideoEditBuiltinPlan => ({ width, height, scratch: plan.scratch, passes: plan.passes })
  const amount = n(params, 'amount') / 100
  if (amount <= 0) { plan.pass('copy', 'input', 'output'); return finish() }
  const h = context ? context.referenceSize.height * context.rasterScale : height
  const box = contentBox(width, height, context)
  const [, , hash] = seedOffset(n(params, 'seed'))
  // 三层纤维相隔 60°（拉长的噪声正反同向），整体转角与颗粒的起始转角由种子决定，换种子换一种纸。
  const base = (hash * 0.618034) % 1 * Math.PI
  const turn = (k: number): number => base + k * Math.PI / 3
  plan.passes.push({
    entry: 'paper', source: 'input', target: 'output',
    uniforms: new Float32Array([width, height, width, height, paperCellSize(params) * h, amount, n(params, 'roughness') / 100, paperEdgeReach(params) * h,
      box.x, box.y, hash, 0, turn(1), turn(2), turn(3), turn(4)]),
  })
  return finish()
}

export const PAPER_WGSL = `
// 纸张：a = (纹理格子边长（像素）, 强度 0..1, 粗糙度 0..1, 轮廓最远挪动（像素）)，b = (内容左上角, 随机种子, 0)，
// c = (三层纤维的方向, 颗粒的起始转角)（弧度）。
// 几层噪声平均后起伏只剩 ±0.15 左右，放大到约 ±0.4，强度 100 时明暗变化约 ±12%。
const PAPER_RELIEF = 2.5;
// 共享值噪声换到 0..1：(值, ∂/∂x, ∂/∂y)。
fn paperNoise(p: vec2f, seed: u32) -> vec3f { return noiseGradient(p, seed) * 0.5 + vec3f(0.5, 0.0, 0.0); }
fn paperRotate(p: vec2f, angle: f32) -> vec2f { let c = cos(angle); let s = sin(angle); return vec2f(c * p.x - s * p.y, s * p.x + c * p.y); }
// 高度场（均值约 0.5）与它对纹理坐标的梯度。
fn paperHeight(q: vec2f) -> vec3f {
 let seed = u32(u.b.z);
 var grain = vec3f(0.0); var scale = 1.0; var weight = 0.5;
 for (var i = 0u; i < 3u; i++) {
  let angle = u.c.w + f32(i) * 2.1;
  let n = paperNoise(paperRotate(q, angle) * scale + f32(i) * 17.31, seed + i);
  grain += vec3f(n.x, paperRotate(n.yz, -angle) * scale) * weight;
  scale *= 2.0; weight *= 0.6;
 }
 grain /= 0.98;
 // 纤维：沿三个相隔 60° 的方向拉长 6:1 的值噪声，取样位置被颗粒轻轻扭弯，纤维不成直线。
 var fiber = vec3f(0.0);
 let warp = (grain.x - 0.5) * 1.5;
 for (var i = 0u; i < 3u; i++) {
  let angle = u.c[i];
  let along = vec2f(cos(angle), sin(angle)); let across = vec2f(-along.y, along.x);
  let n = paperNoise(vec2f(dot(q, along) / 6.0, dot(q, across) + warp) * 3.0 + f32(i) * 41.7, seed + 7u + i);
  fiber += vec3f(n.x, (along * n.y / 6.0 + across * n.z) * 3.0) / 3.0;
 }
 fiber = vec3f(0.5 + (fiber.x - 0.5) * 1.5, fiber.yz * 1.5);
 return mix(fiber, grain, u.a.z);
}
@fragment fn paper(v: Vertex) -> @location(0) vec4f {
 let p = v.position.xy; let src = tap(uvOf(v));
 let height = paperHeight((p - u.b.xy) / u.a.x);
 var alpha = src.a; var color = straight(src);
 if (u.a.w > 0.0) {
  // 梯度长度超过 1 的地方封顶，挪动不超过外扩。
  let offset = height.yz / max(1.0, length(height.yz)) * u.a.w;
  let moved = tap((p + offset) / u.size.xy);
  alpha = moved.a; color = mix(straight(moved), color, src.a);
 }
 // 光从左上来（法线 ∝ (−∇h, 1)，迎光面 ∇h 朝右下）：迎光的坡稍亮、背光的稍暗，只给一点起伏感。
 let shade = 1.0 - u.a.y * 0.3 * (height.x - 0.5) * PAPER_RELIEF + u.a.y * 0.05 * dot(height.yz, vec2f(0.7071068, 0.7071068));
 return premul(toSrgb(toLinear(color) * max(shade, 0.0)), alpha);
}
`

export const PAPER_PLANNER = definePlanner({
  id: 'paper', entries: PAPER_ENTRIES, shared: [EFFECT_MATH_BLOCK], wgsl: PAPER_WGSL,
  plan: (params, frame) => planPaper(params, frame.width, frame.height, frame.layer),
})
