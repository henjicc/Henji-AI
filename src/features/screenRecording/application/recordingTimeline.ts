import type { RecordingDocument, RecordingMedia } from '@/core/screenRecording/document'

export interface RecordingSpan { media: RecordingMedia; startUs: number; endUs: number }

/** Both the viewer and editing import use the recorded intervals, including device/pause gaps. */
export function recordingMediaSpans(recording: RecordingDocument, media: RecordingMedia, durationUs = media.durationUs): RecordingSpan[] {
  let spans: Array<[number, number]> = [[media.monoUs, media.monoUs + Math.min(media.durationUs, durationUs)]]
  for (const gap of recording.tracks?.tracks.find(track => track.kind === media.kind)?.gaps ?? []) {
    spans = spans.flatMap(([start, end]) => gap.monoSpanUs[1] <= start || gap.monoSpanUs[0] >= end ? [[start, end] as [number, number]] : [
      ...(gap.monoSpanUs[0] > start ? [[start, gap.monoSpanUs[0]] as [number, number]] : []),
      ...(gap.monoSpanUs[1] < end ? [[gap.monoSpanUs[1], end] as [number, number]] : []),
    ])
  }
  return spans.filter(([start, end]) => end > start).map(([startUs, endUs]) => ({ media, startUs, endUs }))
}

export function recordingTimeline(recording: RecordingDocument): { originUs: number; durationUs: number; tracks: Array<{ kind: RecordingMedia['kind']; spans: RecordingSpan[] }> } {
  const media = recording.media.filter(item => item.durationUs > 0)
  // The picture starts the session: sound and camera may open a moment earlier while the countdown runs,
  // and anchoring there would show a blank first frame.
  const screens = media.filter(item => item.kind === 'screen')
  const originUs = media.length ? Math.min(...(screens.length ? screens : media).map(item => item.monoUs)) : 0
  const endUs = Math.max(originUs, ...media.map(item => item.monoUs + item.durationUs), ...recording.markers.map(marker => marker.monoUs))
  const tracks = (['screen', 'camera', 'microphone', 'systemAudio'] as const).flatMap(kind => {
    const spans = media.filter(item => item.kind === kind).flatMap(item => recordingMediaSpans(recording, item)).sort((a, b) => a.startUs - b.startUs)
    return spans.length ? [{ kind, spans }] : []
  })
  return { originUs, durationUs: endUs - originUs, tracks }
}
