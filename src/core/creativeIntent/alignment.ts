import { clockEventIssue, type ClockSegment } from './contracts'
import type { ExplanationEvent, TranscriptEntry } from './schema'

export type PointerEvidence = Extract<ExplanationEvent, { kind: 'pointer' }>
export interface AlignedSpeech {
  entry: TranscriptEntry
  events: ExplanationEvent[]
  pointers: PointerEvidence[]
  issues: string[]
}
/** Window is a temporal evidence horizon, never a product-count limit. No frame interpolation. */
export function alignExplanationEntry(entry: TranscriptEntry, events: readonly ExplanationEvent[], clocks: readonly ClockSegment[]): AlignedSpeech {
  const [start, end] = entry.monoSpanUs
  const from = Math.max(0, start - 800_000); const to = end + 250_000
  const selected = events.filter(event => event.monoUs >= from && event.monoUs <= to)
  const staticHost = entry.timeline === null && entry.unavailableReason === 'static'
  const issues: string[] = []
  if (clocks.some(clock => clock.mode === 'gap' && clock.monoSpanUs[0] < end && clock.monoSpanUs[1] > start)) issues.push('讲话跨过录制缺口，请重新确认')
  if (entry.alignmentQuality === 'unavailable' || !entry.timelineSpans.length && !staticHost) issues.push('缺少讲话时的作品时间')
  if (entry.source === 'asr' && entry.confidence !== undefined && entry.confidence < .85) issues.push('转写置信度不足，请先校正文字')
  if (!staticHost && entry.timelineSpans.some(span => span.quality === 'unavailable')) issues.push('讲话时未确认实际呈现画面')
  if (new Set(entry.timelineSpans.map(span => span.start?.visitRef).filter(Boolean)).size > 1) issues.push('讲话跨过不同访问，需明确选择指向')
  if (!staticHost && selected.some(event => event.kind === 'pointer' && event.phase === 'down' && event.monoUs >= start && event.monoUs <= end && event.compositionPoint === null)) issues.push('讲话时点击了菜单或时间线，需明确作品指向')
  const pointers = selected.filter((event): event is PointerEvidence => event.kind === 'pointer')
    .filter(event => !clockEventIssue(event, clocks) && event.phase !== 'cancel' && event.compositionPoint !== null && event.uncertaintyUs <= 50_000)
    .filter(event => staticHost
      ? event.timeline === null && event.unavailableReason === 'static' && clocks.some(clock => clock.id === event.clockSegmentRef && clock.mode !== 'gap' && !clock.start && !clock.end) && !clocks.some(clock => clock.mode === 'gap' && clock.monoSpanUs[0] < Math.max(event.monoUs, end) && clock.monoSpanUs[1] > Math.min(event.monoUs, start))
      : event.timeline !== null && entry.timelineSpans.some(span => span.start && span.end && span.start.visitRef === event.timeline?.visitRef && span.start.sequenceRef.id === event.timeline?.sequenceRef.id && span.start.sequenceRef.kind === event.timeline?.sequenceRef.kind))
  if (!pointers.length) issues.push('没有对应的作品内指向；菜单和时间线点击不能绑定对象')
  return { entry, events: selected, pointers, issues }
}

/** Baseline deliberately ignores visits, menus, ambiguity and speech roles. Used only for comparison. */
export function nearestPointBaseline(entry: TranscriptEntry, events: readonly ExplanationEvent[]): PointerEvidence | undefined {
  const middle = (entry.monoSpanUs[0] + entry.monoSpanUs[1]) / 2
  return events.filter((event): event is PointerEvidence => event.kind === 'pointer')
    .reduce<PointerEvidence | undefined>((best, event) => !best || Math.abs(event.monoUs - middle) < Math.abs(best.monoUs - middle) ? event : best, undefined)
}
