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
/** 一个效果最多 8 个遮罩，一条钢笔路径最多 64 个顶点。 */
export const VIDEO_EDIT_MAX_MASK_SHAPES = 8
export const VIDEO_EDIT_MAX_MASK_POINTS = 64
/** 不透明度 0–100（%）。羽化、扩展与智能区域同一量纲：100 ≈ 画面高度的 10%。 */
export const VIDEO_EDIT_MASK_OPACITY_RANGE = { min: 0, max: 100 } as const
export const VIDEO_EDIT_MASK_DEFAULTS = { feather: 5, expand: 0, opacity: 100 } as const

const coordinate = z.number().finite().min(-2).max(3)
const offset = z.number().finite().min(-4).max(4)
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
  /** 矩形、椭圆：外接框。 */
  box: videoEditMaskBoxSchema.optional(),
  /** 钢笔：闭合路径的顶点（至少 3 个）。 */
  points: z.array(videoEditMaskPointSchema).min(3).max(VIDEO_EDIT_MAX_MASK_POINTS).optional(),
  mode: z.enum(VIDEO_EDIT_MASK_MODES).optional(),
  feather: feather.optional(), expand: expand.optional(),
  opacity: z.number().finite().min(VIDEO_EDIT_MASK_OPACITY_RANGE.min).max(VIDEO_EDIT_MASK_OPACITY_RANGE.max).optional(),
  invert: z.boolean().optional(),
}).strict().superRefine((shape, ctx) => {
  if (shape.kind === 'path' ? !shape.points || shape.box : !shape.box || shape.points) ctx.addIssue({ code: 'custom', message: '矩形、椭圆遮罩写 box（左上角 x、y 与宽、高），钢笔遮罩写 points（至少 3 个顶点）。' })
})
export type VideoEditMaskShape = z.infer<typeof videoEditMaskShapeSchema>

/** 智能区域（4.7d）。 */
export const videoEditSmartMaskSchema = z.object({
  regionId: z.enum(VIDEO_EDIT_SMART_REGION_IDS), invert: z.boolean().optional(), feather: feather.optional(), expand: expand.optional(),
}).strict()
export const videoEditShapesMaskSchema = z.object({
  regionId: z.literal('shapes'), shapes: z.array(videoEditMaskShapeSchema).min(1).max(VIDEO_EDIT_MAX_MASK_SHAPES),
}).strict().superRefine((mask, ctx) => {
  if (new Set(mask.shapes.map(shape => shape.id)).size !== mask.shapes.length) ctx.addIssue({ code: 'custom', message: '遮罩 ID 重复。' })
})
export const videoEditEffectMaskSchema = z.discriminatedUnion('regionId', [videoEditSmartMaskSchema, videoEditShapesMaskSchema])
export type VideoEditEffectMask = z.infer<typeof videoEditEffectMaskSchema>
export type VideoEditShapesMask = z.infer<typeof videoEditShapesMaskSchema>

export function isSmartRegionMask(mask: VideoEditEffectMask | undefined | null): mask is SmartRegionMaskSetting {
  return Boolean(mask) && (VIDEO_EDIT_SMART_REGION_IDS as readonly string[]).includes(mask!.regionId)
}
export function isShapesMask(mask: VideoEditEffectMask | undefined | null): mask is VideoEditShapesMask {
  return mask?.regionId === 'shapes'
}

// ==================== 默认形状 ====================

/** 新建矩形 / 椭圆：画面中央、占 40% 的框（PR 新建遮罩的默认大小）。 */
export function createVideoEditMaskShape(kind: 'rect' | 'ellipse', id: string = crypto.randomUUID()): VideoEditMaskShape {
  return { id, kind, box: [0.3, 0.3, 0.4, 0.4] }
}

/** 遮罩的显示名：按种类与序号（“椭圆遮罩 2”）。 */
export function videoEditMaskShapeName(shapes: readonly VideoEditMaskShape[], shape: VideoEditMaskShape): string {
  const index = shapes.filter(entry => entry.kind === shape.kind).indexOf(shape)
  return `${VIDEO_EDIT_MASK_SHAPE_LABELS[shape.kind]} ${index + 1}`
}

// ==================== 编辑 ====================

/** 节目监视器上拖动遮罩的方式：整体移动、顶点、进入 / 离开控制柄、矩形与椭圆的角。 */
export type VideoEditMaskDragKind = 'move' | 'vertex' | 'in' | 'out' | 'corner'
/** 按拖动方式改一个遮罩（片段画面坐标的位移 du、dv 与指针位置 point）。 */
export function editVideoEditMaskShape(shape: VideoEditMaskShape, kind: VideoEditMaskDragKind, index: number, du: number, dv: number, point: { u: number; v: number }): VideoEditMaskShape {
  if (kind === 'move') {
    if (shape.box) return { ...shape, box: [shape.box[0] + du, shape.box[1] + dv, shape.box[2], shape.box[3]] }
    return { ...shape, points: shape.points!.map(entry => [entry[0] + du, entry[1] + dv, entry[2], entry[3], entry[4], entry[5]]) }
  }
  if (kind === 'corner' && shape.box) {
    const [x, y, width, height] = shape.box
    const corners: Array<[number, number]> = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
    const [ax, ay] = corners[(index + 2) % 4]
    const minWidth = 0.002
    return { ...shape, box: [Math.min(ax, point.u), Math.min(ay, point.v), Math.max(minWidth, Math.abs(point.u - ax)), Math.max(minWidth, Math.abs(point.v - ay))] }
  }
  if (!shape.points) return shape
  return { ...shape, points: shape.points.map((entry, at): VideoEditMaskPoint => {
    if (at !== index) return entry
    if (kind === 'vertex') return [entry[0] + du, entry[1] + dv, entry[2], entry[3], entry[4], entry[5]]
    // 控制柄：拖哪一侧，另一侧保持共线（平滑顶点，与 PR 钢笔一致）。
    const dx = point.u - entry[0]; const dy = point.v - entry[1]
    return kind === 'in' ? [entry[0], entry[1], dx, dy, -dx, -dy] : [entry[0], entry[1], -dx, -dy, dx, dy]
  }) }
}

// ==================== 几何 ====================

/** 椭圆转成 4 段三次贝塞尔（控制柄长度 0.5523 × 半轴，误差 < 0.03%）。 */
const KAPPA = 0.5522847498
export function videoEditMaskShapePoints(shape: Pick<VideoEditMaskShape, 'kind' | 'box' | 'points'>): VideoEditMaskPoint[] {
  if (shape.kind === 'path') return shape.points ?? []
  const [x, y, width, height] = shape.box!
  if (shape.kind === 'rect') return [[x, y, 0, 0, 0, 0], [x + width, y, 0, 0, 0, 0], [x + width, y + height, 0, 0, 0, 0], [x, y + height, 0, 0, 0, 0]]
  const rx = width / 2; const ry = height / 2; const cx = x + rx; const cy = y + ry
  const kx = rx * KAPPA; const ky = ry * KAPPA
  return [[cx, y, -kx, 0, kx, 0], [x + width, cy, 0, -ky, 0, ky], [cx, y + height, kx, 0, -kx, 0], [x, cy, 0, ky, 0, -ky]]
}

/** 路径的外接框（含控制柄的贝塞尔曲线近似：按展平后的折线取）。 */
export function videoEditMaskShapeBounds(shape: Pick<VideoEditMaskShape, 'kind' | 'box' | 'points'>): VideoEditMaskBox {
  if (shape.box) return shape.box
  const polygon = flattenVideoEditMaskPath(videoEditMaskShapePoints(shape), 1, 1)
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity
  for (let index = 0; index < polygon.length; index += 2) {
    minX = Math.min(minX, polygon[index]); maxX = Math.max(maxX, polygon[index]); minY = Math.min(minY, polygon[index + 1]); maxY = Math.max(maxY, polygon[index + 1])
  }
  return [minX, minY, Math.max(0.001, maxX - minX), Math.max(0.001, maxY - minY)]
}

/** 平移、按中心缩放形状（遮罩跟随与拖动共用）：所有顶点与外接框一起变换，控制柄按比例缩放。 */
export function transformVideoEditMaskShape<T extends Pick<VideoEditMaskShape, 'kind' | 'box' | 'points'>>(shape: T, map: { fromX: number; fromY: number; toX: number; toY: number; scale: number }): T {
  const x = (value: number): number => map.toX + (value - map.fromX) * map.scale
  const y = (value: number): number => map.toY + (value - map.fromY) * map.scale
  if (shape.box) return { ...shape, box: [x(shape.box[0]), y(shape.box[1]), shape.box[2] * map.scale, shape.box[3] * map.scale] }
  return { ...shape, points: shape.points!.map(point => [x(point[0]), y(point[1]), point[2] * map.scale, point[3] * map.scale, point[4] * map.scale, point[5] * map.scale]) }
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
  const coverage = new Float32Array(width * height)
  const count = polygon.length / 2
  if (count < 3) return new Uint8Array(width * height)
  let minY = Infinity; let maxY = -Infinity
  for (let index = 1; index < polygon.length; index += 2) { minY = Math.min(minY, polygon[index]); maxY = Math.max(maxY, polygon[index]) }
  const firstRow = Math.max(0, Math.floor(minY)); const lastRow = Math.min(height - 1, Math.ceil(maxY))
  const crossings: Array<{ x: number; winding: number }> = []
  for (let row = firstRow; row <= lastRow; row++) {
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
        const base = row * width
        const start = Math.floor(x0); const end = Math.min(width - 1, Math.floor(x1))
        if (start === end) { coverage[base + start] += (x1 - x0) / ROW_SAMPLES; continue }
        coverage[base + start] += (start + 1 - x0) / ROW_SAMPLES
        for (let x = start + 1; x < end; x++) coverage[base + x] += 1 / ROW_SAMPLES
        if (end < width) coverage[base + end] += (x1 - end) / ROW_SAMPLES
      }
    }
  }
  const output = new Uint8Array(width * height)
  for (let index = 0; index < output.length; index++) output[index] = Math.round(Math.min(1, coverage[index]) * 255)
  return output
}

/** 手绘遮罩的蒙版尺寸：保持片段画面比例，长边 1024（手绘边缘比智能区域更需要锐利）。 */
export function videoEditShapeMaskSize(pictureWidth: number, pictureHeight: number, longSide = 1024): { width: number; height: number } {
  const scale = longSide / Math.max(1, pictureWidth, pictureHeight)
  return { width: Math.max(1, Math.round(pictureWidth * scale)), height: Math.max(1, Math.round(pictureHeight * scale)) }
}

/**
 * 把一组手绘遮罩画成一张 0–255 的蒙版：每个形状先填充，再按自己的扩展、羽化、反转处理（与智能区域同一套 O(n) 处理），
 * 乘以不透明度，然后按模式依次合成——相加 a + m(1 − a)，相减 a(1 − m)，交叉 a·m。
 * 第一个形状是相减或交叉时，从“整个画面”开始（与 AE / PR 一致：单独一个相减遮罩 = 挖掉这块）。
 */
export function rasterizeVideoEditMaskShapes(shapes: readonly VideoEditMaskShape[], width: number, height: number): Uint8Array {
  const accumulator = new Float32Array(width * height)
  if (shapes.length && (shapes[0].mode ?? 'add') !== 'add') accumulator.fill(1)
  for (const shape of shapes) {
    const filled = fillVideoEditMaskPolygon(flattenVideoEditMaskPath(videoEditMaskShapePoints(shape), width, height), width, height)
    const processed = processSmartRegionMatte(filled, width, height, { feather: shape.feather ?? VIDEO_EDIT_MASK_DEFAULTS.feather, expand: shape.expand ?? VIDEO_EDIT_MASK_DEFAULTS.expand, invert: Boolean(shape.invert) })
    const opacity = (shape.opacity ?? VIDEO_EDIT_MASK_DEFAULTS.opacity) / 100
    const mode = shape.mode ?? 'add'
    for (let index = 0; index < accumulator.length; index++) {
      const value = processed[index] / 255 * opacity; const current = accumulator[index]
      accumulator[index] = mode === 'add' ? current + value * (1 - current) : mode === 'subtract' ? current * (1 - value) : current * value
    }
  }
  const output = new Uint8Array(width * height)
  for (let index = 0; index < output.length; index++) output[index] = Math.round(accumulator[index] * 255)
  return output
}
