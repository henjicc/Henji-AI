import { definePlanner } from './effectPlanner'
import { EFFECT_MATH_BLOCK } from './effectShaderPrelude'
import { effectHash } from './effectShaderMath'
/**
 * 故障的工序规划与 WGSL（剪辑内置效果 ABI）：三种方式各是一道取样工序，没有中间纹理。
 *
 * 块网格与条带都锚在内容坐标上（图层移动时碎片跟着走）。每种错法持续“变化频率”换算出的帧数，
 * 段号与随机种子在规划里混成本段种子，着色器只按格子编号取 hash，同一帧预览与导出逐像素相同。
 * 偏移与红蓝错开取整到像素，错开的文字照样清楚；取样越界为透明，透明底的碎片飞出原位也不带黑边。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import { GLITCH_BLOCK_ASPECT, GLITCH_MAX_BAR_SHIFT, GLITCH_MAX_BLOCK_SHIFT, glitchBlockPixels, glitchFrameSeed, glitchSplitDistance } from '@/core/videoEdit/glitch'
import { Planner, type VideoEditBuiltinPlan } from './effectPlan'

export const GLITCH_ENTRIES = ['glitch'] as const
const MODES: Readonly<Record<string, number>> = { digital: 0, bars: 1, compression: 2 }
/** 强度 100 时数字故障错开的块占全部块的比例。 */
const DIGITAL_BLOCK_SHARE = 0.3
/** 反色从这个强度开始出现，到 100 时每段必有一块。 */
const INVERT_FROM = 0.6
const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)


/** `params` 已补齐默认值；`segment` 是 `glitchFrameSeed` 给出的本帧错法段号。 */
export function planGlitch(params: VideoEditBuiltinParams, width: number, height: number, segment: number, context?: LayerEffectReference): VideoEditBuiltinPlan {
  const plan = new Planner(width, height)
  const strength = Math.min(1, n(params, 'amount') / 100)
  if (strength <= 0) { plan.pass('copy', 'input', 'output'); return { width, height, scratch: plan.scratch, passes: plan.passes } }
  const h = context ? context.referenceSize.height * context.rasterScale : height
  const origin = context ? context.rasterOrigin : [0, 0]
  const content = context ? [context.contentBounds.width * context.rasterScale, context.contentBounds.height * context.rasterScale] : [width, height]
  const mode = MODES[String(params.mode)] ?? 0
  const blockHeight = glitchBlockPixels(n(params, 'block_size'), h)
  const blockWidth = mode === 0 ? blockHeight * GLITCH_BLOCK_ASPECT : blockHeight
  // 落在 24 位内，转成 float 交给着色器不丢精度。
  const seed = effectHash(Math.floor(n(params, 'seed')), segment) & 0xffffff
  let invert = [-1e6, -1e6]
  if (mode === 0 && strength > INVERT_FROM && effectHash(seed, 1) / 2 ** 32 < (strength - INVERT_FROM) / (1 - INVERT_FROM)) {
    invert = [effectHash(seed, 2) % Math.max(1, Math.ceil(content[0] / (2 * blockWidth))), effectHash(seed, 3) % Math.max(1, Math.ceil(content[1] / (2 * blockHeight)))]
  }
  const radians = n(params, 'angle') * Math.PI / 180
  const split = mode === 2 ? 0 : Math.round(glitchSplitDistance(n(params, 'rgb_split')) * h)
  plan.passes.push({
    entry: 'glitch', source: 'input', target: 'output',
    uniforms: new Float32Array([width, height, width, height, mode, strength, blockWidth, blockHeight, seed, Math.cos(radians), Math.sin(radians), Math.max(2, Math.round(n(params, 'bars'))),
      strength * GLITCH_MAX_BAR_SHIFT * h, invert[0], invert[1], split, origin[0], origin[1], content[0], content[1], 0, 0, 0, 0]),
  })
  return { width, height, scratch: plan.scratch, passes: plan.passes }
}

const f = (value: number): string => value.toFixed(4)
export const GLITCH_WGSL = `
// a = (方式 0 数字故障 / 1 条带错位 / 2 压缩失真, 强度 0..1, 块宽, 块高)，b = (本段种子, 条带走向 cos, sin, 条数)，
// c = (条带最大偏移, 反色块的列, 行, 红蓝错开)，layer = (内容原点 x, y, 内容宽, 高)；长度都是像素。
fn glitchTap(p: vec2f) -> vec4f { let uv = p / u.size.zw; if (!inside(uv)) { return vec4f(0.0); } return tap(uv); }
fn glitchCell(cell: vec2f) -> vec2u { return vec2u(vec2i(cell) + vec2i(1 << 20)); }
// 红色朝一边、青色（绿与蓝）朝另一边，各错开一半距离。两份各有遮挡时透明度按色差的同一规则：取平均但不低于颜色本身，透明底上只落一色的彩边不发黑。
fn glitchSplit(p: vec2f, offset: vec2f) -> vec4f {
 let r = glitchTap(p + round(offset * 0.5)); let c = glitchTap(p + round(-offset * 0.5));
 let rgb = vec3f(r.r, c.g, c.b);
 let alpha = clamp(max((r.a + c.a) * 0.5, max(rgb.r, max(rgb.g, rgb.b))), 0.0, 1.0);
 return vec4f(min(rgb, vec3f(alpha)), alpha);
}
// 块分三档大小（基本块的 4 倍、2 倍、1 倍），大块随机再切小，碎片大小不一。一部分块整块横移 0.5–${GLITCH_MAX_BLOCK_SHIFT} 个基本块宽并红蓝分离；
// 强度越大入选的块越多，已入选的块在同一段里保持不变。反色块落在 2 倍档的格子上。
fn glitchDigital(p: vec2f) -> vec4f {
 let base = u.a.zw; let q = p - u.layer.xy; var seed = u32(u.b.x);
 var size = base * 4.0; var cell = floor(q / size);
 if (hash(glitchCell(cell), seed + 101u) < 0.65) {
  size = base * 2.0; cell = floor(q / size); seed += 211u;
  if (hash(glitchCell(cell), seed + 101u) < 0.5) { size = base; cell = floor(q / size); seed += 211u; }
 }
 let id = glitchCell(cell);
 // 出错集中在几条横带里：每条大块行按本段种子分到不同的出错概率，平均仍是设定的比例。
 let zone = hash(vec2u(u32(i32(floor(q.y / (base.y * 4.0))) + (1 << 20)), 7u), u32(u.b.x));
 var c = glitchTap(p);
 if (hash(id, seed) < u.a.y * ${f(DIGITAL_BLOCK_SHARE)} * 4.0 * zone * zone * zone) {
  let h = hash(id, seed + 1u);
  let shift = select(-1.0, 1.0, h >= 0.5) * round(mix(0.5, ${f(GLITCH_MAX_BLOCK_SHIFT)}, fract(h * 2.0)) * base.x);
  c = glitchSplit(p + vec2f(shift, 0.0), vec2f(u.c.w, 0.0));
 }
 if (all(floor(q / (base * 2.0)) == u.c.yz)) { c = vec4f(vec3f(c.a) - c.rgb, c.a); }
 return c;
}
fn glitchBar(p: vec2f, index: f32) -> vec4f {
 let h = hash(vec2u(u32(i32(index) + (1 << 20)), 0u), u32(u.b.x)) * 2.0 - 1.0;
 return glitchSplit(p + round(u.b.yz * h * u.c.x), u.b.yz * abs(h) * u.c.w);
}
// 沿走向的法向把内容等分成 N 条，每条沿走向各自偏移；条带边缘按像素覆盖量与相邻条混合，斜条带不出锯齿。
fn glitchBars(p: vec2f) -> vec4f {
 let across = vec2f(-u.b.z, u.b.y);
 let width = max(abs(u.layer.z * across.x) + abs(u.layer.w * across.y), 1.0) / u.b.w;
 let s = dot(p - u.layer.xy - u.layer.zw * 0.5, across) / width + u.b.w * 0.5;
 let index = floor(s); let t = s - index;
 let c = glitchBar(p, index);
 let reach = (abs(across.x) + abs(across.y)) * 0.5; let edge = min(t, 1.0 - t) * width;
 if (edge >= reach) { return c; }
 return mix(c, glitchBar(p, select(index + 1.0, index - 1.0, t < 0.5)), 0.5 * (1.0 - edge / reach));
}
// 块内取样夹在画面以内：整幅画面边上的块像编码器一样重复边缘像素，不会混进透明而发暗。
fn glitchEdgeTap(p: vec2f) -> vec4f { return tap(clamp(p / u.size.zw, vec2f(0.0), vec2f(1.0))); }
// 像码率不够的编码：每块先退成块内四个象限均值的平滑过渡（块内只剩缓坡、块与块之间出现接缝），失真再重就只剩一个均值；
// 色度按 2×2 块取平均（4:2:0 拖色）。每个 2×2 块的失真程度按本段种子起伏，块边不柔化。
fn glitchCompression(p: vec2f) -> vec4f {
 let size = u.a.w; let q = p - u.layer.xy; let cell = floor(q / size); let wide = floor(q / (2.0 * size));
 let loss = clamp(u.a.y * (0.5 + hash(glitchCell(wide), u32(u.b.x))), 0.0, 1.0);
 let origin = u.layer.xy + cell * size;
 var quad = array<vec4f, 4>(vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
 for (var y = 0; y < 4; y++) { for (var x = 0; x < 4; x++) { quad[(y / 2) * 2 + x / 2] += glitchEdgeTap(origin + size * (vec2f(f32(x), f32(y)) + 0.5) / 4.0) * 0.25; } }
 let s = ((q - cell * size) / size - 0.25) * 2.0;
 var ramped = mix(mix(quad[0], quad[1], s.x), mix(quad[2], quad[3], s.x), s.y);
 ramped = vec4f(clamp(ramped.rgb, vec3f(0.0), vec3f(max(ramped.a, 0.0))), clamp(ramped.a, 0.0, 1.0));
 let mean = (quad[0] + quad[1] + quad[2] + quad[3]) * 0.25;
 let block = select(mix(ramped, mean, loss * 2.0 - 1.0), mix(glitchTap(p), ramped, loss * 2.0), loss < 0.5);
 if (block.a <= 0.00001) { return vec4f(0.0); }
 let rgb = block.rgb / block.a; let y = dot(rgb, LUMA);
 var chroma = rgb - y;
 let mo = u.layer.xy + wide * 2.0 * size;
 let around = (glitchEdgeTap(mo + size * 0.5) + glitchEdgeTap(mo + size * vec2f(1.5, 0.5)) + glitchEdgeTap(mo + size * vec2f(0.5, 1.5)) + glitchEdgeTap(mo + size * 1.5)) * 0.25;
 if (around.a > 0.00001) { let m = around.rgb / around.a; chroma = mix(chroma, m - dot(m, LUMA), min(1.0, loss * 2.0)); }
 return premul(y + chroma, block.a);
}
@fragment fn glitch(v: Vertex) -> @location(0) vec4f {
 let p = v.position.xy;
 if (u.a.x < 0.5) { return glitchDigital(p); }
 if (u.a.x < 1.5) { return glitchBars(p); }
 return glitchCompression(p);
}
`

export const GLITCH_PLANNER = definePlanner({
  id: 'glitch', entries: GLITCH_ENTRIES, shared: [EFFECT_MATH_BLOCK], wgsl: GLITCH_WGSL,
  plan: (params, frame) => planGlitch(params, frame.width, frame.height, glitchFrameSeed(params, frame.frame), frame.layer),
})
