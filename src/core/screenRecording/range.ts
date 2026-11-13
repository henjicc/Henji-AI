import type { RecordingDocument, RecordingMedia } from './document'

/** 文件里真实存在的一段：会话时钟上的起止，以及这段开头在文件里的位置。 */
export interface RecordingSpan { media: RecordingMedia; startUs: number; endUs: number; fileUs: number }

type Timed = Pick<RecordingMedia, 'monoUs' | 'gaps'>
/**
 * 会话时刻 → 这个文件里的位置（微秒）。所有按会话时钟找画面或声音的地方都走这里：
 * 普通文件是“会话时刻减起点”；连续文件（暂停不在文件里）还要扣掉这一刻之前跳过的时间段。
 * 落在跳过的时间段里的时刻对到那段之后的第一帧。
 */
export function recordingFileUs(media: Timed, sessionUs: number): number {
  let skipped = 0
  for (const gap of media.gaps ?? []) if (gap.startUs < sessionUs) skipped += Math.min(sessionUs, gap.endUs) - gap.startUs
  return sessionUs - media.monoUs - skipped
}
/** 文件里的位置 → 会话时刻（recordingFileUs 的反向）。 */
export function recordingSessionUs(media: Timed, fileUs: number): number {
  let sessionUs = media.monoUs + fileUs
  for (const gap of [...media.gaps ?? []].sort((a, b) => a.startUs - b.startUs)) if (gap.startUs <= sessionUs) sessionUs += gap.endUs - gap.startUs
  return sessionUs
}
/**
 * 只认识文件时间的服务（文字识别、场景检测）给的“起点 + 文件内位置”→ 真正的会话时刻。
 * 普通文件两者相同；连续文件要把跳过的时间段加回去。
 */
export function recordingSessionUsFromFileClock(media: Timed, originPlusFileUs: number): number {
  return recordingSessionUs(media, originPlusFileUs - media.monoUs)
}
/** 这个文件在会话时钟上到哪一刻为止（连续文件要把跳过的时间段算进去）。 */
export function recordingMediaEndUs(media: Pick<RecordingMedia, 'monoUs' | 'gaps' | 'durationUs'>, durationUs = media.durationUs): number {
  return recordingSessionUs(media, durationUs)
}

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
  const endUs = recording.endUs ?? (picture.length ? Math.max(...picture.map(item => recordingMediaEndUs(item))) : startUs)
  return { startUs, endUs: Math.max(startUs, endUs) }
}

/** 成品时长：共同录制区间减去暂停。 */
export function recordingDurationUs(recording: Pick<RecordingDocument, 'media' | 'startUs' | 'endUs' | 'pauses'>): number {
  const range = recordingRange(recording)
  return Math.max(0, range.endUs - range.startUs - (recording.pauses ?? []).reduce((sum, pause) => sum + pause.endUs - pause.startUs, 0))
}

/**
 * Real intervals of one file inside the recorded range, minus the session's pauses and the track's own
 * pause/device gaps; nothing is ever filled in. Session pauses cut every track at the same moments: the
 * picture restarts a moment after the sound on resume, and neither may run alone.
 */
export function recordingMediaSpans(recording: Pick<RecordingDocument, 'media' | 'startUs' | 'endUs' | 'pauses' | 'tracks'>, media: RecordingMedia, durationUs = media.durationUs): RecordingSpan[] {
  const range = recordingRange(recording)
  let spans: Array<[number, number]> = [[Math.max(range.startUs, media.monoUs), Math.min(range.endUs, recordingMediaEndUs(media, Math.min(media.durationUs, durationUs)))]]
  const cuts = [...(recording.pauses ?? []).map(pause => [pause.startUs, pause.endUs]), ...(media.gaps ?? []).map(gap => [gap.startUs, gap.endUs]), ...(recording.tracks?.tracks.find(track => track.kind === media.kind)?.gaps ?? []).map(gap => gap.monoSpanUs)]
  for (const [cutStart, cutEnd] of cuts) {
    spans = spans.flatMap(([start, end]) => cutEnd <= start || cutStart >= end ? [[start, end] as [number, number]] : [
      ...(cutStart > start ? [[start, cutStart] as [number, number]] : []),
      ...(cutEnd < end ? [[cutEnd, end] as [number, number]] : []),
    ])
  }
  return spans.filter(([start, end]) => end > start).map(([startUs, endUs]) => ({ media, startUs, endUs, fileUs: recordingFileUs(media, startUs) }))
}
