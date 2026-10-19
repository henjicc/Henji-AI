import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMatrix } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMotionSample } from '@/core/videoEdit/codeMaterial/motionSampling'
import { codeMultiply, codePoint } from '@/core/videoEdit/codeMaterial/geometry'

type Box = { x: number; y: number; width: number; height: number }
export const CODE_MOTION_UNIFORM_BYTES = (12 + 64 * 8) * 4
export const CODE_MOTION_PIXEL_SAMPLE_BUDGET = 256 * 1024 * 1024

/** One uniform array and one fragment invocation sum the full premultiplied
 * exposure. Repeated source-over draws would incorrectly darken its overlaps. */
export const CODE_MOTION_WGSL = `
struct Pose { row0:vec4f, row1:vec4f }
struct P { canvas:vec4f, source:vec4f, info:vec4f, poses:array<Pose,64> }
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var image:texture_2d<f32>;
@group(0) @binding(2) var sampler0:sampler;
struct V { @builtin(position) position:vec4f }
@vertex fn vs(@builtin(vertex_index) i:u32)->V {
 let uv=array<vec2f,6>(vec2f(0,0),vec2f(0,1),vec2f(1,0),vec2f(1,0),vec2f(0,1),vec2f(1,1))[i];
 return V(vec4f(uv.x*2.0-1.0,1.0-uv.y*2.0,0.0,1.0));
}
@fragment fn motion(v:V)->@location(0) vec4f {
 let q=v.position.xy+p.canvas.zw;
 var color=vec4f(0);
 for(var i=0u;i<u32(p.info.x);i++) {
  let pose=p.poses[i];
  if(pose.row0.w<=0.0) { continue; }
  let local=vec2f(dot(pose.row0.xyz,vec3f(q,1)),dot(pose.row1.xyz,vec3f(q,1)));
  let uv=(local-p.source.xy)/p.source.zw;
  if(all(uv>=vec2f(0)) && all(uv<vec2f(1))) {
   color+=textureSampleLevel(image,sampler0,uv,0.0)*pose.row0.w;
  }
 }
 return color;
}`

/** Matrices already include the entire evaluated group placement; parent maps
 * its parent's local pixels into this render target, including raster origin. */
export function prepareCodeMotion(source: Box, parent: CodeMatrix, samples: readonly CodeMotionSample[], width: number, height: number, pixelSampleBudget = CODE_MOTION_PIXEL_SAMPLE_BUDGET): { bounds: Box; data: Float32Array; pixelSamples: number } | undefined {
  if (samples.length > 64) throw new CodeMaterialError('BUDGET', 'GPU 运动曝光最多 64 个样本。')
  if (![source.x, source.y, source.width, source.height, width, height, ...parent].every(Number.isFinite) || source.width <= 0 || source.height <= 0 || width <= 0 || height <= 0) throw new CodeMaterialError('CONTEXT', 'GPU 运动层尺寸或父变换无效。')
  const data = new Float32Array(CODE_MOTION_UNIFORM_BYTES / 4)
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, weight = 0
  samples.forEach((sample, index) => {
    if (!Number.isFinite(sample.weight) || sample.weight < 0 || sample.weight > 1) throw new CodeMaterialError('CONTEXT', 'GPU 运动曝光权重无效。')
    weight += sample.weight
    if (!sample.pose || sample.pose.opacity === 0 || sample.weight === 0) return
    if (sample.pose.matrix.length !== 6 || !sample.pose.matrix.every(Number.isFinite) || !Number.isFinite(sample.pose.opacity) || sample.pose.opacity < 0 || sample.pose.opacity > 1) throw new CodeMaterialError('CONTEXT', 'GPU 运动位姿无效。')
    const m = codeMultiply(parent, sample.pose.matrix), determinant = m[0] * m[3] - m[1] * m[2]
    if (!Number.isFinite(determinant)) throw new CodeMaterialError('NON_FINITE', 'GPU 运动矩阵超出有限范围。')
    if (determinant === 0) return
    const values = [m[3] / determinant, -m[2] / determinant, (m[2] * m[5] - m[3] * m[4]) / determinant, sample.weight * sample.pose.opacity,
      -m[1] / determinant, m[0] / determinant, (m[1] * m[4] - m[0] * m[5]) / determinant, 0]
    data.set(values, 12 + index * 8)
    for (const [x, y] of [[source.x, source.y], [source.x + source.width, source.y], [source.x, source.y + source.height], [source.x + source.width, source.y + source.height]]) {
      const point = codePoint(m, x, y)
      if (!point.every(Number.isFinite)) throw new CodeMaterialError('NON_FINITE', 'GPU 运动包围盒超出有限范围。')
      left = Math.min(left, point[0]); top = Math.min(top, point[1]); right = Math.max(right, point[0]); bottom = Math.max(bottom, point[1])
    }
  })
  if (samples.length && Math.abs(weight - 1) > 1e-9) throw new CodeMaterialError('CONTEXT', 'GPU 运动曝光总权重必须为 1。')
  if (!data.every(Number.isFinite)) throw new CodeMaterialError('NON_FINITE', 'GPU 运动位姿超出浮点精度范围。')
  const x = Math.max(0, Math.floor(left)), y = Math.max(0, Math.floor(top))
  const bounds = { x, y, width: Math.min(width, Math.ceil(right)) - x, height: Math.min(height, Math.ceil(bottom)) - y }
  if (bounds.width <= 0 || bounds.height <= 0) return undefined
  // Charge cropped output pixels, not the unbounded offscreen trajectory. This
  // happens before texture allocation/submission and is shared across layers.
  const pixelSamples = bounds.width * bounds.height * samples.length
  if (!Number.isSafeInteger(pixelSamples) || !Number.isSafeInteger(pixelSampleBudget) || pixelSampleBudget < 0 || pixelSamples > pixelSampleBudget) throw new CodeMaterialError('BUDGET', '本帧运动曝光超出计算预算，请缩小运动层范围或降低采样数。')
  data.set([bounds.width, bounds.height, x, y, source.x, source.y, source.width, source.height, samples.length, 0, 0, 0])
  if (!data.every(Number.isFinite)) throw new CodeMaterialError('NON_FINITE', 'GPU 运动尺寸超出浮点精度范围。')
  return { bounds, data, pixelSamples }
}
