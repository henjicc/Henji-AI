import type { RecordingDocument, RecordingMedia } from '@/core/screenRecording/document'
import { recordingMediaSpans, recordingRange, type RecordingSpan } from '@/core/screenRecording/range'

export function recordingTimeline(recording: RecordingDocument): { originUs: number; durationUs: number; tracks: Array<{ kind: RecordingMedia['kind']; spans: RecordingSpan[] }> } {
  const range = recordingRange(recording)
  const media = recording.media.filter(item => item.durationUs > 0)
  const tracks = (['screen', 'camera', 'microphone', 'systemAudio'] as const).flatMap(kind => {
    const spans = media.filter(item => item.kind === kind).flatMap(item => recordingMediaSpans(recording, item)).sort((a, b) => a.startUs - b.startUs)
    return spans.length ? [{ kind, spans }] : []
  })
  return { originUs: range.startUs, durationUs: range.endUs - range.startUs, tracks }
}
