import { z } from 'zod'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from './time'
import { videoEditAnnotationSchema, videoEditAnnotationAuthorSchema, type VideoEditAnnotation } from './annotations'

const frame = z.number().int().nonnegative().max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES)
export const videoEditAnnotationStatusSchema = videoEditAnnotationSchema.shape.status
export type VideoEditAnnotationStatus = z.infer<typeof videoEditAnnotationStatusSchema>
export type VideoEditAnnotationAuthorKind = z.infer<typeof videoEditAnnotationAuthorSchema>['kind']

/** “已处理”是审片结论已经落定的批注；待发送与待处理仍在等人或等助手，清理时不能碰。 */
export const VIDEO_EDIT_ANNOTATION_HANDLED_STATUSES = ['addressed', 'resolved'] as const satisfies readonly VideoEditAnnotationStatus[]

/** 时间段与批注一样是闭区间：两端帧都算在内。 */
export const videoEditAnnotationFrameRangeSchema = z.object({ fromFrame: frame, toFrame: frame }).strict().refine(value => value.toFrame >= value.fromFrame, '时间段不能倒置：toFrame 要不小于 fromFrame。')

export interface VideoEditAnnotationFilter {
  statuses?: readonly VideoEditAnnotationStatus[]
  authorKinds?: readonly VideoEditAnnotationAuthorKind[]
  range?: { fromFrame: number; toFrame: number }
  clipIds?: readonly string[]
}

/** 片段既可能是批注的所属片段，也可能写在时间段目标的 clipIds 里，两处都算挂在这个片段上。 */
function annotationClipIds(mark: VideoEditAnnotation): string[] {
  return [...(mark.clipId ? [mark.clipId] : []), ...(mark.target.kind === 'range' ? mark.target.clipIds ?? [] : [])]
}

/** 各条件之间是“且”；同一条件里列多个值是“或”；没给的条件不限制。 */
export function matchesVideoEditAnnotationFilter(mark: VideoEditAnnotation, filter: VideoEditAnnotationFilter): boolean {
  if (filter.statuses?.length && !filter.statuses.includes(mark.status)) return false
  if (filter.authorKinds?.length && !filter.authorKinds.includes(mark.author.kind)) return false
  if (filter.range && (mark.frame > filter.range.toFrame || (mark.endFrame ?? mark.frame) < filter.range.fromFrame)) return false
  if (filter.clipIds?.length && !annotationClipIds(mark).some(id => filter.clipIds!.includes(id))) return false
  return true
}

export function filterVideoEditAnnotations(marks: readonly VideoEditAnnotation[], filter: VideoEditAnnotationFilter): VideoEditAnnotation[] {
  return marks.filter(mark => matchesVideoEditAnnotationFilter(mark, filter))
}
