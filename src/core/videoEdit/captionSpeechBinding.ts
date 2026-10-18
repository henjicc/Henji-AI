import type { VideoEditComposition } from './document'
import type { VideoEditCaption } from './timedContent'
import { videoEditTranscriptWords } from './textTranscript'
import { videoEditClipSourceSecondsAtTime } from './clipSpeed'
import { bindVideoEditCaptionSpeech, type VideoEditCaptionSpeechWord } from './captionSpeech'

/** Reuse the transcript projection, including linked sound and nested source clocks. */
export function bindVideoEditTranscriptCaptions(composition: VideoEditComposition, captions: readonly VideoEditCaption[]): VideoEditCaption[] {
  if (!captions.some(caption => !caption.speech)) return [...captions]
  const words = videoEditTranscriptWords(composition)
  const clips = new Map(composition.clips.map(clip => [clip.id, clip]))
  const result = [...captions]
  let nextWord = 0; let active: typeof words = []
  for (const { caption, index } of captions.map((caption, index) => ({ caption, index })).sort((left, right) => left.caption.start - right.caption.start)) {
    if (caption.speech) continue
    while (nextWord < words.length && words[nextWord].from < caption.start + caption.duration) active.push(words[nextWord++])
    active = active.filter(word => word.to > caption.start)
    const owner = caption.clipId ? clips.get(caption.clipId) : undefined
    const candidates = active.filter(word => word.from < caption.start + caption.duration
      && (!owner || word.clipId === owner.id || Boolean(owner.linkId && owner.linkId === clips.get(word.clipId)?.linkId)))
    const evidence = candidates.map((word): VideoEditCaptionSpeechWord => {
      const clip = clips.get(word.clipId)!
      const sourceAt = (frame: number): number => Math.max(0, Math.round(videoEditClipSourceSecondsAtTime(clip, frame / composition.fps, composition.fps) * 1e6))
      const a = sourceAt(word.from); const b = sourceAt(word.to)
      const low = Math.min(a, b); const high = Math.max(a, b)
      const startUs = word.sourceVoiceId ? low : Math.max(low, word.startFrame)
      const endUs = word.sourceVoiceId ? high : Math.min(high, word.endFrame)
      return { clipId: clip.id, text: word.text, startUs, endUs, precision: word.granularity === 'word' && !word.sourceVoiceId && startUs === word.startFrame && endUs === word.endFrame ? 'word' : 'estimated' }
    })
    result[index] = bindVideoEditCaptionSpeech(caption, evidence)
  }
  return result
}
