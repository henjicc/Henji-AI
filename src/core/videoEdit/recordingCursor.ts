import { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'
import type { CaptureEvent, CaptureLogPage } from '../captureLog/events'
import { digestSchema, refKey, safeClockSchema } from '../captureLog/clock'

const span = z.tuple([safeClockSchema, safeClockSchema]).refine(([a, b]) => b >= a, '采集页区间倒置。')
/** Immutable capture pages remain owned by the recording; edits only retain references. */
export const recordingCursorPageSchema = z.object({ path: z.string().min(1).max(32768), sha256: z.string().regex(/^[a-f0-9]{64}$/), recordingSpanUs: span, seqSpan: span }).strict()
export const recordingCursorSourceSchema = z.object({
  ownerRef: applicationRefSchema, sourceDigest: digestSchema,
  cursorBakedIn: z.boolean(), recordingStartUs: safeClockSchema,
  width: z.number().int().positive().max(32768), height: z.number().int().positive().max(32768),
  pages: z.array(recordingCursorPageSchema).min(1).max(100_000),
}).strict().superRefine((source, ctx) => {
  for (let i = 1; i < source.pages.length; i++) {
    const a = source.pages[i - 1]; const b = source.pages[i]
    if (b.seqSpan[0] <= a.seqSpan[1] || b.recordingSpanUs[0] < a.recordingSpanUs[1]) ctx.addIssue({ code: 'custom', path: ['pages', i], message: '采集页必须按录制时间和序号排列且不重叠。' })
  }
})
export type RecordingCursorSource = z.infer<typeof recordingCursorSourceSchema>
export type RecordingCursorPage = z.infer<typeof recordingCursorPageSchema>
export const RECORDING_CURSOR_EFFECT = 'recording_cursor'
export const CURSOR_CLICK_DURATION_US = 500_000
export const CURSOR_LOOKAHEAD_US = 100_000
export function recordingCursorPageReference(page: CaptureLogPage, path: string, sha256: string): RecordingCursorPage {
  return recordingCursorPageSchema.parse({ path, sha256, recordingSpanUs: [page.entries[0].recordingUs, page.entries.at(-1)!.recordingUs], seqSpan: page.seqSpan })
}
export function assertRecordingCursorPage(page: CaptureLogPage, ref: RecordingCursorPage, source: RecordingCursorSource): void {
  if (refKey(page.ownerRef) !== refKey(source.ownerRef) || page.sourceDigest !== source.sourceDigest || page.seqSpan.some((v, i) => v !== ref.seqSpan[i]) || page.entries[0].recordingUs !== ref.recordingSpanUs[0] || page.entries.at(-1)!.recordingUs !== ref.recordingSpanUs[1]) throw new Error('光标事件日志归属或区间不符，请恢复原录制日志。')
  for (let i = 1; i < page.entries.length; i++) if (page.entries[i].recordingUs < page.entries[i - 1].recordingUs) throw new Error('光标事件的录制时间倒退。')
}
type Cursor = Extract<CaptureEvent, { kind: 'cursor' }>
type Click = Extract<CaptureEvent, { kind: 'click' }>
export interface RecordingCursorFrame {
  cursor?: { point: [number, number]; shape: Cursor['shape']; opacity: number }
  clicks: Array<{ point: [number, number]; button: Click['button']; progress: number }>
}
/** Binary seek over bounded, ordered page windows; no playback-dependent spring state. */
function lastAt(events: readonly CaptureEvent[], time: number): number {
  let lo = 0; let hi = events.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (events[mid].recordingUs <= time) lo = mid + 1; else hi = mid }
  return lo - 1
}
export function sampleRecordingCursor(events: readonly CaptureEvent[], timeUs: number, options: { smoothing: number; hideAfterSeconds: number; cursorBakedIn: boolean }): RecordingCursorFrame {
  const end = lastAt(events, timeUs)
  const result: RecordingCursorFrame = { clicks: [] }
  for (let i = end; i >= 0 && timeUs - events[i].recordingUs < CURSOR_CLICK_DURATION_US; i--) {
    const e = events[i]
    if (e.kind === 'control') break
    if (e.kind === 'click' && e.phase === 'down') result.clicks.unshift({ point: e.point, button: e.button, progress: (timeUs - e.recordingUs) / CURSOR_CLICK_DURATION_US })
  }
  if (options.cursorBakedIn) return result
  let index = end
  while (index >= 0 && events[index].kind !== 'cursor') { if (events[index].kind === 'control') return result; index-- }
  if (index < 0) return result
  const cursor = events[index] as Cursor
  if (!cursor.point || cursor.shape === 'hidden' || timeUs - cursor.recordingUs > CURSOR_LOOKAHEAD_US) return result
  let nextIndex = index + 1
  while (nextIndex < events.length && events[nextIndex].kind !== 'cursor' && events[nextIndex].kind !== 'control') nextIndex++
  const next = events[nextIndex]
  const point: [number, number] = [...cursor.point]
  if (next?.kind === 'cursor' && next.point && next.shape !== 'hidden' && next.clockSegmentRef === cursor.clockSegmentRef && next.recordingUs - cursor.recordingUs <= CURSOR_LOOKAHEAD_US) {
    const t = Math.max(0, Math.min(1, (timeUs - cursor.recordingUs) / Math.max(1, next.recordingUs - cursor.recordingUs)))
    point[0] += (next.point[0] - point[0]) * t; point[1] += (next.point[1] - point[1]) * t
  }
  // Symmetric finite smoothing reduces 120 Hz jitter without accumulating lag on seeks/reverse.
  // Clicks anchor the path exactly; never smooth across a pause, hidden sample or missing data.
  const radius = Math.max(0, Math.min(100, options.smoothing)) * 800
  let clickDistance = Infinity; let click: Click | undefined
  let activity = cursor.recordingUs
  for (let i = index; i >= 0; i--) {
    const e = events[i]
    if (e.clockSegmentRef !== cursor.clockSegmentRef || e.kind === 'control') break
    if (e.kind === 'click' || e.kind === 'cursor' && (!e.point || Math.hypot(e.point[0] - cursor.point[0], e.point[1] - cursor.point[1]) > 1)) { activity = e.recordingUs; break }
    activity = e.recordingUs
  }
  if (radius > 0) {
    let x = 0; let y = 0; let weight = 0
    const barrier = (e: CaptureEvent): boolean => e.clockSegmentRef !== cursor.clockSegmentRef || e.kind === 'control' || e.kind === 'cursor' && (!e.point || e.shape === 'hidden')
    let start = index; let stop = index + 1
    while (start > 0 && events[start - 1].recordingUs >= timeUs - radius && !barrier(events[start - 1]) && events[start].recordingUs - events[start - 1].recordingUs <= CURSOR_LOOKAHEAD_US) start--
    while (stop < events.length && events[stop].recordingUs <= timeUs + radius && !barrier(events[stop]) && events[stop].recordingUs - events[stop - 1].recordingUs <= CURSOR_LOOKAHEAD_US) stop++
    for (let i = start; i < stop; i++) {
      const e = events[i]; const distance = Math.abs(e.recordingUs - timeUs)
      if (e.clockSegmentRef !== cursor.clockSegmentRef) continue
      if (e.kind === 'click' && e.phase === 'down' && distance < clickDistance) { click = e; clickDistance = distance }
      if (e.kind !== 'cursor' || !e.point || e.shape === 'hidden') continue
      const w = Math.max(0, 1 - distance / radius)
      x += e.point[0] * w; y += e.point[1] * w; weight += w
    }
    if (weight > 0) { point[0] = x / weight; point[1] = y / weight }
    if (click) { const w = Math.max(0, 1 - clickDistance / radius); point[0] += (click.point[0] - point[0]) * w; point[1] += (click.point[1] - point[1]) * w }
  }
  const hideUs = options.hideAfterSeconds * 1_000_000
  const opacity = hideUs <= 0 ? 1 : Math.min(1, Math.max(0, (hideUs - (timeUs - activity)) / 150_000))
  if (opacity > 0) result.cursor = { point, shape: cursor.shape, opacity }
  return result
}
