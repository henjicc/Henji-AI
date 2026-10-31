import { definePlanner } from './effectPlanner'
/**
 * 划痕的工序规划与 WGSL（剪辑内置效果 ABI：预乘 sRGB 编码）。
 *
 * 一道逐点：画面按宽度 4% 分竖条，每个像素只看本条和左右两条。每条按 (竖条, 时间段) 取哈希，决定有没有划痕、横向位置、
 * 上下端、粗细与沿竖向的轻微弯曲；时间段长由“停留”定，起点按竖条错开。线宽按像素盒式覆盖算，比一个像素还细的划痕
 * 只是变淡，不闪烁跳格。亮划痕 c + (1 − c)·不透明度·m，暗划痕 c·(1 − 不透明度·m)。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { scratchFrameSeed, scratchHoldFrames, scratchWidth } from '@/core/videoEdit/scratches'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import { Planner, type VideoEditBuiltinPlan } from './effectPlan'
import { seedOffset } from './dissolveReveal'
import { contentBox } from './lightSweep'
import { EFFECT_MATH_BLOCK } from './effectShaderPrelude'

export const SCRATCHES_ENTRIES = ['scratches'] as const
const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)
/** 竖条宽度占画面宽度的比例。 */
const COLUMN = 0.04

/** 数量 → 每条竖条在一个时间段里出现划痕的概率：30 约 0.11（偶尔几条），80 约 0.62（满屏）。 */
export function scratchChance(amount: number): number { return 0.9 * Math.min(1, Math.max(0, amount / 100)) ** 1.7 }

/** `params` 已补齐默认值；`seed` 是 `scratchFrameSeed` 的返回值，同一种子预览与导出相同。 */
export function planScratches(params: VideoEditBuiltinParams, width: number, height: number, seed: number, context?: LayerEffectReference): VideoEditBuiltinPlan {
  const plan = new Planner(width, height)
  const finish = (): VideoEditBuiltinPlan => ({ width, height, scratch: plan.scratch, passes: plan.passes })
  const chance = scratchChance(n(params, 'amount')), opacity = n(params, 'opacity') / 100
  if (chance <= 0 || opacity <= 0) { plan.pass('copy', 'input', 'output'); return finish() }
  const h = context ? context.referenceSize.height * context.rasterScale : height
  const box = contentBox(width, height, context)
  const [, , hash] = seedOffset(n(params, 'seed'))
  plan.passes.push({
    entry: 'scratches', source: 'input', target: 'output',
    uniforms: new Float32Array([width, height, width, height, box.x, box.y, box.width, box.height, COLUMN * box.width, chance, opacity, scratchWidth(n(params, 'width')) * h,
      seed, scratchHoldFrames(n(params, 'hold')), hash, params.tone === 'dark' ? 1 : 0]),
  })
  return finish()
}

export const SCRATCHES_WGSL = `
// 划痕：a = 画面框（左上、宽高，像素），b = (竖条宽, 出现概率, 不透明度, 线宽（像素）)，c = (帧号, 停留帧数（0 一直不动）, 随机种子, 颜色 0 亮 / 1 暗)。
fn scratchMask(p: vec2f, column: i32) -> f32 {
 let seed = u32(u.c.z); let lane = u32(column + 4096);
 var segment = 0u;
 if (u.c.y > 0.0) { segment = u32(floor((u.c.x + hash(vec2u(lane, 0u), seed) * u.c.y) / u.c.y)); }
 let key = vec2u(lane, segment);
 if (hash(key, seed + 1u) >= u.b.y) { return 0.0; }
 let h = u.a.w; let y = p.y - u.a.y;
 let full = hash(key, seed + 2u) < 0.35;
 let span = select((0.25 + 0.6 * hash(key, seed + 3u)) * h, 1.2 * h, full);
 let top = select(hash(key, seed + 4u) * (h - span), -0.1 * h, full);
 let ends = ramp(top, top + 0.06 * h, y) * (1.0 - ramp(top + span - 0.06 * h, top + span, y));
 let width = u.b.w * (0.6 + 0.8 * hash(key, seed + 5u));
 let bend = 0.0012 * u.a.z * sin(6.2831853 * (y / h * (0.3 + 1.2 * hash(key, seed + 6u)) + hash(key, seed + 7u)));
 let x = u.a.x + (f32(column) + 0.15 + 0.7 * hash(key, seed + 8u)) * u.b.x + bend;
 let cover = clamp(min(p.x + 0.5, x + width * 0.5) - max(p.x - 0.5, x - width * 0.5), 0.0, 1.0);
 return cover * ends * (0.6 + 0.4 * noise(vec2f(y / (0.07 * h), f32(column) * 7.3), seed + 9u));
}
@fragment fn scratches(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); let p = v.position.xy;
 let column = i32(floor((p.x - u.a.x) / u.b.x));
 var m = 0.0;
 for (var i = -1; i <= 1; i++) { m = max(m, scratchMask(p, column + i)); }
 let rgb = straight(c); let k = u.b.z * m;
 return premul(select(rgb + (1.0 - rgb) * k, rgb * (1.0 - k), u.c.w > 0.5), c.a);
}
`

export const SCRATCHES_PLANNER = definePlanner({
  id: 'scratches', entries: SCRATCHES_ENTRIES, shared: [EFFECT_MATH_BLOCK], wgsl: SCRATCHES_WGSL,
  plan: (params, frame) => planScratches(params, frame.width, frame.height, scratchFrameSeed(params, frame.frame), frame.layer),
})
