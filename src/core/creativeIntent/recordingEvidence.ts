import type { ExplanationEvent } from './schema'

export interface RecordingFrameSelection {
  eventId: string; monoUs: number; frame: number; sequenceId: string; fps: [number, number]; visit: string; clockSegmentRef: string; geometrySnapshotRef?: string; pointer: [number, number] | null; reason: 'before' | 'pointing' | 'after' | 'appearance'; stateDigest: string
}
/** P3-2 supplies evidence need. Same frame/different visit or picture state is never deduplicated. */
export function selectRecordingFrames(events: readonly ExplanationEvent[], input: { atUs: number; need: 'structured' | 'appearance' | 'change'; stateDigest: (event: ExplanationEvent) => string | undefined }): RecordingFrameSelection[] {
  if (input.need === 'structured') return []
  const known = events.filter(e => e.timeline && input.stateDigest(e)).sort((a, b) => a.monoUs - b.monoUs || a.seq - b.seq)
  const before = known.filter(e => e.monoUs < input.atUs).at(-1)
  const at = known.filter(e => e.monoUs <= input.atUs).at(-1)
  const after = at && known.find(e => e.monoUs > at.monoUs && (e.timeline?.frame !== at.timeline?.frame || e.timeline?.visitRef !== at.timeline?.visitRef || input.stateDigest(e) !== input.stateDigest(at)))
  const chosen: Array<[ExplanationEvent | undefined, RecordingFrameSelection['reason']]> = input.need === 'appearance' ? [[at, 'appearance']] : [[at, 'pointing'], [before, 'before'], [after, 'after']]
  const seen = new Set<string>(); const result: RecordingFrameSelection[] = []
  for (const [event, reason] of chosen) {
    if (!event?.timeline) continue
    const stateDigest = input.stateDigest(event)!; const key = JSON.stringify([event.timeline.sequenceRef.id, event.timeline.frame, event.timeline.visitRef, stateDigest])
    if (seen.has(key)) continue; seen.add(key)
    result.push({ eventId: event.eventId, monoUs: event.monoUs, frame: event.timeline.frame, sequenceId: event.timeline.sequenceRef.id, fps: [event.timeline.fps.numerator, event.timeline.fps.denominator], visit: event.timeline.visitRef, clockSegmentRef: event.clockSegmentRef, pointer: event.kind === 'pointer' ? event.compositionPoint : null, ...(event.kind === 'pointer' ? { geometrySnapshotRef: event.geometrySnapshotRef } : {}), reason, stateDigest })
  }
  return result.sort((a, b) => a.monoUs - b.monoUs)
}
