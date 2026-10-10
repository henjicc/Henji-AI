import { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'
import { affineSchema, clockEventIssue, clockSegmentsSchema, digestSchema, dualClockShape, finiteSchema, idSchema, monoSpanSchema, pageRefSchema, pointSchema, poseSchema, resourceRefSchema, safeClockSchema, timelineSchema, timelineSpanSchema } from './contracts'

const eventBase = { ...dualClockShape, eventId: idSchema }
export const timelineEventSchema = z.object({ ...eventBase, kind: z.literal('timeline'), intent: z.enum(['navigate', 'demonstrate']), requestedFrame: safeClockSchema.nullable(), action: z.enum(['play', 'pause', 'scrub', 'seek', 'rate', 'present']), playbackRate: finiteSchema.positive() }).strict()
export const controlEventSchema = z.object({ ...eventBase, kind: z.literal('control'), action: z.enum(['start-recording', 'pause-recording', 'resume-recording', 'stop-recording', 'demonstration-mode', 'property-mode', 'focus-lost', 'focus-restored']), intent: z.enum(['navigate', 'demonstrate']).optional(), property: z.enum(['position', 'rotationTurns', 'scaleXY']).optional() }).strict()
export const pointerEventSchema = z.object({ ...eventBase, kind: z.literal('pointer'), surfaceRef: applicationRefSchema, geometrySnapshotRef: idSchema, viewPoint: pointSchema, documentPoint: pointSchema.nullable(), compositionPoint: pointSchema.nullable(), hoverRefs: z.array(applicationRefSchema), pointedRefs: z.array(applicationRefSchema), selectedRefs: z.array(applicationRefSchema), intent: z.enum(['navigate', 'demonstrate']), phase: z.enum(['down', 'move', 'up', 'cancel']), uncertaintyUs: safeClockSchema }).strict()
export const commandEventSchema = z.object({ ...eventBase, kind: z.literal('command'), operationRef: applicationRefSchema, phase: z.enum(['started', 'committed', 'undo', 'redo', 'failed', 'cancelled', 'draft-retract']), relatedOperationRef: applicationRefSchema.optional(), targets: z.array(applicationRefSchema), beforeDigest: digestSchema, afterDigest: digestSchema }).strict().superRefine((v, ctx) => {
  if ((v.phase === 'undo' || v.phase === 'redo') && !v.relatedOperationRef) ctx.addIssue({ code: 'custom', message: '撤销/重做须关联原操作' })
  if ((v.phase === 'failed' || v.phase === 'cancelled' || v.phase === 'started') && v.beforeDigest !== v.afterDigest) ctx.addIssue({ code: 'custom', message: '未提交命令不能伪称已改变状态' })
})
export const deltaEventSchema = z.object({ ...eventBase, kind: z.literal('delta'), operationRef: applicationRefSchema, changes: z.array(z.object({ targetRef: applicationRefSchema, property: z.enum(['position', 'rotationTurns', 'scaleXY', 'pivot']), before: z.union([pointSchema, finiteSchema]), after: z.union([pointSchema, finiteSchema]) }).strict().superRefine((v, ctx) => {
  const scalar = v.property === 'rotationTurns'
  if ([v.before, v.after].some(value => scalar !== (typeof value === 'number') || v.property === 'scaleXY' && Array.isArray(value) && value.some(n => n <= 0))) ctx.addIssue({ code: 'custom', message: '属性增量的值类型或缩放域不符' })
})) }).strict()
export const transcriptEventSchema = z.object({
  ...eventBase, kind: z.literal('transcript'), utteranceId: idSchema, wordId: idSchema.optional(), text: z.string(), audioSegmentRef: idSchema, startSample: safeClockSchema, endSample: safeClockSchema,
  monoSpanUs: monoSpanSchema, timelineSpans: z.array(timelineSpanSchema), granularity: z.enum(['word', 'character', 'segment']), alignmentQuality: z.enum(['precise', 'coarse', 'unavailable']), confidence: finiteSchema.min(0).max(1).optional(), source: z.enum(['asr', 'user']), originalEventRef: idSchema.optional(),
}).strict().superRefine((v, ctx) => {
  if (v.endSample <= v.startSample) ctx.addIssue({ code: 'custom', message: '音频须为正半开采样区间' })
  if (v.granularity === 'segment' && v.wordId) ctx.addIssue({ code: 'custom', message: '句级不得伪造 wordId' })
  if (v.granularity !== 'segment' && !v.wordId) ctx.addIssue({ code: 'custom', message: '词/字须有真实身份' })
  v.timelineSpans.forEach((s, i) => {
    if (s.monoSpanUs[0] < v.monoSpanUs[0] || s.monoSpanUs[1] > v.monoSpanUs[1] || i > 0 && s.monoSpanUs[0] < v.timelineSpans[i - 1].monoSpanUs[1]) ctx.addIssue({ code: 'custom', path: ['timelineSpans', i], message: '句跨度越界/重叠' })
  })
})
export const annotationEventSchema = z.object({ ...eventBase, kind: z.literal('annotation'), annotationRef: applicationRefSchema, snapshotDigest: digestSchema, role: z.enum(['source', 'destination', 'keep', 'align', 'path', 'note']), timelineSpans: z.array(timelineSpanSchema) }).strict()
export const geometryEventSchema = z.object({ ...eventBase, kind: z.literal('geometry'), snapshotRef: idSchema, surfaceRef: applicationRefSchema, windowRef: idSchema, compositionSize: z.tuple([finiteSchema.positive(), finiteSchema.positive()]), validViewRect: z.tuple([finiteSchema, finiteSchema, finiteSchema.positive(), finiteSchema.positive()]), documentToView: affineSchema, ancestorAffine: affineSchema, pixelRatio: finiteSchema.positive(), crop: z.tuple([finiteSchema, finiteSchema, finiteSchema.positive(), finiteSchema.positive()]), orientationTurns: finiteSchema, stateDigest: digestSchema }).strict()
export const audioEventSchema = z.object({ ...eventBase, kind: z.literal('audio'), audioSegmentRef: idSchema, monoSpanUs: monoSpanSchema, startSample: safeClockSchema, endSample: safeClockSchema, sampleRate: safeClockSchema.positive(), channels: safeClockSchema.positive(), uncertaintyUs: safeClockSchema, resourceRef: resourceRefSchema.optional() }).strict().refine(v => v.endSample > v.startSample && v.monoSpanUs[1] > v.monoSpanUs[0], '音频段须有正跨度')
export const explanationEventSchema = z.union([timelineEventSchema, controlEventSchema, pointerEventSchema, commandEventSchema, deltaEventSchema, transcriptEventSchema, annotationEventSchema, geometryEventSchema, audioEventSchema]).superRefine((v, ctx) => {
  if ((v.timeline === null) !== (v.unavailableReason !== undefined)) ctx.addIssue({ code: 'custom', message: 'null 时间轴须说明原因' })
})
export type ExplanationEvent = z.infer<typeof explanationEventSchema>
export const visualEvidenceSchema = z.object({
  id: idSchema, kind: z.enum(['frame', 'contact-sheet']), resourceRef: resourceRefSchema, size: z.tuple([safeClockSchema.positive(), safeClockSchema.positive()]), pixelBudget: safeClockSchema.positive(),
  frames: z.array(z.object({ ...eventBase, stateDigest: digestSchema, geometrySnapshotRef: idSchema, sourceRefs: z.array(applicationRefSchema), pointer: pointSchema.nullable(), reason: z.enum(['reference', 'appearance', 'before', 'pointing', 'after', 'turn', 'sketch']), attachmentRect: z.tuple([finiteSchema.nonnegative(), finiteSchema.nonnegative(), finiteSchema.positive(), finiteSchema.positive()]), roi: z.tuple([finiteSchema, finiteSchema, finiteSchema.positive(), finiteSchema.positive()]).optional() }).strict()).min(1),
}).strict().superRefine((v, ctx) => {
  if (v.size[0] * v.size[1] > v.pixelBudget) ctx.addIssue({ code: 'custom', message: '附件超过本批工作像素预算；须缩放/分批' })
  if (v.kind === 'frame' && v.frames.length !== 1) ctx.addIssue({ code: 'custom', message: '单帧证据只能关联一个时刻' })
  v.frames.forEach((f, i) => {
    if (!f.timeline && f.unavailableReason !== 'static') ctx.addIssue({ code: 'custom', path: ['frames', i], message: '历史画面须有实际呈现证据' })
    const [x, y, w, h] = f.attachmentRect
    if (x + w > v.size[0] || y + h > v.size[1]) ctx.addIssue({ code: 'custom', path: ['frames', i], message: '图格越界' })
  })
})
export const explanationSessionSchema = z.object({
  id: idSchema, version: z.literal(1), ownerRef: applicationRefSchema, createdAt: z.iso.datetime(), state: z.enum(['idle', 'consenting', 'recording', 'paused', 'transcribing', 'reviewing', 'submitted', 'recoverable', 'cancelled']),
  mode: z.enum(['animated', 'static']), sourceDigest: digestSchema,
  consent: z.object({ noticeDigest: digestSchema, userReceiptRef: idSchema, capture: z.boolean(), keepAudio: z.boolean(), audioUpload: z.boolean(), textUpload: z.boolean(), imageUpload: z.boolean(), transcriptionProvider: idSchema.optional() }).strict().optional(),
  retentionStatus: z.enum(['temporary', 'retained', 'deleted', 'absent']), audio: resourceRefSchema.optional(),
  clockSegments: clockSegmentsSchema, pages: z.array(pageRefSchema), visualEvidenceRefs: z.array(visualEvidenceSchema),
  asr: z.object({ moduleId: idSchema, providerId: idSchema, granularity: z.enum(['word', 'character', 'segment']), taskRef: idSchema.optional() }).strict().optional(),
  bindings: z.array(z.object({ id: idSchema, utteranceIds: z.array(idSchema), wordIds: z.array(idSchema), targetRefs: z.array(applicationRefSchema), point: pointSchema.optional(), evidenceSeqs: z.array(safeClockSchema), timelineSpans: z.array(timelineSpanSchema), confidence: z.enum(['confirmed', 'ambiguous', 'unresolved']), correctedByUser: z.boolean() }).strict()),
  segmentExclusions: z.array(z.object({ audioSegmentRef: idSchema, sampleSpan: z.tuple([safeClockSchema, safeClockSchema]) }).strict()), corrections: z.array(z.object({ originalEventRef: idSchema, correctedEventRef: idSchema }).strict()),
  annotationRefs: z.array(applicationRefSchema), submittedPlanRef: resourceRefSchema.optional(), appliedReceiptRefs: z.array(applicationRefSchema), finalPoseRefs: z.array(z.object({ targetRef: applicationRefSchema, pose: poseSchema, stateDigest: digestSchema }).strict()),
}).strict().superRefine((v, ctx) => {
  if ((v.retentionStatus === 'deleted' || v.retentionStatus === 'absent') && v.audio) ctx.addIssue({ code: 'custom', message: '已删除/不存在的原音不能保留资源引用' })
  if (v.state === 'recording' && !v.consent?.capture) ctx.addIssue({ code: 'custom', message: '录制缺用户授权事实' })
  if (new Set(v.clockSegments.map(s => s.id)).size !== v.clockSegments.length) ctx.addIssue({ code: 'custom', message: '时钟段身份重复' })
  v.clockSegments.forEach((s, i) => {
    if (i > 0 && s.monoSpanUs[0] < v.clockSegments[i - 1].monoSpanUs[1]) ctx.addIssue({ code: 'custom', message: '时钟段重叠或乱序' })
    if (v.mode === 'static' && (s.start || s.end)) ctx.addIssue({ code: 'custom', message: '静态会话没有时间轴' })
  })
  v.visualEvidenceRefs.forEach((e, i) => e.frames.forEach((f, j) => { const issue = clockEventIssue(f, v.clockSegments); if (issue) ctx.addIssue({ code: 'custom', path: ['visualEvidenceRefs', i, 'frames', j], message: issue }) }))
})
export type ExplanationSession = z.infer<typeof explanationSessionSchema>
export type VisualEvidence = z.infer<typeof visualEvidenceSchema>
export type TranscriptEntry = z.infer<typeof transcriptEventSchema>
export type AudioClockSegment = z.infer<typeof audioEventSchema>
export type GeometrySnapshot = z.infer<typeof geometryEventSchema>
export { timelineSchema }
