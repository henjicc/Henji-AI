import type { VideoEditClip, VideoEditComposition } from './document'

/** Render the input of one effect, including only its predecessors. This is a
 * transient view of the original timeline: source clocks and data stay intact. */
export function codeFilterInputComposition(document: VideoEditComposition, clipId: string, effectId: string): VideoEditComposition {
  const clip = document.clips.find(value => value.id === clipId)
  const index = clip?.effects?.findIndex(value => value.id === effectId) ?? -1
  if (!clip || index < 0) throw new Error('滤镜输入的片段或效果已移除。')
  const prefix: VideoEditClip = { ...clip, effects: clip.effects!.slice(0, index) }
  if (clip.kind === 'adjustment') {
    // Adjustment opacity/fades mix the completed chain, not each input pass.
    prefix.opacity = 1
    prefix.curves = { ...clip.curves }; delete prefix.curves.opacity
    delete prefix.fadeInFrames; delete prefix.fadeOutFrames
  }
  const clips = document.clips.filter(candidate => candidate.id === clipId || clip.kind === 'adjustment' && candidate.track >= clip.adjustment!.fromTrack && candidate.track < clip.track)
    .map(candidate => candidate.id === clipId ? prefix : candidate)
  const ids = new Set(clips.map(value => value.id))
  return { ...document, clips, captions: [], transitions: document.transitions?.filter(transition =>
    transition.leftClipId !== clipId && transition.rightClipId !== clipId &&
    (!transition.leftClipId || ids.has(transition.leftClipId)) && (!transition.rightClipId || ids.has(transition.rightClipId))) }
}
