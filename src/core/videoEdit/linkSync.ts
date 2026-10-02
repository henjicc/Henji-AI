import type { VideoEditClip, VideoEditSequence } from './document'
import { videoEditFps, videoEditSourceSeconds } from './time'

/**
 * Premiere out-of-sync indicators: only linked portions of the same source (picture/sound
 * components and, later, several sound streams of one item) have a sync relation.
 * Linking two unrelated clips never reports an offset.
 *
 * A clip's sync anchor is the timeline frame where its source time zero would sit; portions
 * in sync share one anchor. The anchor shared by most portions is the reference (ties prefer
 * the picture component, then the lower track, then the earlier clip). Deviating portions show
 * their signed offset in frames; in the classic two-portion pair both sides are marked, as in
 * Premiere, with opposite signs.
 */
interface Portion { clip: VideoEditClip; anchor: number }
function syncSets(sequence: VideoEditSequence): Portion[][] {
  const fps = videoEditFps(sequence.frameRate); const sets = new Map<string, Portion[]>()
  for (const clip of sequence.clips) {
    if (!clip.linkId || (clip.kind !== 'video' && clip.kind !== 'audio')) continue
    const key = `${clip.linkId}\n${clip.itemId}`
    sets.set(key, [...(sets.get(key) ?? []), { clip, anchor: clip.start - videoEditSourceSeconds(clip) * fps }])
  }
  return [...sets.values()].filter(set => set.length > 1)
}
function referenceAnchor(set: readonly Portion[]): number {
  const candidates = new Map<number, { count: number; picture: boolean; track: number; start: number }>()
  for (const { clip, anchor } of set) {
    const key = Math.round(anchor); const picture = clip.kind === 'video'
    const value = candidates.get(key)
    if (!value) candidates.set(key, { count: 1, picture, track: clip.track, start: clip.start })
    else candidates.set(key, { count: value.count + 1, picture: value.picture || picture, track: Math.min(value.track, clip.track), start: Math.min(value.start, clip.start) })
  }
  return [...candidates.entries()].sort(([, a], [, b]) => b.count - a.count || Number(b.picture) - Number(a.picture) || a.track - b.track || a.start - b.start)[0][0]
}
function setOffsets(set: readonly Portion[]): { offsets: Map<string, number>; deviating: Set<string> } {
  const reference = referenceAnchor(set); const offsets = new Map<string, number>(); const deviating = new Set<string>()
  for (const { clip, anchor } of set) {
    const offset = Math.round(anchor) - reference
    if (offset) { offsets.set(clip.id, offset); deviating.add(clip.id) }
  }
  if (set.length === 2 && deviating.size === 1) {
    const other = set.find(portion => !deviating.has(portion.clip.id))!
    offsets.set(other.clip.id, -offsets.get([...deviating][0])!)
  }
  return { offsets, deviating }
}

/** Displayed out-of-sync offsets in sequence frames, keyed by clip id; in-sync clips are absent. */
export function videoEditSyncOffsets(sequence: VideoEditSequence): Map<string, number> {
  const result = new Map<string, number>()
  for (const set of syncSets(sequence)) for (const [id, offset] of setOffsets(set).offsets) result.set(id, offset)
  return result
}

/**
 * Frames to remove from each selected portion to bring it back into sync ("Move into sync" moves
 * the clip earlier by this amount, "Slip into sync" advances its source). When a selection holds
 * both a deviating portion and its reference, only the deviating portion is corrected so the two
 * sides never swap.
 */
export function videoEditSyncCorrections(sequence: VideoEditSequence, clipIds: readonly string[]): Map<string, number> {
  const selected = new Set(clipIds); const result = new Map<string, number>()
  for (const set of syncSets(sequence)) {
    const { offsets, deviating } = setOffsets(set)
    const chosen = set.filter(portion => selected.has(portion.clip.id) && deviating.has(portion.clip.id))
    const targets = chosen.length ? chosen : set.filter(portion => selected.has(portion.clip.id) && offsets.has(portion.clip.id))
    for (const { clip } of targets) result.set(clip.id, offsets.get(clip.id)!)
  }
  return result
}
