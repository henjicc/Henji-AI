import { z } from 'zod'
import { applicationRefSchema, type ApplicationRef } from '../application-control/identifiers'
import { videoEditRatioSchema } from '../videoEdit/time'

/** Proposed pure contract. Not a registered persistence format until P1 storage wiring. */
export const CREATIVE_INTENT_VERSION = 1 as const
export const idSchema = z.string().min(1)
export const safeClockSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const finiteSchema = z.number().finite()
export const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/)
export const pointSchema = z.tuple([finiteSchema, finiteSchema])
export const affineSchema = z.tuple([finiteSchema, finiteSchema, finiteSchema, finiteSchema, finiteSchema, finiteSchema])
export const poseSchema = z.object({ position: pointSchema, rotationTurns: finiteSchema, scaleXY: z.tuple([finiteSchema.positive(), finiteSchema.positive()]), pivot: pointSchema }).strict()
export type Pose = z.infer<typeof poseSchema>
export const motionPropertySchema = z.enum(['position', 'rotationTurns', 'scaleXY', 'pivot'])
export type MotionProperty = z.infer<typeof motionPropertySchema>
export const monoSpanSchema = z.tuple([safeClockSchema, safeClockSchema]).refine(([a, b]) => b >= a, '墙钟区间倒置')
export const timelineSchema = z.object({ sequenceRef: applicationRefSchema, frame: safeClockSchema, fps: videoEditRatioSchema, visitRef: idSchema }).strict()
export type Timeline = z.infer<typeof timelineSchema>
export const dualClockShape = {
  seq: safeClockSchema, monoUs: safeClockSchema, timeline: timelineSchema.nullable(), clockSegmentRef: idSchema,
  unavailableReason: z.enum(['static', 'missing-presentation', 'gap', 'unfocused', 'outside', 'singular']).optional(),
}
export const dualClockSchema = z.object(dualClockShape).strict().superRefine((v, ctx) => {
  if ((v.timeline === null) !== (v.unavailableReason !== undefined)) ctx.addIssue({ code: 'custom', message: 'null 时间轴须说明原因；呈现证据不得同时标不可用' })
})
export const clockAnchorSchema = z.object({
  monoUs: safeClockSchema, audioSample: safeClockSchema.optional(), audioSegmentRef: idSchema.optional(), audioRate: safeClockSchema.positive().optional(),
  presentedFrame: safeClockSchema.nullable(), requestedFrame: safeClockSchema.nullable(), sequenceRef: applicationRefSchema.nullable(), visitRef: idSchema.nullable(),
  playbackDirection: z.union([z.literal(-1), z.literal(0), z.literal(1)]), playbackRate: finiteSchema.positive(), playing: z.boolean(), epoch: safeClockSchema, uncertaintyUs: safeClockSchema,
}).strict().superRefine((v, ctx) => {
  if (v.presentedFrame !== null && (!v.sequenceRef || !v.visitRef)) ctx.addIssue({ code: 'custom', message: '呈现帧须有序列与访问身份' })
  const audioFields = [v.audioSample, v.audioSegmentRef, v.audioRate]
  if (audioFields.some(x => x !== undefined) && audioFields.some(x => x === undefined)) ctx.addIssue({ code: 'custom', message: '音频采样锚点须带采样段和采样率' })
})
export type ClockAnchor = z.infer<typeof clockAnchorSchema>
export const clockSegmentSchema = z.object({
  id: idSchema, monoSpanUs: monoSpanSchema, mode: z.enum(['play', 'hold', 'scrub', 'seek', 'gap']),
  start: timelineSchema.nullable(), end: timelineSchema.nullable(), anchors: z.array(clockAnchorSchema),
}).strict().superRefine((v, ctx) => {
  const [a, b] = v.monoSpanUs
  if ((v.mode === 'seek') !== (a === b)) ctx.addIssue({ code: 'custom', message: 'seek 为零时长边界，其余段须有正墙钟跨度' })
  if (v.mode === 'gap' && (v.start || v.end || v.anchors.length)) ctx.addIssue({ code: 'custom', message: '采集 gap 不得伪造呈现锚点' })
  if ((v.start === null) !== (v.end === null)) ctx.addIssue({ code: 'custom', message: '连续时钟段须完整保留呈现端点，缺呈现应单列缺口' })
  if (v.mode === 'hold' && v.start && v.end && v.start.frame !== v.end.frame) ctx.addIssue({ code: 'custom', message: 'hold 不推进作品时间' })
  if (v.start && v.end && (refKey(v.start.sequenceRef) !== refKey(v.end.sequenceRef) || v.start.fps.numerator !== v.end.fps.numerator || v.start.fps.denominator !== v.end.fps.denominator || v.mode !== 'seek' && v.start.visitRef !== v.end.visitRef)) ctx.addIssue({ code: 'custom', message: '连续时钟段不得跨序列、帧率或访问身份' })
  v.anchors.forEach((p, i) => {
    if (p.monoUs < a || p.monoUs > b || i > 0 && p.monoUs < v.anchors[i - 1].monoUs) ctx.addIssue({ code: 'custom', path: ['anchors', i], message: '锚点墙钟乱序或越界' })
    if (p.presentedFrame !== null && (![v.start, v.end].some(t => t && p.sequenceRef && refKey(t.sequenceRef) === refKey(p.sequenceRef) && t.visitRef === p.visitRef) || v.mode === 'hold' && p.presentedFrame !== v.start?.frame)) ctx.addIssue({ code: 'custom', path: ['anchors', i], message: '呈现锚点身份/hold 帧与时钟段不符' })
  })
})
export type ClockSegment = z.infer<typeof clockSegmentSchema>
export const clockSegmentsSchema = z.array(clockSegmentSchema).superRefine((segments, ctx) => {
  if (new Set(segments.map(s => s.id)).size !== segments.length) ctx.addIssue({ code: 'custom', message: '时钟段身份重复' })
  segments.forEach((s, i) => { if (i > 0 && s.monoSpanUs[0] < segments[i - 1].monoSpanUs[1]) ctx.addIssue({ code: 'custom', path: [i], message: '时钟段重叠或乱序' }) })
})
export function clockEventIssue(event: { monoUs: number; timeline: Timeline | null; clockSegmentRef: string; unavailableReason?: string; kind?: string }, segments: readonly ClockSegment[] | ReadonlyMap<string, ClockSegment>): string | undefined {
  const segment = 'get' in segments ? segments.get(event.clockSegmentRef) : segments.find(s => s.id === event.clockSegmentRef)
  if (!segment) return '事件引用未知时钟段'
  const [a, b] = segment.monoSpanUs
  if (event.monoUs < a || event.monoUs > b) return '事件墙钟超出时钟段'
  if (segment.mode === 'gap') return event.kind === 'control' && (event.monoUs === a || event.monoUs === b) && event.timeline === null && event.unavailableReason === 'gap' ? undefined : '采集 gap 内不能补造事件'
  if (event.timeline && (!segment.start || !segment.end)) return '缺真实呈现端点的时钟段不能制造作品时间'
  if (event.timeline && segment.start) {
    const t = event.timeline; const s = segment.start
    if (refKey(t.sequenceRef) !== refKey(s.sequenceRef) || t.fps.numerator !== s.fps.numerator || t.fps.denominator !== s.fps.denominator || segment.mode !== 'seek' && t.visitRef !== s.visitRef) return '事件时间轴身份与时钟段不符'
    if (segment.mode === 'hold' && t.frame !== s.frame) return 'hold 事件不能推进作品帧'
  }
  if ((event.timeline === null) !== (event.unavailableReason !== undefined)) return '事件双时钟可用性不一致'
  return undefined
}
export const timelineSpanSchema = z.object({ monoSpanUs: monoSpanSchema, clockSegmentRef: idSchema, start: timelineSchema.nullable(), end: timelineSchema.nullable(), evidenceSeqs: z.array(safeClockSchema), quality: z.enum(['presented', 'coarse', 'unavailable']) }).strict().superRefine((v, ctx) => {
  if (v.quality === 'presented' && (!v.start || !v.end)) ctx.addIssue({ code: 'custom', message: '精确跨度需要真实呈现端点' })
  if (v.start && v.end && (refKey(v.start.sequenceRef) !== refKey(v.end.sequenceRef) || v.start.visitRef !== v.end.visitRef || v.start.fps.numerator !== v.end.fps.numerator || v.start.fps.denominator !== v.end.fps.denominator)) ctx.addIssue({ code: 'custom', message: '跨 seek/visit 的句子必须拆跨度' })
})
export type TimelineSpan = z.infer<typeof timelineSpanSchema>
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
export const takeSchema = z.object({ id: idSchema, intent: z.enum(['navigate', 'demonstrate']), pathDemonstration: z.boolean(), monoSpanUs: monoSpanSchema, direction: z.union([z.literal(-1), z.literal(0), z.literal(1)]), visitRef: idSchema.nullable(), timelineRange: z.tuple([safeClockSchema, safeClockSchema]).nullable(), samplePages: z.array(pageRefSchema), geometryDigest: digestSchema }).strict()
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
export function refKey(ref: ApplicationRef): string { return JSON.stringify([ref.kind, ref.id]) }

export function sameCandidateInput(a: CandidateIdentity, b: CandidateIdentity): boolean {
  const bases = (v: CandidateIdentity): string => JSON.stringify(v.targetBases.map(t => [refKey(t.targetRef), t.baseDigest, t.geometryDigest]).sort((x, y) => String(x[0]) < String(y[0]) ? -1 : String(x[0]) > String(y[0]) ? 1 : 0))
  return a.sourceDraftDigest === b.sourceDraftDigest && a.algorithmVersion === b.algorithmVersion && a.requestKey === b.requestKey && refKey(a.ownerRef) === refKey(b.ownerRef) && bases(a) === bases(b)
}
