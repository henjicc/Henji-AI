import { z } from 'zod'
import { Quaternion, Vector3 } from 'three'
import { clockEventIssue, clockSegmentsSchema, dualClockSchema, finiteSchema, refKey, sameCandidateInput, type CandidateIdentity, type ClockSegment, type Timeline } from './contracts'
import { checkCancelled, CreativeIntentError, type ComputationControl } from './sampling'

const vector3Schema = z.object({ x: finiteSchema, y: finiteSchema, z: finiteSchema }).strict()
/** World-space position/target, unit quaternion, vertical field of view in degrees. Never a 2D clip pose. */
export const cameraPose3DSchema = z.object({
  position: vector3Schema,
  target: vector3Schema,
  orientation: z.tuple([finiteSchema, finiteSchema, finiteSchema, finiteSchema]),
  fovDegrees: finiteSchema.gt(0).lt(180),
}).strict().superRefine((pose, ctx) => {
  if (Math.abs(Math.hypot(...pose.orientation) - 1) > 1e-6) ctx.addIssue({ code: 'custom', message: '朝向必须为单位四元数' })
  if (new Vector3().copy(pose.position).distanceTo(pose.target) < 1e-6) ctx.addIssue({ code: 'custom', message: '机位不能与注视点重合' })
})
export type CameraPose3D = z.infer<typeof cameraPose3DSchema>
export interface CameraAnchor3D { id: string; frame: number; pose: CameraPose3D }
export interface CameraRecordingSample3D {
  id: string; seq: number; monoUs: number; timeline: Timeline | null; clockSegmentRef: string
  unavailableReason?: 'static' | 'missing-presentation' | 'gap' | 'unfocused' | 'outside' | 'singular'
  intent: 'navigate' | 'demonstrate'; confirmed: boolean; pose: CameraPose3D
}

/** Split visits, clock gaps and direction changes before sorting by work time; wall time never creates a dwell. */
export function prepareCameraRecording(
  samples: readonly CameraRecordingSample3D[], clocks: readonly ClockSegment[], control: ComputationControl = {},
): CameraAnchor3D[][] {
  clockSegmentsSchema.parse(clocks)
  const segments = new Map(clocks.map(segment => [segment.id, segment]))
  const ids = new Set<string>()
  const result: CameraAnchor3D[][] = []
  let current: CameraAnchor3D[] = []; let direction = 0; let previous: CameraRecordingSample3D | undefined
  const flush = (): void => { if (current.length) result.push(current.sort((a, b) => a.frame - b.frame)); current = []; direction = 0 }
  for (const sample of samples) {
    checkCancelled(control)
    dualClockSchema.parse({ seq: sample.seq, monoUs: sample.monoUs, timeline: sample.timeline, clockSegmentRef: sample.clockSegmentRef, ...(sample.unavailableReason ? { unavailableReason: sample.unavailableReason } : {}) })
    const issue = clockEventIssue(sample, segments)
    if (issue || !sample.id || ids.has(sample.id) || previous && (sample.seq <= previous.seq || sample.monoUs < previous.monoUs)) throw new CreativeIntentError('camera-clock', [sample.id], issue ?? '录制身份或墙钟顺序无效')
    ids.add(sample.id)
    const prior = previous; previous = sample
    if (!sample.confirmed || sample.intent !== 'demonstrate' || !sample.timeline) { flush(); continue }
    cameraPose3DSchema.parse(sample.pose)
    if (prior?.timeline && (prior.timeline.visitRef !== sample.timeline.visitRef || refKey(prior.timeline.sequenceRef) !== refKey(sample.timeline.sequenceRef) || prior.clockSegmentRef !== sample.clockSegmentRef)) flush()
    const last = current[current.length - 1]
    const nextDirection = last ? Math.sign(sample.timeline.frame - last.frame) : 0
    if (nextDirection && direction && nextDirection !== direction) {
      flush()
      // The turn belongs to both adjacent takes; omitting it would erase the first leg after reversal.
      current.push(last)
    }
    if (nextDirection) direction = nextDirection
    const anchor = { id: sample.id, frame: sample.timeline.frame, pose: structuredClone(sample.pose) }
    // Revisited poses in a held frame are alternatives, never silently last-write-wins.
    if (current.some(point => point.frame === anchor.frame)) flush()
    current.push(anchor)
  }
  flush()
  return result
}

export function cameraPoseError(a: CameraPose3D, b: CameraPose3D, sceneScale: number): { positionRatio: number; targetRatio: number; angleDegrees: number; fovDegrees: number } {
  if (!Number.isFinite(sceneScale) || sceneScale <= 0) throw new CreativeIntentError('camera-scale', [], '请提供正的场景参考尺度')
  return {
    positionRatio: new Vector3().copy(a.position).distanceTo(b.position) / sceneScale,
    targetRatio: new Vector3().copy(a.target).distanceTo(b.target) / sceneScale,
    angleDegrees: new Quaternion(...a.orientation).angleTo(new Quaternion(...b.orientation)) * 180 / Math.PI,
    fovDegrees: Math.abs(a.fovDegrees - b.fovDegrees),
  }
}

export type CameraCandidateFamily = 'smooth' | 'orbit' | 'dolly-hold'
export interface CameraCandidate3D<Native> { id: CameraCandidateFamily; label: string; identity: CandidateIdentity; native: Native }
export interface CameraCandidateInput3D { identity: CandidateIdentity; anchors: readonly CameraAnchor3D[]; pinnedIds: readonly string[]; sceneScale: number }
export interface CameraCandidateAdapter3D<Native> {
  compile: (family: CameraCandidateFamily, anchors: readonly CameraAnchor3D[]) => Native
  evaluate: (native: Native, frame: number) => CameraPose3D
}
const families: { id: CameraCandidateFamily; label: string }[] = [
  { id: 'smooth', label: '平滑推拉' }, { id: 'orbit', label: '环绕' }, { id: 'dolly-hold', label: '带停顿的推近' },
]

/** Native compilation/evaluation is supplied by the host; this layer owns time, locks and candidate orchestration. */
export function createCameraCandidates<Native>(input: CameraCandidateInput3D, adapter: CameraCandidateAdapter3D<Native>, control: ComputationControl = {}): {
  candidates: CameraCandidate3D<Native>[]; unavailable: { family: CameraCandidateFamily; code: string; refs: readonly string[]; message: string }[]
} {
  if (input.anchors.length < 2) throw new CreativeIntentError('camera-anchors', [], '至少摆放两个不同时刻的机位')
  const ids = new Set<string>()
  for (const [index, anchor] of input.anchors.entries()) {
    checkCancelled(control); cameraPose3DSchema.parse(anchor.pose)
    // Quarter-frame validation must remain exactly representable in JavaScript numbers.
    if (!Number.isSafeInteger(anchor.frame * 4) || !Number.isInteger(anchor.frame) || anchor.frame < 0 || !anchor.id || ids.has(anchor.id) || index > 0 && anchor.frame <= input.anchors[index - 1].frame) throw new CreativeIntentError('camera-time', [anchor.id], '机位必须有唯一身份，并按可精确表示的正式帧升序；重访请先选择一段示范')
    ids.add(anchor.id)
  }
  cameraPoseError(input.anchors[0].pose, input.anchors[0].pose, input.sceneScale)
  for (const id of input.pinnedIds) if (!ids.has(id)) throw new CreativeIntentError('camera-pin', [id], '钉住的机位已不存在')
  const candidates: CameraCandidate3D<Native>[] = []; const unavailable: { family: CameraCandidateFamily; code: string; refs: readonly string[]; message: string }[] = []
  for (const family of families) {
    checkCancelled(control)
    try {
      const native = adapter.compile(family.id, structuredClone(input.anchors))
      const evaluate = (frame: number): CameraPose3D => {
        const parsed = cameraPose3DSchema.safeParse(adapter.evaluate(native, frame))
        if (!parsed.success) throw new CreativeIntentError('camera-unrepresentable', [], '路径经过无效机位、退化视线或无效焦距，请调整机位')
        return parsed.data
      }
      for (const anchor of input.anchors) {
        checkCancelled(control)
        const actual = evaluate(anchor.frame)
        if (input.pinnedIds.includes(anchor.id)) {
          const error = cameraPoseError(anchor.pose, actual, input.sceneScale)
          if (error.positionRatio > 1e-10 || error.targetRatio > 1e-10 || error.angleDegrees > 1e-5 || error.fovDegrees > 1e-10) throw new CreativeIntentError('camera-pin-conflict', [anchor.id], '候选会改变钉住的机位、视线或焦距，请调整候选或解钉')
        }
      }
      // Endpoints alone miss a degenerate sightline on a push-through. Use the native evaluator at subframes too.
      for (let frame = input.anchors[0].frame; frame <= input.anchors[input.anchors.length - 1].frame; frame += .25) {
        checkCancelled(control); evaluate(frame)
      }
      candidates.push({ ...family, identity: structuredClone(input.identity), native })
    } catch (error) {
      if (!(error instanceof CreativeIntentError) || error.code === 'cancelled') throw error
      unavailable.push({ family: family.id, code: error.code, refs: error.refs, message: error.message })
    }
  }
  return { candidates, unavailable }
}

export function assertCameraCandidateCurrent(candidate: { identity: CandidateIdentity }, identity: CandidateIdentity): void {
  if (!sameCandidateInput(candidate.identity, identity)) throw new CreativeIntentError('stale-candidate', [], '场景或机位已变化，请重新整理')
}
