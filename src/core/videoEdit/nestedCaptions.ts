import type { VideoEditSequence } from './document'
import type { VideoEditCaption } from './timedContent'
import { createVideoEditSpeechCaptionRetimer } from './captionSpeech'
import { advanceVideoEditClipSource, videoEditClipSourceRange, type VideoEditClipTiming } from './clipSpeed'
import { videoEditFps } from './time'

const projections = new WeakMap<VideoEditSequence, Map<string, VideoEditCaption[]>>()

/** A trimmed nested instance presents only its retained speech, without editing the shared child. */
export function projectVideoEditNestedCaptions(sequence: VideoEditSequence, timing: VideoEditClipTiming, parentFps: number): VideoEditCaption[] | undefined {
  if (!sequence.captions?.some(caption => caption.speech)) return sequence.captions
  const range = videoEditClipSourceRange(timing, parentFps); const fps = videoEditFps(sequence.frameRate)
  const from = Math.floor(range.from * fps + 1e-6); const to = Math.ceil(range.to * fps - 1e-6)
  if (sequence.captions.every(caption => caption.start >= from && caption.start + caption.duration <= to)) return sequence.captions
  const key = `${from}:${to}`
  let cache = projections.get(sequence)
  if (!cache) { cache = new Map(); projections.set(sequence, cache) }
  const known = cache.get(key)
  if (known) return known
  const clips = sequence.clips.flatMap(clip => {
    const start = Math.max(from, clip.start); const end = Math.min(to, clip.start + clip.duration)
    return end > start ? [{ ...clip, ...advanceVideoEditClipSource(clip, start - clip.start, sequence.frameRate), start, duration: end - start }] : []
  })
  const retime = createVideoEditSpeechCaptionRetimer(sequence, { ...sequence, clips }, new Map())
  const captions = sequence.captions.flatMap(caption => caption.speech ? retime(caption).map((value, index) => ({ ...value, id: index ? `${caption.id}:view:${index}` : caption.id })) : [caption])
  while (cache.size >= 8) cache.delete(cache.keys().next().value!)
  cache.set(key, captions)
  return captions
}
