import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS } from './time'
import { CodeMaterialError } from './codeMaterial/contract'
import type { CodeMaterialContext, CodeMaterialProgram } from './codeMaterial/contract'
import { videoEditFps, videoEditSourceSeconds } from './time'
import type { VideoEditFrameOffset, VideoEditRatio, VideoEditSourceTime } from './time'
import { videoEditClipSourceTimeAt, videoEditClipMotionSourceTimeAt } from './clipSpeed'
import type { CodeMotionClock } from './codeMaterial/motionSampling'

/** 片段速度与倒放（4.13）按 clipSpeed.ts 换算源时间。 */
export type CodeMaterialTimedClip = VideoEditSourceTime & { start: number; duration: number; speed?: VideoEditRatio; reverse?: boolean }
type TimingProgram = Pick<CodeMaterialProgram, 'width' | 'height' | 'durationSeconds' | 'mode'>

function integer(value: number, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new CodeMaterialError('CONTEXT', `${label}必须是范围内的整数。`)
}
/**
 * The clip is [start, start + duration); source time survives trims/splits and clip movement.
 * Dynamic duration admits only 4 * EPSILON * max(1, |time|, duration) seconds of floating
 * conversion error. This is not a frame or microsecond allowance, and time is never clamped.
 */
export function codeMaterialContextForFrame(clip: CodeMaterialTimedClip, timelineFrame: number, rate: VideoEditRatio, program: TimingProgram): CodeMaterialContext {
  return contextForFrame(clip, timelineFrame, rate, program)
}
/** The domain validates both endpoints and real source handles before supplying this window. */
export function codeMaterialContextForTransitionFrame(clip: CodeMaterialTimedClip, timelineFrame: number, rate: VideoEditRatio, program: TimingProgram, window: { start: number; end: number }): CodeMaterialContext {
  integer(window.start, '转场起点'); integer(window.end, '转场终点', window.start + 1)
  if (timelineFrame < window.start || timelineFrame >= window.end || window.end > Math.floor(videoEditFps(rate) * VIDEO_EDIT_MAX_SEQUENCE_SECONDS)) throw new CodeMaterialError('CONTEXT', '请求帧必须位于有效转场窗口内。')
  return contextForFrame(clip, timelineFrame, rate, program, true)
}
/** Pose-only subframe sampling. The base picture remains an integer frame; callers
 * explicitly provide transition handles rather than silently extending the clip. */
export function codeMaterialContextForSubframe(clip: CodeMaterialTimedClip, timelineFrame: number, offset: VideoEditFrameOffset, rate: VideoEditRatio, program: TimingProgram, window?: { start: number; end: number }): { context: CodeMaterialContext; sourceTime: VideoEditSourceTime } {
  return contextForSubframe(clip, timelineFrame, offset, rate, program, window, false)!
}
function contextForSubframe(clip: CodeMaterialTimedClip, timelineFrame: number, offset: VideoEditFrameOffset, rate: VideoEditRatio, program: TimingProgram, window: { start: number; end: number } | undefined, transparent: boolean): { context: CodeMaterialContext; sourceTime: VideoEditSourceTime } | null {
  const center = window ? codeMaterialContextForTransitionFrame(clip, timelineFrame, rate, program, window) : codeMaterialContextForFrame(clip, timelineFrame, rate, program)
  if (!Number.isSafeInteger(offset.numerator) || !Number.isSafeInteger(offset.denominator) || offset.denominator <= 0 || BigInt(Math.abs(offset.numerator)) > 2n * BigInt(offset.denominator)) throw new CodeMaterialError('CONTEXT', '快门子帧偏移须为两帧以内的有理数。')
  let divisor = BigInt(Math.abs(offset.numerator)), denominator = BigInt(offset.denominator)
  while (denominator) { const remainder = divisor % denominator; divisor = denominator; denominator = remainder }
  denominator = BigInt(offset.denominator) / divisor
  const numerator = BigInt(offset.numerator) / divisor, frame = BigInt(timelineFrame) * denominator + numerator
  const extent = window ?? { start: clip.start, end: clip.start + clip.duration }
  if (frame < BigInt(extent.start) * denominator || frame >= BigInt(extent.end) * denominator) throw new CodeMaterialError('CONTEXT', '快门子时刻超出可用片段或转场窗口。')
  const relative = frame - BigInt(clip.start) * denominator
  const sourceTime = videoEditClipMotionSourceTimeAt(clip, relative, denominator, rate, Boolean(window) && program.mode === 'static')
  if (!sourceTime) { if (transparent) return null; throw new CodeMaterialError('CONTEXT', '源入点不能早于素材开始。') }
  const time = videoEditSourceSeconds(sourceTime), tolerance = 4 * Number.EPSILON * Math.max(1, Math.abs(time), program.durationSeconds)
  if (program.mode === 'dynamic' && time - program.durationSeconds > tolerance) { if (transparent) return null; throw new CodeMaterialError('CONTEXT', '快门源时刻超出动态代码素材声明时长。') }
  const delta = offset.numerator / offset.denominator
  return { sourceTime, context: { ...center, time, localTime: (timelineFrame - clip.start + delta) / center.fps, sequenceTime: (timelineFrame + delta) / center.fps, frame: timelineFrame + delta } }
}
/** Each frame owns this transient clock. Clip trims truncate and normalize the
 * shutter; missing source exposure stays transparent instead of inventing data.
 * Audio/media content remains prepared once; audioTime follows local playback. */
export function codeMaterialMotionClock(clip: CodeMaterialTimedClip, timelineFrame: number, rate: VideoEditRatio, program: TimingProgram, parametersAt: (time: VideoEditSourceTime) => Readonly<Record<string, unknown>>, center: CodeMaterialContext, window?: { start: number; end: number }): CodeMotionClock {
  const extent = window ?? { start: clip.start, end: clip.start + clip.duration }
  const cache = new Map<string, ReturnType<CodeMotionClock['at']>>()
  return { available: { start: { numerator: extent.start - timelineFrame, denominator: 1 }, end: { numerator: extent.end - timelineFrame, denominator: 1 } }, at(offset) {
    const key = `${offset.numerator}/${offset.denominator}`
    if (cache.has(key)) return cache.get(key)!
    const sampled = contextForSubframe(clip, timelineFrame, offset, rate, program, window, true)
    const result = sampled ? { sourceTime: sampled.sourceTime, context: { ...center, ...sampled.context, ...(center.audio ? { audioTime: (center.audioTime ?? center.localTime) + offset.numerator / offset.denominator / center.fps } : {}) }, parameters: parametersAt(sampled.sourceTime) } : null
    cache.set(key, result); return result
  } }
}
function contextForFrame(clip: CodeMaterialTimedClip, timelineFrame: number, rate: VideoEditRatio, program: TimingProgram, transitionHandles = false): CodeMaterialContext {
  integer(clip.start, '片段起点'); integer(clip.duration, '片段时长', 1); integer(timelineFrame, '序列请求帧')
  const end = clip.start + clip.duration; integer(end, '片段结束位置', 1)
  if (!transitionHandles && (timelineFrame < clip.start || timelineFrame >= end)) throw new CodeMaterialError('CONTEXT', '请求帧必须位于片段内部。')
  integer(rate.numerator, '帧率分子', 1, 1_000_000); integer(rate.denominator, '帧率分母', 1, 1_000_000)
  const fps = videoEditFps(rate)
  if (fps > 240) throw new CodeMaterialError('CONTEXT', '代码素材帧率不能超过 240。')
  integer(clip.sourceInUs, '连续源入点')
  integer(clip.sourceRemainder.denominator, '源入点余数分母', 1, 1_000_000)
  integer(clip.sourceRemainder.numerator, '源入点余数分子', 0, clip.sourceRemainder.denominator - 1)
  integer(program.width, '作者画面宽度', 1, 8192); integer(program.height, '作者画面高度', 1, 8192)
  if (!Number.isFinite(program.durationSeconds) || program.durationSeconds <= 0 || program.durationSeconds > VIDEO_EDIT_MAX_SEQUENCE_SECONDS || (program.mode !== 'static' && program.mode !== 'dynamic')) throw new CodeMaterialError('CONTEXT', '代码素材模式或声明时长无效。')
  const relativeFrame = timelineFrame - clip.start
  const source = videoEditClipSourceTimeAt(clip, relativeFrame, rate, transitionHandles && program.mode === 'static')
  integer(source.sourceInUs, '求值连续源入点')
  const time = videoEditSourceSeconds(source)
  const tolerance = 4 * Number.EPSILON * Math.max(1, Math.abs(time), program.durationSeconds)
  if (program.mode === 'dynamic' && time > program.durationSeconds && time - program.durationSeconds > tolerance) throw new CodeMaterialError('CONTEXT', '请求源时间超出动态代码素材声明时长。')
  return { time, localTime: relativeFrame / fps, sequenceTime: timelineFrame / fps, frame: timelineFrame, fps, width: program.width, height: program.height }
}
