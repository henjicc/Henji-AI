import type { RecordingDocument, RecordingMedia } from './document'

export interface RecordingSpan { media: RecordingMedia; startUs: number; endUs: number }

/**
 * The one recorded range every consumer shares (viewer, editing import, movie, quick export).
 * Capture warms up during the countdown and encoders flush after stop; neither belongs to the result.
 * Sessions saved before the range was recorded start at the first picture frame and end with the last one.
 */
export function recordingRange(recording: Pick<RecordingDocument, 'media' | 'startUs' | 'endUs'>): { startUs: number; endUs: number } {
  const media = recording.media.filter(item => item.durationUs > 0)
  const screens = media.filter(item => item.kind === 'screen')
  const picture = screens.length ? screens : media
  const startUs = recording.startUs ?? (picture.length ? Math.min(...picture.map(item => item.monoUs)) : 0)
  const endUs = recording.endUs ?? (picture.length ? Math.max(...picture.map(item => item.monoUs + item.durationUs)) : startUs)
  return { startUs, endUs: Math.max(startUs, endUs) }
}

/**
 * Real intervals of one file inside the recorded range, minus the session's pauses and the track's own
 * pause/device gaps; nothing is ever filled in. Session pauses cut every track at the same moments: the
 * picture restarts a moment after the sound on resume, and neither may run alone.
 */
export function recordingMediaSpans(recording: Pick<RecordingDocument, 'media' | 'startUs' | 'endUs' | 'pauses' | 'tracks'>, media: RecordingMedia, durationUs = media.durationUs): RecordingSpan[] {
  const range = recordingRange(recording)
  let spans: Array<[number, number]> = [[Math.max(range.startUs, media.monoUs), Math.min(range.endUs, media.monoUs + Math.min(media.durationUs, durationUs))]]
  const cuts = [...(recording.pauses ?? []).map(pause => [pause.startUs, pause.endUs]), ...(recording.tracks?.tracks.find(track => track.kind === media.kind)?.gaps ?? []).map(gap => gap.monoSpanUs)]
  for (const [cutStart, cutEnd] of cuts) {
    spans = spans.flatMap(([start, end]) => cutEnd <= start || cutStart >= end ? [[start, end] as [number, number]] : [
      ...(cutStart > start ? [[start, cutStart] as [number, number]] : []),
      ...(cutEnd < end ? [[cutEnd, end] as [number, number]] : []),
    ])
  }
  return spans.filter(([start, end]) => end > start).map(([startUs, endUs]) => ({ media, startUs, endUs }))
}
