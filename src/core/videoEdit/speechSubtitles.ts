import { alignSpeechTimings } from '../media/alignSpeechTimings'
import type { SpeechTimings } from '../media/speechTimings'
import { autoSubtitleOptionsSchema, splitSubtitleText, type AutoSubtitleOptions } from './autoSubtitles'
import { videoEditClipFrameBoundaryAtSource, videoEditClipSourceRange, type VideoEditClipTiming } from './clipSpeed'
import { videoEditFps, type VideoEditRatio } from './time'
import type { VideoEditCaption } from './timedContent'
import { videoEditSubtitleStyleSchema } from './subtitleStyle'

export interface SpeechSubtitle { caption: VideoEditCaption; startUs: number; endUs: number; confidence: number; estimated: boolean }
/** Original text is authoritative; provider/ASR text supplies only matching anchors. */
export async function buildSpeechSubtitles(original: string, timings: SpeechTimings, clip: VideoEditClipTiming & { id: string }, rate: VideoEditRatio, options: AutoSubtitleOptions = {}, signal?: AbortSignal): Promise<SpeechSubtitle[]> {
  const settings = autoSubtitleOptionsSchema.parse(options)
  const fps = videoEditFps(rate)
  const range = videoEditClipSourceRange(clip, fps)
  const aligned = (await alignSpeechTimings(original, timings, signal)).filter(char =>
    (char.endMs > range.from * 1000 + 1e-6 || char.endMs === char.startMs && char.startMs >= range.from * 1000 - 1e-6) && char.startMs < range.to * 1000 - 1e-6)
  const parts = splitSubtitleText(aligned.map(char => char.text).join(''), settings.maxCharacters, settings.maxLines)
  const result: SpeechSubtitle[] = []
  let offset = 0
  for (const [partIndex, part] of parts.entries()) {
    // Shared wrapping decides boundaries; slice the original rather than using normalized/wrapped text.
    const count = Array.from(part).filter(char => !/\s/u.test(char)).length
    const begin = offset; let consumed = 0
    while (offset < aligned.length && consumed < count) { if (!/\s/u.test(aligned[offset].text)) consumed++; offset++ }
    if (partIndex === parts.length - 1 && consumed === count) offset = aligned.length
    const chars = aligned.slice(begin, offset)
    if (!chars.length) continue
    const a = videoEditClipFrameBoundaryAtSource(clip, chars[0].startMs / 1000, fps)
    const b = videoEditClipFrameBoundaryAtSource(clip, chars[chars.length - 1].endMs / 1000, fps)
    const start = Math.max(clip.start, Math.round(Math.min(a, b)))
    const end = Math.min(clip.start + clip.duration, Math.round(Math.max(a, b)))
    if (end <= start) continue
    result.push({ caption: { id: crypto.randomUUID(), clipId: clip.id, text: chars.map(char => char.text).join(''), start, duration: end - start, style: videoEditSubtitleStyleSchema.parse({}) },
      startUs: Math.round(start * rate.denominator * 1e6 / rate.numerator), endUs: Math.round(end * rate.denominator * 1e6 / rate.numerator),
      confidence: chars.reduce((sum, char) => sum + char.confidence, 0) / chars.length, estimated: chars.some(char => char.estimated) })
  }
  return result.sort((a, b) => a.caption.start - b.caption.start)
}
