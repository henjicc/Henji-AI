import { videoEditClipMedia, type VideoEditClip, type VideoEditComposition, type VideoEditDocument } from './document'
import { applyVideoEditTimelineEditResult } from './timelineEdits'

/**
 * 录屏轨：剪辑序列在“录制”样子下只显示的一条轨。它不是另一种数据，而是同一条序列的一种读法：
 * 放着录屏画面片段的那条视频轨，每个录屏画面片段连同与它链接的声音（麦克风、系统声）、摄像头算一个块。
 * 录屏画面按来源认（素材带录制时的指针记录 `recordingCursor`，录屏导入给每个录屏画面素材都写上），
 * 不按轨道位置猜：用户常在录屏下面垫背景、或把口播放在别的视频轨上。
 * 块与块首尾相连；新录的一段要么接在最后，要么从某一时刻起覆盖（剪辑里的“覆盖编辑”），覆盖只动被盖住的录屏块和它链接的声音。
 */
export type VideoEditRecordingKind = 'screen' | 'microphone' | 'systemAudio' | 'camera'
/** 录制素材放进剪辑时各类素材所在轨道的名字；录制导入写轨名，录屏轨按它认出上一次麦克风与系统声各放在哪条轨。 */
export const VIDEO_EDIT_RECORDING_TRACK_NAMES: Readonly<Record<VideoEditRecordingKind, string>> = { screen: '屏幕', microphone: '麦克风', systemAudio: '系统声音', camera: '摄像头' }

type LaneSource = Pick<VideoEditComposition, 'tracks' | 'clips' | 'items' | 'media'>
export interface VideoEditRecordingBlock {
  /** 录屏画面片段（块本身）。 */
  clip: VideoEditClip
  /** 与它链接的其余片段：声音与摄像头。 */
  linked: VideoEditClip[]
}
export interface VideoEditRecordingLane {
  /** 录屏轨所在的视频轨编号；还没有录屏画面时为空（第一段由录制导入找空轨或新建一条“屏幕”轨）。 */
  track: number | null
  blocks: VideoEditRecordingBlock[]
  /** 最后一块的结尾帧；没有块时为 0。 */
  end: number
  /** 认不出唯一一条录屏轨时的原因（给用户看的话）；有它时录制样子不放块，落片拒绝。 */
  problem?: string
}

/** 片段是不是录屏画面：视频片段，素材带录制时的指针记录。 */
export function isVideoEditRecordingPicture(source: Pick<LaneSource, 'items' | 'media'>, clip: VideoEditClip): boolean {
  return clip.kind === 'video' && clip.sourceComponent !== 'audio' && Boolean(videoEditClipMedia(source, clip)?.recordingCursor)
}

export function videoEditRecordingLane(source: LaneSource): VideoEditRecordingLane {
  const pictures = source.clips.filter(clip => isVideoEditRecordingPicture(source, clip))
  const tracks = [...new Set(pictures.map(clip => clip.track))]
  if (tracks.length > 1) return { track: null, blocks: [], end: 0, problem: '这条序列里不止一条轨道放着录屏画面。到“剪辑”里把录屏画面整理到同一条视频轨上，再用录制。' }
  const track = tracks[0] ?? null
  if (track !== null && source.clips.some(clip => clip.track === track && !isVideoEditRecordingPicture(source, clip))) {
    const name = source.tracks.find(value => value.index === track)?.name ?? ''
    return { track: null, blocks: [], end: 0, problem: `录屏画面所在的轨道${name ? `“${name}”` : ''}上还有别的片段。到“剪辑”里把它们移到别的轨道，再用录制。` }
  }
  const blocks = pictures.sort((a, b) => a.start - b.start).map(clip => ({ clip, linked: clip.linkId ? source.clips.filter(other => other.id !== clip.id && other.linkId === clip.linkId) : [] }))
  return { track, blocks, end: blocks.reduce((end, { clip }) => Math.max(end, clip.start + clip.duration), 0) }
}

/** 录屏轨上块与块之间的空隙（半开区间）；录制样子里的编辑都保持它为空。 */
export function videoEditRecordingLaneGaps(lane: VideoEditRecordingLane): Array<{ from: number; to: number }> {
  const gaps: Array<{ from: number; to: number }> = []
  let cursor = 0
  for (const { clip } of lane.blocks) {
    if (clip.start > cursor) gaps.push({ from: cursor, to: clip.start })
    cursor = Math.max(cursor, clip.start + clip.duration)
  }
  return gaps
}

/**
 * 录屏轨的内容指纹：开始录制时记下，停止时对比。录制期间别处（助手、菜单）改过录屏轨，原先按绝对帧定的覆盖位置就不可信了。
 * 只看录屏块与它们链接的片段，别的轨道上的改动不影响。
 */
export function videoEditRecordingLaneBasis(lane: VideoEditRecordingLane): string {
  const text = lane.blocks.map(({ clip, linked }) => [clip, ...linked].map(value => `${value.id}@${value.track}:${value.start}+${value.duration}`).join(',')).join(';')
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0
  return `${lane.blocks.length}-${hash.toString(16)}`
}

/** 新的一段放在哪：接在录屏轨末尾，或从序列的某一帧起覆盖（不在任何块里时等于接在末尾，不留空隙）。 */
export type VideoEditRecordingPlacement = { at: 'end' } | { at: 'frame'; frame: number }
export interface VideoEditRecordingTarget {
  frame: number
  mode: 'append' | 'overwrite'
  /**
   * 各类素材该放进的轨道：沿用录屏轨已有的那几条，新的一段与旧的落在同一组轨道上。声音轨在新一段的范围里
   * 放着不属于录屏的片段时不沿用（交给导入另起一条），覆盖绝不切到用户自己的素材。没有对应轨道的类型省略。
   */
  tracks: Partial<Record<VideoEditRecordingKind, number>>
  /** 定落点时录屏轨的指纹（见 `videoEditRecordingLaneBasis`）。 */
  basis: string
}

/** `frames`：新一段的长度（已知时）；不知道时按到序列尽头算，沿用声音轨更保守。认不出录屏轨时抛出给用户看的原因。 */
export function videoEditRecordingTarget(source: LaneSource, placement: VideoEditRecordingPlacement, frames?: number): VideoEditRecordingTarget {
  if (placement.at === 'frame' && (!Number.isSafeInteger(placement.frame) || placement.frame < 0)) throw new Error('录制位置必须是不小于 0 的整数帧。')
  const lane = videoEditRecordingLane(source)
  if (lane.problem) throw new Error(lane.problem)
  const overwrite = placement.at === 'frame' && placement.frame < lane.end
  const frame = overwrite ? placement.frame : lane.end
  const until = frames === undefined ? Number.POSITIVE_INFINITY : frame + frames
  const own = new Set(lane.blocks.flatMap(block => [block.clip.id, ...block.linked.map(clip => clip.id)]))
  const tracks: VideoEditRecordingTarget['tracks'] = {}
  if (lane.track !== null) tracks.screen = lane.track
  // 越靠后的块越接近这次录制的设置；按轨名认出每类素材上一次放在哪。
  for (const { linked } of [...lane.blocks].reverse()) for (const clip of linked) {
    const name = source.tracks.find(track => track.index === clip.track)?.name
    const kind = (Object.keys(VIDEO_EDIT_RECORDING_TRACK_NAMES) as VideoEditRecordingKind[]).find(value => VIDEO_EDIT_RECORDING_TRACK_NAMES[value] === name)
    if (!kind || kind === 'screen' || tracks[kind] !== undefined) continue
    const foreign = source.clips.some(other => other.track === clip.track && !own.has(other.id) && other.start < until && other.start + other.duration > frame)
    if (!foreign) tracks[kind] = clip.track
  }
  return { frame, mode: overwrite ? 'overwrite' : 'append', tracks, basis: videoEditRecordingLaneBasis(lane) }
}

/**
 * 一次录制拼不成一个画面时（较早的会话、合并失败），各段按会话时钟落下会在暂停处留空档。录屏轨上要首尾相连：
 * 按链接组（一段画面连同它的声音）依次往前挪，接在上一段画面后面。只动这次新放的片段。
 */
export function packVideoEditRecordingTake(document: VideoEditDocument, sequenceId: string, takeClipIds: readonly string[]): VideoEditDocument {
  const sequence = document.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('目标序列不存在。')
  const source = { ...sequence, items: document.items, media: document.media }
  const take = sequence.clips.filter(clip => takeClipIds.includes(clip.id))
  const pictures = take.filter(clip => isVideoEditRecordingPicture(source, clip)).sort((a, b) => a.start - b.start)
  if (pictures.length < 2) return document
  const shifts = new Map<string, number>()
  let cursor = pictures[0].start + pictures[0].duration
  for (const picture of pictures.slice(1)) {
    const shift = picture.start - cursor
    for (const clip of take) if (clip.id === picture.id || picture.linkId && clip.linkId === picture.linkId) shifts.set(clip.id, shift)
    cursor += picture.duration
  }
  const next = { ...sequence, clips: sequence.clips.map(clip => shifts.get(clip.id) ? { ...clip, start: clip.start - shifts.get(clip.id)! } : clip) }
  return { ...document, sequences: document.sequences.map(value => value.id === sequenceId ? next : value) }
}

export interface VideoEditRecordingSettled {
  document: VideoEditDocument
  /** 新一段在序列上的范围（半开）。 */
  from: number
  to: number
  /** 被盖住的录屏块：名字与被盖住的范围（序列帧，半开）。 */
  covered: Array<{ name: string; from: number; to: number }>
}

/**
 * 新录的一段（`takeClipIds`，已经按 `videoEditRecordingTarget` 放到目标帧与轨道上）落定：它覆盖的范围里，
 * 被盖住的录屏块和它们链接的声音、摄像头被切掉（不改原文件，切掉的部分拖回边缘或撤销就能找回），没盖到的原地不动。
 * 只动这些片段本身，同一条轨上别的素材、别的轨道一概不碰。接在末尾时范围里没有录屏块，结果不变。
 * 返回新文档；与放入素材在同一次编辑里提交，就是一步撤销。认不出录屏轨时抛出给用户看的原因。
 */
export function settleVideoEditRecordingTake(document: VideoEditDocument, sequenceId: string, takeClipIds: readonly string[]): VideoEditRecordingSettled {
  const sequence = document.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('目标序列不存在。')
  const takeIds = new Set(takeClipIds)
  const take = sequence.clips.filter(clip => takeIds.has(clip.id))
  if (!take.length) return { document, from: 0, to: 0, covered: [] }
  const from = Math.min(...take.map(clip => clip.start)), to = Math.max(...take.map(clip => clip.start + clip.duration))
  const lane = videoEditRecordingLane({ ...sequence, clips: sequence.clips.filter(clip => !takeIds.has(clip.id)), items: document.items, media: document.media })
  if (lane.problem) throw new Error(lane.problem)
  const overlaps = (clip: VideoEditClip): boolean => clip.start < to && clip.start + clip.duration > from
  const coveredBlocks = lane.blocks.filter(({ clip }) => overlaps(clip))
  const covered = coveredBlocks.map(({ clip }) => ({ name: clip.name, from: Math.max(from, clip.start), to: Math.min(to, clip.start + clip.duration) }))
  const targets = new Set(coveredBlocks.flatMap(block => [block.clip, ...block.linked]).filter(overlaps).map(clip => clip.id))
  let current = document
  const clipsOf = (value: VideoEditDocument): VideoEditClip[] => value.sequences.find(item => item.id === sequenceId)!.clips
  const apply = (edit: Parameters<typeof applyVideoEditTimelineEditResult>[2]): void => {
    const next = applyVideoEditTimelineEditResult(current, sequenceId, edit).sequence
    current = { ...current, sequences: current.sequences.map(value => value.id === sequenceId ? next : value) }
  }
  // 在两端切开要动的片段（切出的右半截也算要动的），再去掉完全落在范围里的那些；只按片段操作，不按整条轨。
  for (const frame of [from, to]) {
    const crossing = clipsOf(current).filter(clip => targets.has(clip.id) && clip.start < frame && frame < clip.start + clip.duration).map(clip => clip.id)
    if (!crossing.length) continue
    const before = new Set(clipsOf(current).map(clip => clip.id))
    apply({ kind: 'split', clipIds: crossing, linked: false, frame })
    for (const clip of clipsOf(current)) if (!before.has(clip.id)) targets.add(clip.id)
  }
  const inside = clipsOf(current).filter(clip => targets.has(clip.id) && clip.start >= from && clip.start + clip.duration <= to).map(clip => clip.id)
  if (inside.length) apply({ kind: 'delete', clipIds: inside, linked: false, ripple: false })
  return { document: current, from, to, covered }
}
