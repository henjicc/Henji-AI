import { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'
import { clockSegmentSchema, digestSchema, monoSpanSchema, safeClockSchema, sampleSchema } from './contracts'
import { audioEventSchema, annotationEventSchema, commandEventSchema, controlEventSchema, deltaEventSchema, geometryEventSchema, pointerEventSchema, timelineEventSchema, transcriptEventSchema } from './schema'

const envelope = { version: z.literal(1), ownerRef: applicationRefSchema, sourceDigest: digestSchema, monoSpanUs: monoSpanSchema, seqSpan: z.tuple([safeClockSchema, safeClockSchema]), count: safeClockSchema }
export const creativeIntentPageSchema = z.discriminatedUnion('kind', [
  z.object({ ...envelope, kind: z.literal('samples'), entries: z.array(sampleSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('timeline'), entries: z.array(timelineEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('control'), entries: z.array(controlEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('pointer'), entries: z.array(pointerEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('command'), entries: z.array(commandEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('delta'), entries: z.array(deltaEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('transcript'), entries: z.array(transcriptEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('annotation'), entries: z.array(annotationEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('geometry'), entries: z.array(geometryEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('audio'), entries: z.array(audioEventSchema) }).strict(),
  z.object({ ...envelope, kind: z.literal('clock'), entries: z.array(clockSegmentSchema) }).strict(),
]).superRefine((v, ctx) => {
  if (v.count !== v.entries.length || !v.count) ctx.addIssue({ code: 'custom', message: '页条数不符或空页' })
  if (v.seqSpan[1] < v.seqSpan[0]) ctx.addIssue({ code: 'custom', message: '页序号区间倒置' })
  if (v.kind === 'clock') {
    v.entries.forEach((s, i) => { if (s.monoSpanUs[0] < v.monoSpanUs[0] || s.monoSpanUs[1] > v.monoSpanUs[1] || i > 0 && s.monoSpanUs[0] < v.entries[i - 1].monoSpanUs[1]) ctx.addIssue({ code: 'custom', path: ['entries', i], message: '页内时钟段乱序、重叠或越界' }) })
    return
  }
  v.entries.forEach((e, i) => {
    if ((e.timeline === null) !== (e.unavailableReason !== undefined)) ctx.addIssue({ code: 'custom', path: ['entries', i], message: 'null 时间轴须说明原因' })
    if (e.monoUs < v.monoSpanUs[0] || e.monoUs > v.monoSpanUs[1] || e.seq < v.seqSpan[0] || e.seq > v.seqSpan[1]) ctx.addIssue({ code: 'custom', path: ['entries', i], message: '事件超出页区间' })
    if (i > 0 && (e.monoUs < v.entries[i - 1].monoUs || e.seq <= v.entries[i - 1].seq)) ctx.addIssue({ code: 'custom', path: ['entries', i], message: '事件墙钟/全局 seq 乱序或重复' })
  })
})
export type CreativeIntentPage = z.infer<typeof creativeIntentPageSchema>

