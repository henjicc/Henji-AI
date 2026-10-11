import { z } from 'zod'
import { mapAffine, scaleAffineAtAnchor } from '../imaging/transforms'
import { interpolateVideoEditKeyframe, videoEditBezierSchema } from '../videoEdit/keyframeInterpolation'
import { finiteSchema, pointSchema, poseSchema, type Pose } from './contracts'

const scales = z.tuple([finiteSchema.positive(), finiteSchema.positive()])
export const motionTimingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('linear') }).strict(),
  z.object({ kind: z.literal('bezier'), bezier: videoEditBezierSchema }).strict(),
])
export const primitiveIntentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('follow_path'), preserveJitter: z.boolean(), timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('move_line'), from: pointSchema, to: pointSchema, timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('move_arc'), from: pointSchema, to: pointSchema, bendRatio: finiteSchema, timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('orbit'), center: pointSchema, radiusXY: scales, startTurns: finiteSchema, sweepTurns: finiteSchema.refine(v => v !== 0), timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('overshoot'), from: pointSchema, to: pointSchema, amountRatio: finiteSchema.positive(), settleFraction: finiteSchema.min(.001).max(.999), timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('bounce'), from: pointSchema, to: pointSchema, heightRatio: finiteSchema.positive(), count: z.number().int().positive(), decay: finiteSchema.min(0).max(1), timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('spring_settle'), from: pointSchema, to: pointSchema, damping: finiteSchema.nonnegative(), cycles: finiteSchema.positive(), timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('swing'), pivot: pointSchema, amplitudeTurns: finiteSchema.positive(), cycles: finiteSchema.positive(), decay: finiteSchema.min(0).max(1), timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('pulse'), baseScaleXY: scales, amountRatio: finiteSchema.positive(), cycles: finiteSchema.positive(), timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('spin'), pivot: pointSchema, startTurns: finiteSchema, sweepTurns: finiteSchema.refine(v => v !== 0), timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('sway'), center: pointSchema, axis: pointSchema.refine(v => Math.hypot(...v) > 0), amplitudeRatio: finiteSchema.positive(), cycles: finiteSchema.positive(), timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('zigzag'), from: pointSchema, to: pointSchema, amplitudeRatio: finiteSchema.positive(), count: z.number().int().positive(), timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('scale_focus'), focus: pointSchema, fromScaleXY: scales, toScaleXY: scales, timingBlend: finiteSchema.min(0).max(1).optional(), timing: motionTimingSchema.optional() }).strict(),
  z.object({ kind: z.literal('dwell'), pose: poseSchema, timing: motionTimingSchema.optional() }).strict(),
])
export type PrimitiveIntent = z.infer<typeof primitiveIntentSchema>
/** Nonrecursive finite composition; period is a frame-grid constraint, not a product limit. */
export const cycleIntentSchema = z.object({
  kind: z.literal('cycle'), template: primitiveIntentSchema, mode: z.enum(['loop', 'pingpong']), periodFrames: z.number().int().positive(),
}).strict().refine(v => v.template.kind !== 'follow_path', '循环模板必须是明确动作')
export const motionIntentSchema = z.union([primitiveIntentSchema, cycleIntentSchema])
export type MotionIntent = z.infer<typeof motionIntentSchema>
export const MOTION_PRIMITIVE_LABELS: Record<PrimitiveIntent['kind'], string> = {
  follow_path: '保留示范路径', move_line: '直线移动', move_arc: '弧线移动', orbit: '沿椭圆环绕',
  overshoot: '轻微过冲回落', bounce: '逐次弹跳', spring_settle: '有弹性地回落', swing: '绕支点摆动',
  pulse: '缩放脉冲', spin: '连续旋转', sway: '往复漂浮', zigzag: '折线前进', scale_focus: '保持焦点推近', dwell: '保持指定停顿',
}
const h = (x: number): number => x * x * (3 - 2 * x)
const tau = 2 * Math.PI
/** Space C(u) and time u(t) are separate; only the compiler consumes this analytic reference. */
export function intentPose(intent: MotionIntent, base: Pose, progress: number, durationFrames = 1): Pose {
  let t = Math.max(0, Math.min(1, progress))
  if (intent.kind === 'cycle') {
    const phase = t * durationFrames / intent.periodFrames
    let u = phase - Math.floor(phase)
    if (intent.mode === 'pingpong') u = h(u <= .5 ? u * 2 : 2 - u * 2)
    return intentPose(intent.template, base, u)
  }
  if (intent.timing) t = Number(interpolateVideoEditKeyframe(0, 1, t, intent.timing.kind === 'linear' ? 'linear' : 'bezier', [0, 1], intent.timing.kind === 'bezier' ? intent.timing.bezier : undefined))
  const pose = structuredClone(base)
  if (intent.kind === 'follow_path') return pose
  if (intent.kind === 'dwell') return structuredClone(intent.pose)
  if (intent.kind === 'scale_focus') {
    const progress = intent.timing ? t : h(t) * (1 - (intent.timingBlend ?? 0)) + t * (intent.timingBlend ?? 0)
    for (const axis of [0, 1] as const) pose.scaleXY[axis] = intent.fromScaleXY[axis] + (intent.toScaleXY[axis] - intent.fromScaleXY[axis]) * progress
    pose.position = [...mapAffine(scaleAffineAtAnchor([1, 0, 0, 1, 0, 0], intent.focus, [pose.scaleXY[0] / intent.fromScaleXY[0], pose.scaleXY[1] / intent.fromScaleXY[1]]), base.position)]
    return pose
  }
  if (intent.kind === 'orbit') {
    const a = tau * (intent.startTurns + intent.sweepTurns * t)
    pose.position = [intent.center[0] + intent.radiusXY[0] * Math.cos(a), intent.center[1] + intent.radiusXY[1] * Math.sin(a)]
    return pose
  }
  if (intent.kind === 'spin' || intent.kind === 'swing') {
    pose.pivot = [...intent.pivot]
    pose.rotationTurns = intent.kind === 'spin' ? intent.startTurns + intent.sweepTurns * t : base.rotationTurns + intent.amplitudeTurns * Math.sin(tau * intent.cycles * t) * Math.pow(intent.decay, t)
    return pose
  }
  if (intent.kind === 'pulse') {
    pose.scaleXY = intent.baseScaleXY.map(s => s * (1 + intent.amountRatio * (1 - Math.cos(tau * intent.cycles * t)) / 2)) as [number, number]
    return pose
  }
  if (intent.kind === 'sway') {
    const norm = Math.hypot(...intent.axis); const amount = intent.amplitudeRatio * Math.sin(tau * intent.cycles * t)
    pose.position = [intent.center[0] + amount * intent.axis[0] / norm, intent.center[1] + amount * intent.axis[1] / norm]
    return pose
  }
  let u = t
  if (intent.kind === 'overshoot') u = t <= intent.settleFraction ? (1 + intent.amountRatio) * h(t / intent.settleFraction) : 1 + intent.amountRatio * (1 - h((t - intent.settleFraction) / (1 - intent.settleFraction)))
  if (intent.kind === 'spring_settle') {
    const raw = (x: number): number => 1 - Math.exp(-intent.damping * x) * Math.cos(tau * intent.cycles * x)
    u = raw(t) + (1 - raw(1)) * h(t)
  }
  pose.position = [intent.from[0] + (intent.to[0] - intent.from[0]) * u, intent.from[1] + (intent.to[1] - intent.from[1]) * u]
  if (intent.kind === 'move_arc') {
    const dx = intent.to[0] - intent.from[0]; const dy = intent.to[1] - intent.from[1]
    pose.position[0] -= dy * intent.bendRatio * 4 * t * (1 - t)
    pose.position[1] += dx * intent.bendRatio * 4 * t * (1 - t)
  }
  if (intent.kind === 'bounce') {
    const phase = t === 1 ? 1 : t * intent.count % 1
    pose.position[1] -= intent.heightRatio * 4 * phase * (1 - phase) * Math.pow(intent.decay, Math.min(intent.count - 1, Math.floor(t * intent.count)))
  }
  if (intent.kind === 'zigzag') {
    const phase = t * intent.count; const i = Math.min(intent.count - 1, Math.floor(phase)); const f = phase - i
    const offset = (i === 0 ? 0 : i % 2 ? 1 : -1) * (1 - f) + (i === intent.count - 1 ? 0 : i % 2 ? -1 : 1) * f
    const dx = intent.to[0] - intent.from[0]; const dy = intent.to[1] - intent.from[1]; const norm = Math.hypot(dx, dy)
    if (norm > 0) { pose.position[0] -= dy / norm * intent.amplitudeRatio * offset; pose.position[1] += dx / norm * intent.amplitudeRatio * offset }
  }
  return pose
}
export function intentEventProgress(intent: PrimitiveIntent): number[] {
  const out = [0, 1]
  if (intent.kind === 'overshoot') out.push(intent.settleFraction)
  if (intent.kind === 'bounce' || intent.kind === 'zigzag') for (let i = 1; i < intent.count * 2; i++) out.push(i / (intent.count * 2))
  if (intent.kind === 'orbit') {
    const a = intent.startTurns * 4; const b = (intent.startTurns + intent.sweepTurns) * 4
    for (let i = Math.ceil(Math.min(a, b)); i <= Math.floor(Math.max(a, b)); i++) out.push((i - a) / (b - a))
  }
  if (intent.kind === 'spring_settle' || intent.kind === 'swing' || intent.kind === 'pulse' || intent.kind === 'sway') for (let i = 1; i < intent.cycles * 4; i++) out.push(i / (intent.cycles * 4))
  return intent.timing?.kind === 'bezier' ? [0, 1] : out.filter(t => t >= 0 && t <= 1)
}
