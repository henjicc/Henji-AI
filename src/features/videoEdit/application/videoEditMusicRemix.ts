import { analyzeMusicStructure } from '@/commands/musicAnalysis'
import type { MusicAnalysis } from '@/core/audioAnalysis/music/musicAnalysis'
import type { MusicRemixGranularity } from '@/core/audioAnalysis/music/musicRemixPlan'
import { createLogger } from '@/core/logging'
import { videoEditClipRetimed } from '@/core/videoEdit/clipSpeed'
import type { VideoEditClip, VideoEditDocument, VideoEditSequence } from '@/core/videoEdit/document'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { applyMusicRemixToSequence, layoutMusicRemix } from '@/core/videoEdit/musicRemix'
import { videoEditFps } from '@/core/videoEdit/time'
import type { MusicAnalysisProgress } from '@/platform/contracts/musicAnalysis'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { planMusicRemixOffThread } from './videoEditMusicRemixPlanner'
import { editVideoSequence, holdVideoEditActivity, listVideoEditInstances, requireVideoEditInstance, type VideoEditInstance } from './videoEditService'

/*
 * 音频重构（对标 PR“重新混合”）：界面与助手共用的唯一入口。
 * 分析（主进程，按内容身份缓存）→ Worker 求路径 → 排到整数帧 → 一次序列编辑替换为子片段与接缝过渡（一步撤销）。
 * 已重构过的片段再次调用时，从记录的原始源范围重新计算并替换同一组子片段。
 */

export type VideoEditMusicRemixTarget =
  | { kind: 'seconds'; seconds: number }
  | { kind: 'frames'; frames: number }
  /** 对齐到序列里其他内容的结尾（不算这段音乐自己）。 */
  | { kind: 'sequence_end' }
  | { kind: 'clip_end'; clipId: string }

export interface VideoEditMusicRemixInput {
  projectId: string
  sequenceId: string
  clipId: string
  target: VideoEditMusicRemixTarget
  /** 0–1。 */
  repetition: number
  granularity: MusicRemixGranularity
  seed?: number
}

export interface VideoEditMusicRemixSeam { frame: number; confidence: number; kind: 'repeat' | 'skip'; fromSeconds: number; toSeconds: number }

export interface VideoEditMusicRemixResult {
  remixId: string
  clipIds: string[]
  startFrame: number
  targetFrames: number
  seams: VideoEditMusicRemixSeam[]
  /** 结尾为精确到帧而截掉的音乐（秒），已淡出。 */
  trimmedSeconds: number
  analysis: { tempo: number; beatsPerBar: number; beatSource: MusicAnalysis['beatSource']; cached: boolean; model: 'used' | 'fallback' }
  timings: { analysisMs: number; planMs: number }
}

/** 重构失败但剪辑未改动；message 给用户看，facts 给调用方改道（最短/最长时长等）。 */
export class VideoEditMusicRemixRejection extends Error {
  constructor(message: string, readonly code: string, readonly facts: { minSeconds?: number; maxSeconds?: number } = {}) { super(message); this.name = 'VideoEditMusicRemixRejection' }
}

export interface VideoEditMusicStructure {
  tempo: number; beatsPerBar: number; beats: number; beatSource: MusicAnalysis['beatSource']; suitable: boolean; unsuitableReason: string | null
  sections: Array<{ startSeconds: number; label: string }>
}

const logger = createLogger('features.videoEdit.musicRemix')
const structures = new WeakMap<VideoEditInstance, Map<string, { identity: string; value: VideoEditMusicStructure }>>()
const running = new WeakSet<VideoEditInstance>()

function mediaIdentity(document: VideoEditDocument, mediaId: string): string { return JSON.stringify(document.media.find(media => media.id === mediaId) ?? null) }

/** 素材最近一次音乐结构分析的摘要；未分析或素材变了为 undefined。只在内存里，不写进作品。 */
export function readVideoEditMusicStructure(projectId: string, mediaId: string): VideoEditMusicStructure | undefined {
  const owner = requireVideoEditInstance(projectId), entry = structures.get(owner)?.get(mediaId)
  return entry && entry.identity === mediaIdentity(owner.document, mediaId) ? entry.value : undefined
}

function remember(owner: VideoEditInstance, mediaId: string, analysis: MusicAnalysis): void {
  let entries = structures.get(owner)
  if (!entries) { entries = new Map(); structures.set(owner, entries) }
  if (entries.size >= 16) entries.delete(entries.keys().next().value!)
  entries.set(mediaId, { identity: mediaIdentity(owner.document, mediaId), value: {
    tempo: analysis.tempo, beatsPerBar: analysis.beatsPerBar, beats: analysis.beats.length, beatSource: analysis.beatSource, suitable: analysis.suitable, unsuitableReason: analysis.unsuitableReason ?? null,
    sections: analysis.sections.map(section => ({ startSeconds: analysis.beats[section.startBeat] ?? 0, label: section.label })),
  } })
}

const sourceSeconds = (clip: Pick<VideoEditClip, 'sourceInUs' | 'sourceRemainder'>): number => (clip.sourceInUs + clip.sourceRemainder.numerator / clip.sourceRemainder.denominator) / 1e6

interface Prepared { owner: VideoEditInstance; sequence: VideoEditSequence; group: VideoEditClip[]; template: VideoEditClip; startFrame: number; sourceStart: number; sourceEnd: number; targetFrames: number; fps: number; path: string; mediaId: string; remixId: string }

/** 校验目标并整理重构的出发点；任何不满足都在改动剪辑之前拒绝。 */
function prepare(input: VideoEditMusicRemixInput): Prepared {
  const owner = requireVideoEditInstance(input.projectId)
  const sequence = owner.document.sequences.find(value => value.id === input.sequenceId)
  if (!sequence) throw new VideoEditMusicRemixRejection('目标序列不存在。', 'sequence_missing')
  const clip = sequence.clips.find(value => value.id === input.clipId)
  if (!clip) throw new VideoEditMusicRemixRejection('这个片段不在目标序列里，请用 video_edit.clip 列出的完整引用。', 'clip_missing')
  if (clip.kind !== 'audio') throw new VideoEditMusicRemixRejection('音频重构只能用于音频片段；视频自带的声音请先取消链接，对分离出的音频片段操作。', 'not_audio')
  const group = clip.remix ? sequence.clips.filter(value => value.remix?.id === clip.remix!.id && value.track === clip.track).sort((a, b) => a.start - b.start) : [clip]
  const template = group.find(value => (value.remix?.segment ?? 0) === 0) ?? group[0]
  assertVideoEditClipsEditable(sequence, group.map(value => value.id))
  if (group.some(value => value.linkId)) throw new VideoEditMusicRemixRejection('片段与画面链接在一起，重构会打乱音画同步；请先取消链接再重构音乐。', 'linked')
  if (group.some(value => videoEditClipRetimed(value))) throw new VideoEditMusicRemixRejection('片段设置了变速、倒放或定格，请先恢复正常速度再重构。', 'retimed')
  if (group.some(value => value.curves && Object.keys(value.curves).length)) throw new VideoEditMusicRemixRejection('片段带有关键帧动画（如音量包络），重构后无法保留，请先清除关键帧。', 'keyframes')
  const item = owner.document.items.find(value => value.id === template.itemId)
  const media = owner.document.media.find(value => value.id === item?.mediaId)
  if (!item || !media || media.kind !== 'audio' && media.kind !== 'video') throw new VideoEditMusicRemixRejection('找不到这个片段对应的音频文件。', 'media_missing')
  const fps = videoEditFps(sequence.frameRate)
  const startFrame = group[0].start
  const sourceStart = clip.remix ? clip.remix.sourceInUs / 1e6 : sourceSeconds(clip)
  const sourceEnd = clip.remix ? clip.remix.sourceOutUs / 1e6 : sourceStart + clip.duration / fps
  const others = sequence.clips.filter(value => !group.includes(value))
  const end = input.target.kind === 'seconds' ? startFrame + Math.round(input.target.seconds * fps)
    : input.target.kind === 'frames' ? startFrame + input.target.frames
      : input.target.kind === 'sequence_end' ? Math.max(0, ...others.map(value => value.start + value.duration))
        : (() => { const target = (input.target as { clipId: string }).clipId, other = others.find(value => value.id === target); if (!other) throw new VideoEditMusicRemixRejection('对齐目标片段不在这个序列里。', 'align_clip_missing'); return other.start + other.duration })()
  const targetFrames = end - startFrame
  if (!Number.isInteger(targetFrames) || targetFrames < Math.round(fps)) throw new VideoEditMusicRemixRejection(`目标时长要至少 1 秒且在音乐起点（第 ${startFrame} 帧）之后。`, 'target_invalid')
  return { owner, sequence, group, template, startFrame, sourceStart, sourceEnd, targetFrames, fps, path: media.path, mediaId: media.id, remixId: clip.remix?.id ?? crypto.randomUUID() }
}

export async function remixVideoEditMusic(input: VideoEditMusicRemixInput, signal?: AbortSignal, onProgress?: (event: MusicAnalysisProgress) => void): Promise<VideoEditMusicRemixResult> {
  const prepared = prepare(input)
  const { owner, fps, targetFrames } = prepared
  if (running.has(owner)) throw new VideoEditMusicRemixRejection('正在重构音乐，请稍候。', 'busy')
  const contentVersion = owner.contentVersion
  const release = holdVideoEditActivity(input.projectId, '音频重构')
  running.add(owner)
  const seed = input.seed ?? 0
  logger.info('音频重构开始', { event: 'video_edit.music_remix.start', context: { projectId: input.projectId, sequenceId: input.sequenceId, clipId: input.clipId, targetFrames, repetition: input.repetition, granularity: input.granularity, seed, again: Boolean(prepared.group[0].remix) } })
  try {
    let started = performance.now()
    const analyzed = await analyzeMusicStructure(prepared.path, signal, onProgress)
    const analysisMs = performance.now() - started
    if (listVideoEditInstances().includes(owner)) remember(owner, prepared.mediaId, analyzed.analysis)
    started = performance.now()
    const plan = await planMusicRemixOffThread({ analysis: analyzed.analysis, sourceStartSeconds: prepared.sourceStart, sourceEndSeconds: prepared.sourceEnd, targetSeconds: targetFrames / fps, repetition: input.repetition, granularity: input.granularity, seed, marginSeconds: 1 / fps }, signal)
    const planMs = performance.now() - started
    if (!plan.ok) throw new VideoEditMusicRemixRejection(plan.message, plan.code, { ...(plan.minSeconds === undefined ? {} : { minSeconds: plan.minSeconds }), ...(plan.maxSeconds === undefined ? {} : { maxSeconds: plan.maxSeconds }) })
    signal?.throwIfAborted()
    if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('剪辑在分析期间已有修改或已关闭，请重新重构。')
    const layout = layoutMusicRemix(plan, fps, targetFrames)
    let applied: ReturnType<typeof applyMusicRemixToSequence> | undefined
    editVideoSequence(input.projectId, input.sequenceId, sequence => {
      applied = applyMusicRemixToSequence({ sequence, replaceClipIds: [prepared.template.id, ...prepared.group.filter(clip => clip !== prepared.template).map(clip => clip.id)], startFrame: prepared.startFrame, layout, newId: () => crypto.randomUUID(),
        remix: { id: prepared.remixId, targetFrames, repetition: input.repetition, granularity: input.granularity, seed, analysisIdentity: analyzed.analysisIdentity, sourceInUs: Math.round(prepared.sourceStart * 1e6), sourceOutUs: Math.round(prepared.sourceEnd * 1e6) } })
      return applied.sequence
    })
    const result: VideoEditMusicRemixResult = {
      remixId: prepared.remixId, clipIds: applied!.clips.map(clip => clip.id), startFrame: prepared.startFrame, targetFrames,
      seams: plan.seams.map((seam, k) => ({ frame: prepared.startFrame + layout.pieces[k + 1].startFrame, confidence: seam.confidence, kind: seam.kind, fromSeconds: analyzed.analysis.beats[seam.fromBeat + 1] ?? prepared.sourceEnd, toSeconds: analyzed.analysis.beats[seam.toBeat] })),
      trimmedSeconds: Math.round(layout.trimmedSeconds * 1000) / 1000,
      analysis: { tempo: analyzed.analysis.tempo, beatsPerBar: analyzed.analysis.beatsPerBar, beatSource: analyzed.analysis.beatSource, cached: analyzed.cached, model: analyzed.model },
      timings: { analysisMs: Math.round(analysisMs), planMs: Math.round(planMs) },
    }
    logger.info('音频重构完成', { event: 'video_edit.music_remix.completed', context: { projectId: input.projectId, sequenceId: input.sequenceId, remixId: result.remixId, segments: result.clipIds.length, seams: result.seams.length, minConfidence: Math.min(1, ...result.seams.map(seam => seam.confidence)), trimmedSeconds: result.trimmedSeconds, beatSource: result.analysis.beatSource, cached: result.analysis.cached, ...result.timings } })
    return result
  } catch (error) {
    if (signal?.aborted) logger.info('音频重构已取消', { event: 'video_edit.music_remix.cancelled', context: { projectId: input.projectId } })
    else logger.warn('音频重构未完成', { event: 'video_edit.music_remix.failed', error, context: { projectId: input.projectId, clipId: input.clipId, code: error instanceof VideoEditMusicRemixRejection ? error.code : undefined } })
    throw error
  } finally { running.delete(owner); release() }
}
