import { z } from 'zod'
import { inverseAffine, mapAffine, type Affine, type Point } from '../imaging/transforms'
import { applicationRefSchema } from '../application-control/identifiers'
import { refKey, type Pose } from './contracts'
import { CreativeIntentError, type PreparedTake } from './sampling'

const point = z.tuple([z.number().finite(), z.number().finite()])
const span = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).refine(v => v[1] >= v[0], '标注时间倒置')
/** Evidence is a projection of an explicitly assigned role, never a replacement artwork. */
export const intentAnnotationSchema = z.object({
  sourceRef: applicationRefSchema, sourceIdentity: z.string().min(1), geometryIdentity: z.string().min(1),
  targetRefs: z.array(applicationRefSchema), span: span.nullable(), text: z.string(),
  geometry: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('path'), points: z.array(point).min(2) }).strict(),
    z.object({ kind: z.literal('region'), outline: z.array(point).min(3), role: z.enum(['target', 'dwell']) }).strict(),
    z.object({ kind: z.literal('text'), at: point }).strict(),
  ]),
}).strict()
export type IntentAnnotation = z.infer<typeof intentAnnotationSchema>

export function transformAnnotationPoints(points: readonly Point[], transform: Affine): [number, number][] {
  // Normalization by a large output canvas legitimately makes the determinant tiny.
  inverseAffine(transform, 0)
  return points.map(p => [...mapAffine(transform, p)] as [number, number])
}

/** Includes the boundary; returns every contained target, without guessing a winner. */
export function annotationContains(outline: readonly Point[], p: Point): boolean {
  let inside = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j]; const b = outline[i]
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])
    if (Math.abs(cross) < 1e-12 && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1])) return true
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}

export function assertAnnotationsCurrent(before: readonly IntentAnnotation[], after: readonly IntentAnnotation[]): void {
  for (const mark of before) {
    const current = after.find(a => refKey(a.sourceRef) === refKey(mark.sourceRef))
    if (!current || JSON.stringify(mark) !== JSON.stringify(current)) throw new CreativeIntentError('annotation-stale', [mark.sourceRef.id], '标注已删除、修改或画幅已改变，请重新选择标注并整理')
  }
}

/** Explicit paths and regions constrain only their authored timeline span. Text stays evidence. */
export function annotationPoseEvaluator(take: PreparedTake, annotations: readonly IntentAnnotation[]): ((frame: number, pose: Pose) => Pose) | undefined {
  const relevant = annotations.map(a => intentAnnotationSchema.parse(a)).filter(a => a.targetRefs.some(r => refKey(r) === refKey(take.target.ref)) && a.geometry.kind !== 'text')
  if (!relevant.length) return undefined
  if (!take.target.editable.includes('position')) throw new CreativeIntentError('annotation-property', [take.takeId], '目标未允许修改位置，请先确认位置动作')
  const first = take.points[0].frame; const last = take.points.at(-1)!.frame
  for (const mark of relevant) if (!mark.span || mark.span[0] < first || mark.span[1] > last || mark.geometry.kind === 'path' && mark.span[0] === mark.span[1]) throw new CreativeIntentError('annotation-time', [mark.sourceRef.id], '请为标注选择示范内的动作起止时间；单帧箭头不能推断时长')
  return (frame, pose) => {
    let position: [number, number] | undefined
    for (const mark of relevant) {
      const [start, end] = mark.span!
      if (frame < start || frame > end || mark.geometry.kind === 'text') continue
      const geometry = mark.geometry
      let next: [number, number]
      if (geometry.kind === 'path') {
        const lengths = geometry.points.slice(1).map((p, i) => Math.hypot(p[0] - geometry.points[i][0], p[1] - geometry.points[i][1]))
        const total = lengths.reduce((a, b) => a + b, 0)
        if (total <= 1e-12) throw new CreativeIntentError('annotation-path', [mark.sourceRef.id], '箭头起点和终点重合，请重新画出方向')
        let distance = (frame - start) / (end - start) * total; let index = 0
        while (index < lengths.length - 1 && distance > lengths[index]) distance -= lengths[index++]
        const u = lengths[index] ? distance / lengths[index] : 0; const a = geometry.points[index]; const b = geometry.points[index + 1]
        next = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
      } else {
        if (geometry.role === 'target' && frame !== end) continue
        const center = geometry.outline.reduce<[number, number]>((sum, p) => [sum[0] + p[0] / geometry.outline.length, sum[1] + p[1] / geometry.outline.length], [0, 0])
        if (!annotationContains(geometry.outline, center)) throw new CreativeIntentError('annotation-region', [mark.sourceRef.id], '区域形状不明确，请重新圈定目标')
        next = geometry.role === 'target' && annotationContains(geometry.outline, pose.position) ? pose.position : center
      }
      if (position && Math.hypot(position[0] - next[0], position[1] - next[1]) > 1e-10) throw new CreativeIntentError('annotation-conflict', relevant.map(a => a.sourceRef.id), '同一时间的标注要求互相冲突，请调整时间或角色')
      position = next
    }
    return position ? { ...pose, position } : pose
  }
}
