import { z } from 'zod'
import { codeMaterialInstanceSchema } from './codeMaterialPersistence'
import type { VideoEditSequence, VideoEditClip } from './document'
import type { VideoEditTransitionWindow } from './transitions'

export const videoEditEffectSchema = z.object({
  id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200), enabled: z.boolean(), amount: z.number().finite().min(0).max(1), code: codeMaterialInstanceSchema,
}).strict()
export type VideoEditEffect = z.infer<typeof videoEditEffectSchema>
export function orderVideoEditEffects(effects: VideoEditEffect[], ids: string[]): VideoEditEffect[] {
  if (ids.length !== effects.length || new Set(ids).size !== effects.length || ids.some(id => !effects.some(effect => effect.id === id))) throw new Error('请使用完整、无重复的效果顺序。')
  return ids.map(id => effects.find(effect => effect.id === id)!)
}
/** Disabled effects remain editable/persisted, but consume no render resources. */
export function activeVideoEditEffects(clip: Pick<VideoEditClip, 'effects' | 'kind' | 'opacity'>): VideoEditEffect[] {
  if (clip.kind === 'adjustment' && clip.opacity <= 0) return []
  return (clip.effects ?? []).filter(effect => effect.enabled && effect.amount > 0)
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
