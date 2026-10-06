import type { VideoEditDocument, VideoEditSequence } from './document'
import { applyVideoEditTimelineEdit } from './timelineEdits'

/**
 * 序列轨道的增删（剪辑对齐 PR 2.4）。轨道编号 `index` 是全序列唯一的合成顺序：视频轨编号越大越靠上（V1 在最下），
 * 音频轨编号越小越靠上（A1 在最上）；两类轨道的编号互不影响显示顺序。片段用编号引用轨道。
 */
export type VideoEditTrack = VideoEditSequence['tracks'][number]
export type VideoEditTrackKind = VideoEditTrack['kind']
export const VIDEO_EDIT_TRACK_LIMIT = 32
const MAX_INDEX = VIDEO_EDIT_TRACK_LIMIT - 1

/** 同类轨道的自然顺序：V1、V2…（自下而上）或 A1、A2…（自上而下），即编号升序。 */
export function videoEditTracksOfKind(sequence: Pick<VideoEditSequence, 'tracks'>, kind: VideoEditTrackKind): VideoEditTrack[] {
  return sequence.tracks.filter(track => track.kind === kind).sort((a, b) => a.index - b.index)
}
/** PR 的轨道编号 V1／A2…（按同类轨道的自然顺序）。 */
export function videoEditTrackCodes(sequence: Pick<VideoEditSequence, 'tracks'>): Map<string, string> {
  const codes = new Map<string, string>()
  for (const kind of ['video', 'audio'] as const) videoEditTracksOfKind(sequence, kind).forEach((track, rank) => codes.set(track.id, `${kind === 'video' ? 'V' : 'A'}${rank + 1}`))
  return codes
}
function trackNames(sequence: Pick<VideoEditSequence, 'tracks'>, kind: VideoEditTrackKind, count: number): string[] {
  const label = kind === 'video' ? '视频' : '音频'
  const used = new Set(sequence.tracks.map(track => track.name))
  const names: string[] = []
  for (let number = sequence.tracks.filter(track => track.kind === kind).length + 1; names.length < count; number++) if (!used.has(`${label} ${number}`)) names.push(`${label} ${number}`)
  return names
}
function createTrack(kind: VideoEditTrackKind, index: number, name: string): VideoEditTrack {
  return { id: crypto.randomUUID(), name, index, kind, locked: false, enabled: true, muted: false, solo: false }
}
function assertRoom(sequence: Pick<VideoEditSequence, 'tracks'>, count: number): void {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('请至少添加一条轨道。')
  if (sequence.tracks.length + count > VIDEO_EDIT_TRACK_LIMIT) throw new Error(`序列最多 ${VIDEO_EDIT_TRACK_LIMIT} 条轨道，请先删除不用的轨道。`)
}

/**
 * 最上面的视频轨之上、或最下面的音频轨之下新建 `count` 条轨道，不改动已有轨道的编号（拖动片段到轨道外自动加轨、助手新建轨道用）。
 * 返回的轨道尚未加入序列。
 */
export function videoEditEdgeTracks(sequence: Pick<VideoEditSequence, 'tracks'>, kind: VideoEditTrackKind, count: number): VideoEditTrack[] {
  assertRoom(sequence, count)
  const used = new Set(sequence.tracks.map(track => track.index))
  const indexes: number[] = []
  for (let index = Math.max(-1, ...videoEditTracksOfKind(sequence, kind).map(track => track.index)) + 1; index <= MAX_INDEX && indexes.length < count; index++) if (!used.has(index)) indexes.push(index)
  if (indexes.length < count) throw new Error('轨道编号已用尽，请先删除不用的轨道。')
  const names = trackNames(sequence, kind, count)
  return indexes.map((index, offset) => createTrack(kind, index, names[offset]))
}

/**
 * 在同类轨道的第 `slot` 个位置（自然顺序，0 = 第一条之前，等于同类数量 = 最后一条之后）插入 `count` 条新轨道（PR“添加轨道”）。
 * 相邻编号之间有空位就直接用；没有就把全部轨道重新编号（音频在前、视频在后），片段所在轨道与调整图层的作用范围随之换算。
 * 锁定轨道的编号不能变（锁定即不可编辑），需要移动它时拒绝并请用户先解锁。
 */
export function insertVideoEditTracks(sequence: VideoEditSequence, kind: VideoEditTrackKind, count: number, slot: number): { sequence: VideoEditSequence; added: VideoEditTrack[] } {
  assertRoom(sequence, count)
  const lanes = videoEditTracksOfKind(sequence, kind)
  const at = Math.max(0, Math.min(lanes.length, Math.round(slot)))
  const names = trackNames(sequence, kind, count)
  const low = at > 0 ? lanes[at - 1].index : -1; const high = at < lanes.length ? lanes[at].index : MAX_INDEX + 1
  const used = new Set(sequence.tracks.map(track => track.index))
  const free: number[] = []
  for (let index = low + 1; index < high && free.length < count; index++) if (!used.has(index)) free.push(index)
  if (free.length === count) {
    const added = free.map((index, offset) => createTrack(kind, index, names[offset]))
    return { sequence: { ...sequence, tracks: [...sequence.tracks, ...added] }, added }
  }
  // 重新编号：每类按自然顺序排好（新轨道插在 slot 处），音频占低位、视频接在后面。
  const fresh = names.map(name => createTrack(kind, -1, name))
  const ordered = { video: videoEditTracksOfKind(sequence, 'video'), audio: videoEditTracksOfKind(sequence, 'audio') }
  ordered[kind] = [...lanes.slice(0, at), ...fresh, ...lanes.slice(at)]
  const renumbered = [...ordered.audio, ...ordered.video].map((track, index) => ({ ...track, index }))
  const mapping = new Map<number, number>()
  for (const track of renumbered) { const before = sequence.tracks.find(value => value.id === track.id); if (before) mapping.set(before.index, track.index) }
  const moved = sequence.tracks.find(track => track.locked && mapping.get(track.index) !== track.index)
  if (moved) throw new Error(`添加轨道需要调整轨道“${moved.name}”的位置，请先解锁该轨道。`)
  const videoBefore = videoEditTracksOfKind(sequence, 'video')
  // 调整图层的作用范围“从某编号起的下方画面”：换算到不低于原起点的第一条视频轨的新编号。
  const fromTrack = (value: number): number => { const first = videoBefore.find(track => track.index >= value); return first ? mapping.get(first.index)! : value }
  const clips = sequence.clips.map(clip => ({ ...clip, track: mapping.get(clip.track) ?? clip.track, ...(clip.adjustment ? { adjustment: { ...clip.adjustment, fromTrack: fromTrack(clip.adjustment.fromTrack) } } : {}) }))
  const added = renumbered.filter(track => fresh.some(value => value.id === track.id))
  return { sequence: { ...sequence, tracks: renumbered, clips }, added }
}

/**
 * 删除轨道及其上的全部片段（PR“删除轨道”；片段的标注、字幕、转场一并清理）。每类至少保留一条轨道；锁定轨道不能删除。
 */
export function removeVideoEditTracks(document: VideoEditDocument, sequenceId: string, trackIds: readonly string[]): VideoEditSequence {
  const sequence = document.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('目标序列不存在。')
  const removed = sequence.tracks.filter(track => trackIds.includes(track.id))
  if (!removed.length) throw new Error('请选择要删除的轨道。')
  const locked = removed.find(track => track.locked)
  if (locked) throw new Error(`轨道“${locked.name}”已锁定，请先解锁再删除。`)
  for (const kind of ['video', 'audio'] as const) if (sequence.tracks.some(track => track.kind === kind) && sequence.tracks.every(track => track.kind !== kind || trackIds.includes(track.id))) throw new Error(`至少保留一条${kind === 'video' ? '视频' : '音频'}轨道。`)
  const indexes = new Set(removed.map(track => track.index))
  const clipIds = sequence.clips.filter(clip => indexes.has(clip.track)).map(clip => clip.id)
  const cleared = clipIds.length ? applyVideoEditTimelineEdit(document, sequenceId, { kind: 'delete', clipIds, linked: false }) : sequence
  return { ...cleared, tracks: cleared.tracks.filter(track => !indexes.has(track.index)) }
}

/** 空轨道：上面没有任何片段。 */
export function videoEditEmptyTrackIds(sequence: Pick<VideoEditSequence, 'tracks' | 'clips'>, kind: VideoEditTrackKind): string[] {
  const used = new Set(sequence.clips.map(clip => clip.track))
  return videoEditTracksOfKind(sequence, kind).filter(track => !used.has(track.index)).map(track => track.id)
}
