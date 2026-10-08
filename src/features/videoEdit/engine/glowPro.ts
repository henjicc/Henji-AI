/**
 * 辉光PRO 的工序规划与 WGSL（剪辑内置效果 ABI：u.size/a/b/c、source/original/sampler，预乘 sRGB 编码）。
 * 配方来自图片编辑 `compileDiffusionRecipe`：亮通提取 → 13 点降采样金字塔 → 9 点升采样合成 → 肩部合成回原画。
 */
import { createDefaultDiffusionOperationParams } from '@/core/imageEdit/diffusionParams'
import { compileDiffusionRecipe } from '@/core/imageEdit/diffusionRecipe'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinPlan, VideoEditBuiltinTexture } from './videoEditBuiltinEffectPasses'
import type { VideoEditBuiltinEffectEntry } from './videoEditBuiltinEffectShaders'

export const GLOW_PRO_ENTRIES = ['glow_pro_extract', 'glow_pro_down', 'glow_pro_up', 'glow_pro_composite'] as const
type V4 = readonly [number, number, number, number]
const numeric = (params: VideoEditBuiltinParams, key: string): number => typeof params[key] === 'number' ? params[key] as number : 0

/** `params` 已补齐默认值；强度 0 只拷贝输入。 */
export function planGlowPro(params: VideoEditBuiltinParams, width: number, height: number): VideoEditBuiltinPlan {
  const plan: VideoEditBuiltinPlan = { width, height, scratch: [], passes: [] }
  const alloc = (w: number, h: number): number => { plan.scratch.push({ width: w, height: h }); return plan.scratch.length - 1 }
  const pass = (entry: VideoEditBuiltinEffectEntry, source: VideoEditBuiltinTexture, target: VideoEditBuiltinTexture, a: V4, b: V4 = [0, 0, 0, 0], c: V4 = [0, 0, 0, 0], original?: VideoEditBuiltinTexture): void => {
    const from = typeof source === 'number' ? plan.scratch[source] : plan; const to = typeof target === 'number' ? plan.scratch[target] : plan
    plan.passes.push({ entry, source, target, original, uniforms: new Float32Array([to.width, to.height, from.width, from.height, ...a, ...b, ...c]) })
  }
  const amount = numeric(params, 'strength') / 100
  if (amount === 0) { pass('copy', 'input', 'output', [0, 0, 0, 0]); return plan }
  const recipe = compileDiffusionRecipe({ ...createDefaultDiffusionOperationParams(), mode: 'glow', strength: amount, glowRange: numeric(params, 'range') / 100, highlightResponse: numeric(params, 'threshold') / 100, glowExposure: numeric(params, 'exposure') / 100, highlightRolloff: numeric(params, 'rolloff') / 100, glowCoreWhite: numeric(params, 'core_white') / 100 }, { width, height })
  const extract = alloc(width, height)
  pass('glow_pro_extract', 'input', extract, [recipe.source.thresholdEV, recipe.source.softKneeEV, recipe.source.highlightGain, 0])
  let previous = extract
  const levels = recipe.scatterLevels.map(level => {
    const target = alloc(Math.max(1, Math.ceil(width / level.divisor)), Math.max(1, Math.ceil(height / level.divisor)))
    pass('glow_pro_down', previous, target, [0, 0, 0, 0]); previous = target; return target
  })
  for (let index = levels.length - 2; index >= 0; index--) {
    const high = levels[index]; const size = plan.scratch[high]; const target = alloc(size.width, size.height)
    const lowWeight = index === levels.length - 2 ? recipe.scatterLevels[index + 1].weight : [1, 1, 1] as const
    pass('glow_pro_up', previous, target, [...recipe.scatterLevels[index].weight, 0], [...lowWeight, 0], [0, 0, 0, 0], high); previous = target
  }
  pass('glow_pro_composite', previous, 'output', [recipe.glow.exposure, recipe.glow.shoulderKnee, recipe.glow.bleach, recipe.glow.tintCoreWhite], [recipe.source.thresholdEV, recipe.source.softKneeEV, recipe.source.highlightGain, recipe.glow.coreWeight], [...recipe.tone.scatterTint, recipe.tone.scatterDesaturation], 'input')
  return plan
}

export const GLOW_PRO_WGSL = `
// Glow PRO shares compileDiffusionRecipe (image editor), bright pass and 13/9-tap mip scatter kernels.
@fragment fn glow_pro_extract(v: Vertex) -> @location(0) vec4f {
 let c=tap(uvOf(v)); if(c.a<=0.00001){return vec4f(0.0);} let rgb=toLinear(straight(c)); let peak=max(rgb.r,max(rgb.g,rgb.b));
 let threshold=0.18*exp2(u.a.x); let knee=max(threshold*clamp(u.a.y/2.4,0.1,0.5),0.00001);
 var soft=clamp(peak-threshold+knee,0.0,2.0*knee); soft=soft*soft/(4.0*knee);
 return vec4f(rgb*(max(peak-threshold,soft)/max(peak,0.00001))*u.a.z*c.a,c.a);
}
@fragment fn glow_pro_down(v: Vertex) -> @location(0) vec4f {
 let uv=uvOf(v); let texel=1.0/u.size.zw; var sum=tap(uv)*0.125;
 sum+=(tap(uv+vec2f(texel.x,0.0))+tap(uv-vec2f(texel.x,0.0))+tap(uv+vec2f(0.0,texel.y))+tap(uv-vec2f(0.0,texel.y)))*0.0625;
 sum+=(tap(uv+texel)+tap(uv-texel)+tap(uv+vec2f(texel.x,-texel.y))+tap(uv+vec2f(-texel.x,texel.y)))*0.03125;
 let h=texel*0.5; sum+=(tap(uv+h)+tap(uv-h)+tap(uv+vec2f(h.x,-h.y))+tap(uv+vec2f(-h.x,h.y)))*0.125; return sum;
}
@fragment fn glow_pro_up(v: Vertex) -> @location(0) vec4f {
 let uv=uvOf(v); let texel=1.0/u.size.zw; var low=tap(uv)*0.25;
 low+=(tap(uv+vec2f(texel.x,0.0))+tap(uv-vec2f(texel.x,0.0))+tap(uv+vec2f(0.0,texel.y))+tap(uv-vec2f(0.0,texel.y)))*0.125;
 low+=(tap(uv+texel)+tap(uv-texel)+tap(uv+vec2f(texel.x,-texel.y))+tap(uv+vec2f(-texel.x,texel.y)))*0.0625;
 let high=tapOriginal(uv); return vec4f(high.rgb*u.a.rgb+low.rgb*u.b.rgb,high.a*u.a.g+low.a*u.b.g);
}
fn glowProShoulder(color:vec3f,knee:f32,bleach:f32)->vec3f {
 let peak=max(color.r,max(color.g,color.b)); if(knee>=1.0||peak<=knee){return color;}
 let range=max(1.0-knee,0.0001); let rolled=knee+range*(1.0-exp(-(peak-knee)/range));
 let scaled=color*(rolled/max(peak,0.00001)); let overflow=clamp((peak-rolled)/max(peak,0.00001),0.0,1.0);
 return mix(scaled,vec3f(rolled),overflow*bleach);
}
fn glowProEmission(uv: vec2f) -> vec3f {
 let c=tapOriginal(uv); let rgb=toLinear(straight(c)); let peak=max(rgb.r,max(rgb.g,rgb.b));
 let threshold=0.18*exp2(u.b.x); let knee=max(threshold*clamp(u.b.y/2.4,0.1,0.5),0.00001);
 var soft=clamp(peak-threshold+knee,0.0,2.0*knee); soft=soft*soft/(4.0*knee);
 return rgb*(max(peak-threshold,soft)/max(peak,0.00001))*u.b.z*c.a;
}
@fragment fn glow_pro_composite(v: Vertex) -> @location(0) vec4f {
 let uv=uvOf(v); let base=tapOriginal(uv); if(base.a<=0.00001){return vec4f(0.0);} let scatter=tap(uv);
 let step=vec2f(2.0)/vec2f(textureDimensions(original));
 let core=glowProEmission(uv)*0.5+(glowProEmission(uv+vec2f(step.x,0.0))+glowProEmission(uv-vec2f(step.x,0.0))+glowProEmission(uv+vec2f(0.0,step.y))+glowProEmission(uv-vec2f(0.0,step.y)))*0.125;
 var scattered=mix(scatter.rgb,core,u.b.w); scattered=mix(scattered,vec3f(dot(scattered,LUMA)),u.c.w)*u.c.rgb;
 var bloom=scattered*u.a.x; let peak=max(bloom.r,max(bloom.g,bloom.b));
 bloom=mix(bloom,vec3f(peak),smoothstep(0.35,1.4,peak)*u.a.w);
 let rgb=glowProShoulder(toLinear(straight(base))+bloom,u.a.y,u.a.z);
 return premul(toSrgb(rgb),base.a);
}
`
