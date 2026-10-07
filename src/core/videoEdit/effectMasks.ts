import { z } from 'zod'
import { processSmartRegionMatte, SMART_REGION_EXPAND_RANGE, SMART_REGION_FEATHER_RANGE, VIDEO_EDIT_SMART_REGION_IDS, type SmartRegionMaskSetting } from './smartRegions'

/*
 * 效果的作用区域（任务 4.7d 智能区域 + 4.10 手绘遮罩）。一个效果只有一个 `mask`，按 `regionId` 区分来源：
 * - 智能区域 face / person / background / text：本地模型分析素材得到（4.7d）；
 * - `shapes` 手绘遮罩：节目监视器上画的矩形、椭圆、钢笔路径（PR 的效果遮罩），可以有多个，按模式相加、相减、交叉。
 *
 * 坐标一律是**片段画面的归一化坐标**（0–1，左上角为原点，相对片段素材本身的画面，不是序列画面）：
 * 片段移动、缩放、旋转后遮罩跟着画面走，预览与导出都由合成器按片段几何画到序列上（与智能区域同一条路径）。
 * 被主进程引用的可能：本文件只用相对路径导入，不依赖 DOM。
 */

/** 遮罩模式：相加（并集）、相减（从前面的结果里挖掉）、交叉（只留重叠部分）。 */
export const VIDEO_EDIT_MASK_MODES = ['add', 'subtract', 'intersect'] as const
export type VideoEditMaskMode = (typeof VIDEO_EDIT_MASK_MODES)[number]
export const VIDEO_EDIT_MASK_MODE_LABELS: Readonly<Record<VideoEditMaskMode, string>> = { add: '相加', subtract: '相减', intersect: '交叉' }
export const VIDEO_EDIT_MASK_SHAPE_KINDS = ['rect', 'ellipse', 'path'] as const
export type VideoEditMaskShapeKind = (typeof VIDEO_EDIT_MASK_SHAPE_KINDS)[number]
export const VIDEO_EDIT_MASK_SHAPE_LABELS: Readonly<Record<VideoEditMaskShapeKind, string>> = { rect: '矩形遮罩', ellipse: '椭圆遮罩', path: '钢笔遮罩' }
/** 不透明度 0–100（%）。羽化、扩展与智能区域同一量纲：100 ≈ 画面高度的 10%。 */
export const VIDEO_EDIT_MASK_OPACITY_RANGE = { min: 0, max: 100 } as const
export const VIDEO_EDIT_MASK_DEFAULTS = { feather: 5, expand: 0, opacity: 100 } as const

const coordinate = z.number().finite()
const offset = z.number().finite()
const feather = z.number().finite().min(SMART_REGION_FEATHER_RANGE.min).max(SMART_REGION_FEATHER_RANGE.max)
const expand = z.number().finite().min(SMART_REGION_EXPAND_RANGE.min).max(SMART_REGION_EXPAND_RANGE.max)
/** 框：左上角 x、y 与宽、高（片段画面归一化）。 */
export const videoEditMaskBoxSchema = z.tuple([coordinate, coordinate, z.number().finite().min(0.001).max(5), z.number().finite().min(0.001).max(5)])
export type VideoEditMaskBox = z.infer<typeof videoEditMaskBoxSchema>
/** 钢笔路径的一个顶点：x、y，进入控制柄与离开控制柄相对顶点的偏移（全 0 为尖角）。 */
export const videoEditMaskPointSchema = z.tuple([coordinate, coordinate, offset, offset, offset, offset])
export type VideoEditMaskPoint = z.infer<typeof videoEditMaskPointSchema>

export const videoEditMaskShapeSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(VIDEO_EDIT_MASK_SHAPE_KINDS),
  /** 所有形状都是闭合贝塞尔路径；kind 只用于创建来源的名称。 */
  points: z.array(videoEditMaskPointSchema).min(3),
  mode: z.enum(VIDEO_EDIT_MASK_MODES).optional(),
  feather: feather.optional(), expand: expand.optional(),
  opacity: z.number().finite().min(VIDEO_EDIT_MASK_OPACITY_RANGE.min).max(VIDEO_EDIT_MASK_OPACITY_RANGE.max).optional(),
  invert: z.boolean().optional(),
  follow: z.object({ trackerId: z.string().min(1).max(100), reference: videoEditMaskBoxSchema }).strict().optional(),
}).strict()
export type VideoEditMaskShape = z.infer<typeof videoEditMaskShapeSchema>

/** 智能区域（4.7d）。 */
export const videoEditSmartMaskSchema = z.object({
  regionId: z.enum(VIDEO_EDIT_SMART_REGION_IDS), invert: z.boolean().optional(), feather: feather.optional(), expand: expand.optional(),
}).strict()
export const videoEditShapesMaskSchema = z.object({
  regionId: z.literal('shapes'), shapes: z.array(videoEditMaskShapeSchema).min(1),
}).strict().superRefine((mask, ctx) => {
  if (new Set(mask.shapes.map(shape => shape.id)).size !== mask.shapes.length) ctx.addIssue({ code: 'custom', message: '遮罩 ID 重复。' })
})
export const videoEditTrackerMaskSchema = z.object({
  regionId: z.literal('tracker'), trackerId: z.string().min(1).max(100), feather: feather.optional(), expand: expand.optional(), invert: z.boolean().optional(),
}).strict()
export const VIDEO_EDIT_TRACKER_MASK_DEFAULTS = { feather: 5, expand: 0 } as const
export const videoEditEffectMaskSchema = z.discriminatedUnion('regionId', [videoEditSmartMaskSchema, videoEditShapesMaskSchema, videoEditTrackerMaskSchema])
export type VideoEditEffectMask = z.infer<typeof videoEditEffectMaskSchema>
export type VideoEditShapesMask = z.infer<typeof videoEditShapesMaskSchema>

export function isSmartRegionMask(mask: VideoEditEffectMask | undefined | null): mask is SmartRegionMaskSetting {
  return Boolean(mask) && (VIDEO_EDIT_SMART_REGION_IDS as readonly string[]).includes(mask!.regionId)
}
export function isShapesMask(mask: VideoEditEffectMask | undefined | null): mask is VideoEditShapesMask {
  return mask?.regionId === 'shapes'
}
/** 快速手势与普通效果编辑共用跟踪引用校验，不依赖宿主或渲染管线。 */
export function assertVideoEditMaskTrackers(clip: { trackers?: readonly { id: string }[] }, mask: VideoEditEffectMask | undefined): void {
  const ids = mask?.regionId === 'tracker' ? [mask.trackerId] : isShapesMask(mask) ? mask.shapes.flatMap(shape => shape.follow ? [shape.follow.trackerId] : []) : []
  for (const id of ids) if (!clip.trackers?.some(tracker => tracker.id === id)) throw new Error('跟踪器不属于此片段，请先在该片段下创建 video_edit.tracker。')
}

// ==================== 默认形状 ====================

/** 新建矩形 / 椭圆：画面中央、占 40% 的框（PR 新建遮罩的默认大小）。 */
export function createVideoEditMaskShape(kind: 'rect' | 'ellipse', id: string = crypto.randomUUID()): VideoEditMaskShape {
  const k = 0.2 * KAPPA
  return { id, kind, points: kind === 'rect'
    ? [[0.3, 0.3, 0, 0, 0, 0], [0.7, 0.3, 0, 0, 0, 0], [0.7, 0.7, 0, 0, 0, 0], [0.3, 0.7, 0, 0, 0, 0]]
    : [[0.5, 0.3, -k, 0, k, 0], [0.7, 0.5, 0, -k, 0, k], [0.5, 0.7, k, 0, -k, 0], [0.3, 0.5, 0, k, 0, -k]] }
}

/** 遮罩的显示名：按种类与序号（“椭圆遮罩 2”）。 */
export function videoEditMaskShapeName(shapes: readonly VideoEditMaskShape[], shape: VideoEditMaskShape): string {
  const index = shapes.filter(entry => entry.kind === shape.kind).indexOf(shape)
  return `${VIDEO_EDIT_MASK_SHAPE_LABELS[shape.kind]} ${index + 1}`
}

// ==================== 编辑 ====================

/** 节目监视器上拖动遮罩的方式：整体移动、顶点、单侧或对称控制柄。 */
export type VideoEditMaskDragKind = 'move' | 'vertex' | 'in' | 'out' | 'symmetric'
/** 按拖动方式改一个遮罩（片段画面坐标的位移 du、dv 与指针位置 point）。 */
export function editVideoEditMaskShape(shape: VideoEditMaskShape, kind: VideoEditMaskDragKind, index: number, du: number, dv: number, point: { u: number; v: number }, breakSymmetry = false): VideoEditMaskShape {
  if (kind === 'move') {
    return { ...shape, points: shape.points.map(entry => [entry[0] + du, entry[1] + dv, entry[2], entry[3], entry[4], entry[5]]) }
  }
  return { ...shape, points: shape.points.map((entry, at): VideoEditMaskPoint => {
    if (at !== index) return entry
    if (kind === 'vertex') return [entry[0] + du, entry[1] + dv, entry[2], entry[3], entry[4], entry[5]]
    // 控制柄：拖哪一侧，另一侧保持共线（平滑顶点，与 PR 钢笔一致）。
    const dx = point.u - entry[0]; const dy = point.v - entry[1]
    if (breakSymmetry && kind !== 'symmetric') return kind === 'in' ? [entry[0], entry[1], dx, dy, entry[4], entry[5]] : [entry[0], entry[1], entry[2], entry[3], dx, dy]
    return kind === 'in' ? [entry[0], entry[1], dx, dy, -dx, -dy] : [entry[0], entry[1], -dx, -dy, dx, dy]
  }) }
}

// ==================== 几何 ====================

/** 椭圆转成 4 段三次贝塞尔（控制柄长度 0.5523 × 半轴，误差 < 0.03%）。 */
const KAPPA = 0.5522847498
export function videoEditMaskShapePoints(shape: Pick<VideoEditMaskShape, 'points'>): VideoEditMaskPoint[] {
  return shape.points
}

/** 路径的精确外接框：解每段贝塞尔各轴的导数极值。 */
export function videoEditMaskShapeBounds(shape: Pick<VideoEditMaskShape, 'points'>): VideoEditMaskBox {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  shape.points.forEach((a, index) => {
    const b = shape.points[(index + 1) % shape.points.length]
    for (const axis of [0, 1] as const) {
      const p0 = a[axis]; const p1 = p0 + a[axis + 4]; const p3 = b[axis]; const p2 = p3 + b[axis + 2]
      const qa = -p0 + 3*p1 - 3*p2 + p3; const qb = 2*(p0 - 2*p1 + p2); const qc = p1 - p0
      const roots: number[] = []
      if (Math.abs(qa) < 1e-12) { if (Math.abs(qb) >= 1e-12) roots.push(-qc/qb) }
      else { const discriminant = qb*qb - 4*qa*qc; if (discriminant >= 0) { const d = Math.sqrt(discriminant); roots.push((-qb+d)/(2*qa),(-qb-d)/(2*qa)) } }
      const values = [p0, p3, ...roots.filter(t => t > 0 && t < 1).map(t => { const u = 1-t; return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3 })]
      if (axis === 0) { minX = Math.min(minX, ...values); maxX = Math.max(maxX, ...values) }
      else { minY = Math.min(minY, ...values); maxY = Math.max(maxY, ...values) }
    }
  })
  return [minX, minY, Math.max(0.001, maxX - minX), Math.max(0.001, maxY - minY)]
}

/** 跟随跟踪区域平移、均匀缩放路径：顶点与手柄一并变换。 */
export function transformVideoEditMaskShape<T extends Pick<VideoEditMaskShape, 'points'>>(shape: T, map: { fromX: number; fromY: number; toX: number; toY: number; scale: number }): T {
  const x = (value: number): number => map.toX + (value - map.fromX) * map.scale
  const y = (value: number): number => map.toY + (value - map.fromY) * map.scale
  return { ...shape, points: shape.points!.map(point => [x(point[0]), y(point[1]), point[2] * map.scale, point[3] * map.scale, point[4] * map.scale, point[5] * map.scale]) }
}

/** 仿射变换 [a,b,c,d,tx,ty]：顶点带平移，手柄只用线性部分。 */
export function affineVideoEditMaskShape(shape: VideoEditMaskShape, matrix: readonly [number, number, number, number, number, number]): VideoEditMaskShape {
  const [a, b, c, d, tx, ty] = matrix
  return { ...shape, points: shape.points.map(([x, y, ix, iy, ox, oy]) => [a*x+c*y+tx, b*x+d*y+ty, a*ix+c*iy, b*ix+d*iy, a*ox+c*oy, b*ox+d*oy]) }
}

export function removeVideoEditMaskPoint(shape: VideoEditMaskShape, index: number): VideoEditMaskShape {
  if (shape.points.length <= 3) throw new Error('闭合遮罩至少需要三个顶点。')
  return { ...shape, points: shape.points.filter((_, at) => at !== index) }
}
export function toggleVideoEditMaskPoint(shape: VideoEditMaskShape, index: number): VideoEditMaskShape {
  return { ...shape, points: shape.points.map((point, at): VideoEditMaskPoint => {
    if (at !== index) return point
    if (point.slice(2).some(Boolean)) return [point[0], point[1], 0, 0, 0, 0]
    const before = shape.points[(at - 1 + shape.points.length) % shape.points.length]; const after = shape.points[(at + 1) % shape.points.length]
    const dx = (after[0] - before[0]) / 6; const dy = (after[1] - before[1]) / 6
    return [point[0], point[1], -dx, -dy, dx, dy]
  }) }
}

/** de Casteljau 分割，保留原曲线包括相邻顶点的另一侧手柄。 */
export function insertVideoEditMaskPoint(shape: VideoEditMaskShape, index: number, t: number): VideoEditMaskShape {
  const points = shape.points.map(point => [...point] as VideoEditMaskPoint)
  const a = points[index]; const b = points[(index + 1) % points.length]
  const mix = (p: readonly number[], q: readonly number[]): [number, number] => [p[0] + (q[0] - p[0])*t, p[1] + (q[1] - p[1])*t]
  const p = mix(a, [a[0]+a[4], a[1]+a[5]]); const q = mix([a[0]+a[4], a[1]+a[5]], [b[0]+b[2], b[1]+b[3]]); const r = mix([b[0]+b[2], b[1]+b[3]], b)
  const s = mix(p, q); const v = mix(q, r); const m = mix(s, v)
  a[4] = p[0]-a[0]; a[5] = p[1]-a[1]; b[2] = r[0]-b[0]; b[3] = r[1]-b[1]
  points.splice(index+1, 0, [m[0], m[1], s[0]-m[0], s[1]-m[1], v[0]-m[0], v[1]-m[1]])
  return { ...shape, points }
}

/** 点到路径最近的三次曲线参数；以显示像素距离度量，再局部细化。 */
export function nearestVideoEditMaskSegment(shape: VideoEditMaskShape, point: { u: number; v: number }, width: number, height: number): { index: number; t: number; distance: number } {
  let best = { index: 0, t: 0, distance: Infinity }
  shape.points.forEach((a, index) => {
    const b = shape.points[(index+1)%shape.points.length]
    const distance = (t: number): number => {
      const u = 1-t
      const x = u*u*u*a[0]+3*u*u*t*(a[0]+a[4])+3*u*t*t*(b[0]+b[2])+t*t*t*b[0]
      const y = u*u*u*a[1]+3*u*u*t*(a[1]+a[5])+3*u*t*t*(b[1]+b[3])+t*t*t*b[1]
      return Math.hypot((x-point.u)*width, (y-point.v)*height)
    }
    let at = 0; let minimum = Infinity
    for (let step = 0; step <= 32; step++) { const value = distance(step/32); if (value < minimum) { minimum = value; at = step/32 } }
    let lo = Math.max(0, at-1/32); let hi = Math.min(1, at+1/32)
    for (let iteration = 0; iteration < 18; iteration++) { const l = lo+(hi-lo)/3; const r = hi-(hi-lo)/3; if (distance(l) < distance(r)) hi=r; else lo=l }
    const t = (lo+hi)/2; const value = distance(t)
    if (value < best.distance) best = { index, t, distance: value }
  })
  return best
}

/**
 * 闭合路径展平成折线（像素坐标，[x0, y0, x1, y1, …]）：直线段原样，带控制柄的段按长度细分（每段至少 4、最多 32 步）。
 */
export function flattenVideoEditMaskPath(points: readonly VideoEditMaskPoint[], width: number, height: number): Float64Array {
  const output: number[] = []
  for (let index = 0; index < points.length; index++) {
    const a = points[index]; const b = points[(index + 1) % points.length]
    const p0x = a[0] * width; const p0y = a[1] * height; const p3x = b[0] * width; const p3y = b[1] * height
    output.push(p0x, p0y)
    if (!a[4] && !a[5] && !b[2] && !b[3]) continue
    const p1x = (a[0] + a[4]) * width; const p1y = (a[1] + a[5]) * height; const p2x = (b[0] + b[2]) * width; const p2y = (b[1] + b[3]) * height
    const length = Math.hypot(p1x - p0x, p1y - p0y) + Math.hypot(p2x - p1x, p2y - p1y) + Math.hypot(p3x - p2x, p3y - p2y)
    const steps = Math.max(4, Math.min(32, Math.ceil(length / 6)))
    for (let step = 1; step < steps; step++) {
      const t = step / steps; const u = 1 - t
      const w0 = u * u * u; const w1 = 3 * u * u * t; const w2 = 3 * u * t * t; const w3 = t * t * t
      output.push(w0 * p0x + w1 * p1x + w2 * p2x + w3 * p3x, w0 * p0y + w1 * p1y + w2 * p2y + w3 * p3y)
    }
  }
  return Float64Array.from(output)
}

/** 每像素行的纵向采样数（抗锯齿）；横向按跨度精确覆盖。 */
const ROW_SAMPLES = 4

/**
 * 闭合折线按非零环绕规则填充成 0–255 覆盖度（扫描线：每像素行取 4 条采样线，横向按像素精确累计覆盖比例）。
 */
export function fillVideoEditMaskPolygon(polygon: Float64Array, width: number, height: number): Uint8Array {
  const output = new Uint8Array(width * height)
  // 每条采样线只写跨度的两端，前缀和恢复覆盖；不再逐像素累加四次。
  const coverage = new Float32Array(width + 1)
  const count = polygon.length / 2
  if (count < 3) return new Uint8Array(width * height)
  let minY = Infinity; let maxY = -Infinity
  for (let index = 1; index < polygon.length; index += 2) { minY = Math.min(minY, polygon[index]); maxY = Math.max(maxY, polygon[index]) }
  const firstRow = Math.max(0, Math.floor(minY)); const lastRow = Math.min(height - 1, Math.ceil(maxY))
  const crossings: Array<{ x: number; winding: number }> = []
  for (let row = firstRow; row <= lastRow; row++) {
    coverage.fill(0)
    for (let sample = 0; sample < ROW_SAMPLES; sample++) {
      const sy = row + (sample + 0.5) / ROW_SAMPLES
      crossings.length = 0
      for (let index = 0; index < count; index++) {
        const ax = polygon[index * 2]; const ay = polygon[index * 2 + 1]
        const next = (index + 1) % count; const bx = polygon[next * 2]; const by = polygon[next * 2 + 1]
        if (ay === by || (sy < Math.min(ay, by)) || sy >= Math.max(ay, by)) continue
        crossings.push({ x: ax + (sy - ay) / (by - ay) * (bx - ax), winding: by > ay ? 1 : -1 })
      }
      if (crossings.length < 2) continue
      crossings.sort((left, right) => left.x - right.x)
      let winding = 0
      for (let index = 0; index < crossings.length - 1; index++) {
        winding += crossings[index].winding
        if (!winding) continue
        const x0 = Math.max(0, crossings[index].x); const x1 = Math.min(width, crossings[index + 1].x)
        if (x1 <= x0) continue
        const start = Math.floor(x0); const end = Math.floor(x1)
        if (start === end) { const value = (x1-x0)/ROW_SAMPLES; coverage[start] += value; coverage[start+1] -= value; continue }
        const left = (start+1-x0)/ROW_SAMPLES; const right = (x1-end)/ROW_SAMPLES
        coverage[start] += left; coverage[start+1] += 1/ROW_SAMPLES-left
        coverage[end] += right-1/ROW_SAMPLES
        if (end < width) coverage[end+1] -= right
      }
    }
    let value = 0
    for (let x = 0; x < width; x++) { value += coverage[x]; output[row*width+x] = Math.round(Math.min(1, value)*255) }
  }
  return output
}

/** 手绘遮罩的蒙版尺寸：保持片段画面比例，长边 1024（手绘边缘比智能区域更需要锐利）。 */
export function videoEditShapeMaskSize(pictureWidth: number, pictureHeight: number, longSide = 1024): { width: number; height: number } {
  const scale = longSide / Math.max(1, pictureWidth, pictureHeight)
  return { width: Math.max(1, Math.round(pictureWidth * scale)), height: Math.max(1, Math.round(pictureHeight * scale)) }
}

interface MaskRaster { data: Uint8Array; x: number; y: number; width: number; height: number }
/** 只限制临时像素缓存的内存，不限制工程的形状或顶点数量。 */
export class VideoEditMaskRasterCache {
  private readonly entries = new Map<string, MaskRaster>()
  private bytes = 0
  constructor(private readonly budgetBytes = 16 * 1024 ** 2) {}
  get(key: string): MaskRaster | undefined {
    const value = this.entries.get(key)
    if (value) { this.entries.delete(key); this.entries.set(key, value) }
    return value
  }
  put(key: string, value: MaskRaster): void {
    const previous = this.entries.get(key)
    if (previous) { this.bytes -= previous.data.byteLength + key.length * 2; this.entries.delete(key) }
    const bytes = value.data.byteLength + key.length * 2
    if (bytes > this.budgetBytes) return
    this.entries.set(key, value); this.bytes += bytes
    while (this.bytes > this.budgetBytes) {
      const first = this.entries.keys().next().value!
      this.bytes -= this.entries.get(first)!.data.byteLength + first.length * 2; this.entries.delete(first)
    }
  }
}

/**
 * 把一组手绘遮罩画成一张 0–255 的蒙版：每个形状先填充，再按自己的扩展、羽化、反转处理（与智能区域同一套 O(n) 处理），
 * 乘以不透明度，然后按模式依次合成——相加 a + m(1 − a)，相减 a(1 − m)，交叉 a·m。
 * 第一个形状是相减或交叉时，从“整个画面”开始（与 AE / PR 一致：单独一个相减遮罩 = 挖掉这块）。
 */
export function rasterizeVideoEditMaskShapes(shapes: readonly VideoEditMaskShape[], width: number, height: number, cache?: VideoEditMaskRasterCache): Uint8Array {
  // 羽化与扩展只消费路径附近的像素。截取所有控制点的保守包围盒，加上两个模糊 pass 与膨胀的完整支持半径。
  const local = (shape: VideoEditMaskShape): MaskRaster => {
    const key = cache && JSON.stringify([width, height, shape.points, shape.feather ?? VIDEO_EDIT_MASK_DEFAULTS.feather, shape.expand ?? VIDEO_EDIT_MASK_DEFAULTS.expand])
    const cached = key && cache?.get(key)
    if (cached) return cached
    const polygon = flattenVideoEditMaskPath(shape.points, width, height)
    const expand = Math.round(Math.abs(shape.expand ?? VIDEO_EDIT_MASK_DEFAULTS.expand)/100*0.1*height)
    const feather = Math.round((shape.feather ?? VIDEO_EDIT_MASK_DEFAULTS.feather)/100*0.1*height/2)
    const padding = expand + (feather ? 2*Math.max(1, Math.round(feather/2)) : 0) + 2
    let minX = width; let minY = height; let maxX = 0; let maxY = 0
    for (let index = 0; index < polygon.length; index += 2) { minX=Math.min(minX,polygon[index]); minY=Math.min(minY,polygon[index+1]); maxX=Math.max(maxX,polygon[index]); maxY=Math.max(maxY,polygon[index+1]) }
    const x = Math.max(0, Math.min(width-1, Math.floor(minX)-padding)); const y = Math.max(0, Math.min(height-1, Math.floor(minY)-padding))
    const w = Math.max(1, Math.min(width, Math.ceil(maxX)+padding)-x); const h = Math.max(1, Math.min(height, Math.ceil(maxY)+padding)-y)
    for (let index = 0; index < polygon.length; index += 2) { polygon[index]-=x; polygon[index+1]-=y }
    const filled = fillVideoEditMaskPolygon(polygon, w, h)
    const data = processSmartRegionMatte(filled, w, h, { feather: (shape.feather ?? VIDEO_EDIT_MASK_DEFAULTS.feather)*height/h, expand: (shape.expand ?? VIDEO_EDIT_MASK_DEFAULTS.expand)*height/h, invert: false })
    const result = { data, x, y, width: w, height: h }
    if (key) cache?.put(key, result)
    return result
  }
  if (shapes.length === 1) {
    const shape = shapes[0]; const crop = local(shape); const output = new Uint8Array(width*height)
    const opacity = (shape.opacity ?? 100)/100
    const inverse = Boolean(shape.invert); const subtract = shape.mode === 'subtract'
    const outside = Math.round((subtract ? 1-(inverse ? opacity : 0) : inverse ? opacity : 0)*255)
    if (outside) output.fill(outside)
    for (let y = 0; y < crop.height; y++) {
      if (!inverse && !subtract && opacity === 1) output.set(crop.data.subarray(y*crop.width,(y+1)*crop.width), (y+crop.y)*width+crop.x)
      else for (let x = 0; x < crop.width; x++) { const raw = crop.data[y*crop.width+x]/255; const value = (inverse ? 1-raw : raw)*opacity; output[(y+crop.y)*width+x+crop.x] = Math.round((subtract ? 1-value : value)*255) }
    }
    return output
  }
  const accumulator = new Float32Array(width * height)
  if (shapes.length && (shapes[0].mode ?? 'add') !== 'add') accumulator.fill(1)
  for (const shape of shapes) {
    const crop = local(shape)
    const opacity = (shape.opacity ?? VIDEO_EDIT_MASK_DEFAULTS.opacity) / 100
    const mode = shape.mode ?? 'add'
    const outside = shape.invert ? opacity : 0
    const applyOutside = (start: number, end: number): void => {
      if (outside === 0) { if (mode === 'intersect') accumulator.fill(0,start,end); return }
      if (outside === 1) { if (mode !== 'intersect') accumulator.fill(mode === 'add' ? 1 : 0,start,end); return }
      for (let index = start; index < end; index++) { const value=accumulator[index]; accumulator[index]=mode === 'add' ? value+outside*(1-value) : mode === 'subtract' ? value*(1-outside) : value*outside }
    }
    applyOutside(0,crop.y*width)
    for (let y = 0; y < crop.height; y++) {
      const base=(y+crop.y)*width
      applyOutside(base,base+crop.x)
      for (let x = 0; x < crop.width; x++) {
        const index=base+crop.x+x; const raw=crop.data[y*crop.width+x]/255
        const value=(shape.invert ? 1-raw : raw)*opacity; const current=accumulator[index]
        accumulator[index]=mode === 'add' ? current+value*(1-current) : mode === 'subtract' ? current*(1-value) : current*value
      }
      applyOutside(base+crop.x+crop.width,base+width)
    }
    applyOutside((crop.y+crop.height)*width,accumulator.length)
  }
  const output = new Uint8Array(width * height)
  for (let index = 0; index < output.length; index++) output[index] = Math.round(accumulator[index] * 255)
  return output
}
