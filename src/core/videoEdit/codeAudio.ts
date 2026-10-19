import { videoEditClipSchema, type VideoEditClip, type VideoEditComposition } from './document'
import { isCodeAudioReference, type CodeParameterValues } from './codeMaterial/contract'

export interface CodeAudioComposition { document: VideoEditComposition; start: number; duration: number }
const compositions = new WeakMap<VideoEditComposition, Map<string, CodeAudioComposition>>()
export function codeAudioReferenceMediaId(parameters: CodeParameterValues): string | undefined { return Object.values(parameters).find(isCodeAudioReference)?.mediaId }
/** Audio follows local playback, independently of the source-anchored author clock. */
export function codeAudioTime(clip: Pick<VideoEditClip, 'start'>, frame: number, fps: number): number { return (frame - clip.start) / fps }
export function codeMotionAudioKey(sequenceId: string, clipId: string): string { return JSON.stringify([sequenceId, clipId]) }

export function codeAudioComposition(document: VideoEditComposition, clip: VideoEditClip, mediaId?: string): CodeAudioComposition {
  let entries = compositions.get(document)
  if (!entries) { entries = new Map(); compositions.set(document, entries) }
  const key = JSON.stringify([clip.id, clip.start, clip.duration, clip.track, mediaId])
  let result = entries.get(key)
  if (!result) { result = audioComposition(document, clip, mediaId); entries.set(key, result) }
  return result
}
function audioComposition(document: VideoEditComposition, clip: VideoEditClip, mediaId?: string): CodeAudioComposition {
  if (mediaId) {
    const media = document.media.find(media => media.id === mediaId && ['audio', 'video'].includes(media.kind))
    if (!media) throw new Error('音频参数引用的音频或视频素材不存在。')
    const item = document.items.find(item => item.mediaId === media.id)
    if (!item) throw new Error('音频素材项不存在。')
    const source = videoEditClipSchema.parse({ id: 'content-audio', itemId: item.id, name: media.name, kind: media.kind, start: 0, track: 0, duration: Math.max(1, Math.ceil(media.durationSeconds * document.fps)), sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, text: '', volume: 1 })
    return { document: { ...document, clips: [source], transitions: [], tracks: [{ id: 'content-audio', name: '音频', kind: 'audio', index: 0, enabled: true, muted: false, solo: false, locked: false }] }, start: 0, duration: Math.max(1 / document.fps, media.durationSeconds) }
  }
  const clips = document.clips.filter(candidate => candidate.id !== clip.id && candidate.track < clip.track)
  const ids = new Set(clips.map(candidate => candidate.id))
  return { document: { ...document, clips, transitions: document.transitions?.filter(transition => (!transition.leftClipId || ids.has(transition.leftClipId)) && (!transition.rightClipId || ids.has(transition.rightClipId))) }, start: clip.start / document.fps, duration: clip.duration / document.fps }
}
