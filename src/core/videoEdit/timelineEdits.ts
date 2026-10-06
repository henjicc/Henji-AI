import { adjustVideoEditClip, splitVideoEditClip, videoEditClipMedia, videoEditComposition, type VideoEditAnnotation, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from './document'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'
import { assertVideoEditClipsEditable } from './lockedTracks'
import { expandVideoEditSelection, type VideoEditRelations } from './timelineSelection'
import { offsetVideoEditSource, rescaleVideoEditFrame, videoEditSourceSeconds, type VideoEditRatio } from './time'
import { videoEditSyncCorrections } from './linkSync'
import { retimeVideoEditContent, type VideoEditMarker, type VideoEditCaption, type VideoEditContentOrigin } from './timedContent'
import { validateVideoEditTransitions, videoEditTransitionClipIds, type VideoEditTransition } from './transitions'
import { validateVideoEditAdjustmentRanges } from './compositing'
import { applyVideoEditTrim, type VideoEditTrimMode } from './timelineTrims'

export interface VideoEditClipboard {
  projectId: string
  frameRate: VideoEditRatio
  clips: VideoEditClip[]
  annotations: VideoEditAnnotation[]
  markers?: VideoEditMarker[]
  captions?: VideoEditCaption[]
  transitions?: VideoEditTransition[]
  tracks?: Array<{ index: number; kind: 'video' | 'audio' }>
}
/**
 * `linked` (default true) extends clip edits to linked and grouped partners. Callers that already
 * resolved the selection (Linked Selection off, Alt single selection) pass `false` so the edit acts
 * on exactly those clips; the link relation itself is kept and drift shows as out-of-sync offsets.
 */
export type VideoEditTimelineEdit =
  /** `newTracks`: tracks created by dragging above the top video track or below the bottom audio track (one edit, one undo). */
  | { kind: 'adjust'; clipIds: string[]; linked?: VideoEditRelations; mode: 'move' | 'in' | 'out'; delta: number; trackMap?: Record<number, number>; snapThreshold?: number; snapFrames?: number[]; newTracks?: VideoEditSequence['tracks'] }
  | { kind: 'split'; clipIds: string[]; linked?: VideoEditRelations; frame: number }
  | { kind: 'delete'; clipIds: string[]; linked?: VideoEditRelations; ripple?: boolean; targetTracks?: number[] }
  | { kind: 'link' | 'unlink' | 'group' | 'ungroup'; clipIds: string[]; linked?: VideoEditRelations }
  | { kind: 'separate_audio'; clipIds: string[]; linked?: VideoEditRelations; audioTrack: number }
  /**
   * Premiere Lift (`ripple: false`) / Extract (`ripple: true`) of `[from, to)` on the given (target) tracks: clips crossing
   * either boundary are cut there, the pieces inside are removed, and Extract closes the gap on sync-locked tracks.
   * Ripple Trim Previous/Next Edit to Playhead (Q/W) is the same edit over the clip's part before/after the playhead.
   */
  | { kind: 'range'; from: number; to: number; tracks: number[]; ripple: boolean }
  /**
   * Premiere modifier drags of the selection by `delta` frames (and `trackMap`): Alt = duplicate (overwrite at the drop),
   * Ctrl+Alt = duplicate and insert, Ctrl = rearrange (extract from the source closing the gap, then insert at the drop).
   */
  | { kind: 'rearrange'; clipIds: string[]; delta: number; trackMap?: Record<number, number>; mode: 'copy' | 'copy_insert' | 'insert'; snapThreshold?: number; snapFrames?: number[]; newTracks?: VideoEditSequence['tracks'] }
  /** Premiere "Move into sync" / "Slip into sync" for the selected out-of-sync portions only. */
  | { kind: 'sync'; clipIds: string[]; mode: 'move' | 'slip' }
  /** `newTracks`: tracks appended before placing (a multi-track item needs more audio tracks than the sequence has, or a drop beyond the outer tracks). */
  | { kind: 'place'; clipboard: VideoEditClipboard; frame: number; mode: 'paste' | 'insert' | 'overwrite'; trackMap?: Record<number, number>; targetTracks?: number[]; newTracks?: VideoEditSequence['tracks'] }
  /** Premiere trim tools (ripple B, roll N, slip Y, slide U), see timelineTrims.ts; `delta` is clamped to what the media and neighbours allow. */
  | { kind: 'trim'; mode: VideoEditTrimMode; clipIds: string[]; linked?: VideoEditRelations; edge?: 'in' | 'out'; delta: number }

/** Appends new tracks before an edit (drag beyond the outer tracks, paste needing more audio tracks); indexes and ids must be unused. */
export function withVideoEditTracks(sequence: VideoEditSequence, added: readonly VideoEditSequence['tracks'][number][] | undefined): VideoEditSequence {
  if (!added?.length) return sequence
  if (added.some(track => track.index < 0 || track.index > 31 || sequence.tracks.some(value => value.index === track.index || value.id === track.id)) || new Set(added.map(track => track.index)).size !== added.length || sequence.tracks.length + added.length > 32) throw new Error('新增的轨道无效，或序列将超过 32 条轨道。')
  return { ...sequence, tracks: [...sequence.tracks, ...added] }
}
/** Snap offset for moving `edges` by `delta`: the nearest candidate within `threshold`, else 0. */
function snapOffset(edges: readonly number[], candidates: readonly number[], delta: number, threshold: number): number {
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error('吸附距离无效。')
  let offset = threshold + 1
  for (const edge of edges) for (const candidate of candidates) {
    const difference = candidate - edge - delta
    if (Math.abs(difference) < Math.abs(offset)) offset = difference
  }
  return Math.abs(offset) <= threshold ? offset : 0
}
function integer(value: number): void { if (!Number.isSafeInteger(value)) throw new Error('剪辑位置和位移必须为整数帧。') }
function sequenceOf(document: VideoEditDocument, id: string): VideoEditSequence {
  const sequence = document.sequences.find(value => value.id === id)
  if (!sequence) throw new Error('目标序列不存在。')
  return sequence
}
function assertTargets(sequence: VideoEditSequence, clips: readonly VideoEditClip[]): void {
  for (const clip of clips) {
    const track = sequence.tracks.find(value => value.index === clip.track)
    if (!track || track.kind !== (clip.kind === 'audio' ? 'audio' : 'video')) throw new Error('目标轨道与片段类型不匹配。')
    if (track.locked) throw new Error(`轨道“${track.name}”已锁定。`)
  }
}
function assertNoOverlap(existing: readonly VideoEditClip[], incoming: readonly VideoEditClip[]): void {
  if (incoming.some(clip => existing.some(other => other.track === clip.track && other.start < clip.start + clip.duration && other.start + other.duration > clip.start))) throw new Error('目标位置已有片段，请换一个落点或使用覆盖编辑。')
}
function assertNewInternalOverlap(before: readonly VideoEditClip[], after: readonly VideoEditClip[]): void {
  for (let index = 0; index < after.length; index++) for (let other = index + 1; other < after.length; other++) {
    const first = after[index]; const second = after[other]
    const overlaps = (left: VideoEditClip, right: VideoEditClip): boolean => left.track === right.track && left.start < right.start + right.duration && left.start + left.duration > right.start
    if (overlaps(first, second) && !overlaps(before[index], before[other])) throw new Error('编辑会使不同片段在同一轨道重叠，请保留独立轨道。')
  }
}
function remapRelations(clips: VideoEditClip[]): VideoEditClip[] {
  const links = new Map<string, string>(); const groups = new Map<string, string>()
  const next = (map: Map<string, string>, id: string): string => { if (!map.has(id)) map.set(id, crypto.randomUUID()); return map.get(id)! }
  return clips.map(clip => ({ ...clip, ...(clip.linkId ? { linkId: next(links, clip.linkId) } : {}), ...(clip.groupId ? { groupId: next(groups, clip.groupId) } : {}) }))
}
/**
 * Right-hand pieces form their own link/group only when every member of that relation crossing
 * the cut was cut too (Premiere: razoring a linked pair yields two linked pairs). When a partner
 * was left whole (Alt single cut, overwrite on some tracks), both pieces stay linked to it.
 */
function separateRightRelations(before: VideoEditSequence, clips: VideoEditClip[], rights: ReadonlyMap<string, string>, frame: number): VideoEditClip[] {
  const cut = new Set(rights.values()); const fresh = new Map<string, string>()
  const locked = new Set(before.tracks.filter(track => track.locked).map(track => track.index))
  const touched = new Set(before.clips.filter(clip => cut.has(clip.id)).flatMap(clip => [clip.linkId ? `linkId:${clip.linkId}` : '', clip.groupId ? `groupId:${clip.groupId}` : '']).filter(Boolean))
  const complete = (key: 'linkId' | 'groupId', relation: string): boolean => touched.has(`${key}:${relation}`) && before.clips.every(clip => clip[key] !== relation || cut.has(clip.id) || !(clip.start < frame && clip.start + clip.duration > frame))
  // Uncut members wholly after the cut follow the right-hand side.
  const follows = (clip: VideoEditClip): boolean => !cut.has(clip.id) && clip.start >= frame && !locked.has(clip.track) && before.clips.some(value => value.id === clip.id)
  return clips.map(clip => {
    if (!rights.has(clip.id) && !follows(clip)) return clip
    const next = { ...clip }
    for (const key of ['linkId', 'groupId'] as const) {
      const relation = clip[key]
      if (!relation || !complete(key, relation)) continue
      if (!fresh.has(`${key}:${relation}`)) fresh.set(`${key}:${relation}`, crypto.randomUUID())
      next[key] = fresh.get(`${key}:${relation}`)!
    }
    return next
  })
}
function splitClips(sequence: VideoEditSequence, ids: string[], frame: number): VideoEditSequence {
  integer(frame)
  let next = sequence
  const rights = new Map<string, string>()
  for (const id of ids) {
    const clip = next.clips.find(value => value.id === id)!
    if (!(frame > clip.start && frame < clip.start + clip.duration)) continue
    const before = new Set(next.clips.map(value => value.id))
    next = splitVideoEditClip(next, id, frame)
    rights.set(next.clips.find(value => !before.has(value.id))!.id, id)
  }
  if (next === sequence) throw new Error('请将播放头置于所选片段内部再拆分。')
  return { ...next, clips: separateRightRelations(sequence, next.clips, rights, frame) }
}
function shiftAnnotations(sequence: VideoEditSequence, clips: VideoEditClip[]): VideoEditAnnotation[] {
  const before = new Map(sequence.clips.map(clip => [clip.id, clip])); const after = new Map(clips.map(clip => [clip.id, clip]))
  return sequence.annotations.flatMap(mark => {
    const previous = before.get(mark.clipId); const current = after.get(mark.clipId)
    if (!previous || !current) return []
    const frame = mark.frame + current.start - previous.start
    return [{ ...mark, frame }]
  })
}
function synchronizedTracks(sequence: VideoEditSequence, targets: readonly number[]): Set<number> {
  if (targets.some(index => !sequence.tracks.some(track => track.index === index))) throw new Error('目标轨道不存在。')
  return new Set([...targets, ...sequence.tracks.filter(track => track.syncLocked !== false).map(track => track.index)])
}
function intervals(clips: readonly VideoEditClip[]): Array<{ from: number; to: number }> {
  const result: Array<{ from: number; to: number }> = []
  for (const clip of [...clips].sort((a, b) => a.start - b.start)) {
    const last = result.at(-1); const to = clip.start + clip.duration
    if (last && clip.start <= last.to) last.to = Math.max(last.to, to)
    else result.push({ from: clip.start, to })
  }
  return result
}

export function copyVideoEditClips(document: VideoEditDocument, sequenceId: string, clipIds: string[], linked: VideoEditRelations = true): VideoEditClipboard {
  const sequence = sequenceOf(document, sequenceId); const ids = new Set(expandVideoEditSelection(sequence, clipIds, linked))
  if (!ids.size) throw new Error('请先选择要复制的片段。')
  return structuredClone({ projectId: document.id, frameRate: sequence.frameRate, clips: sequence.clips.filter(clip => ids.has(clip.id)), annotations: sequence.annotations.filter(mark => ids.has(mark.clipId)), markers: (sequence.markers ?? []).filter(mark => mark.clipId && ids.has(mark.clipId)), captions: (sequence.captions ?? []).filter(caption => caption.clipId && ids.has(caption.clipId)), transitions: (sequence.transitions ?? []).filter(transition => videoEditTransitionClipIds(transition).every(id => ids.has(id))), tracks: sequence.tracks.map(track => ({ index: track.index, kind: track.kind })) })
}

/** Vertical dragging moves the selected lanes of the primary kind; linked audio keeps its lane. */
export function videoEditMoveTrackMap(sequence: VideoEditSequence, clipIds: readonly string[], primaryId: string, targetIndex: number): Record<number, number> {
  const primary = sequence.clips.find(clip => clip.id === primaryId)
  if (!primary || !clipIds.includes(primaryId)) throw new Error('拖动主片段不在选区中。')
  const kind = primary.kind === 'audio' ? 'audio' : 'video'
  const lanes = sequence.tracks.filter(track => track.kind === kind).sort((a, b) => a.index - b.index)
  const source = lanes.findIndex(track => track.index === primary.track); const target = lanes.findIndex(track => track.index === targetIndex)
  if (source < 0 || target < 0) throw new Error('请将片段移动到同类型轨道。')
  const map: Record<number, number> = {}
  for (const clip of sequence.clips.filter(clip => clipIds.includes(clip.id))) {
    if ((clip.kind === 'audio' ? 'audio' : 'video') !== kind) continue
    const lane = lanes[lanes.findIndex(track => track.index === clip.track) + target - source]
    if (!lane) throw new Error('选区超出可用轨道。')
    map[clip.track] = lane.index
  }
  return map
}

export function applyVideoEditTimelineEdit(document: VideoEditDocument, sequenceId: string, edit: VideoEditTimelineEdit, metadata?: CodeMaterialMetadataReader): VideoEditSequence {
  return applyVideoEditTimelineEditResult(document, sequenceId, edit, metadata).sequence
}
export function applyVideoEditTimelineEditResult(document: VideoEditDocument, sequenceId: string, edit: VideoEditTimelineEdit, metadata?: CodeMaterialMetadataReader): { sequence: VideoEditSequence; selectedClipIds?: string[] } {
  if (edit.kind === 'adjust' && edit.newTracks?.length) document = { ...document, sequences: document.sequences.map(value => value.id === sequenceId ? withVideoEditTracks(value, edit.newTracks) : value) }
  const result = edit.kind === 'place' ? placeClips(document, sequenceOf(document, sequenceId), edit) : edit.kind === 'rearrange' ? rearrangeClips(document, sequenceId, edit, metadata) : edit.kind === 'range' ? { sequence: removeRange(sequenceOf(document, sequenceId), edit) } : edit.kind === 'trim' ? { sequence: applyVideoEditTrim(document, sequenceId, { ...edit, clipIds: expandVideoEditSelection(sequenceOf(document, sequenceId), edit.clipIds, edit.linked ?? true) }, metadata).sequence } : { sequence: applyClipEdit(document, sequenceId, edit, metadata) }
  if (result.sequence.clips.length > 500 || result.sequence.annotations.length > 500 || (result.sequence.markers?.length ?? 0) > 500 || (result.sequence.captions?.length ?? 0) > 500 || result.sequence.clips.some(clip => clip.start < 0 || clip.duration < 1 || clip.start + clip.duration > Math.floor(result.sequence.frameRate.numerator / result.sequence.frameRate.denominator * 1800))) throw new Error('编辑结果超出序列片段、标记数量或时间边界。')
  if ((result.sequence.transitions?.length ?? 0) > 500) throw new Error('序列最多500项转场。')
  validateVideoEditAdjustmentRanges(result.sequence)
  validateVideoEditTransitions({ ...document, sequences: document.sequences.map(sequence => sequence.id === sequenceId ? result.sequence : sequence) }, metadata)
  return result
}
function removeRange(sequence: VideoEditSequence, edit: Extract<VideoEditTimelineEdit, { kind: 'range' }>): VideoEditSequence {
  integer(edit.from); integer(edit.to)
  if (edit.to <= edit.from) throw new Error('请先设置有效的入点和出点。')
  const tracks = new Set(edit.tracks.filter(index => sequence.tracks.some(track => track.index === index && !track.locked)))
  if (!tracks.size) throw new Error('请先选择未锁定的目标轨道。')
  let next = sequence
  for (const frame of [edit.from, edit.to]) {
    const crossing = next.clips.filter(clip => tracks.has(clip.track) && clip.start < frame && frame < clip.start + clip.duration).map(clip => clip.id)
    if (crossing.length) next = splitClips(next, crossing, frame)
  }
  const removed = new Set(next.clips.filter(clip => tracks.has(clip.track) && clip.start >= edit.from && clip.start + clip.duration <= edit.to).map(clip => clip.id))
  if (!removed.size) throw new Error('入出点之间的目标轨道上没有片段。')
  let kept = next.clips.filter(clip => !removed.has(clip.id))
  if (edit.ripple) {
    const length = edit.to - edit.from; const affected = synchronizedTracks(next, [...tracks])
    kept = kept.map(clip => {
      if (!affected.has(clip.track) || clip.start + clip.duration <= edit.from) return clip
      if (clip.start < edit.to) throw new Error('波纹范围内的同步锁定轨道还有片段，请先调整目标轨道或关闭该轨道的同步锁定。')
      assertVideoEditClipsEditable(next, [clip.id])
      return { ...clip, start: clip.start - length }
    })
  }
  const origins = new Map(kept.map(clip => [clip.id, { originalId: clip.id, shift: clip.start - next.clips.find(value => value.id === clip.id)!.start }]))
  return retimeVideoEditContent(next, { ...next, clips: kept, annotations: shiftAnnotations(next, kept) }, origins)
}
function rearrangeClips(document: VideoEditDocument, sequenceId: string, edit: Extract<VideoEditTimelineEdit, { kind: 'rearrange' }>, metadata?: CodeMaterialMetadataReader): { sequence: VideoEditSequence; selectedClipIds: string[] } {
  integer(edit.delta)
  if (edit.newTracks?.length) document = { ...document, sequences: document.sequences.map(value => value.id === sequenceId ? withVideoEditTracks(value, edit.newTracks) : value) }
  const sequence = sequenceOf(document, sequenceId)
  const clipboard = copyVideoEditClips(document, sequenceId, edit.clipIds, false)
  const from = Math.min(...clipboard.clips.map(clip => clip.start))
  // Snapping (when on) as for a plain move: duplicates also snap to the originals, an insert-rearrange only to the clips it lands among.
  const moving = new Set(edit.clipIds)
  const snap = edit.snapThreshold === undefined ? 0 : snapOffset(clipboard.clips.flatMap(clip => [clip.start, clip.start + clip.duration]), [0, ...(edit.snapFrames ?? []), ...(sequence.markers ?? []).map(mark => mark.frame), ...sequence.clips.filter(clip => edit.mode !== 'insert' || !moving.has(clip.id)).flatMap(clip => [clip.start, clip.start + clip.duration])], edit.delta, edit.snapThreshold)
  const frame = Math.max(0, from + edit.delta + snap)
  const tracks = [...new Set(clipboard.clips.map(clip => edit.trackMap?.[clip.track] ?? clip.track))]
  if (edit.mode !== 'insert') return placeClips(document, sequence, { kind: 'place', clipboard, frame, mode: edit.mode === 'copy' ? 'overwrite' : 'insert', ...(edit.trackMap ? { trackMap: edit.trackMap } : {}), targetTracks: tracks })
  // Extract first; the drop frame moves left by the extracted ranges before it (a drop inside a range lands at its start).
  const extracted = applyClipEdit(document, sequenceId, { kind: 'delete', clipIds: edit.clipIds, linked: false, ripple: true }, metadata)
  const shift = intervals(clipboard.clips).reduce((sum, range) => sum + Math.max(0, Math.min(frame, range.to) - range.from), 0)
  return placeClips({ ...document, sequences: document.sequences.map(value => value.id === sequenceId ? extracted : value) }, extracted, { kind: 'place', clipboard, frame: frame - shift, mode: 'insert', ...(edit.trackMap ? { trackMap: edit.trackMap } : {}), targetTracks: tracks })
}
function applyClipEdit(document: VideoEditDocument, sequenceId: string, edit: Exclude<VideoEditTimelineEdit, { kind: 'place' | 'range' | 'rearrange' | 'trim' }>, metadata?: CodeMaterialMetadataReader): VideoEditSequence {
  const sequence = sequenceOf(document, sequenceId)
  const ids = expandVideoEditSelection(sequence, edit.clipIds, edit.kind === 'sync' ? false : edit.linked ?? true); const selected = new Set(ids)
  if (!ids.length) throw new Error('请先选择片段。')
  assertVideoEditClipsEditable(sequence, ids)
  const clips = sequence.clips.filter(clip => selected.has(clip.id))
  if (edit.kind === 'split') return splitClips(sequence, ids, edit.frame)
  if (edit.kind === 'sync') return syncClips(document, sequence, ids, edit.mode)
  if (edit.kind === 'adjust') {
    integer(edit.delta)
    const composition = videoEditComposition(document, sequenceId)
    let delta = edit.delta
    if (edit.mode === 'move') {
      const from = Math.min(...clips.map(clip => clip.start)); const to = Math.max(...clips.map(clip => clip.start + clip.duration))
      delta = Math.max(-from, Math.min(Math.floor(composition.fps * 1800) - to, delta))
      if (edit.snapThreshold !== undefined) {
        const candidates = [0, ...(edit.snapFrames ?? []), ...(sequence.markers ?? []).map(mark => mark.frame), ...sequence.annotations.map(mark => mark.frame), ...sequence.clips.filter(clip => !selected.has(clip.id)).flatMap(clip => [clip.start, clip.start + clip.duration])]
        const offset = snapOffset(clips.flatMap(clip => [clip.start, clip.start + clip.duration]), candidates, delta, edit.snapThreshold)
        if (offset) delta = Math.max(-from, Math.min(Math.floor(composition.fps * 1800) - to, delta + offset))
      }
    } else {
      const clamp = (requested: number): number => {
      const actual = clips.map(clip => {
        const next = adjustVideoEditClip(composition, clip, { mode: edit.mode, delta: requested, track: clip.track }, metadata)
        return edit.mode === 'in' ? next.start - clip.start : next.duration - clip.duration
      })
      return requested >= 0 ? Math.min(...actual) : Math.max(...actual)
      }
      delta = clamp(delta)
      if (edit.snapThreshold !== undefined) {
        if (!Number.isFinite(edit.snapThreshold) || edit.snapThreshold < 0) throw new Error('吸附距离无效。')
        const candidates = [0, ...(edit.snapFrames ?? []), ...(sequence.markers ?? []).map(mark => mark.frame), ...sequence.annotations.map(mark => mark.frame), ...sequence.clips.filter(clip => !selected.has(clip.id)).flatMap(clip => [clip.start, clip.start + clip.duration])]
        let offset = edit.snapThreshold + 1
        for (const edge of clips.map(clip => edit.mode === 'in' ? clip.start : clip.start + clip.duration)) for (const candidate of candidates) {
          const difference = candidate - edge - delta
          if (Math.abs(difference) < Math.abs(offset)) offset = difference
        }
        if (Math.abs(offset) <= edit.snapThreshold) delta = clamp(delta + offset)
      }
    }
    const adjusted = clips.map(clip => adjustVideoEditClip(composition, clip, { mode: edit.mode, delta, track: edit.trackMap?.[clip.track] ?? clip.track }, metadata))
    assertNewInternalOverlap(clips, adjusted)
    assertTargets(sequence, adjusted); assertNoOverlap(sequence.clips.filter(clip => !selected.has(clip.id)), adjusted)
    const byId = new Map(adjusted.map(clip => [clip.id, clip])); const next = sequence.clips.map(clip => byId.get(clip.id) ?? clip)
    const annotations = edit.mode === 'move' ? shiftAnnotations(sequence, next) : sequence.annotations.filter(mark => { const clip = byId.get(mark.clipId); return !clip || (mark.frame >= clip.start && mark.frame < clip.start + clip.duration) })
    const origins = new Map(adjusted.map(clip => [clip.id, { originalId: clip.id, shift: edit.mode === 'move' ? clip.start - sequence.clips.find(value => value.id === clip.id)!.start : 0 }]))
    return retimeVideoEditContent(sequence, { ...sequence, clips: next, annotations }, origins)
  }
  if (edit.kind === 'delete') {
    let kept = sequence.clips.filter(clip => !selected.has(clip.id))
    if (edit.ripple) {
      const ranges = intervals(clips); const affected = synchronizedTracks(sequence, [...clips.map(clip => clip.track), ...(edit.targetTracks ?? [])])
      kept = kept.map(clip => {
        if (!affected.has(clip.track)) return clip
        if (ranges.some(range => clip.start < range.to && clip.start + clip.duration > range.from)) throw new Error('波纹范围内还有未选片段，请先调整选区或关闭该轨道的同步锁定。')
        const shift = ranges.filter(range => range.to <= clip.start).reduce((sum, range) => sum + range.to - range.from, 0)
        if (shift) assertVideoEditClipsEditable(sequence, [clip.id])
        return { ...clip, start: clip.start - shift }
      })
      // Linked partners on tracks outside sync lock stay put and show as out of sync (Premiere).
    }
    return retimeVideoEditContent(sequence, { ...sequence, clips: kept, annotations: shiftAnnotations(sequence, kept) })
  }
  if (edit.kind === 'separate_audio') {
    const audioTrack = sequence.tracks.find(track => track.index === edit.audioTrack)
    if (!audioTrack || audioTrack.kind !== 'audio' || audioTrack.locked) throw new Error('请选择未锁定的音频轨道。')
    if (clips.some(clip => clip.kind !== 'video' || clip.sourceComponent)) throw new Error('请选择尚未拆开音画的视频片段。')
    if (clips.some(clip => { const item = document.items.find(item => item.id === clip.itemId); return document.media.find(media => media.id === item?.mediaId)?.hasAudio !== true })) throw new Error('请先确认原视频具有可解码的音轨。')
    const pairs = new Map(clips.map(clip => [clip.id, { audioId: crypto.randomUUID(), linkId: clip.linkId ?? crypto.randomUUID() }]))
    const audio = clips.map(clip => { const next = { ...clip, id: pairs.get(clip.id)!.audioId, kind: 'audio' as const, sourceComponent: 'audio' as const, track: edit.audioTrack, linkId: pairs.get(clip.id)!.linkId }; delete next.effects; return next })
    assertNoOverlap(sequence.clips, audio)
    // The sound keeps the clip's channel mapping; the picture no longer plays sound.
    const picture = (clip: VideoEditClip): VideoEditClip => { const next = { ...clip, sourceComponent: 'video' as const, linkId: pairs.get(clip.id)!.linkId }; delete next.audioMapping; return next }
    return { ...sequence, clips: sequence.clips.flatMap(clip => selected.has(clip.id) ? [picture(clip), audio.find(value => value.id === pairs.get(clip.id)!.audioId)!] : [clip]) }
  }
  const key = edit.kind === 'link' || edit.kind === 'unlink' ? 'linkId' : 'groupId'
  const remove = edit.kind === 'unlink' || edit.kind === 'ungroup'
  if (!remove && ids.length < 2) throw new Error('请至少选择两个片段。')
  const relation = crypto.randomUUID()
  return { ...sequence, clips: sequence.clips.map(clip => { if (!selected.has(clip.id)) return clip; const next = { ...clip }; if (remove) delete next[key]; else next[key] = relation; return next }) }
}

function syncClips(document: VideoEditDocument, sequence: VideoEditSequence, ids: string[], mode: 'move' | 'slip'): VideoEditSequence {
  const corrections = videoEditSyncCorrections(sequence, ids)
  if (!corrections.size) throw new Error('所选片段与链接片段没有失步。')
  const composition = videoEditComposition(document, sequence.id); const limit = Math.floor(composition.fps * 1800)
  const before = sequence.clips.filter(clip => corrections.has(clip.id))
  const after = before.map(clip => {
    const offset = corrections.get(clip.id)!
    if (mode === 'move') {
      const start = clip.start - offset
      if (start < 0 || start + clip.duration > limit) throw new Error('移入同步会超出序列范围，请改用滑入同步。')
      return { ...clip, start }
    }
    let source: ReturnType<typeof offsetVideoEditSource>
    try { source = offsetVideoEditSource(clip, offset, sequence.frameRate) } catch { throw new Error('素材开头之前没有可用内容，无法滑入同步，请改用移入同步。') }
    const media = videoEditClipMedia(composition, clip)
    if (media && videoEditSourceSeconds(source) + clip.duration / composition.fps > media.durationSeconds + 1 / composition.fps) throw new Error('素材结尾之后没有可用内容，无法滑入同步，请改用移入同步。')
    return { ...clip, ...source }
  })
  assertNewInternalOverlap(before, after)
  assertNoOverlap(sequence.clips.filter(clip => !corrections.has(clip.id)), after)
  const byId = new Map(after.map(clip => [clip.id, clip])); const clips = sequence.clips.map(clip => byId.get(clip.id) ?? clip)
  if (mode === 'slip') return { ...sequence, clips }
  const origins = new Map(before.map(clip => [clip.id, { originalId: clip.id, shift: byId.get(clip.id)!.start - clip.start }]))
  return retimeVideoEditContent(sequence, { ...sequence, clips, annotations: shiftAnnotations(sequence, clips) }, origins)
}

function placeClips(document: VideoEditDocument, original: VideoEditSequence, edit: Extract<VideoEditTimelineEdit, { kind: 'place' }>): { sequence: VideoEditSequence; selectedClipIds: string[] } {
  integer(edit.frame)
  const sequence = withVideoEditTracks(original, edit.newTracks)
  if (edit.clipboard.projectId !== document.id) throw new Error('此剪贴板属于另一剪辑，请通过素材面板引用导入。')
  if (!edit.clipboard.clips.length || edit.clipboard.clips.length > 500) throw new Error('剪贴板没有有效片段。')
  const from = Math.min(...edit.clipboard.clips.map(clip => clip.start))
  const convert = (frame: number): number => rescaleVideoEditFrame(frame - from, edit.clipboard.frameRate, sequence.frameRate)
  const ids = new Map(edit.clipboard.clips.map(clip => [clip.id, crypto.randomUUID()]))
  const incoming = remapRelations(edit.clipboard.clips.map(clip => ({ ...structuredClone(clip), ...(clip.effects ? { effects: clip.effects.map(effect => ({ ...structuredClone(effect), id: crypto.randomUUID() })) } : {}), id: ids.get(clip.id)!, track: edit.trackMap?.[clip.track] ?? clip.track, start: edit.frame + convert(clip.start), duration: convert(clip.start + clip.duration) - convert(clip.start) })))
  assertTargets(sequence, incoming)
  assertNewInternalOverlap(edit.clipboard.clips, incoming)
  if (incoming.some(clip => !document.items.some(item => item.id === clip.itemId) || clip.duration < 1 || clip.start < 0 || clip.start + clip.duration > Math.floor(sequence.frameRate.numerator / sequence.frameRate.denominator * 1800))) throw new Error('剪贴板引用已移除，或粘贴范围超出序列边界。')
  const length = Math.max(...incoming.map(clip => clip.start + clip.duration)) - edit.frame
  const tracks = new Set(incoming.map(clip => clip.track))
  let kept = sequence
  if (edit.mode === 'paste') assertNoOverlap(sequence.clips, incoming)
  if (edit.mode === 'insert') {
    const affected = synchronizedTracks(sequence, [...tracks, ...(edit.targetTracks ?? [])])
    const crossing = sequence.clips.filter(clip => affected.has(clip.track) && clip.start < edit.frame && clip.start + clip.duration > edit.frame)
    const changing = sequence.clips.filter(clip => affected.has(clip.track) && clip.start + clip.duration > edit.frame).map(clip => clip.id)
    // Linked partners on tracks outside sync lock stay put and show as out of sync (Premiere).
    assertVideoEditClipsEditable(sequence, changing)
    if (crossing.length) kept = splitClips(sequence, crossing.map(clip => clip.id), edit.frame)
    const shifted = kept.clips.map(clip => affected.has(clip.track) && clip.start >= edit.frame ? { ...clip, start: clip.start + length } : clip)
    kept = retimeVideoEditContent(kept, { ...kept, clips: shifted, annotations: shiftAnnotations(kept, shifted) })
  }
  if (edit.mode === 'overwrite') {
    const end = edit.frame + length
    const overlapping = sequence.clips.filter(clip => tracks.has(clip.track) && clip.start < end && clip.start + clip.duration > edit.frame)
    assertVideoEditClipsEditable(sequence, overlapping.map(clip => clip.id))
    const fragments = new Map<string, VideoEditClip[]>()
    const origins = new Map<string, VideoEditContentOrigin>()
    for (const clip of overlapping) {
      const pieces: VideoEditClip[] = []
      if (clip.start < edit.frame) pieces.push({ ...clip, duration: edit.frame - clip.start })
      if (clip.start + clip.duration > end) pieces.push({ ...structuredClone(clip), ...(pieces.length && clip.effects ? { effects: clip.effects.map(effect => ({ ...structuredClone(effect), id: crypto.randomUUID() })) } : {}), id: pieces.length ? crypto.randomUUID() : clip.id, start: end, duration: clip.start + clip.duration - end, ...offsetVideoEditSource(clip, end - clip.start, sequence.frameRate) })
      fragments.set(clip.id, pieces)
      for (const piece of pieces) origins.set(piece.id, { originalId: clip.id, shift: 0 })
    }
    const rights = new Map([...fragments].flatMap(([id, pieces]) => pieces.filter(clip => clip.start === end).map(clip => [clip.id, id] as const)))
    const rightPieces = separateRightRelations(sequence, [...fragments.values()].flatMap(pieces => pieces.filter(clip => clip.start === end)), rights, end)
    const rightById = new Map(rightPieces.map(clip => [clip.id, clip]))
    for (const [id, pieces] of fragments) fragments.set(id, pieces.map(clip => rightById.get(clip.id) ?? clip))
    kept = retimeVideoEditContent(sequence, { ...sequence, clips: sequence.clips.flatMap(clip => fragments.get(clip.id) ?? [clip]), annotations: sequence.annotations.flatMap(mark => {
      const pieces = fragments.get(mark.clipId)
      if (!pieces) return [mark]
      const piece = pieces.find(clip => mark.frame >= clip.start && mark.frame < clip.start + clip.duration)
      return piece ? [{ ...mark, clipId: piece.id }] : []
    }) }, origins, true)
  }
  const annotations = edit.clipboard.annotations.map(mark => ({ ...mark, id: crypto.randomUUID(), clipId: ids.get(mark.clipId)!, frame: edit.frame + convert(mark.frame) }))
  const markers = (edit.clipboard.markers ?? []).map(mark => ({ ...mark, id: crypto.randomUUID(), clipId: ids.get(mark.clipId!)!, frame: edit.frame + convert(mark.frame) }))
  const captions = (edit.clipboard.captions ?? []).map(caption => ({ ...caption, id: crypto.randomUUID(), clipId: ids.get(caption.clipId!)!, start: edit.frame + convert(caption.start), duration: convert(caption.start + caption.duration) - convert(caption.start) }))
  const transitions = (edit.clipboard.transitions ?? []).map(transition => {
    const leftClipId = transition.leftClipId && ids.get(transition.leftClipId); const rightClipId = transition.rightClipId && ids.get(transition.rightClipId)
    if (transition.leftClipId && !leftClipId || transition.rightClipId && !rightClipId) throw new Error('复制转场必须同时包含两端片段。')
    return { ...transition, id: crypto.randomUUID(), ...(leftClipId ? { leftClipId } : {}), ...(rightClipId ? { rightClipId } : {}), durationFrames: rescaleVideoEditFrame(transition.durationFrames, edit.clipboard.frameRate, sequence.frameRate) }
  })
  return { sequence: { ...kept, clips: [...kept.clips, ...incoming], annotations: [...kept.annotations, ...annotations], ...(kept.markers || markers.length ? { markers: [...(kept.markers ?? []), ...markers] } : {}), ...(kept.captions || captions.length ? { captions: [...(kept.captions ?? []), ...captions] } : {}), ...(kept.transitions || transitions.length ? { transitions: [...(kept.transitions ?? []), ...transitions] } : {}) }, selectedClipIds: incoming.map(clip => clip.id) }
}
