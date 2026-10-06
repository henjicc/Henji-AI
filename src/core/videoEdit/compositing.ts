import { z } from 'zod'
import { codeMaterialInstanceSchema } from './codeMaterialPersistence'
import type { VideoEditSequence, VideoEditClip } from './document'
import type { VideoEditTransitionWindow } from './transitions'
import { videoEditBuiltinEffectIssue, videoEditBuiltinEffectMedia, type VideoEditBuiltinMedia } from './builtinEffects'
import { videoEditEffectMaskSchema } from './effectMasks'
import { videoEditCurvesSchema, assertVideoEditBuiltinCurves } from './keyframes'

/** 内置效果实例（4.7a）：内置效果 ID 与参数（键与范围由 `builtinEffects.ts` 登记）。 */
export const videoEditBuiltinEffectInstanceSchema = z.object({
  id: z.string().min(1).max(64), params: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.union([z.number().finite(), z.boolean(), z.string().max(64)])),
  curves: videoEditCurvesSchema.optional(),
}).strict()
export type VideoEditBuiltinEffectInstance = z.infer<typeof videoEditBuiltinEffectInstanceSchema>
/**
 * 效果的作用区域（`mask`）：智能区域（4.7d，人脸、人物、背景、文字，本地模型分析一次并缓存）或手绘遮罩（4.10，矩形、椭圆、钢笔）。
 * 定义与几何在 `effectMasks.ts`；只对内置画面效果开放。
 */
export { videoEditEffectMaskSchema, type VideoEditEffectMask } from './effectMasks'
/** 效果链里的一项：代码滤镜（`code`）或内置效果（`builtin`）二选一。 */
export const videoEditEffectSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), enabled: z.boolean(), amount: z.number().finite().min(0).max(1),
  code: codeMaterialInstanceSchema.optional(), builtin: videoEditBuiltinEffectInstanceSchema.optional(), mask: videoEditEffectMaskSchema.optional(),
}).strict().superRefine((effect, ctx) => {
  if (Boolean(effect.code) === Boolean(effect.builtin)) ctx.addIssue({ code: 'custom', message: '效果必须是代码滤镜或内置效果其中之一。' })
  const issue = effect.builtin && videoEditBuiltinEffectIssue(effect.builtin)
  if (issue) ctx.addIssue({ code: 'custom', message: issue })
  if (effect.builtin) try { assertVideoEditBuiltinCurves(effect.builtin) } catch (error) { ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '效果关键帧无效。' }) }
  if (effect.mask && (!effect.builtin || videoEditBuiltinEffectMedia(effect.builtin.id) !== 'video')) ctx.addIssue({ code: 'custom', message: '作用区域只能用在内置画面效果上（代码滤镜、音频效果作用于整体）。' })
})
export type VideoEditEffect = z.infer<typeof videoEditEffectSchema>
export type VideoEditCodeEffect = VideoEditEffect & { code: NonNullable<VideoEditEffect['code']> }
export type VideoEditBuiltinEffect = VideoEditEffect & { builtin: VideoEditBuiltinEffectInstance }
export function isVideoEditCodeEffect(effect: VideoEditEffect): effect is VideoEditCodeEffect { return Boolean(effect.code) }
export function isVideoEditBuiltinEffect(effect: VideoEditEffect): effect is VideoEditBuiltinEffect { return Boolean(effect.builtin) }
/** 效果链里的代码滤镜源码实例（内置效果没有源码）。 */
export function videoEditEffectCodes(effects: readonly VideoEditEffect[] | undefined): Array<NonNullable<VideoEditEffect['code']>> { return (effects ?? []).flatMap(effect => effect.code ? [effect.code] : []) }
/** 一个片段最多挂的效果数。 */
export const VIDEO_EDIT_MAX_EFFECTS = 8
export function orderVideoEditEffects(effects: VideoEditEffect[], ids: string[]): VideoEditEffect[] {
  if (ids.length !== effects.length || new Set(ids).size !== effects.length || ids.some(id => !effects.some(effect => effect.id === id))) throw new Error('请使用完整、无重复的效果顺序。')
  return ids.map(id => effects.find(effect => effect.id === id)!)
}
/** 效果处理画面还是声音：代码滤镜与画面内置效果为 video，音频内置效果（4.7c）为 audio。 */
export function videoEditEffectMedia(effect: Pick<VideoEditEffect, 'builtin'>): VideoEditBuiltinMedia { return effect.builtin ? videoEditBuiltinEffectMedia(effect.builtin.id) : 'video' }
/** 片段能不能挂这种效果：音频效果只挂声音片段，画面效果只挂画面片段（与过渡的媒介规则一致）。 */
export function videoEditEffectAccepts(media: VideoEditBuiltinMedia, clip: Pick<VideoEditClip, 'kind'>): boolean { return media === 'audio' ? clip.kind === 'audio' : clip.kind !== 'audio' }
/** Disabled effects remain editable/persisted, but consume no render resources. 只返回画面效果（音频效果由混音处理）。 */
export function activeVideoEditEffects(clip: Pick<VideoEditClip, 'effects' | 'kind' | 'opacity'>): VideoEditEffect[] {
  if (clip.kind === 'adjustment' && clip.opacity <= 0) return []
  return (clip.effects ?? []).filter(effect => effect.enabled && effect.amount > 0 && videoEditEffectMedia(effect) === 'video')
}
/** 声音片段上生效的音频效果（按效果链顺序处理声音）。 */
export function activeVideoEditAudioEffects(clip: Pick<VideoEditClip, 'effects' | 'kind'>): VideoEditBuiltinEffect[] {
  if (clip.kind !== 'audio') return []
  return (clip.effects ?? []).filter((effect): effect is VideoEditBuiltinEffect => effect.enabled && effect.amount > 0 && isVideoEditBuiltinEffect(effect) && videoEditEffectMedia(effect) === 'audio')
}
export type VideoEditCompositeNode = { fromTrack: number; toTrack: number } & (
  | { kind: 'clip'; clip: VideoEditClip }
  | { kind: 'transition'; window: VideoEditTransitionWindow }
  | { kind: 'adjustment'; clip: VideoEditClip; children: VideoEditCompositeNode[] }
)
export const videoEditAdjustmentSchema = z.object({ fromTrack: z.number().int().min(0).max(30) }).strict()
/** Crossing intervals cannot split an already processed band; nested and disjoint bands are exact. */
export function validateVideoEditAdjustmentRanges(sequence: Pick<VideoEditSequence, 'clips'>): void {
  const adjustments = sequence.clips.filter(clip => clip.kind === 'adjustment')
  for (const [index, clip] of adjustments.entries()) {
    if (!clip.adjustment || clip.adjustment.fromTrack >= clip.track) throw new Error('调整图层的作用范围必须在自身轨道下方。')
    if (clip.x !== 0 || clip.y !== 0 || clip.scale !== 1 || clip.rotation !== 0 || clip.brightness !== 1 || clip.volume !== 0 || clip.text !== '') throw new Error('调整图层只处理下方画面，请通过作用范围、不透明度和效果设置调整。')
    for (const earlier of adjustments.slice(0, index)) {
      if (earlier.start >= clip.start + clip.duration || earlier.start + earlier.duration <= clip.start) continue
      const a = earlier.adjustment!.fromTrack; const b = earlier.track; const c = clip.adjustment.fromTrack; const d = clip.track
      if (a < c && c < b && b < d || c < a && a < d && d < b) throw new Error('同时生效的调整图层范围不能交叉，请使用独立或包含的范围。')
    }
  }
}

/** The renderer supplies visible clips/transition windows from its one track visibility rule. */
export function buildVideoEditCompositePlan(clips: readonly VideoEditClip[], transitions: readonly VideoEditTransitionWindow[] = []): VideoEditCompositeNode[] {
  const nodes: VideoEditCompositeNode[] = []
  const endpoints = new Set(transitions.flatMap(window => [window.left.id, window.right.id]))
  const tracks = [...new Set([...clips.filter(clip => clip.kind !== 'audio').map(clip => clip.track), ...transitions.map(window => window.left.track)])].sort((a, b) => a - b)
  for (const track of tracks) {
    // Same-track nested bands must process inner ranges before outer ranges.
    const adjustments = clips.filter(clip => clip.track === track && clip.kind === 'adjustment').sort((a, b) => b.adjustment!.fromTrack - a.adjustment!.fromTrack)
    for (const clip of adjustments) {
      const fromTrack = clip.adjustment!.fromTrack
      if (fromTrack >= track) throw new Error('调整图层的作用范围必须在自身轨道下方。')
      const children = nodes.filter(node => node.fromTrack >= fromTrack && node.toTrack <= track)
      if (nodes.some(node => node.fromTrack < track && node.toTrack > fromTrack && !children.includes(node))) throw new Error('调整图层不能拆分已处理的合成范围。')
      for (let index = nodes.length - 1; index >= 0; index--) if (children.includes(nodes[index])) nodes.splice(index, 1)
      nodes.push({ kind: 'adjustment', clip, fromTrack, toTrack: track, children })
    }
    nodes.push(...clips.filter(clip => clip.track === track && clip.kind !== 'audio' && clip.kind !== 'adjustment' && !endpoints.has(clip.id)).map(clip => ({ kind: 'clip' as const, clip, fromTrack: track, toTrack: track + 1 })))
    nodes.push(...transitions.filter(window => window.left.track === track).map(window => ({ kind: 'transition' as const, window, fromTrack: track, toTrack: track + 1 })))
  }
  return nodes
}
