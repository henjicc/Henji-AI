import { definePlanner } from './effectPlanner'
import { COLOR_MATH_BLOCK, EFFECT_MATH_BLOCK } from './effectShaderPrelude'
/**
 * 模糊的工序规划与 WGSL（剪辑内置效果 ABI：u.size/a/b/c、source/original/sampler，预乘 sRGB 编码）。
 *
 * - 均匀：线性光里的可分离高斯（`planGaussian`：先对半降采样到 σ ≤ 3 再横竖两道），与图片编辑同一份规划，代价有上限。
 * - 方向：16 点等权直线，下一道填满上一道取样之间的空隙；至少两道（等效 256 点），拖影越长道数越多。
 * - 放射：朝中心缩放取样，每道 16 点，下一道的间距是上一道的 1/16，直到最外圈的间距不到一个像素。
 * - 旋转：绕中心沿圆弧取样，道数与间距同放射，转角按像素计算，不随画幅长宽比变形。
 * - 镜头：96 点黄金角圆盘，亮点加权；半径大时先按 2×2 平均降采样到取样间距约一个像素，不依赖输入带 mip。
 * - 范围（均匀）：13 点降采样金字塔（与发光同一组权重）存线性光，由粗到细逐层按本处模糊量与上一层的 B 样条放大混合；
 *   每像素只在相邻两层之间插值，清楚处原样输出。范围（镜头）：圆盘半径逐处乘模糊量，按半径落在哪一层取那一层降采样的画面。
 * 换算见 `core/videoEdit/blur.ts`，同一个模糊度在各方式下糊的程度相近。
 */
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { blurLensRadius, blurLineLength, blurRangeLevelSigma, blurSigma, blurSpinAngle, blurZoomRange } from '@/core/videoEdit/blur'
import type { LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import { GAUSSIAN_EFFECT, gaussianParameterSchema } from '@/core/imaging/effects/gaussian'
import type { EffectQuality, EffectSize } from '@/core/imaging/effects/descriptor'
import { Planner, type Vec4, type VideoEditBuiltinPass, type VideoEditBuiltinPlan, type VideoEditBuiltinTexture } from './effectPlan'

export const BLUR_ENTRIES = ['blur_line', 'blur_zoom', 'blur_spin', 'blur_lens', 'blur_lens_band', 'blur_range_down', 'blur_range_up', 'blur_range_finish'] as const
const TAPS = 16
/** 镜头圆盘取样数；与 WGSL 里的循环次数一致。 */
const LENS_TAPS = 96
/** 范围方式最糊处的标准差（像素）不到这么多时与整幅高斯一样不处理。 */
const RANGE_MIN_SIGMA = 0.3

export interface BlurFrame { frame: number; renderScale?: number; quality?: EffectQuality; referenceSize?: EffectSize; layer?: LayerEffectReference }

const finish = (planner: Planner, extra: Partial<VideoEditBuiltinPlan> = {}): VideoEditBuiltinPlan => ({ width: planner.width, height: planner.height, scratch: planner.scratch, passes: planner.passes, ...extra })
function copyPlan(width: number, height: number): VideoEditBuiltinPlan {
  const planner = new Planner(width, height); planner.pass('copy', 'input', 'output'); return finish(planner)
}

/**
 * 均匀模糊：`sigma` 是高斯标准差占参考画面高度的比例（图层上是完整作者画幅，不是图层纹理的高度）。
 * 在线性光里卷积，大半径的亮部不会被暗部吃掉。
 */
export function planUniformBlur(sigma: number, axis: string, repeatEdges: boolean, width: number, height: number, frame: BlurFrame): VideoEditBuiltinPlan {
  const planner = new Planner(width, height)
  const scale = frame.renderScale ?? 1
  const referenceSize = frame.referenceSize ?? { width: Math.round(width / scale), height: Math.round(height / scale) }
  // 局部纹理只改变栅格范围；尺度仍来自完整作者画幅。
  const layerHeight = frame.layer ? frame.layer.referenceSize.height * frame.layer.rasterScale : height
  const parameters = gaussianParameterSchema.parse({ sigma_fraction_height: frame.layer ? sigma * layerHeight / height : sigma, axis, edge_mode: repeatEdges ? 'clamp' : 'transparent' })
  const resolvedGaussian = GAUSSIAN_EFFECT.resolve(parameters, { referenceSize: frame.layer ? { width, height } : referenceSize, outputSize: { width, height }, quality: frame.layer?.quality ?? frame.quality ?? 'interactive' })
  if (resolvedGaussian.passes.every(step => step.operation.kind === 'copy')) return copyPlan(width, height)
  let source: VideoEditBuiltinTexture = planner.alloc()
  planner.pass('gaussian_linear', 'input', source)
  for (const step of resolvedGaussian.passes) {
    const operation = step.operation; const target = planner.alloc(operation.width, operation.height)
    planner.pass(operation.kind === 'blur' ? 'gaussian_blur' : 'gaussian_resample', source, target,
      operation.kind === 'blur' ? [operation.axis === 'x' ? 1 : 0, operation.axis === 'y' ? 1 : 0, operation.sigma, operation.radius] : [step.sampleScale[0], step.sampleScale[1], 0, 0],
      [repeatEdges ? 1 : 0, operation.sourceWidth, operation.sourceHeight, 0])
    source = target
  }
  planner.pass('gaussian_encoded', source, 'output')
  return finish(planner, { resolvedGaussian, linearScratch: true })
}

/**
 * 镜头圆盘的降采样层：第 0 层是输入，之后每层 2×2 平均，降到圆盘相邻取样相距约一个源像素，圆盘内的细节不会混叠成条纹。
 * `wanted` 是最大半径该用的层号；纹理先缩到一个像素时实际层数会少于它。
 */
function lensLevels(planner: Planner, radius: number): { levels: VideoEditBuiltinTexture[]; wanted: number } {
  const spacing = radius * Math.sqrt(Math.PI / LENS_TAPS)
  const wanted = Math.max(0, Math.round(Math.log2(spacing * 0.7)))
  const levels: VideoEditBuiltinTexture[] = ['input']
  let [w, h] = planner.size('input')
  for (let level = 0; level < wanted && (w > 1 || h > 1); level++) {
    w = Math.max(1, Math.ceil(w / 2)); h = Math.max(1, Math.ceil(h / 2))
    const target = planner.alloc(w, h); planner.pass('copy', levels.at(-1)!, target); levels.push(target)
  }
  return { levels, wanted }
}

/**
 * 镜头模糊：`radius` 是圆盘半径（目标像素）。空间景深在材料面上按两轴参考尺度给出椭圆半径 `radiusY`，
 * 弥散圆在可感知阈值附近由 `strength` 与原图平滑混合，半径趋零时画面连续回到原图。
 */
export function planLensBlur(radius: number, highlights: number, repeatEdges: boolean, width: number, height: number, spatial?: { radiusY: number; strength: number }): VideoEditBuiltinPlan {
  if (spatial ? spatial.strength === 0 : radius < 0.5) return copyPlan(width, height)
  const planner = new Planner(width, height)
  const source = lensLevels(planner, Math.max(radius, spatial?.radiusY ?? radius)).levels.at(-1)!
  const blurred = spatial && spatial.strength < 1 ? planner.alloc() : 'output'
  planner.pass('blur_lens', source, blurred, [radius, highlights / 100 * 4, repeatEdges ? 1 : 0, spatial?.radiusY ?? 0])
  if (blurred !== 'output') planner.pass('effect_mix', blurred, 'output', [spatial!.strength, 0, 0, 0])
  return finish(planner)
}

/** 按百分比取内容里的一点（目标像素）：图层上锚在内容框里，与纹理外扩无关；片段上按画面算。放射、旋转的中心与范围的位置共用。 */
function contentPoint(x: number, y: number, width: number, height: number, layer: LayerEffectReference | undefined): [number, number] {
  return layer
    ? [layer.rasterOrigin[0] + x / 100 * layer.contentBounds.width * layer.rasterScale, layer.rasterOrigin[1] + y / 100 * layer.contentBounds.height * layer.rasterScale]
    : [x / 100 * width, y / 100 * height]
}

/**
 * 范围的几何，交给 WGSL `blurRangeAmount`：b = (位置, 方向)，c = (方式：1 渐进、2 移轴, 清晰带半宽, 过渡, 本道一个像素合多少 H)。
 * 距离都以画面高度 H 为 1。
 */
interface BlurRangeShape { b: Vec4; c(pixelsPerTexel: number): Vec4 }
function blurRangeShape(params: VideoEditBuiltinParams, width: number, height: number, H: number, layer: LayerEffectReference | undefined): BlurRangeShape {
  const anchor = contentPoint(Number(params.range_x), Number(params.range_y), width, height, layer)
  const angle = Number(params.range_angle) * Math.PI / 180
  const tilt = params.range === 'tilt'
  return {
    b: [anchor[0] / H, anchor[1] / H, Math.cos(angle), Math.sin(angle)],
    c: pixelsPerTexel => [tilt ? 2 : 1, tilt ? Number(params.range_width) / 200 : 0, Number(params.range_falloff) / 100, pixelsPerTexel / H],
  }
}

/**
 * 金字塔各层在画面四周多存的纹素：模糊会把内容向画外推开，下一层降采样和 B 样条放大要读到这部分，
 * 只存画面以内时“不重复边缘”的四边会比整幅高斯多淡一倍；按一维模拟，两格已与高斯逐级一致。
 */
const RANGE_MARGIN = 2
/** 给一道补上 WGSL 的 layer.xy（参数超出 a、b、c 三组时用），补齐到 24 个 float。 */
function withLayer(pass: VideoEditBuiltinPass, x: number, y: number): void { pass.uniforms = new Float32Array([...pass.uniforms, x, y, 0, 0, 0, 0, 0, 0]) }

/** 均匀方式的范围：`sigma` 是最糊处的标准差（像素）。层数加到最粗一层盖住 `sigma`，或者画面只剩一个像素。 */
function planRangeBlur(sigma: number, repeatEdges: boolean, width: number, height: number, shape: BlurRangeShape): VideoEditBuiltinPlan {
  if (sigma < RANGE_MIN_SIGMA) return copyPlan(width, height)
  const planner = new Planner(width, height)
  const levels: number[] = []
  let w = width; let h = height
  while (blurRangeLevelSigma(levels.length) < sigma && (w > 1 || h > 1)) {
    w = Math.ceil(w / 2); h = Math.ceil(h / 2)
    const level = planner.alloc(w + 2 * RANGE_MARGIN, h + 2 * RANGE_MARGIN)
    planner.pass('blur_range_down', levels.at(-1) ?? 'input', level, [levels.length ? 0 : 1, repeatEdges ? 1 : 0, levels.length ? RANGE_MARGIN : 0, RANGE_MARGIN])
    levels.push(level)
  }
  // 一个像素的画面没有可糊的。
  if (!levels.length) return copyPlan(width, height)
  // levels[k - 1] 是第 k 层；由最粗一层往回，每层与粗一层的结果混合。
  let coarse = levels.at(-1)!
  for (let level = levels.length - 1; level >= 1; level--) {
    const fine = levels[level - 1]; const [fw, fh] = planner.size(fine); const target = planner.alloc(fw, fh)
    planner.pass('blur_range_up', coarse, target, [sigma, blurRangeLevelSigma(level), blurRangeLevelSigma(level + 1), repeatEdges ? 1 : 0], shape.b, fine, shape.c(2 ** level))
    withLayer(planner.passes.at(-1)!, RANGE_MARGIN, RANGE_MARGIN)
    coarse = target
  }
  planner.pass('blur_range_finish', coarse, 'output', [sigma, 0, blurRangeLevelSigma(1), repeatEdges ? 1 : 0], shape.b, 'input', shape.c(1))
  withLayer(planner.passes.at(-1)!, RANGE_MARGIN, 0)
  return finish(planner, { linearScratch: true })
}

/** 镜头方式的范围：`radius` 是最糊处的圆盘半径（像素）；每层一道，把落在这一层附近的像素的圆盘按权重累加。 */
function planLensRangeBlur(radius: number, highlights: number, repeatEdges: boolean, width: number, height: number, shape: BlurRangeShape): VideoEditBuiltinPlan {
  if (radius < 0.5) return copyPlan(width, height)
  const planner = new Planner(width, height)
  const { levels, wanted } = lensLevels(planner, radius); const top = levels.length - 1
  let before: VideoEditBuiltinTexture = 'input'
  levels.forEach((level, index) => {
    const target = index === top ? 'output' : planner.alloc()
    planner.pass('blur_lens_band', level, target, [radius, highlights / 100 * 4, repeatEdges ? 1 : 0, index], shape.b, before, shape.c(1))
    withLayer(planner.passes.at(-1)!, top, wanted)
    before = target
  })
  return finish(planner)
}

/** 中心到纹理最远一角的像素距离；最细一道在这里的取样间距要小于一个像素。 */
const farthest = (center: readonly [number, number], width: number, height: number): number => Math.max(...[[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => Math.hypot(x - center[0], y - center[1])))

/** `params` 已补齐默认值；`width`/`height` 是这次渲染的画面（或图层纹理）尺寸。 */
export function planBlur(params: VideoEditBuiltinParams, width: number, height: number, frame: BlurFrame): VideoEditBuiltinPlan {
  const amount = Number(params.amount)
  const repeat = params.repeat_edges !== false
  const layer = frame.layer
  // 空间量按画面高度换算：图层上是完整作者画幅乘栅格倍率，片段上是这次渲染的画面高度。
  const H = layer ? layer.referenceSize.height * layer.rasterScale : height
  const ranged = params.range === 'progressive' || params.range === 'tilt'
  switch (params.mode) {
    case 'directional': {
      const length = blurLineLength(amount) * H
      if (length < 1) return copyPlan(width, height)
      const planner = new Planner(width, height)
      const angle = Number(params.angle) * Math.PI / 180; const dx = Math.cos(angle) * length; const dy = Math.sin(angle) * length
      // 至少两道（等效 256 点）；拖影再长就多加一道，最细一道的间距不到一个像素，长拖影也不出一格格重影。
      const passes = Math.max(2, Math.ceil(Math.log(length) / Math.log(TAPS)))
      let source: VideoEditBuiltinTexture = 'input'
      for (let index = 0; index < passes; index++) {
        const target = index === passes - 1 ? 'output' : planner.alloc(), step = TAPS ** (index + 1)
        planner.pass('blur_line', source, target, [dx / step / width, dy / step / height, TAPS, repeat ? 1 : 0])
        source = target
      }
      return finish(planner)
    }
    case 'radial': {
      const range = blurZoomRange(amount)
      if (range * H < 1) return copyPlan(width, height)
      const planner = new Planner(width, height)
      const [cx, cy] = contentPoint(Number(params.center_x), Number(params.center_y), width, height, layer)
      const passes = Math.max(1, Math.ceil(Math.log(range * farthest([cx, cy], width, height)) / Math.log(TAPS)))
      let source: VideoEditBuiltinTexture = 'input'
      for (let index = 0; index < passes; index++) {
        const target = index === passes - 1 ? 'output' : planner.alloc()
        planner.pass('blur_zoom', source, target, [cx / width, cy / height, range / TAPS ** (index + 1), TAPS], [repeat ? 1 : 0, 0, 0, 0])
        source = target
      }
      return finish(planner)
    }
    case 'spin': {
      const turn = blurSpinAngle(amount)
      const center = contentPoint(Number(params.center_x), Number(params.center_y), width, height, layer)
      const arc = turn * farthest(center, width, height)
      if (arc < 1) return copyPlan(width, height)
      const planner = new Planner(width, height)
      const passes = Math.max(1, Math.ceil(Math.log(arc) / Math.log(TAPS)))
      let source: VideoEditBuiltinTexture = 'input'
      for (let index = 0; index < passes; index++) {
        const target = index === passes - 1 ? 'output' : planner.alloc()
        planner.pass('blur_spin', source, target, [center[0], center[1], turn / TAPS ** (index + 1), TAPS], [repeat ? 1 : 0, 0, 0, 0])
        source = target
      }
      return finish(planner)
    }
    case 'lens': {
      const radius = blurLensRadius(amount) * H
      if (ranged) return planLensRangeBlur(radius, Number(params.highlights), repeat, width, height, blurRangeShape(params, width, height, H, layer))
      return planLensBlur(radius, Number(params.highlights), repeat, width, height)
    }
    default:
      if (ranged) return planRangeBlur(blurSigma(amount) * H, repeat, width, height, blurRangeShape(params, width, height, H, layer))
      return planUniformBlur(blurSigma(amount), String(params.axis), repeat, width, height, frame)
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

/** 绕中心沿圆弧取样（旋转模糊的一道），以当前角度为中间：a = (中心（像素）, 每步转角（弧度）, 取样数)，b.x 重复边缘。 */
@fragment fn blur_spin(v: Vertex) -> @location(0) vec4f {
 let d = v.position.xy - u.a.xy; let n = i32(u.a.w); let middle = (u.a.w - 1.0) * 0.5;
 var sum = vec4f(0.0);
 for (var i = 0; i < n; i++) {
  let turn = (f32(i) - middle) * u.a.z; let cosine = cos(turn); let sine = sin(turn);
  sum += tapEdge((u.a.xy + vec2f(cosine * d.x - sine * d.y, sine * d.x + cosine * d.y)) / u.size.xy, u.b.x);
 }
 return sum / u.a.w;
}

/** 镜头圆盘：半径与位置按目标像素计；source 可以是降采样过的画面，偏移按目标像素换算。 */
/** radiusY > 0 时圆盘纵向半径单独给出（空间材料面两轴尺度不同）；否则是正圆。 */
fn blurLensDisc(position: vec2f, radius: f32, radiusY: f32, highlight: f32, repeat: f32) -> vec4f {
 // Jimenez 交错梯度噪声按像素旋转圆盘，打散相邻像素的取样条纹；不含帧种子以保持时间稳定。
 let rotation = 6.28318531 * fract(52.9829189 * fract(dot(floor(position), vec2f(.06711056, .00583715))));
 var sum = vec4f(0); var total = 0.0;
 for (var i = 0u; i < ${LENS_TAPS}u; i++) {
  let k = (f32(i) + .5) / ${LENS_TAPS}.0; let r = sqrt(k) * radius; let a = f32(i) * 2.39996323 + rotation;
  var offset = r * vec2f(cos(a), sin(a));
  if (radiusY > 0.0) { offset.y = sqrt(k) * radiusY * sin(a); }
  let c = tapEdge((position + offset) / u.size.xy, repeat);
  let w = 1.0 + highlight * pow(max(max(c.r, c.g), c.b), 4.0); sum += c * w; total += w;
 }
 return sum / total;
}
/** 镜头模糊：a = (半径（目标像素）, 亮点加权, 重复边缘, 纵向半径（0 为正圆）)。 */
@fragment fn blur_lens(v: Vertex) -> @location(0) vec4f { return blurLensDisc(v.position.xy, u.a.x, u.a.w, u.a.y, u.a.z); }

/**
 * 范围：本处模糊量占最糊处的比例（0 清楚、1 最糊）。b = (位置, 方向)，c = (方式, 清晰带半宽, 过渡, 本道一个像素合多少 H)，距离以 H 为 1。
 * 渐进从位置沿方向越来越糊；移轴按到清楚带中线的距离，两边对称。
 */
fn blurRangeAmount(position: vec2f) -> f32 {
 let along = dot(position * u.c.w - u.b.xy, u.b.zw);
 if (u.c.x < 1.5) { return ramp(0.0, u.c.z, along); }
 return ramp(u.c.y, u.c.y + u.c.z, abs(along));
}

/**
 * 镜头范围的一层：本处半径 = 最糊处半径 × 模糊量；半径每减半落到细一层，相邻两层按距离分权重，累加到前几层的结果（original）上。
 * a = (最糊处半径, 亮点加权, 重复边缘, 本层层号)，layer = (最粗层号, 最大半径该用的层号)；纹理缩到一个像素时前者小于后者。
 * 清楚处（模糊量 0）由第 0 层直接给出原像素，粗层原样传下去。
 */
@fragment fn blur_lens_band(v: Vertex) -> @location(0) vec4f {
 var before = vec4f(0.0);
 if (u.a.w > 0.5) { before = textureLoad(original, vec2i(floor(v.position.xy)), 0); }
 let amount = blurRangeAmount(v.position.xy);
 if (amount <= 0.0) {
  if (u.a.w < 0.5) { return textureLoad(source, vec2i(floor(v.position.xy)), 0); }
  return before;
 }
 let level = clamp(u.layer.y + log2(amount), 0.0, u.layer.x);
 let weight = max(0.0, 1.0 - abs(level - u.a.w));
 if (weight <= 0.0) { return before; }
 return before + blurLensDisc(v.position.xy, u.a.x * amount, 0.0, u.a.y, u.a.z) * weight;
}

/** 范围金字塔取一个纹素：画外按“重复边缘像素”取边缘或透明；第一层从预乘编码值换成线性光（保留超出 0–1 的高精度值）。 */
fn blurRangeTexel(at: vec2i, size: vec2i, repeat: bool, linearize: bool) -> vec4f {
 if (!repeat && (any(at < vec2i(0)) || any(at >= size))) { return vec4f(0.0); }
 let c = textureLoad(source, clamp(at, vec2i(0), size - vec2i(1)), 0);
 if (!linearize) { return c; }
 if (c.a <= 0.0) { return vec4f(0.0); }
 return vec4f(cgLin(c.rgb / c.a) * c.a, c.a);
}
/**
 * 范围金字塔降一层：a = (输入是编码值，先换成线性光, 重复边缘, 源的边距, 本层的边距)，边距是画面四周多存的纹素。
 * 13 点降采样的权重（与发光同一组）写成 6×6 纹素上的两项可分离权重：一半是中间 4×4 的盒，一半是四角 4×4 盒的平均；
 * 逐纹素取值，换成线性光后再加权，亮的细节不在编码值里先被平均掉。目标纹素 j 对应源纹素 2j、2j+1，各层网格按 2 的幂对齐。
 */
@fragment fn blur_range_down(v: Vertex) -> @location(0) vec4f {
 var middle = array<f32, 6>(0.0, 0.25, 0.25, 0.25, 0.25, 0.0);
 var corners = array<f32, 6>(0.125, 0.125, 0.25, 0.25, 0.125, 0.125);
 let size = vec2i(textureDimensions(source)); let base = (vec2i(floor(v.position.xy)) - i32(u.a.w)) * 2 - vec2i(2) + i32(u.a.z);
 var sum = vec4f(0.0);
 for (var y = 0; y < 6; y++) {
  for (var x = 0; x < 6; x++) { sum += 0.5 * (middle[x] * middle[y] + corners[x] * corners[y]) * blurRangeTexel(base + vec2i(x, y), size, u.a.y > 0.5, u.a.x > 0.5); }
 }
 return sum;
}
/**
 * 本处在两层之间的位置：a = (最糊处标准差, 细层的, 粗层的, 重复边缘)，全分辨率像素。细层是原画（0）时按标准差线性插值，其余按对数：
 * 两层混合的边缘宽度比同样标准差的高斯宽约 6%（第 1、2 层之间约 8%），按方差插值则会偏清楚到 −12%。
 */
fn blurRangeBlend(position: vec2f) -> f32 {
 let sigma = u.a.x * blurRangeAmount(position);
 if (u.a.y <= 0.0) { return clamp(sigma / u.a.z, 0.0, 1.0); }
 return clamp(log2(max(sigma, 1e-6) / u.a.y) / log2(u.a.z / u.a.y), 0.0, 1.0);
}
/**
 * 粗层（source）的三次 B 样条放大：position 是去掉边距后本道的像素位置，在粗层里是一半，与降采样同一套 2 的幂网格；layer.x 是粗层边距。
 * 逐纹素取 4×4，存储范围以外与降采样同样按“重复边缘像素”处理（硬件取样只能夹到边缘，做不出透明边缘）。
 */
fn blurRangeCoarse(position: vec2f) -> vec4f {
 let size = vec2i(textureDimensions(source)); let p = position * 0.5 - 0.5; let cell = vec2i(floor(p)) + i32(u.layer.x);
 let wx = bsplineWeights(fract(p.x)); let wy = bsplineWeights(fract(p.y));
 var sum = vec4f(0.0);
 for (var y = 0; y < 4; y++) {
  for (var x = 0; x < 4; x++) { sum += wx[x] * wy[y] * blurRangeTexel(cell + vec2i(x - 1, y - 1), size, u.a.w > 0.5, false); }
 }
 return sum;
}
/** 由粗到细的一层：本层（original，与本道同样的边距）与粗层结果按本处模糊量混合，都是线性光。layer = (粗层边距, 本层边距)。 */
@fragment fn blur_range_up(v: Vertex) -> @location(0) vec4f {
 let fine = textureLoad(original, vec2i(floor(v.position.xy)), 0);
 let position = v.position.xy - u.layer.y;
 let t = blurRangeBlend(position);
 if (t <= 0.0) { return fine; }
 return mix(fine, blurRangeCoarse(position), t);
}
/** 写回画面：清楚处原样输出；其余把原画换成线性光与粗层混合，再换回预乘编码值。 */
@fragment fn blur_range_finish(v: Vertex) -> @location(0) vec4f {
 let base = textureLoad(original, vec2i(floor(v.position.xy)), 0);
 let t = blurRangeBlend(v.position.xy);
 if (t <= 0.0) { return base; }
 var fine = vec4f(0.0);
 if (base.a > 0.0) { fine = vec4f(cgLin(base.rgb / base.a) * base.a, base.a); }
 let c = mix(fine, blurRangeCoarse(v.position.xy), t);
 if (c.a <= 0.00001) { return vec4f(0.0); }
 return vec4f(cgEnc(c.rgb / c.a) * c.a, c.a);
}
`

export const BLUR_PLANNER = definePlanner({
  // 范围用到 ramp、bsplineWeights 与有符号的 cgLin/cgEnc。
  id: 'blur', entries: BLUR_ENTRIES, wgsl: BLUR_WGSL, shared: [COLOR_MATH_BLOCK, EFFECT_MATH_BLOCK],
  plan: (params, frame) => planBlur(params, frame.width, frame.height, frame),
})
