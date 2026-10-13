import { z } from 'zod'
import { applicationRefSchema, type ApplicationRef } from '../application-control/identifiers'
import { videoEditRatioSchema } from '../videoEdit/time'

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

export function refKey(ref: ApplicationRef): string { return JSON.stringify([ref.kind, ref.id]) }
