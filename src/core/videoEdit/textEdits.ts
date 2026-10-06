import { copyVideoEditSequence } from './sequenceCopy'
import { applyVideoEditTimelineEdit, copyVideoEditClips } from './timelineEdits'
import { videoEditComposition, type VideoEditDocument, type VideoEditSequence } from './document'
import { mergeVideoEditTextRanges, type VideoEditTextRange } from './textTranscript'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'

const replace = (document: VideoEditDocument, sequence: VideoEditSequence): VideoEditDocument => ({ ...document, sequences: document.sequences.map(value => value.id === sequence.id ? sequence : value) })
function remove(document: VideoEditDocument, sequenceId: string, range: VideoEditTextRange, ripple: boolean, metadata?: CodeMaterialMetadataReader): VideoEditDocument {
  const sequence = videoEditComposition(document, sequenceId)
  // Range edits deliberately target all tracks, including linked picture and sound. Never silently skip locked partners.
  if (sequence.clips.some(clip => clip.start < range.to && clip.start + clip.duration > range.from && sequence.tracks.find(track => track.index === clip.track)?.locked)) throw new Error('文本范围经过锁定轨道，请先解锁音画轨道。')
  if (!sequence.clips.some(clip => clip.start < range.to && clip.start + clip.duration > range.from)) return document
  return replace(document, applyVideoEditTimelineEdit(document, sequenceId, { kind: 'range', ...range, ripple, tracks: sequence.tracks.map(track => track.index) }, metadata))
}
export function deleteVideoEditTextRanges(document: VideoEditDocument, sequenceId: string, ranges: readonly VideoEditTextRange[], metadata?: CodeMaterialMetadataReader): VideoEditDocument {
  let next = document
  for (const range of mergeVideoEditTextRanges(ranges).reverse()) next = remove(next, sequenceId, range, true, metadata)
  return next
}
/** Build a compact excerpt using the same splits, source offsets and ripple retiming as the timeline. */
export function extractVideoEditTextRanges(document: VideoEditDocument, sequenceId: string, ranges: readonly VideoEditTextRange[], name = '文本摘选', metadata?: CodeMaterialMetadataReader): VideoEditSequence {
  const selected = mergeVideoEditTextRanges(ranges)
  if (!selected.length) throw new Error('请先选中文字。')
  const sequence = videoEditComposition(document, sequenceId)
  if (sequence.clips.some(clip => sequence.tracks.find(track => track.index === clip.track)?.locked && selected.some(range => clip.start < range.to && clip.start + clip.duration > range.from))) throw new Error('文本范围经过锁定轨道，请先解锁音画轨道。')
  // Trimming a temporary copy must not be blocked by unrelated locked tracks outside the excerpt.
  let next: VideoEditDocument = { ...document, sequences: document.sequences.map(value => value.id === sequenceId ? { ...value, tracks: value.tracks.map(track => ({ ...track, locked: false })) } : value) }
  const maximum = Math.max(...sequence.clips.map(clip => clip.start + clip.duration))
  if (selected.some(range => range.to > maximum)) throw new Error('文本范围超出当前时间线。')
  const gaps = [{ from: 0, to: selected[0].from }, ...selected.slice(1).map((range, index) => ({ from: selected[index].to, to: range.from })), { from: selected.at(-1)!.to, to: maximum }].filter(range => range.to > range.from)
  // Delete the tail first. Empty gaps have no clips: close their time explicitly when assembling the clipboard.
  for (const range of gaps.reverse()) next = remove(next, sequenceId, range, false, metadata)
  const kept = next.sequences.find(value => value.id === sequenceId)!
  if (!kept.clips.length) throw new Error('选中文字没有对应媒体。')
  const mapFrame = (frame: number): number => selected.reduce((sum, range) => sum + Math.max(0, Math.min(frame, range.to) - range.from), 0)
  const excerpt: VideoEditSequence = { ...kept, clips: kept.clips.map(clip => ({ ...clip, start: mapFrame(clip.start) })), annotations: kept.annotations.map(value => ({ ...value, frame: mapFrame(value.frame) })), markers: kept.markers?.filter(value => selected.some(range => value.frame >= range.from && value.frame < range.to)).map(value => ({ ...value, frame: mapFrame(value.frame) })), captions: kept.captions?.flatMap(value => selected.flatMap(range => { const from = Math.max(range.from, value.start); const to = Math.min(range.to, value.start + value.duration); return to > from ? [{ ...value, id: crypto.randomUUID(), start: mapFrame(from), duration: to - from }] : [] })), transitions: kept.transitions }
  excerpt.tracks = sequence.tracks
  const copied = copyVideoEditSequence(excerpt); copied.name = name
  return copied
}
export function insertVideoEditTextRanges(document: VideoEditDocument, sequenceId: string, ranges: readonly VideoEditTextRange[], frame: number, metadata?: CodeMaterialMetadataReader): VideoEditDocument {
  const excerpt = extractVideoEditTextRanges(document, sequenceId, ranges, '文本摘选', metadata)
  const temporary = { ...document, sequences: [...document.sequences, excerpt] }
  const clipboard = copyVideoEditClips(temporary, excerpt.id, excerpt.clips.map(clip => clip.id), false)
  // Include unanchored captions/markers from the excerpt as well; copyVideoEditClips keeps only clip-owned ones.
  clipboard.captions = excerpt.captions; clipboard.markers = excerpt.markers
  return replace(document, applyVideoEditTimelineEdit(document, sequenceId, { kind: 'place', clipboard, frame, mode: 'insert', targetTracks: videoEditComposition(document, sequenceId).tracks.map(track => track.index) }, metadata))
}
