/**
 * 模糊的工序规划与 WGSL（剪辑内置效果 ABI：u.size/a/b/c、source/original/sampler，预乘 sRGB 编码）。
 *
 * - 均匀：线性光里的可分离高斯（`planGaussian`：先对半降采样到 σ ≤ 3 再横竖两道），与图片编辑同一份规划，代价有上限。
 * - 方向：16 点等权直线，下一道填满上一道取样之间的空隙；至少两道（等效 256 点），拖影越长道数越多。
 * - 放射：朝中心缩放取样，每道 16 点，下一道的间距是上一道的 1/16，直到最外圈的间距不到一个像素。
 * - 镜头：96 点黄金角圆盘，亮点加权；半径大时先按 2×2 平均降采样到取样间距约一个像素，不依赖输入带 mip。
 * 换算见 `core/videoEdit/blur.ts`，同一个模糊度在四种方式下糊的程度相近。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { blurLensRadius, blurLineLength, blurSigma, blurZoomRange } from '@/core/videoEdit/blur'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import { GAUSSIAN_EFFECT, gaussianParameterSchema } from '@/core/imaging/effects/gaussian'
import type { EffectQuality, EffectSize } from '@/core/imaging/effects/descriptor'
import type { VideoEditBuiltinPlan, VideoEditBuiltinTexture } from './videoEditBuiltinEffectPasses'
import type { VideoEditBuiltinEffectEntry } from './videoEditBuiltinEffectShaders'

export const BLUR_ENTRIES = ['blur_line', 'blur_zoom', 'blur_lens'] as const
type V4 = readonly [number, number, number, number]
const ZERO: V4 = [0, 0, 0, 0]
const TAPS = 16
/** 镜头圆盘取样数；与 WGSL 里的循环次数一致。 */
const LENS_TAPS = 96

export interface BlurFrame { frame: number; renderScale?: number; quality?: EffectQuality; referenceSize?: EffectSize; layer?: LayerEffectReference }

function planner(width: number, height: number): { plan: VideoEditBuiltinPlan; alloc(w?: number, h?: number): number; pass(entry: VideoEditBuiltinEffectEntry, source: VideoEditBuiltinTexture, target: VideoEditBuiltinTexture, a?: V4, b?: V4): void } {
  const plan: VideoEditBuiltinPlan = { width, height, scratch: [], passes: [] }
  const size = (texture: VideoEditBuiltinTexture): EffectSize => typeof texture === 'number' ? plan.scratch[texture] : plan
  return {
    plan,
    alloc: (w = width, h = height) => { plan.scratch.push({ width: w, height: h }); return plan.scratch.length - 1 },
    pass: (entry, source, target, a = ZERO, b = ZERO) => {
      const to = size(target); const from = size(source)
      plan.passes.push({ entry, source, target, uniforms: new Float32Array([to.width, to.height, from.width, from.height, ...a, ...b, ...ZERO]) })
    },
  }
}

/**
 * 均匀模糊：`sigma` 是高斯标准差占参考画面高度的比例（图层上是完整作者画幅，不是图层纹理的高度）。
 * 在线性光里卷积，大半径的亮部不会被暗部吃掉。
 */
export function planUniformBlur(sigma: number, axis: string, repeatEdges: boolean, width: number, height: number, frame: BlurFrame): VideoEditBuiltinPlan {
  const { plan, alloc, pass } = planner(width, height)
  const scale = frame.renderScale ?? 1
  const referenceSize = frame.referenceSize ?? { width: Math.round(width / scale), height: Math.round(height / scale) }
  // 局部纹理只改变栅格范围；尺度仍来自完整作者画幅。
  const layerHeight = frame.layer ? frame.layer.referenceSize.height * frame.layer.rasterScale : height
  const parameters = gaussianParameterSchema.parse({ sigma_fraction_height: frame.layer ? sigma * layerHeight / height : sigma, axis, edge_mode: repeatEdges ? 'clamp' : 'transparent' })
  const resolvedGaussian = GAUSSIAN_EFFECT.resolve(parameters, { referenceSize: frame.layer ? { width, height } : referenceSize, outputSize: { width, height }, quality: frame.layer?.quality ?? frame.quality ?? 'interactive' })
  if (resolvedGaussian.passes.every(step => step.operation.kind === 'copy')) { pass('copy', 'input', 'output'); return plan }
  let source: VideoEditBuiltinTexture = alloc()
  pass('gaussian_linear', 'input', source)
  for (const step of resolvedGaussian.passes) {
    const operation = step.operation; const target = alloc(operation.width, operation.height)
    pass(operation.kind === 'blur' ? 'gaussian_blur' : 'gaussian_resample', source, target,
      operation.kind === 'blur' ? [operation.axis === 'x' ? 1 : 0, operation.axis === 'y' ? 1 : 0, operation.sigma, operation.radius] : [step.sampleScale[0], step.sampleScale[1], 0, 0],
      [repeatEdges ? 1 : 0, operation.sourceWidth, operation.sourceHeight, 0])
    source = target
  }
  pass('gaussian_encoded', source, 'output')
  return { ...plan, resolvedGaussian, linearScratch: true }
}

/** 镜头模糊：`radius` 是圆盘半径（目标像素）。 */
export function planLensBlur(radius: number, highlights: number, repeatEdges: boolean, width: number, height: number): VideoEditBuiltinPlan {
  const { plan, alloc, pass } = planner(width, height)
  if (radius < 0.5) { pass('copy', 'input', 'output'); return plan }
  // 相邻取样相距约 spacing 像素；降到每个取样覆盖约一个源像素，圆盘内的细节不会混叠成条纹。
  const spacing = radius * Math.sqrt(Math.PI / LENS_TAPS)
  const levels = Math.max(0, Math.round(Math.log2(spacing * 0.7)))
  let source: VideoEditBuiltinTexture = 'input'; let w = width; let h = height
  for (let level = 0; level < levels && (w > 1 || h > 1); level++) {
    w = Math.max(1, Math.ceil(w / 2)); h = Math.max(1, Math.ceil(h / 2))
    const target = alloc(w, h); pass('copy', source, target); source = target
  }
  pass('blur_lens', source, 'output', [radius, highlights / 100 * 4, repeatEdges ? 1 : 0, 0])
  return plan
}

/** `params` 已补齐默认值；`width`/`height` 是这次渲染的画面（或图层纹理）尺寸。 */
export function planBlur(params: VideoEditBuiltinParams, width: number, height: number, frame: BlurFrame): VideoEditBuiltinPlan {
  const amount = Number(params.amount)
  const repeat = params.repeat_edges !== false
  const layer = frame.layer
  // 空间量按画面高度换算：图层上是完整作者画幅乘栅格倍率，片段上是这次渲染的画面高度。
  const H = layer ? layer.referenceSize.height * layer.rasterScale : height
  switch (params.mode) {
    case 'directional': {
      const length = blurLineLength(amount) * H
      const { plan, alloc, pass } = planner(width, height)
      if (length < 1) { pass('copy', 'input', 'output'); return plan }
      const angle = Number(params.angle) * Math.PI / 180; const dx = Math.cos(angle) * length; const dy = Math.sin(angle) * length
      // 至少两道（等效 256 点）；拖影再长就多加一道，最细一道的间距不到一个像素，长拖影也不出一格格重影。
      const passes = Math.max(2, Math.ceil(Math.log(length) / Math.log(TAPS)))
      let source: VideoEditBuiltinTexture = 'input'
      for (let index = 0; index < passes; index++) {
        const target = index === passes - 1 ? 'output' : alloc(), step = TAPS ** (index + 1)
        pass('blur_line', source, target, [dx / step / width, dy / step / height, TAPS, repeat ? 1 : 0])
        source = target
      }
      return plan
    }
    case 'radial': {
      const range = blurZoomRange(amount)
      const { plan, alloc, pass } = planner(width, height)
      if (range * H < 1) { pass('copy', 'input', 'output'); return plan }
      const cx = Number(params.center_x) / 100; const cy = Number(params.center_y) / 100
      const center = layer
        ? [(layer.rasterOrigin[0] + cx * layer.contentBounds.width * layer.rasterScale) / width, (layer.rasterOrigin[1] + cy * layer.contentBounds.height * layer.rasterScale) / height]
        : [cx, cy]
      // 最远的角到中心的像素距离；最细一道的取样间距要小于一个像素。
      const far = Math.max(...[[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => Math.hypot((x - center[0]) * width, (y - center[1]) * height)))
      const passes = Math.max(1, Math.ceil(Math.log(range * far) / Math.log(TAPS)))
      let source: VideoEditBuiltinTexture = 'input'
      for (let index = 0; index < passes; index++) {
        const target = index === passes - 1 ? 'output' : alloc()
        pass('blur_zoom', source, target, [center[0], center[1], range / TAPS ** (index + 1), TAPS], [repeat ? 1 : 0, 0, 0, 0])
        source = target
      }
      return plan
    }
    case 'lens': return planLensBlur(blurLensRadius(amount) * H, Number(params.highlights), repeat, width, height)
    default: return planUniformBlur(blurSigma(amount), String(params.axis), repeat, width, height, frame)
  }
}

export const BLUR_WGSL = `
/** 等权直线取样（方向模糊）：a = (每步 u, 每步 v, 取样数, 重复边缘)，以当前像素为中心。 */
@fragment fn blur_line(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let n = i32(u.a.z); let middle = (u.a.z - 1.0) * 0.5;
 var sum = vec4f(0.0);
 for (var i = 0; i < n; i++) { sum += tapEdge(uv + u.a.xy * (f32(i) - middle), u.a.w); }
 return sum / u.a.z;
}

/** 朝中心缩放取样（放射模糊的一道）：a = (中心 u, 中心 v, 每步缩放, 取样数)，b.x 重复边缘。 */
@fragment fn blur_zoom(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let n = i32(u.a.w);
 var sum = vec4f(0.0);
 for (var i = 0; i < n; i++) { sum += tapEdge(u.a.xy + (uv - u.a.xy) * (1.0 - u.a.z * f32(i)), u.b.x); }
 return sum / u.a.w;
}

/** 镜头圆盘：a = (半径（目标像素）, 亮点加权, 重复边缘)。source 已按半径降采样，偏移按目标像素换算。 */
@fragment fn blur_lens(v: Vertex) -> @location(0) vec4f {
 // Jimenez 交错梯度噪声按像素旋转圆盘，打散相邻像素的取样条纹；不含帧种子以保持时间稳定。
 let rotation = 6.28318531 * fract(52.9829189 * fract(dot(floor(v.position.xy), vec2f(.06711056, .00583715))));
 var sum = vec4f(0); var total = 0.0;
 for (var i = 0u; i < ${LENS_TAPS}u; i++) {
  let k = (f32(i) + .5) / ${LENS_TAPS}.0; let r = sqrt(k) * u.a.x; let a = f32(i) * 2.39996323 + rotation;
  let c = tapEdge((v.position.xy + r * vec2f(cos(a), sin(a))) / u.size.xy, u.a.z);
  let w = 1.0 + u.a.y * pow(max(max(c.r, c.g), c.b), 4.0); sum += c * w; total += w;
 }
 return sum / total;
}
`
