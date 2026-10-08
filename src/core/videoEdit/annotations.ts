import { z } from 'zod'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from './time'
import { videoEditSourceSeconds } from './time'
import { videoEditClipSourceMidSecondsAt, videoEditClipSpeedSupported, videoEditClipSpeedValue } from './clipSpeed'
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
])
export const videoEditAnnotationAuthorSchema = z.object({ kind: z.enum(['user', 'assistant', 'external']), name: z.string().trim().min(1) }).strict()
export const videoEditAnnotationMessageSchema = z.object({ id: identifier, author: videoEditAnnotationAuthorSchema, createdAt: z.string().datetime(), text: z.string().trim().min(1) }).strict()
export const videoEditAnnotationSchema = z.object({
  id: identifier, clipId: identifier.optional(), frame, endFrame: frame.optional(),
  space: z.literal('composition-normalized'), target: videoEditAnnotationTargetSchema,
  text: z.string().trim().min(1), status: z.enum(['draft', 'open', 'addressed', 'resolved']),
  author: videoEditAnnotationAuthorSchema, createdAt: z.string().datetime(), thread: z.array(videoEditAnnotationMessageSchema),
  addressedBy: z.object({ transactionId: identifier.optional(), revision: z.number().int().nonnegative() }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string): void => { ctx.addIssue({ code: 'custom', message }) }
  if (value.endFrame !== undefined && value.endFrame < value.frame) issue('标注结束帧不能早于开始帧。')
  const target = value.target
  if (target.kind === 'range' && (target.startFrame !== value.frame || target.endFrame < target.startFrame || target.endFrame !== value.endFrame)) issue('时间段标注的定位帧、结束帧必须与目标范围一致（含两端）。')
  if (target.kind === 'element' && !value.clipId) issue('元素标注必须指定代码片段。')
  const box = target.kind === 'region' ? target : target.kind === 'element' ? target.region : undefined
  if (box && (box.x + box.width > 1.000001 || box.y + box.height > 1.000001)) issue('标注区域必须在画幅内。')
  if (new Set(value.thread.map(message => message.id)).size !== value.thread.length) issue('标注回复不能有重复标识。')
  if (value.status === 'addressed' && (!value.addressedBy || !value.thread.length)) issue('待审查标注需要修改关联和处理回复。')
})
export type VideoEditAnnotation = z.infer<typeof videoEditAnnotationSchema>
export type VideoEditAnnotationTarget = z.infer<typeof videoEditAnnotationTargetSchema>
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
/** Keep the marked source moment when speed, direction, source trim or placement changes. */
export function retimeVideoEditAnnotation(mark: VideoEditAnnotation, before: VideoEditClip, after: VideoEditClip, fps: number): VideoEditAnnotation | undefined {
  const convert = (frame: number): number => {
    if (!videoEditClipSpeedSupported(before.kind)) return frame + after.start - before.start
    const source = videoEditClipSourceMidSecondsAt(before, frame, fps)
    const offset = (source - videoEditSourceSeconds(after)) / (videoEditClipSpeedValue(after) / fps) * (after.reverse ? -1 : 1) - 0.5
    return after.start + Math.round(offset)
  }
  const mapped = mapVideoEditAnnotationTime(mark, convert)
  if ((mapped.endFrame ?? mapped.frame) < after.start || mapped.frame >= after.start + after.duration) return undefined
  return mapVideoEditAnnotationTime(mapped, frame => Math.max(after.start, Math.min(after.start + after.duration - 1, frame)))
}
export function videoEditAnnotationBounds(mark: VideoEditAnnotation): { x: number; y: number; width: number; height: number } | undefined {
  const target = mark.target
  if (target.kind === 'region') return target
  if (target.kind === 'element') return target.region
  const points = target.kind === 'point' ? [target] : target.kind === 'stroke' ? target.strokes.flat() : []
  if (!points.length) return undefined
  let x = 1; let y = 1; let right = 0; let bottom = 0
  for (const point of points) { x = Math.min(x, point.x); y = Math.min(y, point.y); right = Math.max(right, point.x); bottom = Math.max(bottom, point.y) }
  const padding = 0.025
  return { x: Math.max(0, x - padding), y: Math.max(0, y - padding), width: Math.min(1, right + padding) - Math.max(0, x - padding), height: Math.min(1, bottom + padding) - Math.max(0, y - padding) }
}
