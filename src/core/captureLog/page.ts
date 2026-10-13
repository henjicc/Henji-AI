import { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'
import { digestSchema, monoSpanSchema, safeClockSchema, type ClockSegment } from './clock'
export const capturePageEnvelope = { version: z.literal(1), ownerRef: applicationRefSchema, sourceDigest: digestSchema, monoSpanUs: monoSpanSchema, seqSpan: z.tuple([safeClockSchema, safeClockSchema]), count: safeClockSchema }

interface PageEvent { seq: number; monoUs: number; timeline: unknown | null; unavailableReason?: string }
export function validateCapturePage(v: { kind: string; count: number; entries: readonly PageEvent[] | readonly ClockSegment[]; monoSpanUs: [number, number]; seqSpan: [number, number] }, ctx: z.RefinementCtx): void {

  if (v.count !== v.entries.length || !v.count) ctx.addIssue({ code: 'custom', message: '页条数不符或空页' })
  if (v.seqSpan[1] < v.seqSpan[0]) ctx.addIssue({ code: 'custom', message: '页序号区间倒置' })
  if (v.kind === 'clock') {
    (v.entries as readonly ClockSegment[]).forEach((s, i) => { if (s.monoSpanUs[0] < v.monoSpanUs[0] || s.monoSpanUs[1] > v.monoSpanUs[1] || i > 0 && s.monoSpanUs[0] < (v.entries[i - 1] as ClockSegment).monoSpanUs[1]) ctx.addIssue({ code: 'custom', path: ['entries', i], message: '页内时钟段乱序、重叠或越界' }) })
    return
  }
  (v.entries as readonly PageEvent[]).forEach((e, i) => {
    if ((e.timeline === null) !== (e.unavailableReason !== undefined)) ctx.addIssue({ code: 'custom', path: ['entries', i], message: 'null 时间轴须说明原因' })
    if (e.monoUs < v.monoSpanUs[0] || e.monoUs > v.monoSpanUs[1] || e.seq < v.seqSpan[0] || e.seq > v.seqSpan[1]) ctx.addIssue({ code: 'custom', path: ['entries', i], message: '事件超出页区间' })
    if (i > 0 && (e.monoUs < (v.entries[i - 1] as PageEvent).monoUs || e.seq <= (v.entries[i - 1] as PageEvent).seq)) ctx.addIssue({ code: 'custom', path: ['entries', i], message: '事件墙钟/全局 seq 乱序或重复' })
  })
}
