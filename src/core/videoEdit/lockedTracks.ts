import type { VideoEditDocument, VideoEditSequence } from './document'

/** Lock is an editing constraint, not an output switch. Undo restores the whole transaction. */
export function assertVideoEditLockedTracks(before: VideoEditDocument, after: VideoEditDocument): void {
  for (const sequence of before.sequences) {
    const target = after.sequences.find(value => value.id === sequence.id)
    for (const track of sequence.tracks.filter(value => value.locked)) {
      const nextTrack = target?.tracks.find(value => value.id === track.id)
      if (!target || !nextTrack || nextTrack.index !== track.index || nextTrack.kind !== track.kind) throw new Error(`轨道“${track.name}”已锁定，请先解锁再编辑。`)
      const content = (value: VideoEditSequence): string => {
        const clips = value.clips.filter(clip => clip.track === track.index).sort((a, b) => a.id.localeCompare(b.id))
        const ids = new Set(clips.map(clip => clip.id))
        const annotations = value.annotations.filter(mark => ids.has(mark.clipId)).sort((a, b) => a.id.localeCompare(b.id))
        const markers = (value.markers ?? []).filter(mark => mark.clipId && ids.has(mark.clipId)).sort((a, b) => a.id.localeCompare(b.id))
        const captions = (value.captions ?? []).filter(caption => caption.clipId && ids.has(caption.clipId)).sort((a, b) => a.id.localeCompare(b.id))
        const transitions = (value.transitions ?? []).filter(transition => ids.has(transition.leftClipId) || ids.has(transition.rightClipId)).sort((a, b) => a.id.localeCompare(b.id))
        return JSON.stringify({ clips, annotations, markers, captions, transitions })
      }
      if (content(sequence) !== content(target)) throw new Error(`轨道“${track.name}”已锁定，请先解锁再编辑。`)
    }
  }
}

export function assertVideoEditClipsEditable(sequence: VideoEditSequence, ids: readonly string[]): void {
  const selected = new Set(ids)
  for (const clip of sequence.clips) if (selected.has(clip.id)) {
    const track = sequence.tracks.find(value => value.index === clip.track)
    if (!track || track.locked) throw new Error(`片段“${clip.name}”所在轨道已锁定。`)
  }
}
