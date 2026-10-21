import { sliceVideoEditClipKeyframes } from './keyframes'
import type { VideoEditClip, VideoEditDocument } from './document'
import { videoEditClipFrameBoundaryAtSource } from './clipSpeed'
import { videoEditFps, videoEditSourceSeconds } from './time'
import type { VideoEditDocumentSource } from './creativeResult'

export interface AudioLinkNotice { clipId: string; message: string }
/** A shorter source trims only the tail. An entirely exhausted clip is removed; followers never ripple. */
export function updateVideoEditAudioLinks(document: VideoEditDocument, documentId: string, itemId: string, source: VideoEditDocumentSource, durationSeconds: number): { document: VideoEditDocument; notices: AudioLinkNotice[]; changed: number } {
  const notices: AudioLinkNotice[] = []
  let changed = 0
  const sequences = document.sequences.map(sequence => {
    const removed = new Set<string>()
    const clips = sequence.clips.flatMap((clip): VideoEditClip[] => {
      if (clip.kind !== 'audio' || clip.creativeSource?.type !== 'document' || clip.creativeSource.docRef.docId !== documentId) return [clip]
      changed++
      const head = videoEditSourceSeconds(clip)
      const boundary = clip.frameHold ? clip.duration : videoEditClipFrameBoundaryAtSource(clip, clip.reverse ? 0 : durationSeconds, videoEditFps(sequence.frameRate)) - clip.start
      const duration = (clip.reverse ? head > durationSeconds : head >= durationSeconds) ? 0 : Math.min(clip.duration, Math.max(0, Math.floor(boundary + 1e-7)))
      if (duration < clip.duration) notices.push({ clipId: clip.id, message: duration ? '音频作品变短，片段结尾已截短，后续片段位置保持不变。' : '音频作品已短于片段入点，该声音片段已移除，后续片段位置保持不变。' })
      if (!duration) { removed.add(clip.id); return [] }
      return [{ ...sliceVideoEditClipKeyframes(clip, 0, duration), itemId, duration, ...(clip.fadeInFrames ? { fadeInFrames: Math.min(duration, clip.fadeInFrames) } : {}), ...(clip.fadeOutFrames ? { fadeOutFrames: Math.min(duration, clip.fadeOutFrames) } : {}), creativeSource: source }]
    })
    // Timeline transitions cannot retain references to exhausted clips.
    return { ...sequence, clips, ...(sequence.transitions ? { transitions: sequence.transitions.filter(t => !removed.has(t.leftClipId ?? "") && !removed.has(t.rightClipId ?? "")) } : {}) }
  })
  return { document: { ...document, sequences }, notices, changed }
}
