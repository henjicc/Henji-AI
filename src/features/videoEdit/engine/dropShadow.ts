/**
 * 投影的工序规划与 WGSL（剪辑内置效果 ABI）。
 *
 * 1. 用均匀模糊的同一份可分离高斯规划（`planGaussian`）模糊输入，只用结果的 alpha；
 * 2. 合成：在偏移处取模糊后的 alpha 做影子。片段上叠在原画下面成一张图；图层上影子作为普通预乘的下层（cover）交给执行器，
 *    主图只按原画不透明度，后面的效果不再改动影子。
 * 平滑的影子靠 16 位浮点合成与末道抖动防色带（高精度触发表登记了投影），这里不另加抖动。
 */
import { BLACK_HEX } from '@/core/theme/colorTokens'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { blurSigma } from '@/core/videoEdit/blur'
import { dropShadowOffset } from '@/core/videoEdit/dropShadow'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import { planGaussian } from '@/core/imaging/adjustments/gaussianPlan'
import type { VideoEditBuiltinPlan, VideoEditBuiltinTexture } from './videoEditBuiltinEffectPasses'
import type { VideoEditBuiltinEffectEntry } from './videoEditBuiltinEffectShaders'

export const DROP_SHADOW_ENTRIES = ['shadow_composite', 'shadow_layer'] as const
type V4 = readonly [number, number, number, number]
const ZERO: V4 = [0, 0, 0, 0]
const n = (params: VideoEditBuiltinParams, key: string): number => Number(params[key] ?? 0)

function encodedColor(value: unknown): [number, number, number] {
  const hex = typeof value === 'string' && /^#[0-9a-f]{6}/i.test(value) ? value : BLACK_HEX
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255) as [number, number, number]
}

/** `params` 已补齐默认值；`split` 为图层拆输出。 */
export function planDropShadow(params: VideoEditBuiltinParams, width: number, height: number, context?: LayerEffectReference, split = false): VideoEditBuiltinPlan {
  const plan: VideoEditBuiltinPlan = { width, height, scratch: [], passes: [], linearScratch: true }
  const size = (texture: VideoEditBuiltinTexture): [number, number] => typeof texture === 'number' ? [plan.scratch[texture].width, plan.scratch[texture].height] : [width, height]
  const pass = (entry: VideoEditBuiltinEffectEntry, source: VideoEditBuiltinTexture, target: VideoEditBuiltinTexture, a: V4 = ZERO, b: V4 = ZERO): void => {
    plan.passes.push({ entry, source, target, uniforms: new Float32Array([...size(target), ...size(source), ...a, ...b, ...ZERO]) })
  }
  const opacity = n(params, 'opacity') / 100, sourceOpacity = n(params, 'source_opacity') / 100
  const keep = (): VideoEditBuiltinPlan => { if (sourceOpacity === 1) pass('copy', 'input', 'output'); else pass('effect_opacity', 'input', 'output', [sourceOpacity, 0, 0, 0]); return plan }
  if (opacity <= 0) return keep()

  const h = context ? context.referenceSize.height * context.rasterScale : height
  const sigma = blurSigma(n(params, 'softness')) * h
  // 模糊：最后一道直接写进全尺寸的影子底图；规划只有一道 copy 时（σ 小于 0.3 像素）直接取输入。
  let blurred: VideoEditBuiltinTexture = 'input'
  const steps = planGaussian({ width, height, sigmaX: sigma, sigmaY: sigma, repeatEdges: false }).passes
  if (!(steps.length === 1 && steps[0].kind === 'copy')) {
    plan.scratch.push({ width, height }); const target = plan.scratch.length - 1
    let current: VideoEditBuiltinTexture = 'input'
    steps.forEach((step, index) => {
      const next = index === steps.length - 1 ? target : (plan.scratch.push({ width: step.width, height: step.height }), plan.scratch.length - 1)
      if (step.kind === 'blur') pass('blur', current, next, [step.axis === 'x' ? 1 / step.sourceWidth : 0, step.axis === 'y' ? 1 / step.sourceHeight : 0, step.sigma, step.radius])
      else pass('copy', current, next)
      current = next
    })
    blurred = target
  }

  const offset = dropShadowOffset(n(params, 'distance')) * h
  const angle = n(params, 'direction') * Math.PI / 180
  const a: V4 = [Math.cos(angle) * offset / width, Math.sin(angle) * offset / height, opacity, Math.min(1, n(params, 'spread') / 100)]
  const b: V4 = [...encodedColor(params.color), sourceOpacity]
  if (!split) {
    pass('shadow_composite', blurred, 'output', a, b)
    plan.passes.at(-1)!.original = 'input'
    return plan
  }
  plan.scratch.push({ width, height }); const shadow = plan.scratch.length - 1
  pass('shadow_layer', blurred, shadow, a, b)
  plan.underlay = shadow; plan.underlayKind = 'cover'
  return keep()
}

export const DROP_SHADOW_WGSL = `
// 影子：a = (偏移 u, 偏移 v, 不透明度, 扩展)，b = (颜色（编码值）, 原画不透明度)。
// 偏移后落到纹理外的取样一律当作透明，不让 clamp 取样把边缘像素拉成长影。颜色由 alpha 推出，预乘始终成立。
// 扩展把模糊后的 alpha 按 1/(1 − 0.95·扩展) 放大：100% 时 5% 以上的 alpha 都变实，边缘落在高斯尾巴里，
// 不会碰到模糊核在 3σ 处截断的方形边界。
fn shadowCover(v: Vertex) -> vec4f {
 let uv = uvOf(v) - u.a.xy;
 var a = 0.0;
 if (inside(uv)) { a = tap(uv).a; }
 a = min(1.0, a / (1.0 - 0.95 * u.a.w));
 return vec4f(u.b.rgb * a, a) * u.a.z;
}
@fragment fn shadow_composite(v: Vertex) -> @location(0) vec4f {
 let base = tapOriginal(uvOf(v)) * u.b.w;
 return base + shadowCover(v) * (1.0 - base.a);
}
@fragment fn shadow_layer(v: Vertex) -> @location(0) vec4f { return shadowCover(v); }
`
