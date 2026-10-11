import { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'
import { inverseAffine, mapAffine, type Affine } from '../imaging/transforms'
import { videoEditClipToFrame } from '../videoEdit/clipGeometry'
import { evaluateVideoEditKeyframes, videoEditClipCurvesSchema } from '../videoEdit/keyframes'
import { refKey, type Pose } from './contracts'
import { CreativeIntentError, type FramePose, type PreparedTake } from './sampling'

const finite = z.number().finite()
export const referenceTransformTrackSchema = z.object({
  ref: applicationRefSchema, identity: z.string().min(1),
  samples: z.array(z.object({ frame: finite.nonnegative(), matrix: z.tuple([finite, finite, finite, finite, finite, finite]) }).strict()).min(1).optional(),
  native: z.object({ start: finite.int().nonnegative(), end: finite.int().nonnegative(),
    base: z.object({ x: finite, y: finite, scale: finite.positive(), rotation: finite, anchorX: finite, anchorY: finite }).strict(),
    curves: videoEditClipCurvesSchema.optional(), pictureSize: z.tuple([finite.positive(), finite.positive()]), compositionSize: z.tuple([finite.positive(), finite.positive()]),
  }).strict().optional(),
}).strict().refine(v => Boolean(v.samples) !== Boolean(v.native), '参照须提供采样或正式运动曲线之一')
export type ReferenceTransformTrack = z.infer<typeof referenceTransformTrackSchema>
export interface RelativeMotionInput { recorded: ReferenceTransformTrack; current: ReferenceTransformTrack; mode: 'local' | 'composition'; targetRef: z.infer<typeof applicationRefSchema> }

/** Host supplies formally evaluated samples; no tracker, source-time conversion or parent mutation here. */
export function referenceTransformEvaluator(track: ReferenceTransformTrack): (frame: number) => Affine {
  const parsed = referenceTransformTrackSchema.parse(track)
  if (parsed.native) {
    const native = parsed.native
    return frame => {
      if (frame < native.start || frame > native.end) throw new CreativeIntentError('reference-gap', [track.ref.id], '参照片段未覆盖整段示范，请延长参照或缩短示范')
      const value = (key: keyof typeof native.base): number => evaluateVideoEditKeyframes(native.curves?.[key], frame - native.start, native.base[key])
      const placement = { x: value('x'), y: value('y'), scale: value('scale'), rotation: value('rotation'), anchorX: value('anchorX'), anchorY: value('anchorY') }
      const picture = { width: native.pictureSize[0], height: native.pictureSize[1] }; const size = { width: native.compositionSize[0], height: native.compositionSize[1] }
      const origin = videoEditClipToFrame(placement, picture, size, 0, 0); const x = videoEditClipToFrame(placement, picture, size, 1, 0); const y = videoEditClipToFrame(placement, picture, size, 0, 1)
      const matrix: Affine = [x.x - origin.x, x.y - origin.y, y.x - origin.x, y.y - origin.y, origin.x, origin.y]
      try { inverseAffine(matrix, 0) } catch { throw new CreativeIntentError('reference-singular', [track.ref.id], '参照变换不可逆，请恢复参照的尺寸后重试') }
      return matrix
    }
  }
  const samples = parsed.samples!
  samples.forEach((s, i) => {
    try { inverseAffine(s.matrix, 0) } catch { throw new CreativeIntentError('reference-singular', [track.ref.id], '参照变换不可逆，请恢复参照的尺寸后重试') }
    if (i && s.frame <= samples[i - 1].frame) throw new CreativeIntentError('reference-time', [track.ref.id], '参照采样时间必须严格递增')
  })
  return frame => {
    let low = 0; let high = samples.length - 1
    while (low < high) { const mid = (low + high) >>> 1; if (samples[mid].frame < frame) low = mid + 1; else high = mid }
    const sample = samples[low]
    if (sample.frame !== frame) throw new CreativeIntentError('reference-gap', [track.ref.id], '参照缺少该时刻的正式画面，请重新整理')
    return sample.matrix
  }
}

export function interpolateMotionPose(points: readonly FramePose[], frame: number): Pose {
  let low = 0; let high = points.length - 1
  while (low < high) { const mid = (low + high) >>> 1; if (points[mid].frame < frame) low = mid + 1; else high = mid }
  const b = points[low]; const a = points[Math.max(0, low - 1)]
  const u = b.frame === a.frame ? 0 : Math.max(0, Math.min(1, (frame - a.frame) / (b.frame - a.frame)))
  const mix = (x: number, y: number): number => x + (y - x) * u
  return { position: [mix(a.pose.position[0], b.pose.position[0]), mix(a.pose.position[1], b.pose.position[1])], rotationTurns: mix(a.pose.rotationTurns, b.pose.rotationTurns), scaleXY: [mix(a.pose.scaleXY[0], b.pose.scaleXY[0]), mix(a.pose.scaleXY[1], b.pose.scaleXY[1])], pivot: [mix(a.pose.pivot[0], b.pose.pivot[0]), mix(a.pose.pivot[1], b.pose.pivot[1])] }
}

/** Bake only positional following; rotation/scale of the target stay authored and parents stay untouched. */
export function relativeMotionEvaluator(take: PreparedTake, input: RelativeMotionInput): (frame: number) => Pose {
  if (refKey(input.targetRef) !== refKey(take.target.ref) || refKey(input.current.ref) !== refKey(input.recorded.ref) || refKey(input.targetRef) === refKey(input.current.ref)) throw new CreativeIntentError('reference-cycle', [input.current.ref.id], '参照须是同一已确认元素，且不能跟随自身')
  if (!take.target.editable.includes('position')) throw new CreativeIntentError('reference-property', [take.takeId], '请先示范位置，再整理相对运动')
  const recorded = referenceTransformEvaluator(input.recorded); const current = referenceTransformEvaluator(input.current)
  const local = take.points.map(point => {
    const matrix = recorded(point.frame)
    const position = input.mode === 'local' ? mapAffine(inverseAffine(matrix, 0), point.pose.position) : [point.pose.position[0] - matrix[4], point.pose.position[1] - matrix[5]]
    return { ...point, pose: { ...point.pose, position: [position[0], position[1]] as [number, number] } }
  })
  return frame => {
    const pose = interpolateMotionPose(local, frame); const matrix = current(frame)
    const position = input.mode === 'local' ? mapAffine(matrix, pose.position) : [pose.position[0] + matrix[4], pose.position[1] + matrix[5]]
    return { ...pose, position: [position[0], position[1]] }
  }
}
