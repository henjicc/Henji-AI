import { z } from 'zod'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from './time'
import { videoEditClipFrameBoundaryAtSource, videoEditClipSourceMidSecondsAt, videoEditClipSpeedSupported } from './clipSpeed'
import type { VideoEditClip } from './document'

const identifier = z.string().min(1).max(100)
const frame = z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES)
const unit = z.number().min(0).max(1)
const point = z.object({ x: unit, y: unit }).strict()
const region = z.object({ x: unit, y: unit, width: unit.positive(), height: unit.positive() }).strict()
export const videoEditAnnotationTargetSchema = z.discriminatedUnion('kind', [
  point.extend({ kind: z.literal('point') }).strict(),
  region.extend({ kind: z.literal('region') }).strict(),
  z.object({ kind: z.literal('stroke'), strokes: z.array(z.array(point).min(1)).min(1) }).strict(),
  z.object({ kind: z.literal('element'), elementId: z.string().min(1), sourceSpan: z.object({ file: z.string().min(1), start: z.number().int().nonnegative(), end: z.number().int().positive() }).strict().refine(span => span.end > span.start).optional(), region: region.optional() }).strict(),
  z.object({ kind: z.literal('range'), startFrame: frame, endFrame: frame, trackIds: z.array(identifier).optional(), clipIds: z.array(identifier).optional() }).strict(),
  // 截图式标注：箭头从 from 指向 to；椭圆按外接框；文字以锚点为左上角显示 annotation.text；编号圆点显示 number。
  z.object({ kind: z.literal('arrow'), from: point, to: point }).strict(),
  region.extend({ kind: z.literal('ellipse') }).strict(),
  point.extend({ kind: z.literal('text') }).strict(),
  point.extend({ kind: z.literal('marker'), number: z.number().int().positive().max(999) }).strict(),
])
/** 标注颜色用命名色板，真实色值在 colorTokens 的 VIDEO_EDIT_ANNOTATION_COLORS；省略为 red。 */
export const VIDEO_EDIT_ANNOTATION_COLOR_NAMES = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'white', 'black'] as const
/** 线条粗细（重要记录 019 统一批注工具的“粗细”）：细 / 中 / 粗，省略为中。 */
export const VIDEO_EDIT_ANNOTATION_WEIGHTS = ['thin', 'regular', 'bold'] as const
export type VideoEditAnnotationWeight = typeof VIDEO_EDIT_ANNOTATION_WEIGHTS[number]
export const VIDEO_EDIT_ANNOTATION_WEIGHT_LABELS: Record<VideoEditAnnotationWeight, string> = { thin: '细', regular: '中', bold: '粗' }
export const videoEditAnnotationStyleSchema = z.object({ color: z.enum(VIDEO_EDIT_ANNOTATION_COLOR_NAMES), weight: z.enum(VIDEO_EDIT_ANNOTATION_WEIGHTS).optional().describe('线条粗细：thin 细、regular 中（省略即中）、bold 粗。') }).strict()
export type VideoEditAnnotationColor = typeof VIDEO_EDIT_ANNOTATION_COLOR_NAMES[number]
/** 颜色的中文名（参数条的色样与读屏名称用）。 */
export const VIDEO_EDIT_ANNOTATION_COLOR_LABELS: Record<VideoEditAnnotationColor, string> = { red: '红', orange: '橙', yellow: '黄', green: '绿', blue: '蓝', purple: '紫', white: '白', black: '黑' }
export const videoEditAnnotationAuthorSchema = z.object({ kind: z.enum(['user', 'assistant', 'external']), name: z.string().trim().min(1) }).strict()
export const videoEditAnnotationMessageSchema = z.object({ id: identifier, author: videoEditAnnotationAuthorSchema, createdAt: z.string().datetime(), text: z.string().trim().min(1) }).strict()
export const videoEditAnnotationSchema = z.object({
  id: identifier, clipId: identifier.optional(), frame, endFrame: frame.optional(),
  space: z.literal('composition-normalized'), target: videoEditAnnotationTargetSchema,
  text: z.string().trim().min(1), status: z.enum(['draft', 'open', 'addressed', 'resolved']),
  author: videoEditAnnotationAuthorSchema, createdAt: z.string().datetime(), thread: z.array(videoEditAnnotationMessageSchema),
  addressedBy: z.object({ transactionId: identifier.optional(), revision: z.number().int().nonnegative() }).strict().optional(),
  style: videoEditAnnotationStyleSchema.optional(),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string): void => { ctx.addIssue({ code: 'custom', message }) }
  if (value.endFrame !== undefined && value.endFrame < value.frame) issue('标注结束帧不能早于开始帧。')
  const target = value.target
  if (target.kind === 'range' && (target.startFrame !== value.frame || target.endFrame < target.startFrame || target.endFrame !== value.endFrame)) issue('时间段标注的定位帧、结束帧必须与目标范围一致（含两端）。')
  if (target.kind === 'element' && !value.clipId) issue('元素标注必须指定代码片段。')
  const box = target.kind === 'region' || target.kind === 'ellipse' ? target : target.kind === 'element' ? target.region : undefined
  if (box && (box.x + box.width > 1.000001 || box.y + box.height > 1.000001)) issue('标注区域必须在画幅内。')
  if (target.kind === 'arrow' && Math.hypot(target.to.x - target.from.x, target.to.y - target.from.y) < 0.002) issue('箭头起点和终点不能重合。')
  if (new Set(value.thread.map(message => message.id)).size !== value.thread.length) issue('标注回复不能有重复标识。')
  if (value.status === 'addressed' && (!value.addressedBy || !value.thread.length)) issue('待审查标注需要修改关联和处理回复。')
})
export type VideoEditAnnotation = z.infer<typeof videoEditAnnotationSchema>
export type VideoEditAnnotationTarget = z.infer<typeof videoEditAnnotationTargetSchema>
export type VideoEditAnnotationStyle = z.infer<typeof videoEditAnnotationStyleSchema>
export function videoEditAnnotationColor(mark: Pick<VideoEditAnnotation, 'style'>): VideoEditAnnotationColor { return mark.style?.color ?? 'red' }
export function videoEditAnnotationWeight(mark: Pick<VideoEditAnnotation, 'style'>): VideoEditAnnotationWeight { return mark.style?.weight ?? 'regular' }
/** 写进批注的样式：中等粗细不写出来，文件里只记偏离默认的值。 */
export function videoEditAnnotationStyle(color: VideoEditAnnotationColor, weight: VideoEditAnnotationWeight): NonNullable<VideoEditAnnotation['style']> { return { color, ...(weight === 'regular' ? {} : { weight }) } }
export const VIDEO_EDIT_ANNOTATION_STATUS_LABELS = { draft: '待发送', open: '待处理', addressed: '待审查', resolved: '已通过' } as const

/** Review is a user action. Neither the built-in assistant nor an external caller can approve it. */
export function assertVideoEditAnnotationTransition(before: VideoEditAnnotation | undefined, after: VideoEditAnnotation, source: 'user' | 'agent'): void {
  if (source === 'agent' && after.status === 'resolved') throw new Error('只有用户能审查通过标注；处理完成请写 addressed 并追加回复。')
  if (!before) {
    if (!['draft', 'open'].includes(after.status)) throw new Error('新标注只能是 draft 或 open。')
    return
  }
  const transitions = { draft: ['draft', 'open'], open: ['open', 'addressed'], addressed: ['addressed', 'resolved', 'open'], resolved: ['resolved', 'open'] }
  if (!transitions[before.status].includes(after.status)) throw new Error('标注状态转换无效；处理后待审查，用户可通过或重开。')
  if (source === 'agent' && (before.author.kind !== after.author.kind || before.author.name !== after.author.name || before.createdAt !== after.createdAt)) throw new Error('不能改写标注作者或创建时间。')
  if (source === 'agent' && (after.thread.length < before.thread.length || before.thread.some((message, index) => JSON.stringify(message) !== JSON.stringify(after.thread[index])))) throw new Error('回复只能追加，不能覆盖已有讨论。')
  if (source === 'agent' && before.status !== 'addressed' && after.status === 'addressed' && (after.thread.length <= before.thread.length || after.thread.at(-1)?.author.kind === 'user')) throw new Error('处理完成必须追加助手的处理回复。')
}

export function videoEditAnnotationAt(mark: VideoEditAnnotation, at: number): boolean { return mark.frame <= at && at <= (mark.endFrame ?? mark.frame) }
export function mapVideoEditAnnotationTime(mark: VideoEditAnnotation, convert: (value: number) => number): VideoEditAnnotation {
  const from = convert(mark.frame); const to = mark.endFrame === undefined ? undefined : convert(mark.endFrame)
  const frame = to === undefined ? from : Math.min(from, to); const endFrame = to === undefined ? undefined : Math.max(from, to)
  return { ...mark, frame, ...(endFrame === undefined ? {} : { endFrame }), target: mark.target.kind === 'range' ? { ...mark.target, startFrame: frame, endFrame: endFrame! } : mark.target }
}
/** 标注使用闭区间；内容范围使用半开区间。保留首末有效帧，整段位于空隙时丢弃。 */
export function clipVideoEditAnnotationTime(mark: VideoEditAnnotation, ranges: readonly { from: number; to: number }[]): VideoEditAnnotation | undefined {
  const intersections = ranges.map(range => ({ from: Math.max(mark.frame, range.from), to: Math.min(mark.endFrame ?? mark.frame, range.to - 1) })).filter(range => range.from <= range.to)
  if (!intersections.length) return undefined
  const from = Math.min(...intersections.map(range => range.from)); const to = Math.max(...intersections.map(range => range.to))
  return mapVideoEditAnnotationTime(mark, frame => Math.max(from, Math.min(to, frame)))
}
/** Keep the marked source moment when speed, direction, source trim or placement changes. */
export function retimeVideoEditAnnotation(mark: VideoEditAnnotation, before: VideoEditClip, after: VideoEditClip, fps: number): VideoEditAnnotation | undefined {
  const convert = (frame: number): number => {
    if (!videoEditClipSpeedSupported(before.kind)) return frame + after.start - before.start
    const source = videoEditClipSourceMidSecondsAt(before, frame, fps)
    // 源时刻在新片段里的连续位置（速度、方向与速度曲线都在 clipSpeed.ts 换算），取所在帧。
    return Math.round(videoEditClipFrameBoundaryAtSource(after, source, fps) - 0.5)
  }
  const mapped = mapVideoEditAnnotationTime(mark, convert)
  if ((mapped.endFrame ?? mapped.frame) < after.start || mapped.frame >= after.start + after.duration) return undefined
  return mapVideoEditAnnotationTime(mapped, frame => Math.max(after.start, Math.min(after.start + after.duration - 1, frame)))
}
export function videoEditAnnotationBounds(mark: VideoEditAnnotation): { x: number; y: number; width: number; height: number } | undefined {
  const target = mark.target
  if (target.kind === 'region' || target.kind === 'ellipse') return { x: target.x, y: target.y, width: target.width, height: target.height }
  if (target.kind === 'element') return target.region
  const points = target.kind === 'point' || target.kind === 'marker' ? [target] : target.kind === 'stroke' ? target.strokes.flat() : target.kind === 'arrow' ? [target.from, target.to]
    // 文字没有固定尺寸：按锚点向右下估一块常见说明的区域，裁切时把文字一起带上。
    : target.kind === 'text' ? [target, { x: Math.min(1, target.x + 0.22), y: Math.min(1, target.y + 0.06) }] : []
  if (!points.length) return undefined
  let x = 1; let y = 1; let right = 0; let bottom = 0
  for (const point of points) { x = Math.min(x, point.x); y = Math.min(y, point.y); right = Math.max(right, point.x); bottom = Math.max(bottom, point.y) }
  const padding = 0.025
  return { x: Math.max(0, x - padding), y: Math.max(0, y - padding), width: Math.min(1, right + padding) - Math.max(0, x - padding), height: Math.min(1, bottom + padding) - Math.max(0, y - padding) }
}
