import { definePlanner } from './effectPlanner'
/**
 * 扫光的工序规划与 WGSL（剪辑内置效果 ABI）。
 *
 * 光带沿“角度”方向扫过内容框：进度 0 时光带整条在内容框前面，100 时整条已经过去，两端都与原画逐位相同。
 * `sweep_image` 用发光的同一套相加公式（肩部压缩、溢出推白、只在改动像素上抖动）把光加到内容上，再乘 alpha，透明处不出光条；
 * 发光组开启时 `sweep_light` 另写一张预乘线性光，交给发光金字塔（来源“光源纹理”），光晕照到内容外面。
 */
import { WHITE_HEX } from '@/core/theme/colorTokens'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { lightGlowParams } from '@/core/videoEdit/glow'
import { lightSweepWidth } from '@/core/videoEdit/lightSweep'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import type { VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'
import { appendGlow, createGlowPlanner } from './glow'

export const LIGHT_SWEEP_ENTRIES = ['sweep_image', 'sweep_light'] as const
const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)

/** sRGB 编码的 #rrggbb → 线性光。 */
export function linearHex(value: unknown): [number, number, number] {
  const hex = typeof value === 'string' && /^#[0-9a-f]{6}/i.test(value) ? value : WHITE_HEX
  return [1, 3, 5].map(index => {
    const c = parseInt(hex.slice(index, index + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
}

/** 内容框（纹理像素）：图层上是未外扩的 bounds，片段上是整张纹理。 */
export function contentBox(width: number, height: number, context?: LayerEffectReference): { x: number; y: number; width: number; height: number } {
  if (!context) return { x: 0, y: 0, width, height }
  return { x: context.rasterOrigin[0], y: context.rasterOrigin[1], width: context.contentBounds.width * context.rasterScale, height: context.contentBounds.height * context.rasterScale }
}

/** `params` 已补齐默认值；`split` 为图层拆输出。 */
export function planLightSweep(params: VideoEditBuiltinParams, width: number, height: number, context?: LayerEffectReference, split = false): VideoEditBuiltinPlan {
  const glow = createGlowPlanner(width, height, context)
  const progress = n(params, 'progress') / 100, intensity = n(params, 'intensity') / 100
  if (intensity <= 0 || progress <= 0 || progress >= 1) { glow.pass('copy', 'input', 'output'); return glow.plan }
  const h = context ? context.referenceSize.height * context.rasterScale : height
  const box = contentBox(width, height, context)
  const angle = n(params, 'angle') * Math.PI / 180
  const direction: [number, number] = [Math.cos(angle), Math.sin(angle)]
  const center: [number, number] = [box.x + box.width / 2, box.y + box.height / 2]
  // 内容框四角在扫动方向上的投影范围；光带中心从框前一个半宽走到框后一个半宽。
  const span = Math.abs(direction[0]) * box.width / 2 + Math.abs(direction[1]) * box.height / 2
  const half = Math.max(0.5, lightSweepWidth(n(params, 'width')) * h / 2)
  const position = -span - half + progress * 2 * (span + half)
  const light = linearHex(params.color).map(value => value * intensity)
  const edge = 1 - Math.max(n(params, 'feather') / 100, Math.min(1, 1 / half))
  const uniforms = (target: number | 'output'): Float32Array => {
    const [tw, th] = typeof target === 'number' ? [glow.plan.scratch[target].width, glow.plan.scratch[target].height] : [width, height]
    return new Float32Array([tw, th, width, height, direction[0], direction[1], center[0], center[1], ...light, position, half, 0.5, 0.5, 0, context ? context.rasterOrigin[0] : 0, context ? context.rasterOrigin[1] : 0, edge, 0, 0, 0, 0, 0])
  }
  const glowParams = lightGlowParams(params)
  if (Number(glowParams.strength) <= 0) {
    glow.plan.passes.push({ entry: 'sweep_image', source: 'input', target: 'output', uniforms: uniforms('output') })
    return glow.plan
  }
  const image = glow.alloc(width, height), lightTexture = glow.alloc(width, height)
  glow.plan.passes.push({ entry: 'sweep_image', source: 'input', target: image, uniforms: uniforms(image) }, { entry: 'sweep_light', source: 'input', target: lightTexture, uniforms: uniforms(lightTexture) })
  appendGlow(glow, glowParams, width, height, context, split, 'light', lightTexture, image)
  return glow.plan
}

export const LIGHT_SWEEP_WGSL = `
// a = (扫动方向, 内容框中心)，b = (光（线性，乘过亮度）, 光带中心的位置)，c = (半宽, 核心发白, 抖动, 单色)，layer = (内容原点, 光带边缘开始变暗处 0..1, 0)。
fn sweepLight(v: Vertex) -> vec3f {
 let s = dot(v.position.xy - u.a.zw, u.a.xy);
 let d = abs(s - u.b.w) / u.c.x;
 return u.b.rgb * (1.0 - ramp(u.layer.z, 1.0, d));
}
@fragment fn sweep_image(v: Vertex) -> @location(0) vec4f {
 let base = tap(uvOf(v));
 if (base.a <= 0.00001) { return vec4f(0.0); }
 return vec4f(glowColor(straight(base), sweepLight(v), false, v.position.xy) * base.a, base.a);
}
@fragment fn sweep_light(v: Vertex) -> @location(0) vec4f { return vec4f(sweepLight(v) * tap(uvOf(v)).a, 1.0); }
`

export const LIGHT_SWEEP_PLANNER = definePlanner({
  id: 'light_sweep', entries: LIGHT_SWEEP_ENTRIES, wgsl: LIGHT_SWEEP_WGSL,
  plan: (params, frame) => planLightSweep(params, frame.width, frame.height, frame.layer, frame.split),
})
