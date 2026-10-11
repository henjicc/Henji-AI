import type { AudioClockSegment, TranscriptEntry } from './schema'
import type { ClockSegment, Timeline, TimelineSpan } from './contracts'
import type { TimestampedTranscript, TimestampedTranscriptPart } from '../audioEdit/timestampedTranscript'

/** Worklet sample positions, not delivery times, define the audio-to-wall mapping. */
export function sampleWallUs(audio: Pick<AudioClockSegment, 'startSample' | 'sampleRate' | 'monoSpanUs'>, sample: number): number {
  return audio.monoSpanUs[0] + Math.round((sample - audio.startSample) * 1_000_000 / audio.sampleRate)
}
function presentedAt(segment: ClockSegment, at: number): Timeline | null {
  let result: Timeline | null = null
  for (const anchor of segment.anchors) {
    if (anchor.monoUs > at) break
    if (anchor.presentedFrame !== null && anchor.sequenceRef && anchor.visitRef && segment.start) result = { ...segment.start, frame: anchor.presentedFrame, sequenceRef: anchor.sequenceRef, visitRef: anchor.visitRef }
  }
  return result
}
/** No interpolation over scrub/seek; the last acknowledged picture remains visible. */
export function recordingTimelineSpans(clocks: readonly ClockSegment[], span: [number, number]): TimelineSpan[] {
  const result: TimelineSpan[] = []
  for (const clock of clocks) {
    if (clock.mode === 'seek') continue
    const start = Math.max(span[0], clock.monoSpanUs[0]); const end = Math.min(span[1], clock.monoSpanUs[1])
    if (end <= start) continue
    const a = presentedAt(clock, start); const b = presentedAt(clock, Math.max(start, end - 1))
    result.push({ monoSpanUs: [start, end], clockSegmentRef: clock.id, start: a, end: b, evidenceSeqs: [], quality: a && b ? 'presented' : 'unavailable' })
  }
  return result
}
export interface AlignedRecordingTranscript { entries: TranscriptEntry[]; untimed: string[] }
export function alignRecordingTranscript(transcript: TimestampedTranscript, audio: AudioClockSegment, clocks: readonly ClockSegment[], firstSeq: number, id: (suffix: string) => string): AlignedRecordingTranscript {
  if (transcript.unit !== 'ms') throw new Error('转写时间单位须为毫秒。')
  const entries: TranscriptEntry[] = []; const untimed: string[] = []
  let index = 0
  const add = (part: TimestampedTranscriptPart, utteranceId: string): void => {
    if (part.startMs === null || part.endMs === null || part.granularity === 'none') { untimed.push(part.text); return }
    if (!Number.isFinite(part.startMs) || !Number.isFinite(part.endMs) || part.startMs < 0 || part.endMs <= part.startMs) throw new Error('转写时间无效。')
    const startSample = audio.startSample + Math.round(part.startMs * audio.sampleRate / 1000)
    const endSample = audio.startSample + Math.round(part.endMs * audio.sampleRate / 1000)
    if (startSample < audio.startSample || endSample > audio.endSample || endSample <= startSample) throw new Error('转写时间超出这一块录音。')
    const monoSpanUs: [number, number] = [sampleWallUs(audio, startSample), sampleWallUs(audio, endSample)]
    const timelineSpans = recordingTimelineSpans(clocks, monoSpanUs)
    const first = timelineSpans[0]
    if (!first) { untimed.push(part.text); return }
    const word = part.granularity !== 'segment'
    entries.push({ kind: 'transcript', eventId: id(`event-${index}`), seq: firstSeq + index++, monoUs: monoSpanUs[0], timeline: first.start, clockSegmentRef: first.clockSegmentRef,
      ...(!first.start ? { unavailableReason: audio.unavailableReason === 'static' ? 'static' as const : 'missing-presentation' as const } : {}), utteranceId, ...(word ? { wordId: id(`word-${index}`) } : {}), text: part.text, audioSegmentRef: audio.audioSegmentRef,
      startSample, endSample, monoSpanUs, timelineSpans, granularity: part.granularity, alignmentQuality: word && part.timing === 'precise' && audio.uncertaintyUs <= 50_000 && timelineSpans.every(s => s.quality === 'presented' || audio.unavailableReason === 'static' && clocks.some(c => c.id === s.clockSegmentRef && c.mode === 'hold' && !c.start && !c.end)) ? 'precise' : 'coarse',
      ...(part.confidence === undefined ? {} : { confidence: part.confidence }), source: 'asr' })
  }
  transcript.segments.forEach((segment, i) => {
    const utterance = id(`utterance-${i}`)
    if (segment.words?.length) for (const word of segment.words) add(word, utterance)
    else add(segment, utterance)
  })
  for (const text of untimed) {
    const spans = recordingTimelineSpans(clocks, audio.monoSpanUs); const first = spans[0]
    if (!first) continue
    entries.push({ kind: 'transcript', eventId: id(`untimed-${index}`), seq: firstSeq + index++, monoUs: audio.monoSpanUs[0], timeline: first.start, clockSegmentRef: first.clockSegmentRef, ...(!first.start ? { unavailableReason: audio.unavailableReason === 'static' ? 'static' as const : 'missing-presentation' as const } : {}), utteranceId: id(`untimed-utterance-${index}`), text, audioSegmentRef: audio.audioSegmentRef, startSample: audio.startSample, endSample: audio.endSample, monoSpanUs: audio.monoSpanUs, timelineSpans: spans, granularity: 'segment', alignmentQuality: 'unavailable', source: 'asr' })
  }
  entries.sort((a, b) => a.monoUs - b.monoUs || a.seq - b.seq).forEach((entry, i) => { entry.seq = firstSeq + i })
  return { entries, untimed }
}
