import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'

/** Total sample work across all uncached lens layers in a frame. Texture memory
 * remains owned by the existing code renderer allocator and layer cache. */
export const CODE_LENS_PIXEL_SAMPLE_BUDGET = 1024 * 1024 * 1024
const TAPS = 96
export function codeLensPlan(width: number, height: number, radius: number, remaining = CODE_LENS_PIXEL_SAMPLE_BUDGET): { levels: { width: number; height: number }[]; width: number; height: number; taps: number; pixelSamples: number } {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 8192) || !Number.isFinite(radius) || radius <= 0 || radius > 256) throw new CodeMaterialError('BUDGET', '镜头虚化尺寸或弥散圆半径超出范围。')
  // Same sample-spacing prefilter as the reference compositor. Adjacent box
  // reductions fill gaps between disk samples without a sparse large kernel.
  const divisor = Math.max(1, 2 ** Math.floor(Math.log2(radius * Math.sqrt(Math.PI / TAPS) * .7)))
  const levels: { width: number; height: number }[] = []
  let w = width, h = height, pixelSamples = 0
  for (let d = 1; d < divisor && (w > 1 || h > 1); d *= 2) {
    w = Math.max(1, Math.ceil(w / 2)); h = Math.max(1, Math.ceil(h / 2)); levels.push({ width: w, height: h }); pixelSamples += w * h * 4
  }
  const taps = radius < 1 ? 8 : radius < 2 ? 12 : radius < 4 ? 24 : radius < 6 ? 48 : TAPS
  pixelSamples += w * h * taps
  if (pixelSamples > remaining) throw new CodeMaterialError('BUDGET', '本帧镜头虚化超出采样预算，请减少同时虚化的图层或画幅。')
  return { levels, width: w, height: h, taps, pixelSamples }
}

// Reuses the golden-angle disk from AEPR's compositor, rather than importing a
// second Three.js/WebGL renderer (BokehShader forces opaque alpha; postprocessing
// DOF also requires depth buffers). We filter premultiplied RGBA with equal,
// positive weights so transparent colored edges remain valid and energy is not
// artificially boosted. The host supplies the same radius before motion blur.
const disk = Array.from({ length: TAPS }, (_, index) => {
  const radius = Math.sqrt((index + .5) / TAPS), angle = index * 2.399963229728653
  return `vec2f(${(radius * Math.cos(angle)).toFixed(9)},${(radius * Math.sin(angle)).toFixed(9)})`
}).join(',')
export const CODE_LENS_WGSL = /* wgsl */ `
struct Params { extent: vec4f, samples: vec4f }
@group(0) @binding(0) var<uniform> u: Params;
@group(0) @binding(1) var picture: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
const disk = array<vec2f,96>(${disk});
@vertex fn vs(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {
  let p=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1));
  return vec4f(p[index],0,1);
}
@fragment fn downsample(@builtin(position) p:vec4f)->@location(0) vec4f {
  let uv=p.xy/u.extent.xy; let d=vec2f(.25)/u.extent.xy;
  return (textureSampleLevel(picture,linearSampler,uv+vec2f(-d.x,-d.y),0)
    +textureSampleLevel(picture,linearSampler,uv+vec2f(d.x,-d.y),0)
    +textureSampleLevel(picture,linearSampler,uv+vec2f(-d.x,d.y),0)
    +textureSampleLevel(picture,linearSampler,uv+d,0))*.25;
}
@fragment fn lens(@builtin(position) p:vec4f)->@location(0) vec4f {
  let uv=p.xy/u.extent.xy; let count=u32(u.samples.x); var sum=vec4f(0);
  for(var i=0u;i<count;i++) { sum+=textureSampleLevel(picture,linearSampler,uv+disk[i*96u/count]*u.extent.zw,0); }
  return sum/f32(count);
}`
