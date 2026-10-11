import type { ApplicationRef } from '../application-control/identifiers'
import { refKey, type ClockSegment, type TimelineSpan } from './contracts'
import type { ExplanationEvent, ExplanationSession } from './schema'

/** JSONL is private data, never executable commands and never the application log. */
export async function* serializeRecordingInput(session: ExplanationSession, events: Iterable<ExplanationEvent> | AsyncIterable<ExplanationEvent>, input: { size: [number, number]; request?: string; includeImages?: boolean; finalState?: (ref: ApplicationRef) => Readonly<Record<string, unknown>> | undefined }): AsyncGenerator<string> {
  const refs = new Map<string, string>(); const dictionary: Record<string, ApplicationRef> = {}
  const alias = (ref: ApplicationRef): string => {
    const key = refKey(ref); let value = refs.get(key)
    if (!value) { value = `r${refs.size}`; refs.set(key, value); dictionary[value] = ref }
    return value
  }
  const projectTimeline = (timeline: ExplanationEvent['timeline']): unknown => timeline ? { sequence: alias(timeline.sequenceRef), frame: timeline.frame, fps: [timeline.fps.numerator, timeline.fps.denominator], visit: timeline.visitRef } : null
  const projectSpans = (spans: TimelineSpan[]): unknown[] => spans.map(s => [s.monoSpanUs[0] / 1000, s.monoSpanUs[1] / 1000, s.start?.frame ?? null, s.end?.frame ?? null, s.clockSegmentRef, s.start?.visitRef ?? null])
  const clocks = session.clockSegments.map((clock: ClockSegment) => ({ id: clock.id, spanW: clock.monoSpanUs.map(v => v / 1000), mode: clock.mode, start: projectTimeline(clock.start), end: projectTimeline(clock.end), pointsWT: clock.anchors.map(a => [a.monoUs / 1000, a.presentedFrame]), visit: clock.start?.visitRef ?? null }))
  yield JSON.stringify({ kind: 'header', v: 'explanation-input/1', mode: session.mode, clockUnit: 'ms', timelineUnit: 'presented-frame', size: input.size })
  yield JSON.stringify({ kind: 'dictionary', refs: { ...dictionary } })
  yield JSON.stringify({ kind: 'clocks', segments: clocks })
  let seq = -1; let mono = -1
  for await (const event of events) {
    if (event.monoUs < mono || event.monoUs === mono && event.seq <= seq) throw new Error('讲解投影须按墙钟和序号合并。')
    seq = event.seq; mono = event.monoUs
    const before = refs.size
    const base = { kind: 'event', s: event.seq, id: event.eventId, w: event.monoUs / 1000, t: event.timeline?.frame ?? null, cs: event.clockSegmentRef, visit: event.timeline?.visitRef ?? null, ...(event.unavailableReason ? { reason: event.unavailableReason } : {}) }
    let payload: object
    switch (event.kind) {
      case 'pointer': payload = { type: 'pointer', q: event.compositionPoint, view: event.viewPoint, document: event.documentPoint, hover: event.hoverRefs.map(alias), pointed: event.pointedRefs.map(alias), selected: event.selectedRefs.map(alias), surface: alias(event.surfaceRef), geometry: event.geometrySnapshotRef, phase: event.phase, intent: event.intent, uncertaintyUs: event.uncertaintyUs }; break
      case 'timeline': payload = { type: 'playhead', action: event.action, requestedFrame: event.requestedFrame, intent: event.intent, rate: event.playbackRate }; break
      case 'command': payload = { type: 'command', operation: alias(event.operationRef), phase: event.phase, related: event.relatedOperationRef ? alias(event.relatedOperationRef) : null, targets: event.targets.map(alias), alreadyApplied: ['committed', 'undo', 'redo'].includes(event.phase), before: event.beforeDigest, after: event.afterDigest }; break
      case 'delta': payload = { type: 'delta', command: alias(event.operationRef), changes: event.changes.map(c => [alias(c.targetRef), c.property, c.before, c.after]) }; break
      case 'transcript': {
        const timelineSpans = projectSpans(event.timelineSpans)
        payload = { type: 'speech', utterance: event.utteranceId, ...(event.wordId ? { words: [[event.wordId, event.monoSpanUs[0] / 1000, event.monoSpanUs[1] / 1000, event.text, timelineSpans]] } : {}), text: event.text, source: event.source, originalEvent: event.originalEventRef, spanW: event.monoSpanUs.map(v => v / 1000), granularity: event.granularity, alignment: event.alignmentQuality, timelineSpans }; break
      }
      case 'annotation': payload = { type: 'annotation', target: alias(event.annotationRef), role: event.role, snapshot: event.snapshotDigest, timelineSpans: projectSpans(event.timelineSpans) }; break
      case 'geometry': payload = { type: 'geometry', id: event.snapshotRef, surface: alias(event.surfaceRef), window: event.windowRef, size: event.compositionSize, rect: event.validViewRect, documentToView: event.documentToView, ancestorAffine: event.ancestorAffine, pixelRatio: event.pixelRatio, crop: event.crop, orientationTurns: event.orientationTurns, state: event.stateDigest }; break
      case 'control': payload = { type: 'control', action: event.action, intent: event.intent, property: event.property }; break
      case 'audio': payload = { type: 'audio-clock', segment: event.audioSegmentRef, spanW: event.monoSpanUs.map(v => v / 1000), sampleSpan: [event.startSample, event.endSample], rate: event.sampleRate, uncertaintyUs: event.uncertaintyUs }; break
    }
    if (refs.size !== before) yield JSON.stringify({ kind: 'dictionary', refs: Object.fromEntries(Object.entries(dictionary).slice(before)) })
    yield JSON.stringify({ ...base, ...payload })
  }
  const finalState = Object.fromEntries(Object.entries(dictionary).flatMap(([key, ref]) => { const value = input.finalState?.(ref); return value ? [[key, value]] : [] }))
  yield JSON.stringify({ kind: 'request', text: input.request ?? '', bindings: session.bindings, finalState, missing: [], imageAttachments: input.includeImages === false ? [] : session.visualEvidenceRefs, execution: 'preview-only; recorded commands already happened' })
}
