import type { VideoEditSequence } from './document'

/** Copy all sequence-owned references together, keeping source media shared. */
export function copyVideoEditSequence(source: VideoEditSequence): VideoEditSequence {
  const sequence = structuredClone(source); sequence.id = crypto.randomUUID(); sequence.name = `${source.name} 副本`
  const clips = new Map(source.clips.map(clip => [clip.id, crypto.randomUUID()]))
  const links = new Map(source.clips.filter(clip => clip.linkId).map(clip => [clip.linkId!, crypto.randomUUID()]))
  const groups = new Map(source.clips.filter(clip => clip.groupId).map(clip => [clip.groupId!, crypto.randomUUID()]))
  const tracks = new Map(source.tracks.map(track => [track.id, crypto.randomUUID()]))
  sequence.tracks = sequence.tracks.map(track => ({ ...track, id: tracks.get(track.id)! }))
  sequence.clips = sequence.clips.map(clip => ({ ...clip, id: clips.get(clip.id)!, ...(clip.effects ? { effects: clip.effects.map(effect => ({ ...effect, id: crypto.randomUUID() })) } : {}), ...(clip.follow ? { follow: { ...clip.follow, clipId: clips.get(clip.follow.clipId) ?? clip.follow.clipId } } : {}), ...(clip.linkId ? { linkId: links.get(clip.linkId) } : {}), ...(clip.groupId ? { groupId: groups.get(clip.groupId) } : {}) }))
  sequence.annotations = sequence.annotations.map(mark => ({ ...mark, id: crypto.randomUUID(), ...(mark.clipId ? { clipId: clips.get(mark.clipId)! } : {}), target: mark.target.kind === 'range' ? { ...mark.target, clipIds: mark.target.clipIds?.map(id => clips.get(id)!), trackIds: mark.target.trackIds?.map(id => tracks.get(id)!) } : mark.target, status: mark.status === 'draft' ? 'draft' : 'open', addressedBy: undefined }))
  if (sequence.markers) sequence.markers = sequence.markers.map(mark => ({ ...mark, id: crypto.randomUUID(), ...(mark.clipId ? { clipId: clips.get(mark.clipId)! } : {}) }))
  if (sequence.captions) sequence.captions = sequence.captions.map(caption => ({ ...caption, id: crypto.randomUUID(), ...(caption.clipId ? { clipId: clips.get(caption.clipId)! } : {}) }))
  if (sequence.transitions) sequence.transitions = sequence.transitions.map(transition => ({ ...transition, id: crypto.randomUUID(), ...(transition.leftClipId ? { leftClipId: clips.get(transition.leftClipId)! } : {}), ...(transition.rightClipId ? { rightClipId: clips.get(transition.rightClipId)! } : {}) }))
  return sequence
}
