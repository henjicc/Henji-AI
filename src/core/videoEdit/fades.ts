import type { VideoEditClip, VideoEditSequence } from './document'
import { VIDEO_EDIT_DEFAULT_TRANSITIONS, videoEditTransitionAccepts, videoEditTransitionAmount, videoEditTransitionSide, videoEditTransitionWindow, type VideoEditTransition, type VideoEditTransitionMedium, type VideoEditTransitionSide, type VideoEditTransitionWindow } from './transitions'

/**
 * 淡入淡出就是挂在片段一端的单侧过渡（PR 淡化手柄）：画面片段默认交叉溶解，声音片段默认恒定功率。
 * 拖手柄、从效果面板拖过渡、助手写过渡都是同一个对象，只有一份实现。
 */
export const VIDEO_EDIT_FADE_MIN_FRAMES = 2

/** 片段能挂哪种淡化：声音片段挂音频过渡，画面片段挂画面过渡；调整图层与灯光没有画面，不能淡化。 */
export function videoEditFadeMedium(clip: Pick<VideoEditClip, 'kind'>): VideoEditTransitionMedium | undefined {
  return clip.kind === 'audio' ? 'audio' : videoEditTransitionAccepts('video', clip) ? 'video' : undefined
}

/** 片段这一端的单侧过渡（淡入在入点，淡出在出点）。 */
export function videoEditClipFade(sequence: Pick<VideoEditSequence, 'transitions'>, clipId: string, edge: VideoEditTransitionSide): VideoEditTransition | undefined {
  return sequence.transitions?.find(transition => videoEditTransitionSide(transition) === edge && (edge === 'in' ? transition.rightClipId : transition.leftClipId) === clipId)
}

/**
 * 这一端还能淡化多长：同轨其他过渡（另一端的淡化、相邻切点上的普通过渡）占着的部分让出来。
 * 这一端已经挂着普通过渡（两边都有片段）时没有淡化手柄，返回 0。
 */
export function videoEditClipFadeRoom(sequence: Pick<VideoEditSequence, 'clips' | 'transitions'>, clip: VideoEditClip, edge: VideoEditTransitionSide): number {
  const own = videoEditClipFade(sequence, clip.id, edge)
  const end = clip.start + clip.duration
  let room = clip.duration
  for (const transition of sequence.transitions ?? []) {
    if (transition === own) continue
    let window: VideoEditTransitionWindow
    try { window = videoEditTransitionWindow(sequence, transition) } catch { continue }
    if (window.left.track !== clip.track || window.end <= clip.start || window.start >= end) continue
    if (edge === 'in' ? window.start <= clip.start : window.end >= end) return 0
    room = Math.min(room, edge === 'in' ? window.start - clip.start : end - window.end)
  }
  return Math.max(0, room)
}

/**
 * 拖淡化手柄：`frames` 为淡化长度，不足 2 帧（过渡最短）时去掉这一端的淡化；已有的只改时长，保留过渡类型与参数。
 * 新建时按片段媒介取默认过渡（画面交叉溶解、声音恒定功率）。不越过同轨其他过渡。
 */
export function setVideoEditClipFade(sequence: VideoEditSequence, clipId: string, edge: VideoEditTransitionSide, frames: number, newId: () => string = () => crypto.randomUUID()): VideoEditSequence {
  const clip = sequence.clips.find(value => value.id === clipId)
  const medium = clip && videoEditFadeMedium(clip)
  if (!clip || !medium) throw new Error('这个片段不能淡化。')
  const own = videoEditClipFade(sequence, clipId, edge)
  const length = Math.min(videoEditClipFadeRoom(sequence, clip, edge), Math.round(frames))
  const others = (sequence.transitions ?? []).filter(transition => transition !== own)
  if (length < VIDEO_EDIT_FADE_MIN_FRAMES) return own ? { ...sequence, transitions: others } : sequence
  if (own?.durationFrames === length) return sequence
  const next: VideoEditTransition = own ? { ...own, durationFrames: length } : { id: newId(), kind: VIDEO_EDIT_DEFAULT_TRANSITIONS[medium], ...(edge === 'out' ? { leftClipId: clipId } : { rightClipId: clipId }), durationFrames: length }
  return { ...sequence, transitions: own ? (sequence.transitions ?? []).map(transition => transition === own ? next : transition) : [...others, next] }
}

/**
 * 片段在 `frame` 处被淡入淡出乘上的不透明度：只看两端的交叉溶解（从透明淡入、淡出到透明），黑场、擦除这类不是透明度变化。
 * 给不经过合成的地方用（画面上的元素选框、命中），以及三维组里没被整组合成的那些淡化；`skip` 跳过已经由过渡管线画的。
 */
export function videoEditClipFadeOpacity(sequence: Pick<VideoEditSequence, 'clips' | 'transitions'>, clip: VideoEditClip, frame: number, skip?: (transitionId: string) => boolean): number {
  let value = 1
  for (const edge of ['in', 'out'] as const) {
    const fade = videoEditClipFade(sequence, clip.id, edge)
    if (fade?.kind !== 'cross_dissolve' || skip?.(fade.id)) continue
    let window: VideoEditTransitionWindow
    try { window = videoEditTransitionWindow(sequence, fade) } catch { continue }
    if (frame < window.start || frame >= window.end) continue
    const progress = videoEditTransitionAmount(window, frame)
    value *= edge === 'in' ? progress : 1 - progress
  }
  return value
}
