import { isCodeImageReference, type CodeParameterValues } from './codeMaterial/contract'
import { type VideoEditComposition, type VideoEditClip } from './document'
import type { CodeImageReference } from '../imaging/parameterTypes'

export function codeMediaInputKey(clipId: string, parameter: string): string { return `code-input:${JSON.stringify([clipId, parameter])}` }
export function codeMediaFrameParameters(clip: VideoEditClip, parameters: CodeParameterValues): CodeParameterValues {
  return Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, isCodeImageReference(value) && value.kind !== 'image' ? { kind: 'image', mediaId: codeMediaInputKey(clip.id, key) } : value]))
}
/** Produces a normal composition; the ordinary renderer remains the sole decoder/compositor. */
export function codeMediaInputSeconds(clip: Pick<VideoEditClip, 'start'>, reference: CodeImageReference, frame: number, fps: number): number { return reference.time ?? (frame - clip.start) / fps }
export function codeMediaInputComposition(document: VideoEditComposition, clip: VideoEditClip, reference: CodeImageReference, frame: number): { document: VideoEditComposition; frame: number; sessionKey: string; sampleKey: string } {
  if (reference.kind === 'sequence') {
    const clips = document.clips.filter(candidate => candidate.track < clip.track)
    const ids = new Set(clips.map(candidate => candidate.id))
    return { document: { ...document, clips, captions: [], transitions: document.transitions?.filter(transition => (!transition.leftClipId || ids.has(transition.leftClipId)) && (!transition.rightClipId || ids.has(transition.rightClipId))) }, frame, sessionKey: JSON.stringify([document.id, 'below', clip.track]), sampleKey: String(frame) }
  }
  const media = document.media.find(media => media.id === reference.mediaId && media.kind === 'video')
  const item = document.items.find(item => item.mediaId === media?.id)
  if (!media || !item) throw new Error('视频图片参数引用的素材不存在。')
  const seconds = codeMediaInputSeconds(clip, reference, frame, document.fps)
  if (seconds < 0 || seconds >= media.durationSeconds) throw new Error('视频图片参数的取帧时间超出素材范围。')
  const sourceUs = seconds * 1e6
  const input: VideoEditClip = { id: `code-video:${media.id}`, itemId: item.id, name: media.name, kind: 'video', start: 0, duration: 1, track: 0, sourceInUs: Math.floor(sourceUs), sourceRemainder: { numerator: Math.floor((sourceUs % 1) * 1e6), denominator: 1e6 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }
  const sessionKey = JSON.stringify([document.id, 'video', media.id, media.path, media.sourceRevision, media.assetContent, media.width, media.height, media.durationSeconds, media.frameRate, media.frameRateMode])
  return { document: { ...document, width: media.width, height: media.height, pixelAspectRatio: { numerator: 1, denominator: 1 }, clips: [input], tracks: [{ id: 'code-input', name: '画面', kind: 'video', index: 0, locked: false, enabled: true, muted: true, solo: false }], captions: [], transitions: [] }, frame: 0, sessionKey, sampleKey: JSON.stringify([input.sourceInUs, input.sourceRemainder]) }
}
