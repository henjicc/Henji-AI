import { z } from 'zod'
import { interpolateVideoEditKeyframe, videoEditBezierSchema, videoEditInterpolationSchema, type VideoEditBezier } from './keyframeInterpolation'

/**
 * 时间重映射（速度曲线，对标 PR 时间重映射与剪映曲线变速）：片段的速度是**源位置**的函数。
 *
 * - 曲线点 `offsetUs` 是沿播放方向距片段开头源位置的微秒数（倒放时向源的较早处数），`speed` 为倍率（1 = 100%）。
 *   点之间的速度按点的插值方式变化（linear / hold / ease / bezier，与关键帧同一套插值），第一个点之前、最后一个点之后
 *   保持端点速度。改曲线时片段用到的源内容不变，时长随曲线重新积分（`videoEditTimeRemapElapsedAt`）。
 * - 换算：时间线经过 t 秒时的源位置 u 满足 dt = du / v(u)。线性段解析求解（t = L·ln(v₁/v₀)/(v₁−v₀) 及其反函数）；
 *   ease/bezier 段按 256 个子区间的分段线性速度积分。积分表是派生缓存（按曲线对象缓存），不落盘。
 * - 与常数速度 `speed`、定格 `frameHold` 互斥；倒放 `reverse` 仍是片段的播放方向。
 */
export const VIDEO_EDIT_TIME_REMAP_SPEED_MIN = 0.01
export const VIDEO_EDIT_TIME_REMAP_SPEED_MAX = 100
export const VIDEO_EDIT_TIME_REMAP_MAX_POINTS = 256
const MAX_OFFSET_US = 24 * 3600 * 1_000_000
const EASED_STEPS = 256

export const videoEditTimeRemapPointSchema = z.object({
  offsetUs: z.number().int().min(0).max(MAX_OFFSET_US),
  speed: z.number().finite().min(VIDEO_EDIT_TIME_REMAP_SPEED_MIN).max(VIDEO_EDIT_TIME_REMAP_SPEED_MAX),
  interpolation: videoEditInterpolationSchema,
  bezier: videoEditBezierSchema.optional(),
  /** 修剪或拆分切在缓动段中间时保留原曲线形状（与关键帧的 easeRange / easeValues 同义）。 */
  easeRange: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).refine(([a, b]) => b > a, '缓动区间终点须大于起点。').optional(),
  easeValues: z.tuple([z.number().finite(), z.number().finite()]).optional(),
}).strict()
export const videoEditTimeRemapSchema = z.object({
  points: z.array(videoEditTimeRemapPointSchema).min(1).max(VIDEO_EDIT_TIME_REMAP_MAX_POINTS),
}).strict().superRefine((remap, ctx) => {
  remap.points.forEach((point, index) => {
    if (index > 0 && point.offsetUs <= remap.points[index - 1].offsetUs) ctx.addIssue({ code: 'custom', path: ['points', index, 'offsetUs'], message: '速度曲线点必须按源位置升序排列，不能重复。' })
    if (point.easeValues && (point.interpolation !== 'bezier' || !point.easeRange)) ctx.addIssue({ code: 'custom', path: ['points', index, 'easeValues'], message: 'easeValues 只能用于带 easeRange 的贝塞尔段。' })
  })
})
export type VideoEditTimeRemapPoint = z.infer<typeof videoEditTimeRemapPointSchema>
export type VideoEditTimeRemap = z.infer<typeof videoEditTimeRemapSchema>

/** 补帧方式：nearest 帧采样（PR 默认），blend 慢于原速处相邻两帧按位置混合；optical_flow 预留（尚未实现时按 blend 渲染）。 */
export const VIDEO_EDIT_FRAME_INTERPOLATIONS = ['nearest', 'blend', 'optical_flow'] as const
export const videoEditFrameInterpolationSchema = z.enum(VIDEO_EDIT_FRAME_INTERPOLATIONS)
export type VideoEditFrameInterpolation = z.infer<typeof videoEditFrameInterpolationSchema>
/** 补帧实现版本（预渲染缓存指纹）：光流接入或帧混合算法改变时递增。 */
export const VIDEO_EDIT_FRAME_INTERPOLATION_ENGINE = 'nearest-1/blend-1/optical_flow=blend'
/** 实际渲染用的补帧方式：光流尚未实现，降级为帧混合。 */
export function videoEditRenderedFrameInterpolation(value: VideoEditFrameInterpolation | undefined): 'nearest' | 'blend' {
  return value === 'blend' || value === 'optical_flow' ? 'blend' : 'nearest'
}

/** 速度在源位置上分段线性的一段：[u0, u1] 秒，速度 v0→v1，段首对应时间线 t0 秒。 */
interface Piece { u0: number; u1: number; v0: number; v1: number; t0: number; t1: number }
interface Table { pieces: Piece[]; first: number; last: number; min: number; max: number }
const tables = new WeakMap<VideoEditTimeRemap, Table>()

function segmentSpeed(left: VideoEditTimeRemapPoint, right: VideoEditTimeRemapPoint, fraction: number): number {
  return interpolateVideoEditKeyframe(left.speed, right.speed, fraction, left.interpolation, left.easeRange, left.bezier, left.easeValues) as number
}
/** 段内经过时间：速度从 v0 线性变到 v1、源长度 x（共 L）时用的时间线秒数。 */
function pieceElapsed(piece: Piece, x: number): number {
  const length = piece.u1 - piece.u0; const dv = piece.v1 - piece.v0
  if (length <= 0) return 0
  if (Math.abs(dv) < 1e-12 * piece.v0) return x / piece.v0
  return length / dv * Math.log((piece.v0 + dv * x / length) / piece.v0)
}
/** 反函数：段内经过 dt 秒走过的源长度。 */
function pieceAdvance(piece: Piece, dt: number): number {
  const length = piece.u1 - piece.u0; const dv = piece.v1 - piece.v0
  if (length <= 0) return 0
  if (Math.abs(dv) < 1e-12 * piece.v0) return dt * piece.v0
  return (piece.v0 * Math.exp(dt * dv / length) - piece.v0) * length / dv
}
function table(remap: VideoEditTimeRemap): Table {
  const cached = tables.get(remap)
  if (cached) return cached
  const { points } = remap
  const pieces: Piece[] = []
  const push = (u0: number, u1: number, v0: number, v1: number): void => {
    if (u1 <= u0) return
    const t0 = pieces.length ? pieces[pieces.length - 1].t1 : 0
    const piece = { u0, u1, v0, v1, t0, t1: t0 }
    piece.t1 = t0 + pieceElapsed(piece, u1 - u0)
    pieces.push(piece)
  }
  let min = Infinity; let max = 0
  for (let index = 0; index < points.length - 1; index++) {
    const left = points[index]; const right = points[index + 1]
    const u0 = left.offsetUs / 1e6; const u1 = right.offsetUs / 1e6
    if (left.interpolation === 'hold') { push(u0, u1, left.speed, left.speed); min = Math.min(min, left.speed); max = Math.max(max, left.speed); continue }
    const steps = left.interpolation === 'linear' && !left.easeValues ? 1 : EASED_STEPS
    let previous = segmentSpeed(left, right, 0)
    min = Math.min(min, previous); max = Math.max(max, previous)
    for (let step = 1; step <= steps; step++) {
      const next = Math.max(VIDEO_EDIT_TIME_REMAP_SPEED_MIN, Math.min(VIDEO_EDIT_TIME_REMAP_SPEED_MAX, segmentSpeed(left, right, step / steps)))
      push(u0 + (u1 - u0) * (step - 1) / steps, u0 + (u1 - u0) * step / steps, previous, next)
      min = Math.min(min, next); max = Math.max(max, next); previous = next
    }
  }
  const first = points[0].speed; const last = points[points.length - 1].speed
  const result = { pieces, first, last, min: Math.min(min, first, last), max: Math.max(max, first, last) }
  tables.set(remap, result)
  return result
}
const startOf = (remap: VideoEditTimeRemap): number => remap.points[0].offsetUs / 1e6
const endOf = (remap: VideoEditTimeRemap): number => remap.points[remap.points.length - 1].offsetUs / 1e6

/** 从曲线第一个点量起的时间线秒数（u 可在曲线外，按端点速度外延）。 */
function timeFromStart(remap: VideoEditTimeRemap, u: number): number {
  const { pieces, first, last } = table(remap)
  const start = startOf(remap); const end = endOf(remap)
  if (u <= start) return (u - start) / first
  if (u >= end) return (pieces.length ? pieces[pieces.length - 1].t1 : 0) + (u - end) / last
  let low = 0; let high = pieces.length - 1
  while (low < high) { const middle = (low + high + 1) >> 1; if (pieces[middle].u0 <= u) low = middle; else high = middle - 1 }
  return pieces[low].t0 + pieceElapsed(pieces[low], u - pieces[low].u0)
}
/** 源位置 u 秒（相对片段开头，沿播放方向，可为负或超出曲线）对应的时间线经过秒数；严格单调递增，u=0 时为 0。 */
export function videoEditTimeRemapElapsedAt(remap: VideoEditTimeRemap, sourceSeconds: number): number {
  return timeFromStart(remap, sourceSeconds) - timeFromStart(remap, 0)
}
/** 反函数：时间线经过 `elapsedSeconds` 秒（可为负）时的源位置（秒，相对片段开头，沿播放方向）。 */
export function videoEditTimeRemapSourceAt(remap: VideoEditTimeRemap, elapsedSeconds: number): number {
  const { pieces, first, last } = table(remap)
  const t = elapsedSeconds + timeFromStart(remap, 0)
  if (t <= 0) return startOf(remap) + t * first
  const total = pieces.length ? pieces[pieces.length - 1].t1 : 0
  if (t >= total) return endOf(remap) + (t - total) * last
  let low = 0; let high = pieces.length - 1
  while (low < high) { const middle = (low + high + 1) >> 1; if (pieces[middle].t0 <= t) low = middle; else high = middle - 1 }
  const piece = pieces[low]
  return Math.min(piece.u1, piece.u0 + pieceAdvance(piece, t - piece.t0))
}
/** 源位置处的速度（倍率）。 */
export function videoEditTimeRemapSpeedAtSource(remap: VideoEditTimeRemap, sourceSeconds: number): number {
  const { points } = remap
  const us = sourceSeconds * 1e6
  if (us <= points[0].offsetUs) return points[0].speed
  if (us >= points[points.length - 1].offsetUs) return points[points.length - 1].speed
  let low = 0; let high = points.length - 1
  while (high - low > 1) { const middle = (low + high) >> 1; if (points[middle].offsetUs <= us) low = middle; else high = middle }
  const left = points[low]; const right = points[high]
  return segmentSpeed(left, right, (us - left.offsetUs) / (right.offsetUs - left.offsetUs))
}
/** 曲线上的最低与最高速度（端点外延也算在内）。 */
export function videoEditTimeRemapSpeedRange(remap: VideoEditTimeRemap): { min: number; max: number } {
  const { min, max } = table(remap)
  return { min, max }
}
/** 一条常数速度的曲线（单点）。 */
export function videoEditConstantTimeRemap(speed: number): VideoEditTimeRemap {
  return { points: [{ offsetUs: 0, speed, interpolation: 'linear' }] }
}
/** 速度整体乘以 `factor`（比率拉伸：用到的源内容不变，时长变为 1/factor）。 */
export function scaleVideoEditTimeRemap(remap: VideoEditTimeRemap, factor: number): VideoEditTimeRemap {
  const clamp = (value: number): number => Math.max(VIDEO_EDIT_TIME_REMAP_SPEED_MIN, Math.min(VIDEO_EDIT_TIME_REMAP_SPEED_MAX, value * factor))
  return videoEditTimeRemapSchema.parse({ points: remap.points.map(point => ({ ...point, speed: clamp(point.speed), ...(point.easeValues ? { easeValues: [clamp(point.easeValues[0]), clamp(point.easeValues[1])] } : {}) })) })
}
/**
 * 片段开头沿播放方向移动 `shiftSeconds` 源秒（修剪入点、拆分出的右段；负数为向前露出更多源内容）后的曲线：
 * 新开头之前的点去掉，开头处补一个按原曲线取值的点（切在缓动段中间时用 easeRange 保留原形状）。
 */
export function shiftVideoEditTimeRemap(remap: VideoEditTimeRemap, shiftSeconds: number): VideoEditTimeRemap {
  const shift = Math.round(shiftSeconds * 1e6)
  if (!shift) return remap
  const { points } = remap
  if (shift < 0) {
    const moved = points.map(point => ({ ...point, offsetUs: point.offsetUs - shift }))
    return videoEditTimeRemapSchema.parse({ points: moved[0].offsetUs > 0 ? [{ offsetUs: 0, speed: moved[0].speed, interpolation: 'linear' }, ...moved] : moved })
  }
  const kept = points.filter(point => point.offsetUs >= shift).map(point => ({ ...point, offsetUs: point.offsetUs - shift }))
  if (kept[0]?.offsetUs === 0) return videoEditTimeRemapSchema.parse({ points: kept })
  let leftIndex = points.length - 1
  while (leftIndex >= 0 && points[leftIndex].offsetUs >= shift) leftIndex--
  if (leftIndex < 0) return videoEditTimeRemapSchema.parse({ points: kept })
  const left = points[leftIndex]; const right = points[leftIndex + 1]
  const head: VideoEditTimeRemapPoint = { offsetUs: 0, speed: videoEditTimeRemapSpeedAtSource(remap, shift / 1e6), interpolation: left.interpolation }
  if (right && (left.interpolation === 'ease' || left.interpolation === 'bezier' || left.easeValues)) {
    const [a, b] = left.easeRange ?? [0, 1]
    const fraction = (shift - left.offsetUs) / (right.offsetUs - left.offsetUs)
    head.interpolation = 'bezier'
    head.bezier = left.bezier ?? (left.interpolation === 'ease' ? [1 / 3, 0, 2 / 3, 1] : undefined)
    head.easeRange = [a + (b - a) * fraction, b]
    head.easeValues = left.easeValues ?? [left.speed, right.speed]
    if (!head.bezier) delete head.bezier
  }
  return videoEditTimeRemapSchema.parse({ points: [head, ...kept] })
}
/** 镜像（切换倒放）：片段用到的源长度 `spanSeconds` 内，u → span − u，曲线形状随之翻转。 */
export function mirrorVideoEditTimeRemap(remap: VideoEditTimeRemap, spanSeconds: number): VideoEditTimeRemap {
  const span = Math.round(spanSeconds * 1e6)
  // 先把曲线裁到 [0, span]，两端补上按原曲线取值的点。
  let inside = remap.points.filter(point => point.offsetUs <= span)
  if (!inside.length || inside[0].offsetUs > 0) inside = [{ offsetUs: 0, speed: videoEditTimeRemapSpeedAtSource(remap, 0), interpolation: 'linear' }, ...inside]
  if (inside[inside.length - 1].offsetUs < span) {
    const lastInside = inside[inside.length - 1]
    if (lastInside.interpolation === 'ease' || lastInside.interpolation === 'bezier') inside = shiftTail(remap, inside, span)
    inside = [...inside, { offsetUs: span, speed: videoEditTimeRemapSpeedAtSource(remap, span / 1e6), interpolation: 'linear' }]
  }
  const result: VideoEditTimeRemapPoint[] = []
  for (let index = inside.length - 1; index >= 0; index--) {
    const point = inside[index]; const left = inside[index - 1]
    const base: VideoEditTimeRemapPoint = { offsetUs: span - point.offsetUs, speed: point.speed, interpolation: 'linear' }
    if (!left || left.interpolation === 'linear') { result.push(base); continue }
    if (left.interpolation === 'hold') {
      // 原来是左端速度保持到这里：倒过来先在 1 微秒内从本点速度过渡到保持的速度。
      const length = point.offsetUs - left.offsetUs
      if (left.speed === point.speed || length <= 1) result.push({ ...base, speed: left.speed, interpolation: 'hold' })
      else result.push(base, { offsetUs: base.offsetUs + 1, speed: left.speed, interpolation: 'hold' })
      continue
    }
    const bezier: VideoEditBezier = left.bezier ?? [1 / 3, 0, 2 / 3, 1]
    const range: [number, number] = left.easeRange ?? [0, 1]
    result.push({ ...base, interpolation: 'bezier', bezier: [1 - bezier[2], 1 - bezier[3], 1 - bezier[0], 1 - bezier[1]], easeRange: [1 - range[1], 1 - range[0]], easeValues: left.easeValues ? [left.easeValues[1], left.easeValues[0]] : [point.speed, left.speed] })
  }
  return videoEditTimeRemapSchema.parse({ points: result })
}
/** 末段是缓动且被 span 截断时，用 easeRange 保留截断前的形状。 */
function shiftTail(remap: VideoEditTimeRemap, inside: VideoEditTimeRemapPoint[], span: number): VideoEditTimeRemapPoint[] {
  const index = remap.points.findIndex(point => point.offsetUs > span)
  if (index <= 0) return inside
  const left = remap.points[index - 1]; const right = remap.points[index]
  const [a, b] = left.easeRange ?? [0, 1]
  const fraction = (span - left.offsetUs) / (right.offsetUs - left.offsetUs)
  const trimmed: VideoEditTimeRemapPoint = { ...left, interpolation: 'bezier', bezier: left.bezier ?? [1 / 3, 0, 2 / 3, 1], easeRange: [a, a + (b - a) * fraction], easeValues: left.easeValues ?? [left.speed, right.speed] }
  return [...inside.slice(0, -1), trimmed]
}
