import { videoEditClipMedia, VIDEO_EDIT_MAX_CLIP_TAKES, type VideoEditClip, type VideoEditCreativeSource, type VideoEditClipTake, type VideoEditDocument, type VideoEditSequence } from './document'
import { makeVideoEditItemClip } from './projectItems'
import { applyVideoEditTimelineEditResult } from './timelineEdits'
import { videoEditFps, videoEditSourceSeconds } from './time'
import { videoEditEdgeTracks } from './tracks'
import type { CodeMaterialMetadataReader } from './codeMaterialDocument'

/*
 * 原地生成（4.12）：在时间线当前位置生成镜头或声音并直接落进去。
 * - 规划：按动作算出落点、时长、轨道与参考帧（前一镜头尾帧、后一镜头首帧、被替换镜头首帧、被延长镜头尾帧）。
 * - 落位：生成完成时按“当时”的剪辑重新求落点——生成期间用户可以继续剪，原片段被移动就跟着它，
 *   原落点被占用就在最上面的视频轨之上（或最下面的音频轨之下）新建一条轨道，从不覆盖用户后来放的片段。
 * - 替换保留原镜头为可切回的版本（takes），切回只换素材与入点，位置与属性不动。
 * 这里只有纯计算，界面、助手与后台任务共用；生成、取帧与导入在 features/videoEdit/application/videoEditInPlaceGeneration.ts。
 */

export type VideoEditInPlaceAction = 'generate_shot' | 'replace_shot' | 'extend_shot' | 'generate_audio'
export type VideoEditInPlaceMode = 'insert' | 'overwrite'
export interface VideoEditInPlaceIntent {
  action: VideoEditInPlaceAction
  /** generate_shot / generate_audio：落点帧。 */
  frame?: number
  /** generate_shot / generate_audio / extend_shot：帧数（明确给出时结果按它裁）；省略时生成镜头填满落点所在空隙，后面没有片段或延长时按生成结果的实际长度（预计 5 秒）。 */
  duration?: number
  /** generate_shot / generate_audio：目标轨道编号；省略时用目标轨道或第一条空着的同类轨道，都占用时新建轨道。 */
  trackIndex?: number
  /** replace_shot / extend_shot 必填；generate_audio 传入时替换这段声音。 */
  clipId?: string
  /** extend_shot：插入（后面片段后移）或覆盖，默认插入。 */
  mode?: VideoEditInPlaceMode
}
export type VideoEditReferenceRole = 'previous_tail' | 'next_head' | 'replaced_head' | 'extended_tail'
export interface VideoEditInPlaceReference { role: VideoEditReferenceRole; clipId: string; itemId: string; clipName: string; sourceTimeUs: number }
export interface VideoEditInPlacePlan {
  action: VideoEditInPlaceAction
  mediaType: 'video' | 'audio'
  sequenceId: string
  frame: number
  /** 预计长度（占位片段按它显示，参数里的时长按它换算）。 */
  duration: number
  /** true：长度是硬性的（填空隙、入出点、替换、明确指定），结果更长时裁掉；false：按生成结果的实际长度放。 */
  fill: boolean
  /** null：没有空余同类轨道，落位时新建。 */
  trackIndex: number | null
  placement: 'add' | 'replace' | VideoEditInPlaceMode
  clipId?: string
  references: VideoEditInPlaceReference[]
  width: number
  height: number
  fps: number
}

export const VIDEO_EDIT_IN_PLACE_DEFAULT_SECONDS = 5
const REFERENCE_LABELS: Record<VideoEditReferenceRole, string> = { previous_tail: '前一镜头的最后一帧', next_head: '后一镜头的第一帧', replaced_head: '原镜头的第一帧', extended_tail: '原镜头的最后一帧' }
export function videoEditReferenceLabel(reference: VideoEditInPlaceReference): string { return `「${reference.clipName}」${REFERENCE_LABELS[reference.role].replace('镜头', '')}` }

function maxFrames(sequence: VideoEditSequence): number { return Math.floor(videoEditFps(sequence.frameRate) * 1800) }
function overlaps(clip: VideoEditClip, from: number, to: number): boolean { return clip.start < to && clip.start + clip.duration > from }
function pictured(document: Pick<VideoEditDocument, 'items' | 'media'>, clip: VideoEditClip): boolean {
  if (clip.kind !== 'video' && clip.kind !== 'image') return false
  const media = videoEditClipMedia(document, clip)
  return Boolean(media && media.kind !== 'audio')
}

/** 轨道上包含 `frame` 的空隙 `[from, to)`；`to` 为 null 表示后面没有片段。`frame` 落在片段上时返回 null。 */
export function videoEditTrackGap(sequence: Pick<VideoEditSequence, 'clips'>, trackIndex: number, frame: number): { from: number; to: number | null } | null {
  const clips = sequence.clips.filter(clip => clip.track === trackIndex)
  if (clips.some(clip => clip.start <= frame && clip.start + clip.duration > frame)) return null
  const from = Math.max(0, ...clips.filter(clip => clip.start + clip.duration <= frame).map(clip => clip.start + clip.duration))
  const after = clips.filter(clip => clip.start > frame).map(clip => clip.start)
  return { from, to: after.length ? Math.min(...after) : null }
}

/** 片段第 `offset` 帧（片段时间）对应的源时间，落在源帧中间避免解码到前一帧；不超出素材。 */
export function videoEditClipFrameSourceUs(document: Pick<VideoEditDocument, 'items' | 'media'>, sequence: VideoEditSequence, clip: VideoEditClip, offset: number): number {
  const media = videoEditClipMedia(document, clip)
  if (!media || media.kind === 'image') return 0
  const fps = videoEditFps(sequence.frameRate)
  const end = Math.max(0, Math.round(media.durationSeconds * 1e6) - 1)
  return Math.max(0, Math.min(end, Math.round((videoEditSourceSeconds(clip) + (Math.max(0, Math.min(clip.duration - 1, offset)) + 0.5) / fps) * 1e6)))
}

function reference(document: VideoEditDocument, sequence: VideoEditSequence, clip: VideoEditClip, role: VideoEditReferenceRole): VideoEditInPlaceReference {
  const offset = role === 'previous_tail' || role === 'extended_tail' ? clip.duration - 1 : 0
  return { role, clipId: clip.id, itemId: clip.itemId, clipName: clip.name, sourceTimeUs: videoEditClipFrameSourceUs(document, sequence, clip, offset) }
}

/** 空隙两侧的画面：同一轨道优先，其次任意视频轨上离得最近的（高轨道优先，与节目画面一致）。 */
function neighbours(document: VideoEditDocument, sequence: VideoEditSequence, trackIndex: number | null, from: number, to: number): VideoEditInPlaceReference[] {
  const enabled = new Set(sequence.tracks.filter(track => track.kind === 'video' && track.enabled).map(track => track.index))
  const candidates = sequence.clips.filter(clip => enabled.has(clip.track) && pictured(document, clip))
  const pick = (list: VideoEditClip[], score: (clip: VideoEditClip) => number): VideoEditClip | undefined => {
    const same = list.filter(clip => clip.track === trackIndex)
    const pool = same.length ? same : list
    return [...pool].sort((a, b) => score(a) - score(b) || b.track - a.track)[0]
  }
  const before = pick(candidates.filter(clip => clip.start + clip.duration <= from), clip => from - (clip.start + clip.duration))
  const after = pick(candidates.filter(clip => clip.start >= to), clip => clip.start - to)
  return [...(before ? [reference(document, sequence, before, 'previous_tail')] : []), ...(after ? [reference(document, sequence, after, 'next_head')] : [])]
}

function freeTrack(sequence: VideoEditSequence, kind: 'video' | 'audio', from: number, to: number, preferred: readonly number[]): number | null {
  const free = sequence.tracks.filter(track => track.kind === kind && !track.locked && !sequence.clips.some(clip => clip.track === track.index && overlaps(clip, from, to)))
  const ordered = [...free].sort((a, b) => kind === 'video' ? a.index - b.index : b.index - a.index)
  return (ordered.find(track => preferred.includes(track.index)) ?? ordered[0])?.index ?? null
}

/**
 * 按动作规划一次原地生成。`targetTracks` 是时间线的目标轨道编号（PR 的轨道目标），自动选轨时优先。
 * 不合法的请求抛出可直接给用户看的说明。
 */
export function planVideoEditInPlaceGeneration(document: VideoEditDocument, sequenceId: string, intent: VideoEditInPlaceIntent, targetTracks: readonly number[] = []): VideoEditInPlacePlan {
  const sequence = document.sequences.find(value => value.id === sequenceId)
  if (!sequence) throw new Error('目标序列不存在。')
  const fps = videoEditFps(sequence.frameRate); const limit = maxFrames(sequence)
  const base = { action: intent.action, sequenceId, width: sequence.width, height: sequence.height, fps }
  const seconds = (value: number): number => Math.max(1, Math.round(value * fps))
  const checkDuration = (duration: number | undefined): void => { if (duration !== undefined && (!Number.isSafeInteger(duration) || duration < 1)) throw new Error('时长须为正整数帧。') }
  checkDuration(intent.duration)
  if (intent.action === 'replace_shot' || intent.action === 'extend_shot' || intent.action === 'generate_audio' && intent.clipId) {
    const clip = sequence.clips.find(value => value.id === intent.clipId)
    if (!clip) throw new Error(intent.clipId ? '要处理的片段已不在这个序列里。' : '请指定要替换或延长的片段。')
    const track = sequence.tracks.find(value => value.index === clip.track)
    if (track?.locked) throw new Error('片段所在轨道已锁定，请先解锁。')
    if (intent.action === 'generate_audio') {
      if (clip.kind !== 'audio') throw new Error('只能用新的配音或配乐替换声音片段。')
      return { ...base, mediaType: 'audio', frame: clip.start, duration: clip.duration, fill: true, trackIndex: clip.track, placement: 'replace', clipId: clip.id, references: [] }
    }
    if (!pictured(document, clip)) throw new Error(intent.action === 'replace_shot' ? '只能替换视频或图片片段。' : '只能延长视频或图片片段。')
    if (intent.action === 'replace_shot') return { ...base, mediaType: 'video', frame: clip.start, duration: clip.duration, fill: true, trackIndex: clip.track, placement: 'replace', clipId: clip.id, references: [reference(document, sequence, clip, 'replaced_head')] }
    const frame = clip.start + clip.duration
    const duration = Math.min(intent.duration ?? seconds(VIDEO_EDIT_IN_PLACE_DEFAULT_SECONDS), limit - frame)
    if (duration < 1) throw new Error('片段已到序列末尾，不能再延长。')
    return { ...base, mediaType: 'video', frame, duration, fill: intent.duration !== undefined, trackIndex: clip.track, placement: intent.mode ?? 'insert', clipId: clip.id, references: [reference(document, sequence, clip, 'extended_tail')] }
  }
  const kind = intent.action === 'generate_audio' ? 'audio' : 'video'
  const frame = intent.frame
  if (frame === undefined || !Number.isSafeInteger(frame) || frame < 0 || frame >= limit) throw new Error('请指定序列范围内的落点。')
  let trackIndex: number | null
  let duration = intent.duration
  let fill = duration !== undefined
  if (intent.trackIndex !== undefined) {
    const track = sequence.tracks.find(value => value.index === intent.trackIndex)
    if (!track || track.kind !== kind) throw new Error(kind === 'audio' ? '配音或配乐只能放在音频轨道上。' : '镜头只能放在视频轨道上。')
    if (track.locked) throw new Error('目标轨道已锁定，请先解锁。')
    const gap = videoEditTrackGap(sequence, track.index, frame)
    if (!gap) throw new Error('落点已有片段，请换到空白处，或选中片段用“替换镜头”。')
    if (duration === undefined) { fill = gap.to !== null; duration = gap.to === null ? seconds(VIDEO_EDIT_IN_PLACE_DEFAULT_SECONDS) : gap.to - frame }
    trackIndex = sequence.clips.some(clip => clip.track === track.index && overlaps(clip, frame, frame + duration!)) ? null : track.index
  } else {
    duration ??= seconds(VIDEO_EDIT_IN_PLACE_DEFAULT_SECONDS)
    trackIndex = freeTrack(sequence, kind, frame, frame + duration, targetTracks)
  }
  duration = Math.min(duration, limit - frame)
  if (duration < 1) throw new Error('落点已到序列末尾。')
  if (trackIndex === null) videoEditEdgeTracks(sequence, kind, 1)
  return { ...base, mediaType: kind, frame, duration, fill, trackIndex, placement: 'add', references: kind === 'video' ? neighbours(document, sequence, trackIndex, frame, frame + duration) : [] }
}

function takeOf(clip: VideoEditClip): VideoEditClipTake {
  return { itemId: clip.itemId, name: clip.name, kind: clip.kind === 'audio' ? 'audio' : clip.kind === 'image' ? 'image' : 'video', duration: clip.duration, sourceInUs: clip.sourceInUs, sourceRemainder: { ...clip.sourceRemainder },
    ...(clip.sourceComponent ? { sourceComponent: clip.sourceComponent } : {}), ...(clip.creativeSource ? { creativeSource: structuredClone(clip.creativeSource) } : {}) }
}
function replaceSequence(document: VideoEditDocument, sequence: VideoEditSequence): VideoEditDocument {
  return { ...document, sequences: document.sequences.map(value => value.id === sequence.id ? sequence : value) }
}
/** 同轨道上 `clip` 之后第一个片段的起点（没有时到序列末尾）。 */
function roomAfter(sequence: VideoEditSequence, clip: VideoEditClip): number {
  const next = sequence.clips.filter(value => value.track === clip.track && value.id !== clip.id && value.start >= clip.start + 1).map(value => value.start)
  return (next.length ? Math.min(...next) : maxFrames(sequence)) - clip.start
}

export interface VideoEditInPlaceLanding { document: VideoEditDocument; clipId: string; newTrack: boolean; fallback?: 'clip_missing' | 'slot_taken' }
/**
 * 把已导入项目的生成结果（素材项 `itemId`）按规划落进 `document` 的当前状态，返回整份新剪辑（一步编辑）。
 * 生成结果比规划短时片段跟着变短；替换时位置、变换、效果与链接不动，原素材记为可切回的版本。
 */
export function landVideoEditInPlaceResult(document: VideoEditDocument, plan: VideoEditInPlacePlan, itemId: string, origin?: VideoEditCreativeSource, metadata?: CodeMaterialMetadataReader): VideoEditInPlaceLanding {
  let sequence = document.sequences.find(value => value.id === plan.sequenceId)
  if (!sequence) throw new Error('原序列已删除，生成结果保留在项目素材里。')
  const item = document.items.find(value => value.id === itemId)
  const media = document.media.find(value => value.id === item?.mediaId)
  if (!item || !media || media.kind !== (plan.mediaType === 'audio' ? 'audio' : 'video') && !(plan.mediaType === 'video' && media.kind === 'image')) throw new Error(plan.mediaType === 'audio' ? '生成结果不是声音，没有放进时间线。' : '生成结果不是视频或图片，没有放进时间线。')
  // 生成结果的自然长度（图片不限）；比规划短时片段跟着变短。
  const natural = media.kind === 'image' ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.floor(media.durationSeconds * videoEditFps(sequence.frameRate) + 1e-6))
  const prior = plan.clipId ? sequence.clips.find(value => value.id === plan.clipId) : undefined
  const priorTrack = prior && sequence.tracks.find(track => track.index === prior.track)
  if (plan.placement === 'replace' && prior && !priorTrack?.locked) {
    const component = prior.sourceComponent && item.kind === 'video' && (prior.sourceComponent === 'video' || media.hasAudio === true) ? { sourceComponent: prior.sourceComponent } : {}
    const duration = Math.min(prior.duration, natural)
    const made = makeVideoEditItemClip(document, itemId, sequence.id, { frame: prior.start, track: prior.track, duration, ...component }, metadata)
    const takes = [takeOf(prior), ...(prior.takes ?? [])].slice(0, VIDEO_EDIT_MAX_CLIP_TAKES)
    const clip: VideoEditClip = { ...prior, itemId: made.itemId, name: made.name, kind: made.kind, duration, sourceInUs: made.sourceInUs, sourceRemainder: made.sourceRemainder, takes }
    if (component.sourceComponent) clip.sourceComponent = component.sourceComponent; else delete clip.sourceComponent
    if (origin) clip.creativeSource = structuredClone(origin); else delete clip.creativeSource
    delete clip.audioMapping
    if (clip.fadeInFrames && clip.fadeInFrames > duration) clip.fadeInFrames = duration
    if (clip.fadeOutFrames && clip.fadeOutFrames > duration) clip.fadeOutFrames = duration
    return { document: replaceSequence(document, { ...sequence, clips: sequence.clips.map(value => value.id === prior.id ? clip : value) }), clipId: clip.id, newTrack: false }
  }
  // 延长跟着原片段走：它被移动或修剪过就接在它现在的尾巴上。
  const extending = plan.action === 'extend_shot' && prior && !priorTrack?.locked
  const frame = extending ? prior.start + prior.duration : plan.frame
  const mode = extending ? plan.placement as VideoEditInPlaceMode : 'paste'
  const kind = plan.mediaType
  let track = extending ? prior.track : plan.trackIndex
  const usable = track !== null && sequence.tracks.some(value => value.index === track && value.kind === kind && !value.locked)
  let fallback: VideoEditInPlaceLanding['fallback'] = plan.clipId && !extending ? 'clip_missing' : undefined
  const limit = maxFrames(sequence)
  if (frame >= limit) throw new Error('原落点已超出序列范围，生成结果保留在项目素材里。')
  const duration = Math.min(plan.fill ? plan.duration : Number.MAX_SAFE_INTEGER, natural, limit - frame)
  const taken = (index: number): boolean => sequence!.clips.some(clip => clip.track === index && overlaps(clip, frame, frame + duration))
  let newTracks: VideoEditSequence['tracks'] | undefined
  if (!usable || mode === 'paste' && taken(track!)) {
    if (usable) fallback ??= 'slot_taken'
    newTracks = videoEditEdgeTracks(sequence, kind, 1)
    track = newTracks[0].index
  }
  if (newTracks) sequence = { ...sequence, tracks: [...sequence.tracks, ...newTracks] }
  const base = replaceSequence(document, sequence)
  const made = makeVideoEditItemClip(base, itemId, sequence.id, { frame, track: track!, duration }, metadata)
  const clip = origin ? { ...made, creativeSource: structuredClone(origin) } : made
  const result = applyVideoEditTimelineEditResult(base, sequence.id, { kind: 'place', clipboard: { projectId: document.id, frameRate: sequence.frameRate, clips: [clip], annotations: [] }, frame, mode }, metadata)
  const placed = result.selectedClipIds?.[0]
  if (!placed) throw new Error('生成结果没有放进时间线。')
  return { document: replaceSequence(document, result.sequence), clipId: placed, newTrack: Boolean(newTracks), ...(fallback ? { fallback } : {}) }
}

/**
 * 切回片段的第 `index` 个版本（PR 替换素材后换回）：当前画面变成可切回的版本，位置、变换、效果不动。
 * 版本的原长度放得下就恢复，放不下（后面已有片段或素材不够长）就收紧。
 */
export function switchVideoEditClipTake(document: VideoEditDocument, sequenceId: string, clipId: string, index: number): VideoEditDocument {
  const sequence = document.sequences.find(value => value.id === sequenceId)
  const clip = sequence?.clips.find(value => value.id === clipId)
  if (!sequence || !clip) throw new Error('片段已不在这个序列里。')
  const take = clip.takes?.[index]
  if (!take) throw new Error('这个片段没有可切回的镜头版本。')
  if (sequence.tracks.find(track => track.index === clip.track)?.locked) throw new Error('片段所在轨道已锁定，请先解锁。')
  const item = document.items.find(value => value.id === take.itemId)
  if (!item) throw new Error('这个版本的素材已从项目中移除，不能切回。')
  const media = document.media.find(value => value.id === item.mediaId)
  const fps = videoEditFps(sequence.frameRate)
  const available = media && media.kind !== 'image' ? Math.floor((media.durationSeconds - videoEditSourceSeconds(take)) * fps + 1e-6) : Number.MAX_SAFE_INTEGER
  const duration = Math.max(1, Math.min(take.duration, available, roomAfter(sequence, clip)))
  const takes = [takeOf(clip), ...clip.takes!.filter((_, at) => at !== index)].slice(0, VIDEO_EDIT_MAX_CLIP_TAKES)
  const next: VideoEditClip = { ...clip, itemId: take.itemId, name: take.name, kind: take.kind, duration, sourceInUs: take.sourceInUs, sourceRemainder: { ...take.sourceRemainder }, takes }
  if (take.sourceComponent) next.sourceComponent = take.sourceComponent; else delete next.sourceComponent
  if (take.creativeSource) next.creativeSource = structuredClone(take.creativeSource); else delete next.creativeSource
  delete next.audioMapping
  if (next.fadeInFrames && next.fadeInFrames > duration) next.fadeInFrames = duration
  if (next.fadeOutFrames && next.fadeOutFrames > duration) next.fadeOutFrames = duration
  return replaceSequence(document, { ...sequence, clips: sequence.clips.map(value => value.id === clip.id ? next : value) })
}
