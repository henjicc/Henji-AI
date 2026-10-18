import type { MediaContentFact, MediaContentRange } from '../media/contentIndex'
import { mergeMediaContentRanges } from '../media/contentIndex'
import type { AudioEditProjectDocument } from '../audioEdit/types'
import type { RecordingDocument } from '../screenRecording/document'
import type { VideoEditDocument, VideoEditMedia } from './document'
import { videoEditComposition } from './document'
import { videoEditTextMediaIdentity } from './textTranscript'
import { videoEditClipSourceSecondsAtTime } from './clipSpeed'
import { videoEditFps } from './time'

export function audioDocumentContentFacts(audio: AudioEditProjectDocument): MediaContentFact[] {
  let group = 0
  return audio.transcript.flatMap(block => {
    if (!block.included) { group++; return [] }
    return [{ id: `audio:${audio.id}:${block.id}`, kind: 'transcript' as const, text: block.text,
      ranges: [{ fromUs: Math.round(block.startFrame * 1e6 / audio.source.sampleRate), toUs: Math.round(block.endFrame * 1e6 / audio.source.sampleRate) }],
      basis: 'saved' as const, precision: block.granularity === 'word' ? 'word' as const : 'segment' as const,
      originRef: { kind: 'audio_edit.document', id: audio.id }, recordId: block.id, transcriptGroup: `audio:${audio.id}:${group}` }]
  })
}

export function videoEditSavedContentFacts(document: VideoEditDocument, itemIds: readonly string[], media: VideoEditMedia): MediaContentFact[] {
  const ids = new Set(itemIds); const facts: MediaContentFact[] = []; const seenSources = new Set<string>()
  for (const sequence of document.sequences) {
    const originRef = { kind: 'video_edit.sequence', id: `${document.id}:${sequence.id}` }
    const composition = videoEditComposition(document, sequence.id)
    for (const source of sequence.textTranscription?.sources ?? []) {
      if (!ids.has(source.itemId) || source.mediaIdentity !== videoEditTextMediaIdentity(composition, source.itemId)) continue
      const signature = JSON.stringify([source.audioMappingIdentity, source.blocks])
      if (seenSources.has(signature)) continue
      seenSources.add(signature)
      let group = 0
      for (const block of source.blocks) {
        if (!block.included) { group++; continue }
        facts.push({ id: `source:${sequence.id}:${source.itemId}:${block.id}`, kind: 'transcript', text: block.text,
          ranges: [{ fromUs: block.startFrame, toUs: block.endFrame }], basis: 'saved', precision: block.granularity === 'word' ? 'word' : 'segment',
          originRef, recordId: block.id, transcriptGroup: `${sequence.id}:${source.itemId}:${source.audioMappingIdentity ?? ''}:${group}` })
      }
    }
    const fps = videoEditFps(sequence.frameRate)
    const targetClips = new Map(sequence.clips.filter(clip => ids.has(clip.itemId)).map(clip => [clip.id, clip]))
    for (const caption of sequence.captions ?? []) {
      let ranges: MediaContentRange[] = (caption.speech?.words ?? []).filter(word => targetClips.has(word.clipId)).map(word => ({ fromUs: word.startUs, toUs: word.endUs }))
      if (!ranges.length && caption.clipId && targetClips.has(caption.clipId)) {
        const clip = targetClips.get(caption.clipId)!
        const start = Math.max(clip.start, caption.start); const end = Math.min(clip.start + clip.duration, caption.start + caption.duration)
        if (end > start) {
          const a = videoEditClipSourceSecondsAtTime(clip, start / fps, fps); const b = videoEditClipSourceSecondsAtTime(clip, end / fps, fps)
          ranges = [{ fromUs: Math.max(0, Math.round(Math.min(a, b) * 1e6)), toUs: Math.max(0, Math.round(Math.max(a, b) * 1e6)) }]
        }
      }
      if (ranges.length) facts.push({ id: `caption:${sequence.id}:${caption.id}`, kind: 'caption', text: caption.text, ranges: mergeMediaContentRanges(ranges), basis: 'timeline', precision: 'caption', originRef: { kind: 'video_edit.caption', id: `${document.id}:${caption.id}` }, recordId: caption.id })
    }
  }
  const origin = media.creativeSource
  if (origin?.type === 'generation' && origin.prompt?.trim()) facts.push({ id: `intent:${media.id}`, kind: 'description', text: origin.prompt,
    ranges: [{ fromUs: 0, toUs: Math.round(media.durationSeconds * 1e6) }], basis: 'intent', precision: 'segment', originRef: { kind: 'video_edit.media', id: `${document.id}:${media.id}` }, recordId: media.id })
  return facts
}

/** Recording steps/chapters use the session clock; project only their intersections with this actual media file. */
export function recordingMediaContentFacts(recordingId: string, recording: RecordingDocument, mediaIds: readonly string[]): MediaContentFact[] {
  const result: MediaContentFact[] = []
  const originRef = { kind: 'screen_recording.understanding', id: recordingId }
  const stepsById = new Map(recording.understanding.steps.map(step => [step.id, step]))
  for (const media of recording.media.filter(value => mediaIds.includes(value.id))) {
    const project = (from: number, to: number): MediaContentRange[] => {
      const start = Math.max(media.monoUs, from); const end = Math.min(media.monoUs + media.durationUs, to)
      return end > start ? [{ fromUs: start - media.monoUs, toUs: end - media.monoUs }] : []
    }
    for (const step of recording.understanding.steps) {
      const ranges = project(step.startUs, step.endUs)
      if (ranges.length) result.push({ id: `step:${recordingId}:${media.id}:${step.id}`, kind: 'description', text: [step.title, step.description].filter(Boolean).join('：'), ranges, basis: 'saved', precision: 'segment', originRef, recordId: step.id })
    }
    for (const chapter of recording.understanding.chapters) {
      const steps = chapter.stepIds.flatMap(id => stepsById.has(id) ? [stepsById.get(id)!] : [])
      const ranges = mergeMediaContentRanges(steps.flatMap(step => project(step.startUs, step.endUs)))
      if (ranges.length) result.push({ id: `chapter:${recordingId}:${media.id}:${chapter.id}`, kind: 'chapter', text: chapter.title, ranges, basis: 'saved', precision: 'segment', originRef, recordId: chapter.id })
    }
    for (const block of recording.understanding.transcript.filter(value => value.mediaId === media.id)) {
      const ranges = project(block.startUs, block.endUs)
      if (ranges.length) result.push({ id: `recording-word:${recordingId}:${block.id}`, kind: 'transcript', text: block.text, ranges, basis: 'saved', precision: block.granularity === 'word' ? 'word' : 'segment', originRef, recordId: block.id, transcriptGroup: `recording:${recordingId}:${media.id}` })
    }
  }
  return result
}
