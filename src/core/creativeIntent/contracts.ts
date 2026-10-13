import { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'
import { idSchema, safeClockSchema, finiteSchema, digestSchema, poseSchema, motionPropertySchema, monoSpanSchema, dualClockShape, clockSegmentsSchema, refKey } from '../captureLog/clock'
export { idSchema, safeClockSchema, finiteSchema, digestSchema, pointSchema, affineSchema, poseSchema, motionPropertySchema, monoSpanSchema, timelineSchema, dualClockShape, dualClockSchema, clockAnchorSchema, clockSegmentSchema, clockSegmentsSchema, clockEventIssue, timelineSpanSchema, refKey, type Pose, type MotionProperty, type Timeline, type ClockAnchor, type ClockSegment, type TimelineSpan } from '../captureLog/clock'

/** Proposed pure contract. Not a registered persistence format until P1 storage wiring. */
export const CREATIVE_INTENT_VERSION = 1 as const
export const sampleSchema = z.object({ ...dualClockShape, sampleId: idSchema, takeRef: idSchema, targetRef: applicationRefSchema, pose: poseSchema, gestureKind: z.enum(['place', 'move', 'rotate', 'scale', 'path']), quality: z.enum(['presented', 'estimated', 'unavailable']), confirmed: z.boolean(), event: z.enum(['down', 'up', 'dwell-start', 'dwell-end', 'turn', 'sample']) }).strict().superRefine((v, ctx) => {
  if (v.timeline === null && !v.unavailableReason || v.timeline !== null && v.unavailableReason) ctx.addIssue({ code: 'custom', message: '双时钟可用性不一致' })
  if (v.quality === 'presented' && v.timeline === null && v.unavailableReason !== 'static') ctx.addIssue({ code: 'custom', message: '缺呈现不可标精确' })
})
export type MotionSample = z.infer<typeof sampleSchema>
export const resourceRefSchema = z.object({ resourceId: idSchema, digest: digestSchema, bytes: safeClockSchema }).strict()
export const pageRefSchema = resourceRefSchema.extend({ kind: z.enum(['samples', 'timeline', 'control', 'pointer', 'command', 'delta', 'transcript', 'annotation', 'geometry', 'audio', 'clock']), count: safeClockSchema, monoSpanUs: monoSpanSchema, seqSpan: z.tuple([safeClockSchema, safeClockSchema]) }).strict().refine(v => v.seqSpan[1] >= v.seqSpan[0], '页序号区间倒置')
export type CreativeIntentResourceRef = z.infer<typeof resourceRefSchema>
export type CreativeIntentPageRef = z.infer<typeof pageRefSchema>
export const pinSchema = z.object({ id: idSchema, sampleId: idSchema, targetRef: applicationRefSchema, properties: z.array(motionPropertySchema).min(1), timeLocked: z.boolean(), valueLocked: z.boolean() }).strict().refine(v => new Set(v.properties).size === v.properties.length && (v.timeLocked || v.valueLocked), 'pin 属性重复或没有锁定任何维度')
export type MotionPin = z.infer<typeof pinSchema>
export const targetSchema = z.object({ ref: applicationRefSchema, ownerRef: applicationRefSchema, editable: z.array(motionPropertySchema), basePose: poseSchema, baseDigest: digestSchema, geometryDigest: digestSchema, compositionSize: z.tuple([finiteSchema.positive(), finiteSchema.positive()]) }).strict()
export type MotionTarget = z.infer<typeof targetSchema>
export const takeSchema = z.object({ id: idSchema, intent: z.enum(['navigate', 'demonstrate']), pathDemonstration: z.boolean(), placement: z.literal(true).optional(), monoSpanUs: monoSpanSchema, direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]), visitRef: idSchema.nullable(), timelineRange: z.tuple([safeClockSchema, safeClockSchema]).nullable(), samplePages: z.array(pageRefSchema), geometryDigest: digestSchema }).strict()
export type MotionTake = z.infer<typeof takeSchema>
export const candidateIdentitySchema = z.object({ sourceDraftDigest: digestSchema, algorithmVersion: idSchema, requestKey: idSchema, ownerRef: applicationRefSchema, targetBases: z.array(z.object({ targetRef: applicationRefSchema, baseDigest: digestSchema, geometryDigest: digestSchema }).strict()) }).strict()
export type CandidateIdentity = z.infer<typeof candidateIdentitySchema>
const constraintBase = { id: idSchema, strength: z.enum(['hard', 'soft']), sourceRefs: z.array(applicationRefSchema) }
export const layoutConstraintSchema = z.discriminatedUnion('kind', [
  z.object({ ...constraintBase, kind: z.literal('align'), targets: z.array(applicationRefSchema).min(2), axis: z.enum(['x', 'y']), edge: z.enum(['start', 'center', 'end']), reference: applicationRefSchema }).strict(),
  z.object({ ...constraintBase, kind: z.literal('distribute'), targets: z.array(applicationRefSchema).min(3), axis: z.enum(['x', 'y']), gapRatio: finiteSchema.nonnegative().optional() }).strict(),
])
export type LayoutConstraint = z.infer<typeof layoutConstraintSchema>
export const motionDraftSchema = z.object({
  id: idSchema, version: z.literal(CREATIVE_INTENT_VERSION), ownerRef: applicationRefSchema, mode: z.enum(['animated', 'static']), label: z.string(), fidelity: finiteSchema.min(0).max(1),
  sourceDigest: digestSchema, clockSegments: clockSegmentsSchema, targets: z.array(targetSchema), takes: z.array(takeSchema), pins: z.array(pinSchema), constraints: z.array(layoutConstraintSchema),
  recipeRefs: z.array(resourceRefSchema), candidateRefs: z.array(resourceRefSchema), selectedCandidateRef: idSchema.optional(),
  applications: z.array(z.object({ candidateRef: idSchema, operationRef: applicationRefSchema, receiptRef: applicationRefSchema, saved: z.boolean() }).strict()),
}).strict().superRefine((v, ctx) => {
  for (const [name, ids] of [['targets', v.targets.map(t => refKey(t.ref))], ['takes', v.takes.map(t => t.id)], ['pins', v.pins.map(p => p.id)]] as const) {
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: [name], message: '身份重复' })
  }
  const targets = new Set(v.targets.map(t => refKey(t.ref)))
  if (v.targets.some(t => refKey(t.ownerRef) !== refKey(v.ownerRef))) ctx.addIssue({ code: 'custom', message: '目标归属不同文档' })
  if (v.pins.some(p => !targets.has(refKey(p.targetRef)))) ctx.addIssue({ code: 'custom', message: 'pin 引用未声明目标' })
  if (v.mode === 'static' && v.takes.some(t => t.timelineRange || t.visitRef || t.direction !== 0)) ctx.addIssue({ code: 'custom', message: '静态草稿不得造时间轴' })
  if (v.selectedCandidateRef && !v.candidateRefs.some(r => r.resourceId === v.selectedCandidateRef)) ctx.addIssue({ code: 'custom', message: '选择候选不在目录' })
})
export type MotionDraft = z.infer<typeof motionDraftSchema>

/** Stable key excludes optional display label/revision; ownership remains explicit in target/header. */


export function sameCandidateInput(a: CandidateIdentity, b: CandidateIdentity): boolean {
  const bases = (v: CandidateIdentity): string => JSON.stringify(v.targetBases.map(t => [refKey(t.targetRef), t.baseDigest, t.geometryDigest]).sort((x, y) => String(x[0]) < String(y[0]) ? -1 : String(x[0]) > String(y[0]) ? 1 : 0))
  return a.sourceDraftDigest === b.sourceDraftDigest && a.algorithmVersion === b.algorithmVersion && a.requestKey === b.requestKey && refKey(a.ownerRef) === refKey(b.ownerRef) && bases(a) === bases(b)
}
