import { adjustVideoEditClip, splitVideoEditClip, videoEditComposition, type VideoEditAnnotation, type VideoEditClip, type VideoEditDocument, type VideoEditSequence } from './document'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'
import { assertVideoEditClipsEditable } from './lockedTracks'
import { expandVideoEditSelection } from './timelineSelection'
import { offsetVideoEditSource, rescaleVideoEditFrame, type VideoEditRatio } from './time'

export interface VideoEditClipboard {
  projectId: string
  frameRate: VideoEditRatio
  clips: VideoEditClip[]
  annotations: VideoEditAnnotation[]
  tracks?: Array<{ index: number; kind: 'video' | 'audio' }>
}
export type VideoEditTimelineEdit =
  | { kind: 'adjust'; clipIds: string[]; mode: 'move' | 'in' | 'out'; delta: number; trackMap?: Record<number, number>; snapThreshold?: number; snapFrames?: number[] }
  | { kind: 'split'; clipIds: string[]; frame: number }
  | { kind: 'delete'; clipIds: string[]; ripple?: boolean; targetTracks?: number[] }
  | { kind: 'link' | 'unlink' | 'group' | 'ungroup'; clipIds: string[] }
  | { kind: 'separate_audio'; clipIds: string[]; audioTrack: number }
  | { kind: 'place'; clipboard: VideoEditClipboard; frame: number; mode: 'paste' | 'insert' | 'overwrite'; trackMap?: Record<number, number>; targetTracks?: number[] }

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
function assertRelatedCoverage(sequence: VideoEditSequence, ids: string[]): void {
  const affected = new Set(ids)
  if (expandVideoEditSelection(sequence, ids).some(id => !affected.has(id))) throw new Error('编辑会改变链接或编组的相对时间，请先启用相关轨道同步或解除关联。')
}
function assertRelatedShifts(sequence: VideoEditSequence, after: VideoEditClip[]): void {
  const previous = new Map(sequence.clips.map(clip => [clip.id, clip])); const shifts = new Map<string, number>()
  for (const clip of after) {
    const shift = clip.start - previous.get(clip.id)!.start
    for (const relation of [clip.linkId ? `link:${clip.linkId}` : '', clip.groupId ? `group:${clip.groupId}` : ''].filter(Boolean)) {
      if (shifts.has(relation) && shifts.get(relation) !== shift) throw new Error('波纹编辑会使链接或编组错位，请先启用相关轨道同步或解除关联。')
      shifts.set(relation, shift)
    }
  }
}
function remapRelations(clips: VideoEditClip[]): VideoEditClip[] {
  const links = new Map<string, string>(); const groups = new Map<string, string>()
  const next = (map: Map<string, string>, id: string): string => { if (!map.has(id)) map.set(id, crypto.randomUUID()); return map.get(id)! }
  return clips.map(clip => ({ ...clip, ...(clip.linkId ? { linkId: next(links, clip.linkId) } : {}), ...(clip.groupId ? { groupId: next(groups, clip.groupId) } : {}) }))
}
function splitClips(sequence: VideoEditSequence, ids: string[], frame: number): VideoEditSequence {
  integer(frame)
  const originals = new Set(sequence.clips.map(clip => clip.id))
  let next = sequence
  for (const id of ids) {
    const clip = next.clips.find(value => value.id === id)!
    if (frame > clip.start && frame < clip.start + clip.duration) next = splitVideoEditClip(next, id, frame)
  }
  if (next === sequence) throw new Error('请将播放头置于所选片段内部再拆分。')
  const right = remapRelations(next.clips.filter(clip => !originals.has(clip.id)))
  const byId = new Map(right.map(clip => [clip.id, clip]))
  return { ...next, clips: next.clips.map(clip => byId.get(clip.id) ?? clip) }
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

export function copyVideoEditClips(document: VideoEditDocument, sequenceId: string, clipIds: string[]): VideoEditClipboard {
  const sequence = sequenceOf(document, sequenceId); const ids = new Set(expandVideoEditSelection(sequence, clipIds))
  if (!ids.size) throw new Error('请先选择要复制的片段。')
  return structuredClone({ projectId: document.id, frameRate: sequence.frameRate, clips: sequence.clips.filter(clip => ids.has(clip.id)), annotations: sequence.annotations.filter(mark => ids.has(mark.clipId)), tracks: sequence.tracks.map(track => ({ index: track.index, kind: track.kind })) })
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
  const result = edit.kind === 'place' ? placeClips(document, sequenceOf(document, sequenceId), edit) : { sequence: applyClipEdit(document, sequenceId, edit, metadata) }
  if (result.sequence.clips.length > 500 || result.sequence.annotations.length > 500 || result.sequence.clips.some(clip => clip.start < 0 || clip.duration < 1 || clip.start + clip.duration > Math.floor(result.sequence.frameRate.numerator / result.sequence.frameRate.denominator * 1800))) throw new Error('编辑结果超出序列片段、标记数量或时间边界。')
  return result
}
function applyClipEdit(document: VideoEditDocument, sequenceId: string, edit: Exclude<VideoEditTimelineEdit, { kind: 'place' }>, metadata?: CodeMaterialMetadataReader): VideoEditSequence {
  const sequence = sequenceOf(document, sequenceId)
  const ids = expandVideoEditSelection(sequence, edit.clipIds); const selected = new Set(ids)
  if (!ids.length) throw new Error('请先选择片段。')
  assertVideoEditClipsEditable(sequence, ids)
  const clips = sequence.clips.filter(clip => selected.has(clip.id))
  if (edit.kind === 'split') return splitClips(sequence, ids, edit.frame)
  if (edit.kind === 'adjust') {
    integer(edit.delta)
    const composition = videoEditComposition(document, sequenceId)
    let delta = edit.delta
    if (edit.mode === 'move') {
      const from = Math.min(...clips.map(clip => clip.start)); const to = Math.max(...clips.map(clip => clip.start + clip.duration))
      delta = Math.max(-from, Math.min(Math.floor(composition.fps * 1800) - to, delta))
      if (edit.snapThreshold !== undefined) {
        const threshold = edit.snapThreshold
        if (!Number.isFinite(threshold) || threshold < 0) throw new Error('吸附距离无效。')
        const candidates = [0, ...(edit.snapFrames ?? []), ...sequence.annotations.map(mark => mark.frame), ...sequence.clips.filter(clip => !selected.has(clip.id)).flatMap(clip => [clip.start, clip.start + clip.duration])]
        let offset = threshold + 1
        for (const edge of clips.flatMap(clip => [clip.start, clip.start + clip.duration])) for (const candidate of candidates) {
          const difference = candidate - edge - delta
          if (Math.abs(difference) < Math.abs(offset)) offset = difference
        }
        if (Math.abs(offset) <= threshold) delta = Math.max(-from, Math.min(Math.floor(composition.fps * 1800) - to, delta + offset))
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
        const candidates = [0, ...(edit.snapFrames ?? []), ...sequence.annotations.map(mark => mark.frame), ...sequence.clips.filter(clip => !selected.has(clip.id)).flatMap(clip => [clip.start, clip.start + clip.duration])]
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
    return { ...sequence, clips: next, annotations }
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
      assertRelatedShifts(sequence, kept)
    }
    return { ...sequence, clips: kept, annotations: shiftAnnotations(sequence, kept) }
  }
  if (edit.kind === 'separate_audio') {
    const audioTrack = sequence.tracks.find(track => track.index === edit.audioTrack)
    if (!audioTrack || audioTrack.kind !== 'audio' || audioTrack.locked) throw new Error('请选择未锁定的音频轨道。')
    if (clips.some(clip => clip.kind !== 'video' || clip.sourceComponent)) throw new Error('请选择尚未拆开音画的视频片段。')
    if (clips.some(clip => { const item = document.items.find(item => item.id === clip.itemId); return document.media.find(media => media.id === item?.mediaId)?.hasAudio !== true })) throw new Error('请先确认原视频具有可解码的音轨。')
    const pairs = new Map(clips.map(clip => [clip.id, { audioId: crypto.randomUUID(), linkId: clip.linkId ?? crypto.randomUUID() }]))
    const audio = clips.map(clip => ({ ...clip, id: pairs.get(clip.id)!.audioId, kind: 'audio' as const, sourceComponent: 'audio' as const, track: edit.audioTrack, linkId: pairs.get(clip.id)!.linkId }))
    assertNoOverlap(sequence.clips, audio)
    return { ...sequence, clips: sequence.clips.flatMap(clip => selected.has(clip.id) ? [{ ...clip, sourceComponent: 'video' as const, linkId: pairs.get(clip.id)!.linkId }, audio.find(value => value.id === pairs.get(clip.id)!.audioId)!] : [clip]) }
  }
  const key = edit.kind === 'link' || edit.kind === 'unlink' ? 'linkId' : 'groupId'
  const remove = edit.kind === 'unlink' || edit.kind === 'ungroup'
  if (!remove && ids.length < 2) throw new Error('请至少选择两个片段。')
  const relation = crypto.randomUUID()
  return { ...sequence, clips: sequence.clips.map(clip => { if (!selected.has(clip.id)) return clip; const next = { ...clip }; if (remove) delete next[key]; else next[key] = relation; return next }) }
}

function placeClips(document: VideoEditDocument, sequence: VideoEditSequence, edit: Extract<VideoEditTimelineEdit, { kind: 'place' }>): { sequence: VideoEditSequence; selectedClipIds: string[] } {
  integer(edit.frame)
  if (edit.clipboard.projectId !== document.id) throw new Error('此剪贴板属于另一工程，请通过项目素材引用导入。')
  if (!edit.clipboard.clips.length || edit.clipboard.clips.length > 500) throw new Error('剪贴板没有有效片段。')
  const from = Math.min(...edit.clipboard.clips.map(clip => clip.start))
  const convert = (frame: number): number => rescaleVideoEditFrame(frame - from, edit.clipboard.frameRate, sequence.frameRate)
  const ids = new Map(edit.clipboard.clips.map(clip => [clip.id, crypto.randomUUID()]))
  const incoming = remapRelations(edit.clipboard.clips.map(clip => ({ ...structuredClone(clip), id: ids.get(clip.id)!, track: edit.trackMap?.[clip.track] ?? clip.track, start: edit.frame + convert(clip.start), duration: convert(clip.start + clip.duration) - convert(clip.start) })))
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
    assertRelatedCoverage(sequence, changing); assertVideoEditClipsEditable(sequence, changing)
    if (crossing.length) kept = splitClips(sequence, crossing.map(clip => clip.id), edit.frame)
    const shifted = kept.clips.map(clip => affected.has(clip.track) && clip.start >= edit.frame ? { ...clip, start: clip.start + length } : clip)
    kept = { ...kept, clips: shifted, annotations: shiftAnnotations(kept, shifted) }
  }
  if (edit.mode === 'overwrite') {
    const end = edit.frame + length
    const overlapping = sequence.clips.filter(clip => tracks.has(clip.track) && clip.start < end && clip.start + clip.duration > edit.frame)
    assertRelatedCoverage(sequence, overlapping.map(clip => clip.id))
    assertVideoEditClipsEditable(sequence, overlapping.map(clip => clip.id))
    const fragments = new Map<string, VideoEditClip[]>()
    for (const clip of overlapping) {
      const pieces: VideoEditClip[] = []
      if (clip.start < edit.frame) pieces.push({ ...clip, duration: edit.frame - clip.start })
      if (clip.start + clip.duration > end) pieces.push({ ...structuredClone(clip), id: pieces.length ? crypto.randomUUID() : clip.id, start: end, duration: clip.start + clip.duration - end, ...offsetVideoEditSource(clip, end - clip.start, sequence.frameRate) })
      fragments.set(clip.id, pieces)
    }
    const rightPieces = remapRelations([...fragments.values()].flatMap(pieces => pieces.filter(clip => clip.start === end)))
    const rightById = new Map(rightPieces.map(clip => [clip.id, clip]))
    for (const [id, pieces] of fragments) fragments.set(id, pieces.map(clip => rightById.get(clip.id) ?? clip))
    kept = { ...sequence, clips: sequence.clips.flatMap(clip => fragments.get(clip.id) ?? [clip]), annotations: sequence.annotations.flatMap(mark => {
      const pieces = fragments.get(mark.clipId)
      if (!pieces) return [mark]
      const piece = pieces.find(clip => mark.frame >= clip.start && mark.frame < clip.start + clip.duration)
      return piece ? [{ ...mark, clipId: piece.id }] : []
    }) }
  }
  const annotations = edit.clipboard.annotations.map(mark => ({ ...mark, id: crypto.randomUUID(), clipId: ids.get(mark.clipId)!, frame: edit.frame + convert(mark.frame) }))
  return { sequence: { ...kept, clips: [...kept.clips, ...incoming], annotations: [...kept.annotations, ...annotations] }, selectedClipIds: incoming.map(clip => clip.id) }
}
