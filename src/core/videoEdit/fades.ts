import type { VideoEditClip } from './document'

/**
 * PR 淡化手柄（片段首尾的淡入淡出）：画面不透明度从 0 线性渐显、到结尾线性渐隐；
 * 声音按恒定功率（正弦）渐强渐弱。淡入淡出各自独立计算再相乘，片段被裁短时自然重叠，不需要额外校验。
 */
export function videoEditFadeOpacity(clip: Pick<VideoEditClip, 'start' | 'duration' | 'fadeInFrames' | 'fadeOutFrames'>, frame: number): number {
  let value = 1
  if (clip.fadeInFrames) value *= Math.max(0, Math.min(1, (frame - clip.start) / clip.fadeInFrames))
  if (clip.fadeOutFrames) value *= Math.max(0, Math.min(1, (clip.start + clip.duration - 1 - frame) / clip.fadeOutFrames))
  return value
}
/** 声音在序列时间 `seconds` 处的淡化增益（连续时间，按采样计算）。 */
export function videoEditFadeGain(clip: Pick<VideoEditClip, 'start' | 'duration' | 'fadeInFrames' | 'fadeOutFrames'>, seconds: number, fps: number): number {
  let value = 1
  const local = seconds - clip.start / fps
  if (clip.fadeInFrames) value *= Math.sin(Math.max(0, Math.min(1, local / (clip.fadeInFrames / fps))) * Math.PI / 2)
  if (clip.fadeOutFrames) value *= Math.sin(Math.max(0, Math.min(1, ((clip.start + clip.duration) / fps - seconds) / (clip.fadeOutFrames / fps))) * Math.PI / 2)
  return value
}
/** 片段是否带淡化（渲染时据此决定要不要按帧改不透明度）。 */
export function videoEditClipFades(clip: Pick<VideoEditClip, 'fadeInFrames' | 'fadeOutFrames'>): boolean { return Boolean(clip.fadeInFrames || clip.fadeOutFrames) }
/**
 * 拖淡化手柄：`edge` 为 in（左上角）或 out（右上角），`frames` 为拖到的淡化长度（整数帧，0 = 去掉）。
 * 淡入淡出合计不超过片段时长。
 */
export function setVideoEditClipFade(clip: VideoEditClip, edge: 'in' | 'out', frames: number): VideoEditClip {
  const other = edge === 'in' ? clip.fadeOutFrames ?? 0 : clip.fadeInFrames ?? 0
  const value = Math.max(0, Math.min(clip.duration - other, Math.round(frames)))
  const key = edge === 'in' ? 'fadeInFrames' : 'fadeOutFrames'
  const next = { ...clip }
  if (value > 0) next[key] = value; else delete next[key]
  return next
}
