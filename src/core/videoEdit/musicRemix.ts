import { videoEditGainDbSchema } from './loudness'
import { z } from 'zod'
import type { MusicRemixGranularity, MusicRemixPlan } from '../audioAnalysis/music/musicRemixPlan'
import type { VideoEditClip, VideoEditSequence } from './document'
import type { VideoEditTransition } from './transitions'
import { VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from './time'

/*
 * 音频重构落到时间线（对标 PR“重新混合”）：重构路径的每一段成为一个普通音频子片段，相邻子片段之间挂 2 帧恒定功率过渡。
 *
 * 片段只能从整数帧开始，接缝取“理想拍点 − 30 ms”附近的整数帧；跳入一侧的源入点按同一偏移前移，
 * 让跳入的那一拍在时间线上恰好落在原本下一拍应在的位置（节拍网格连续，误差为零），切点永远在起音之前约 10–50 ms。
 * 过渡整段放在切点之前（PR“终点切点”），交叉淡化只覆盖起音前的衰减部分。多出的时长在最后一段末尾截掉并淡出。
 */

export const MUSIC_REMIX_SEAM_LEAD_SECONDS = 0.03
export const MUSIC_REMIX_TRANSITION_FRAMES = 2
const TAIL_FADE_SECONDS = 1.5

const identifier = z.string().min(1).max(100)
export const videoEditClipRemixSchema = z.object({
  /** 同一次重构的全部子片段共用。 */
  id: identifier,
  /** 子片段在重构结果里的序号，从 0 起。 */
  segment: z.number().int().nonnegative().max(10_000),
  targetFrames: z.number().int().min(1).max(VIDEO_EDIT_MAX_SEQUENCE_FRAMES),
  repetition: z.number().min(0).max(1),
  granularity: z.enum(['beat', 'bar', 'phrase']),
  seed: z.number().int().min(0).max(2 ** 31 - 1),
  /** 分析所依据的素材内容身份与分析版本；内容变了需要重新分析。 */
  analysisIdentity: z.string().min(1).max(200),
  /** 重构前的原始源范围（微秒），改参数重算时从这里出发。 */
  sourceInUs: z.number().int().nonnegative(),
  sourceOutUs: z.number().int().positive(),
  /** 这一段开头接缝的听感把握（0–1，越高越不易听出）；首段没有接缝。 */
  seamConfidence: z.number().min(0).max(1).optional(),
}).strict().refine(value => value.sourceOutUs > value.sourceInUs, '重构原始出点须晚于入点。')
export type VideoEditClipRemix = z.infer<typeof videoEditClipRemixSchema>

export interface MusicRemixPiece {
  startFrame: number
  durationFrames: number
  /** 精确源入点（秒）。 */
  sourceInSeconds: number
  gainDb: number
  seamConfidence?: number
}

export interface MusicRemixLayout {
  pieces: MusicRemixPiece[]
  /** 尾段截掉的源时长（秒）与淡出帧数。 */
  trimmedSeconds: number
  tailFadeFrames: number
}

type ReadyPlan = Extract<MusicRemixPlan, { ok: true }>

/** 把以秒表达的重构路径排到整数帧上；总帧数严格等于 targetFrames。 */
export function layoutMusicRemix(plan: ReadyPlan, fps: number, targetFrames: number): MusicRemixLayout {
  if (!Number.isFinite(fps) || fps <= 0 || !Number.isInteger(targetFrames) || targetFrames < 1) throw new Error('帧率或目标时长无效。')
  const pieces: MusicRemixPiece[] = []
  plan.segments.forEach((segment, k) => {
    if (k === 0) { pieces.push({ startFrame: 0, durationFrames: 0, sourceInSeconds: segment.sourceStartSeconds, gainDb: 0 }); return }
    const frame = Math.max(pieces[k - 1].startFrame + MUSIC_REMIX_TRANSITION_FRAMES, Math.round((segment.timelineSeconds - MUSIC_REMIX_SEAM_LEAD_SECONDS) * fps))
    const lead = segment.timelineSeconds - frame / fps
    pieces.push({ startFrame: frame, durationFrames: 0, sourceInSeconds: segment.sourceStartSeconds - lead, gainDb: segment.gainDb, seamConfidence: plan.seams[k - 1]?.confidence })
  })
  if (pieces.at(-1)!.startFrame + MUSIC_REMIX_TRANSITION_FRAMES > targetFrames) throw new Error('重构结果的最后一段落在目标时长之外。')
  pieces.forEach((piece, k) => { piece.durationFrames = (pieces[k + 1]?.startFrame ?? targetFrames) - piece.startFrame })
  const tail = pieces.at(-1)!, lastSegment = plan.segments.at(-1)!
  const trimmedSeconds = lastSegment.sourceEndSeconds - (tail.sourceInSeconds + tail.durationFrames / fps)
  if (trimmedSeconds < -1e-6) throw new Error('重构结果比可用音乐短，无法精确到目标时长。')
  const tailFadeFrames = trimmedSeconds > 0.05 ? Math.max(2, Math.min(Math.round(TAIL_FADE_SECONDS * fps), Math.floor(tail.durationFrames / 2))) : 0
  return { pieces, trimmedSeconds: Math.max(0, trimmedSeconds), tailFadeFrames }
}

/** 秒 → 源入点微秒与亚微秒分数（分母 1000）。 */
export function videoEditSourceTimeFromSeconds(seconds: number): Pick<VideoEditClip, 'sourceInUs' | 'sourceRemainder'> {
  const us = Math.max(0, seconds) * 1e6
  const whole = Math.floor(us)
  const numerator = Math.min(999, Math.round((us - whole) * 1000))
  return { sourceInUs: whole, sourceRemainder: { numerator, denominator: 1000 } }
}

export interface MusicRemixApplyInput {
  sequence: VideoEditSequence
  /** 被替换的片段（首次重构为原片段；改参数重算为同一次重构的全部子片段）。第一个为模板。 */
  replaceClipIds: readonly string[]
  /** 结果起点（序列帧）。 */
  startFrame: number
  layout: MusicRemixLayout
  remix: Omit<VideoEditClipRemix, 'segment' | 'seamConfidence'>
  newId: () => string
}

/** 纯函数：用重构结果替换原片段，返回新序列与新子片段。同轨在结果范围内有其他片段时拒绝。 */
export function applyMusicRemixToSequence(input: MusicRemixApplyInput): { sequence: VideoEditSequence; clips: VideoEditClip[]; transitions: VideoEditTransition[] } {
  const { sequence, layout } = input
  const removed = new Set(input.replaceClipIds)
  const template = sequence.clips.find(clip => clip.id === input.replaceClipIds[0])
  if (!template) throw new Error('要重构的片段不在这个序列里。')
  const total = layout.pieces.reduce((sum, piece) => sum + piece.durationFrames, 0)
  const end = input.startFrame + total
  const blocking = sequence.clips.find(clip => !removed.has(clip.id) && clip.track === template.track && clip.start < end && clip.start + clip.duration > input.startFrame)
  if (blocking) throw new Error(`重构结果会盖住同一轨道第 ${blocking.start} 帧起的片段“${blocking.name}”，请先挪开它或换一条空轨道。`)
  const firstFadeIn = sequence.clips.filter(clip => removed.has(clip.id)).sort((a, b) => a.start - b.start)[0]?.fadeInFrames
  const { id: _id, remix: _remix, fadeInFrames: _in, fadeOutFrames: _out, takes: _takes, ...base } = template
  void _id; void _remix; void _in; void _out; void _takes
  const groupId = template.groupId ?? input.remix.id
  const clips: VideoEditClip[] = layout.pieces.map((piece, segment) => {
    const last = segment === layout.pieces.length - 1
    const fadeOut = last ? Math.max(layout.tailFadeFrames, template.fadeOutFrames ?? 0) : 0
    const fadeIn = segment === 0 ? firstFadeIn : undefined
    return {
      ...base, id: input.newId(), groupId, start: input.startFrame + piece.startFrame, duration: piece.durationFrames,
      ...videoEditSourceTimeFromSeconds(piece.sourceInSeconds),
      gainDb: videoEditGainDbSchema.parse((template.gainDb ?? 0) + piece.gainDb),
      ...(fadeIn ? { fadeInFrames: Math.min(fadeIn, piece.durationFrames) } : {}),
      ...(fadeOut ? { fadeOutFrames: Math.min(fadeOut, piece.durationFrames) } : {}),
      remix: { ...input.remix, segment, ...(piece.seamConfidence === undefined ? {} : { seamConfidence: piece.seamConfidence }) },
    }
  })
  const transitions: VideoEditTransition[] = clips.slice(1).map((clip, k) => ({ id: input.newId(), kind: 'constant_power', leftClipId: clips[k].id, rightClipId: clip.id, durationFrames: MUSIC_REMIX_TRANSITION_FRAMES, alignment: 'end' }))
  return {
    sequence: {
      ...sequence,
      clips: [...sequence.clips.filter(clip => !removed.has(clip.id)), ...clips],
      transitions: [...(sequence.transitions ?? []).filter(transition => !removed.has(transition.leftClipId ?? '') && !removed.has(transition.rightClipId ?? '')), ...transitions],
    },
    clips, transitions,
  }
}

export type { MusicRemixGranularity }
