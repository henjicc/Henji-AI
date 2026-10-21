import { z } from 'zod'
import { normalizeTranscriptSearch, findTranscriptSearchRanges } from '../media/transcriptSearch'
import { joinAudioEditText } from '../audioEdit/captions'
import { videoEditClipSourceRange, videoEditClipSourceSecondsAtTime, videoEditClipFrameBoundaryAtSource } from './clipSpeed'
import { videoEditFps } from './time'
import type { VideoEditCaption, VideoEditContentOrigin } from './timedContent'
import type { VideoEditClip, VideoEditSequence } from './document'

const sourceWord = z.object({ clipId: z.string().min(1).max(100), text: z.string().min(1).max(20000),
  startUs: z.number().int().nonnegative(), endUs: z.number().int().nonnegative(), precision: z.enum(['word', 'estimated']),
}).strict().refine(word => word.endUs >= word.startUs)
export const videoEditCaptionSpeechSchema = z.object({ text: z.string().min(1).max(2000), aligned: z.boolean(), words: z.array(sourceWord).min(1) }).strict()
export const videoEditCaptionReviewSchema = z.array(z.enum(['text', 'translation', 'timing'])).max(3)
export type VideoEditCaptionSpeechWord = z.infer<typeof sourceWord>
export type VideoEditCaptionSpeech = z.infer<typeof videoEditCaptionSpeechSchema>
export type VideoEditCaptionReview = z.infer<typeof videoEditCaptionReviewSchema>
export function videoEditCaptionClipIds(caption: VideoEditCaption): string[] {
  return [...new Set([...(caption.clipId ? [caption.clipId] : []), ...(caption.speech?.words.map(word => word.clipId) ?? [])])]
}
const join = (words: readonly { text: string }[]): string => words.reduce((text, word) => joinAudioEditText(text, word.text), '')

/** Keep the caption's authored punctuation and line breaks when retaining whole source words. */
function retainedCaptionText(text: string, words: readonly VideoEditCaptionSpeechWord[], indices: readonly number[]): string | undefined {
  const points = Array.from(text); const positions: number[] = []; const parts: string[] = []
  points.forEach((point, index) => {
    const normalized = normalizeTranscriptSearch(point); parts.push(normalized)
    for (let at = 0; at < normalized.length; at++) positions.push(index)
  })
  const lengths = words.map(word => normalizeTranscriptSearch(word.text).length)
  if (!positions.length || parts.join('') !== words.map(word => normalizeTranscriptSearch(word.text)).join('')) return undefined
  const offsets = [0]
  for (const length of lengths) offsets.push(offsets.at(-1)! + length)
  const ranges: { start: number; end: number }[] = []
  for (const index of indices) {
    if (!lengths[index]) continue
    const previous = ranges.at(-1)
    if (previous && offsets[index] === offsets[previous.end + 1]) previous.end = index
    else ranges.push({ start: index, end: index })
  }
  return ranges.reduce((result, range) => {
    const start = offsets[range.start] ? positions[offsets[range.start]] : 0
    const end = offsets[range.end + 1] >= positions.length ? points.length : positions[offsets[range.end + 1]]
    return joinAudioEditText(result, points.slice(start, end).join('').trim())
  }, '')
}

/** Only source evidence is stored. Program positions are always derived from the current clip. */
export function bindVideoEditCaptionSpeech(caption: VideoEditCaption, candidates: readonly VideoEditCaptionSpeechWord[]): VideoEditCaption {
  if (!candidates.length) return caption
  const matches = normalizeTranscriptSearch(caption.text) ? findTranscriptSearchRanges(candidates, caption.text) : []
  const words = matches.length === 1 ? candidates.slice(matches[0].start, matches[0].end + 1) : [...candidates]
  return { ...caption, speech: { text: caption.text, aligned: normalizeTranscriptSearch(join(words)) === normalizeTranscriptSearch(caption.text), words } }
}

export function remapVideoEditCaptionSpeech(caption: VideoEditCaption, clipIds: ReadonlyMap<string, string>): VideoEditCaption {
  return caption.speech ? { ...caption, speech: { ...caption.speech, words: caption.speech.words.map(word => ({ ...word, clipId: clipIds.get(word.clipId) ?? word.clipId })) } } : caption
}

/** Clips may split or change speed; source intervals keep their identity through both. */
export function createVideoEditSpeechCaptionRetimer(before: VideoEditSequence, after: VideoEditSequence, origins: ReadonlyMap<string, VideoEditContentOrigin>): (caption: VideoEditCaption) => VideoEditCaption[] {
  const fps = videoEditFps(before.frameRate)
  const oldClips = new Map(before.clips.map(clip => [clip.id, clip]))
  const descendants = new Map<string, VideoEditClip[]>()
  for (const clip of after.clips) {
    const origin = origins.get(clip.id)?.originalId ?? clip.id
    const values = descendants.get(origin) ?? []; values.push(clip); descendants.set(origin, values)
  }
  const newClips = new Map(after.clips.map(clip => [clip.id, clip]))
  return caption => {
    const speech = caption.speech!
    // A source replacement does not establish new speech evidence. Keep the authored caption for review.
    if (speech.words.some(word => descendants.get(word.clipId)?.some(clip => clip.itemId !== oldClips.get(word.clipId)?.itemId))) {
      return [{ ...caption, speech: undefined, clipId: undefined, reviewReasons: [...new Set([...(caption.reviewReasons ?? []), 'text' as const, 'timing' as const])] }]
    }
    const groups = new Map<string, { clip: VideoEditClip; previous: VideoEditClip; words: VideoEditCaptionSpeechWord[]; indices: number[]; partial: boolean }>()
    speech.words.forEach((word, index) => {
      const previous = oldClips.get(word.clipId)
      if (!previous) return
      for (const clip of descendants.get(word.clipId) ?? []) {
        const range = videoEditClipSourceRange(clip, fps)
        const low = Math.round(range.from * 1e6); const high = Math.round(range.to * 1e6)
        if ((word.endUs === word.startUs ? word.startUs < low : word.endUs <= low) || word.startUs >= high) continue
        const group = groups.get(clip.id) ?? { clip, previous, words: [], indices: [], partial: false }
        const startUs = Math.max(low, word.startUs); const endUs = Math.min(high, word.endUs)
        group.partial ||= startUs !== word.startUs || endUs !== word.endUs
        group.words.push({ ...word, clipId: clip.id, startUs, endUs, ...(startUs !== word.startUs || endUs !== word.endUs ? { precision: 'estimated' as const } : {}) }); group.indices.push(index); groups.set(clip.id, group)
      }
    })
    const outputs: VideoEditCaption[] = []
    for (const { clip, previous, words, indices, partial } of groups.values()) {
      const sourceAt = (frame: number): number => videoEditClipSourceSecondsAtTime(previous, frame / fps, fps)
      const a = videoEditClipFrameBoundaryAtSource(clip, sourceAt(Math.max(previous.start, caption.start)), fps)
      const b = videoEditClipFrameBoundaryAtSource(clip, sourceAt(Math.min(previous.start + previous.duration, caption.start + caption.duration)), fps)
      const start = Math.max(clip.start, Math.round(Math.min(a, b)))
      const end = Math.min(clip.start + clip.duration, Math.round(Math.max(a, b)))
      if (end <= start) continue
      const changed = indices.length !== speech.words.length || partial
      const retained = changed && speech.aligned && normalizeTranscriptSearch(caption.text) === normalizeTranscriptSearch(speech.text) ? retainedCaptionText(caption.text, speech.words, indices) : undefined
      const canRewrite = retained !== undefined
      const text = changed && canRewrite ? retained.slice(0, 2000) : caption.text
      if (!text.trim()) continue
      const reviewReasons: VideoEditCaptionReview = [...new Set([...(caption.reviewReasons ?? []),
        ...(changed && !canRewrite ? ['text' as const] : []), ...(changed && caption.translation ? ['translation' as const] : []),
        ...(partial || changed && words.some(word => word.precision === 'estimated') || previous.reverse !== clip.reverse ? ['timing' as const] : []),
      ])]
      outputs.push({ ...caption, id: outputs.length ? crypto.randomUUID() : caption.id, clipId: clip.id, start, duration: end - start, text,
        ...(changed && canRewrite ? { sourceText: join(words) } : {}), speech: { ...speech, text: changed && canRewrite ? text : speech.text, words },
        ...(reviewReasons.length ? { reviewReasons } : {}),
      })
    }
    // Unrelated edits cannot change a cue's ownership, layout or authored timing.
    if (groups.size && speech.words.every(word => {
      const previous = oldClips.get(word.clipId); const next = newClips.get(word.clipId)
      return previous && next && previous.itemId === next.itemId && previous.start === next.start && previous.duration === next.duration && previous.sourceInUs === next.sourceInUs && JSON.stringify(previous.speed) === JSON.stringify(next.speed) && JSON.stringify(previous.timeRemap) === JSON.stringify(next.timeRemap) && previous.reverse === next.reverse
    })) return [caption]
    return outputs.sort((left, right) => left.start - right.start)
  }
}

/** A deliberate subtitle split/reflow selects evidence on both its time and text ranges. */
export function sliceVideoEditCaptionSpeech(caption: VideoEditCaption, sequence: VideoEditSequence): VideoEditCaption {
  if (!caption.speech) return caption
  const fps = videoEditFps(sequence.frameRate)
  const clips = new Map(sequence.clips.map(clip => [clip.id, clip]))
  const words = caption.speech.words.flatMap(word => {
    const clip = clips.get(word.clipId)
    if (!clip) return []
    const a = videoEditClipFrameBoundaryAtSource(clip, word.startUs / 1e6, fps)
    const b = videoEditClipFrameBoundaryAtSource(clip, word.endUs / 1e6, fps)
    return Math.max(a, b) > caption.start && Math.min(a, b) < caption.start + caption.duration ? [word] : []
  })
  if (!words.length) return { ...caption, speech: undefined, reviewReasons: [...new Set([...(caption.reviewReasons ?? []), 'timing' as const])] }
  return bindVideoEditCaptionSpeech(caption, words)
}
