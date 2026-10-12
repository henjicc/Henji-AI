import { alignSpeechTimings } from '../media/alignSpeechTimings'
import type { SpeechTimings } from '../media/speechTimings'
import { splitSubtitleText, wrapSubtitleText, ensureSubtitleDuration, type AutoSubtitleOptions } from './autoSubtitles'
import { resolveSubtitleStyle, subtitleFrameBoundary } from './subtitleStyleProfiles'
import { segmentTimedSubtitles, subtitleTokensFromCharacters, type SubtitlePause } from './subtitleSegmentation'
import { joinAudioEditText } from '../audioEdit/captions'
import { videoEditClipFrameBoundaryAtSource, videoEditClipSourceRange, videoEditClipSpeedValue, type VideoEditClipTiming } from './clipSpeed'
import { videoEditFps, type VideoEditRatio } from './time'
import type { VideoEditCaption } from './timedContent'
import { videoEditSubtitleStyleSchema } from './subtitleStyle'

export interface SpeechSubtitle { caption: VideoEditCaption; startUs: number; endUs: number; confidence: number; estimated: boolean }
/** Original text is authoritative; provider/ASR text supplies only matching anchors. */
export async function buildSpeechSubtitles(original: string, timings: SpeechTimings, clip: VideoEditClipTiming & { id: string }, rate: VideoEditRatio, options: AutoSubtitleOptions = {}, signal?: AbortSignal, pauses: readonly SubtitlePause[] = [], textScope: 'source' | 'clip' = 'source'): Promise<SpeechSubtitle[]> {
  const profile = resolveSubtitleStyle(options, original)
  const settings = profile.chinese ? profile : { ...profile, maxCharacters: options.maxCharacters ?? 24, minDurationSeconds: options.minDurationSeconds ?? 1 }
  const fps = videoEditFps(rate)
  const range = videoEditClipSourceRange(clip, fps)
  const scopedTimings = textScope === 'clip' ? { ...timings, items: timings.items.filter(item => item.endMs > range.from * 1000 && item.startMs < range.to * 1000) } : timings
  const aligned = (await alignSpeechTimings(original, scopedTimings, signal)).filter(char =>
    (char.endMs > range.from * 1000 + 1e-6 || char.endMs === char.startMs && char.startMs >= range.from * 1000 - 1e-6) && char.startMs < range.to * 1000 - 1e-6)
  if (settings.chinese) {
    const tokens = subtitleTokensFromCharacters(aligned.map(char => ({ ...char, timing: timings.granularity === 'word' ? 'word' as const : 'estimated' as const })))
    for (const token of tokens) if (token.wordId !== undefined) {
      const item = scopedTimings.items[token.wordId]
      token.startMs = Math.max(range.from * 1000, Math.min(token.startMs, item.startMs))
      token.endMs = Math.min(range.to * 1000, Math.max(token.endMs, item.endMs))
    }
    // Profile limits describe playback time, while aligner and energy clocks describe source time.
    const speed = videoEditClipSpeedValue(clip)
    const sourceOptions = { ...options, minDurationSeconds: settings.minDurationSeconds * speed, maxDurationSeconds: settings.maxDurationSeconds * speed,
      maxReadingSpeed: settings.maxReadingSpeed / speed, joinGapMs: settings.joinGapMs * speed,
      ...(settings.pauseSeconds === undefined ? {} : { pauseSeconds: settings.pauseSeconds * speed }) }
    const groups = segmentTimedSubtitles(tokens, { startMs: range.from * 1000, endMs: range.to * 1000 }, sourceOptions, pauses)
    const result = groups.map(group => {
      const a = videoEditClipFrameBoundaryAtSource(clip, group.startMs / 1000, fps)
      const b = videoEditClipFrameBoundaryAtSource(clip, group.endMs / 1000, fps)
      const start = Math.max(clip.start, subtitleFrameBoundary(Math.min(a, b)))
      const end = Math.min(clip.start + clip.duration, subtitleFrameBoundary(Math.max(a, b)))
      const chars = aligned.filter(char => (char.endMs > tokens[group.first].startMs || char.endMs === char.startMs && char.startMs >= tokens[group.first].startMs) && char.startMs < tokens[group.last].endMs)
      const first = chars[0]; const last = chars.at(-1)
      const mismatch = chars.some(char => char.mismatch && /[\p{L}\p{N}]/u.test(char.text))
      const anchored = timings.items.some(item => Math.abs(item.startMs - group.startMs) < 1e-6)
        && timings.items.some(item => Math.abs(item.endMs - group.endMs) < 1e-6 || Math.abs(item.startMs - group.endMs) < 1e-6)
      return { caption: { id: crypto.randomUUID(), clipId: clip.id, text: group.text, start, duration: Math.max(1, end - start), style: videoEditSubtitleStyleSchema.parse({}) },
        startUs: Math.round(start / fps * 1e6), endUs: Math.round(end / fps * 1e6), confidence: mismatch ? 0 : Math.min(first?.confidence ?? 0, last?.confidence ?? 0) * Number(anchored), estimated: mismatch || !anchored }
    }).sort((a, b) => a.caption.start - b.caption.start)
    for (let index = 0; index + 1 < result.length; index++) {
      const cue = result[index]; const next = result[index + 1]
      const gap = next.caption.start - cue.caption.start - cue.caption.duration
      if (gap >= 0 && gap / fps * 1000 < settings.joinGapMs) { cue.caption.duration += gap; cue.endUs = next.startUs }
    }
    return result
  }
  const parts = splitSubtitleText(aligned.map(char => char.text).join(''), settings.maxCharacters, settings.maxLines)
  const groups: Array<{ start: number; end: number; text: string; chars: typeof aligned }> = []
  let offset = 0
  for (const part of parts) {
    // Whitespace carries no speech timing; only shared layout may introduce line breaks.
    const count = Array.from(part).filter(char => !/\s/u.test(char)).length
    while (offset < aligned.length && /\s/u.test(aligned[offset].text)) offset++
    const begin = offset; let consumed = 0
    while (offset < aligned.length && consumed < count) { if (!/\s/u.test(aligned[offset].text)) consumed++; offset++ }
    const chars = aligned.slice(begin, offset).filter(char => !/\s/u.test(char.text))
    if (!chars.length) continue
    const a = videoEditClipFrameBoundaryAtSource(clip, chars[0].startMs / 1000, fps)
    const b = videoEditClipFrameBoundaryAtSource(clip, chars[chars.length - 1].endMs / 1000, fps)
    const start = Math.max(clip.start, subtitleFrameBoundary(Math.min(a, b)))
    const end = Math.min(clip.start + clip.duration, subtitleFrameBoundary(Math.max(a, b)))
    if (end <= start) continue
    groups.push({ start, end, text: part, chars })
  }
  return ensureSubtitleDuration(groups.sort((a, b) => a.start - b.start), Math.ceil(settings.minDurationSeconds * fps), { startFrame: clip.start, endFrame: clip.start + clip.duration },
    (left, right) => ({ ...left, end: right.end, text: wrapSubtitleText(joinAudioEditText(left.text, right.text), settings.maxCharacters), chars: [...left.chars, ...right.chars] }))
    .map(({ start, end, text, chars }): SpeechSubtitle => {
      const ordered = [...chars].sort((a, b) => a.startMs - b.startMs)
      const first = ordered[0]; const last = ordered[ordered.length - 1]
      const mismatched = ordered.some(char => char.mismatch)
      const boundaryStart = videoEditClipFrameBoundaryAtSource(clip, first.startMs / 1000, fps)
      const boundaryEnd = videoEditClipFrameBoundaryAtSource(clip, last.endMs / 1000, fps)
      const startExact = (boundaryStart <= boundaryEnd ? first.startExact : last.endExact) && start === subtitleFrameBoundary(Math.min(boundaryStart, boundaryEnd))
      const endExact = (boundaryStart <= boundaryEnd ? last.endExact : first.startExact) && end === subtitleFrameBoundary(Math.max(boundaryStart, boundaryEnd))
      const estimated = !startExact || !endExact || mismatched
      return { caption: { id: crypto.randomUUID(), clipId: clip.id, text, start, duration: end - start, style: videoEditSubtitleStyleSchema.parse({}) },
      startUs: Math.round(start * rate.denominator * 1e6 / rate.numerator), endUs: Math.round(end * rate.denominator * 1e6 / rate.numerator),
      confidence: mismatched ? 0 : Math.min(first.confidence, last.confidence) * (Number(Boolean(startExact)) + Number(Boolean(endExact))) / 2, estimated }
    })
}
