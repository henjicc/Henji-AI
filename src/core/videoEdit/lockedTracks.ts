import { jsonEqual } from '../jsonEqual'
import type { VideoEditDocument, VideoEditSequence } from './document'
import { videoEditTransitionClipIds } from './transitions'
import { videoEditCaptionClipIds } from './captionSpeech'

/**
 * Lock is an editing constraint, not an output switch. Undo restores the whole transaction.
 * 批注是审片记录而不是画面内容：锁定轨道上片段挂的批注照样可以增删、改状态和回复。
 */
export function assertVideoEditLockedTracks(before: VideoEditDocument, after: VideoEditDocument): void {
  for (const sequence of before.sequences) {
    const target = after.sequences.find(value => value.id === sequence.id)
    if (target === sequence) continue
    if (sequence.captionTrackLocked && (!target || !jsonEqual(sequence.captions ?? [], target.captions ?? []))) {
      throw new Error('字幕轨道已锁定，请先解锁再编辑。')
    }
    for (const track of sequence.tracks.filter(value => value.locked)) {
      const nextTrack = target?.tracks.find(value => value.id === track.id)
      if (!target || !nextTrack || nextTrack.index !== track.index || nextTrack.kind !== track.kind) throw new Error(`轨道“${track.name}”已锁定，请先解锁再编辑。`)
      const content = (value: VideoEditSequence): unknown => {
        const clips = value.clips.filter(clip => clip.track === track.index).sort((a, b) => a.id.localeCompare(b.id))
        const ids = new Set(clips.map(clip => clip.id))
        const markers = (value.markers ?? []).filter(mark => mark.clipId && Boolean(mark.clipId && ids.has(mark.clipId))).sort((a, b) => a.id.localeCompare(b.id))
        const captions = (value.captions ?? []).filter(caption => videoEditCaptionClipIds(caption).some(id => ids.has(id))).sort((a, b) => a.id.localeCompare(b.id))
        const transitions = (value.transitions ?? []).filter(transition => videoEditTransitionClipIds(transition).some(id => ids.has(id))).sort((a, b) => a.id.localeCompare(b.id))
        return { clips, markers, captions, transitions }
      }
      if (!jsonEqual(content(sequence), content(target))) throw new Error(`轨道“${track.name}”已锁定，请先解锁再编辑。`)
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
