import { z } from 'zod'
import { mapAffine, scaleAffineAtAnchor } from '../imaging/transforms'
import { finiteSchema, pointSchema, poseSchema, type Pose } from './contracts'

const scales = z.tuple([finiteSchema.positive(), finiteSchema.positive()])
/** P1 explicit intent only. No implicit bounce, loop, hover or speech execution. */
export const motionIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('follow_path'), preserveJitter: z.boolean() }).strict(),
  z.object({ kind: z.literal('move_line'), from: pointSchema, to: pointSchema }).strict(),
  z.object({ kind: z.literal('overshoot'), from: pointSchema, to: pointSchema, amountRatio: finiteSchema.positive(), settleFraction: finiteSchema.min(.001).max(.999) }).strict(),
  z.object({ kind: z.literal('spring_settle'), from: pointSchema, to: pointSchema, damping: finiteSchema.nonnegative(), cycles: finiteSchema.positive() }).strict(),
  z.object({ kind: z.literal('dwell'), pose: poseSchema }).strict(),
  z.object({ kind: z.literal('scale_focus'), focus: pointSchema, fromScaleXY: scales, toScaleXY: scales, timingBlend: finiteSchema.min(0).max(1).optional() }).strict(),
])
export type MotionIntent = z.infer<typeof motionIntentSchema>
const h = (x: number): number => x * x * (3 - 2 * x)

/** Compile-time intent function, never a playback evaluator. The native curves remain the only runtime. */
export function intentPose(intent: MotionIntent, base: Pose, progress: number): Pose {
  const t = Math.max(0, Math.min(1, progress)); const pose = structuredClone(base)
  if (intent.kind === 'follow_path') return pose
  if (intent.kind === 'dwell') return structuredClone(intent.pose)
  if (intent.kind === 'scale_focus') {
    const s: [number, number] = [0, 0]
    const progress = h(t) * (1 - (intent.timingBlend ?? 0)) + t * (intent.timingBlend ?? 0)
    for (const axis of [0, 1] as const) { s[axis] = intent.fromScaleXY[axis] + (intent.toScaleXY[axis] - intent.fromScaleXY[axis]) * progress; pose.scaleXY[axis] = s[axis] }
    pose.position = [...mapAffine(scaleAffineAtAnchor([1, 0, 0, 1, 0, 0], intent.focus, [s[0] / intent.fromScaleXY[0], s[1] / intent.fromScaleXY[1]]), base.position)]
    return pose
  }
  let u = t
  if (intent.kind === 'overshoot') u = t <= intent.settleFraction ? (1 + intent.amountRatio) * h(t / intent.settleFraction) : 1 + intent.amountRatio * (1 - h((t - intent.settleFraction) / (1 - intent.settleFraction)))
  if (intent.kind === 'spring_settle') {
    // Finite damped motion with exact settled endpoint; enough compiler samples are required by cycles.
    const raw = (x: number): number => 1 - Math.exp(-intent.damping * x) * Math.cos(2 * Math.PI * intent.cycles * x)
    // Endpoint correction retains oscillations even when damping=0 and raw(1)=0.
    u = raw(t) + (1 - raw(1)) * h(t)
  }
  pose.position = [intent.from[0] + (intent.to[0] - intent.from[0]) * u, intent.from[1] + (intent.to[1] - intent.from[1]) * u]
  return pose
}
