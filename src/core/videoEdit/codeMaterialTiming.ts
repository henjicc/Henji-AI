import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS } from './time'
import { CodeMaterialError } from './codeMaterial/contract'
import type { CodeMaterialContext } from './codeMaterial/contract'
import type { CodeMaterialMetadata } from './codeMaterialDocument'
import { videoEditFps, videoEditSourceSeconds } from './time'
import type { VideoEditFrameOffset, VideoEditRatio, VideoEditSourceTime } from './time'
import { videoEditFrameFraction } from './time'
import { videoEditClipSourceTimeAt, videoEditClipMotionSourceTimeAt } from './clipSpeed'

/** 片段速度与倒放（4.13）按 clipSpeed.ts 换算源时间。 */
export type CodeMaterialTimedClip = VideoEditSourceTime & { start: number; duration: number; speed?: VideoEditRatio; reverse?: boolean }
type TimingProgram = Pick<CodeMaterialMetadata, 'mode' | 'width' | 'height' | 'durationSeconds'>
export interface CodeMaterialHostSize { width: number; height: number }
/** Placement hints are optional. The host supplies the actual canvas; source
 * declarations never acquire invented dimensions or a finite source duration. */
export function codeMaterialSize(program: Pick<TimingProgram, 'width' | 'height'>, host?: CodeMaterialHostSize): CodeMaterialHostSize {
  const width = program.width ?? host?.width, height = program.height ?? host?.height
  if (width === undefined || height === undefined) throw new CodeMaterialError('CONTEXT', '未声明画幅的代码效果需要宿主序列尺寸。')
  integer(width, '画面宽度', 1); integer(height, '画面高度', 1)
  return { width, height }
}

function integer(value: number, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new CodeMaterialError('CONTEXT', `${label}必须是范围内的整数。`)
}
/**
 * The clip is [start, start + duration); source time survives trims/splits and clip movement.
 * Dynamic duration admits only 4 * EPSILON * max(1, |time|, duration) seconds of floating
 * conversion error. This is not a frame or microsecond allowance, and time is never clamped.
 */
export function codeMaterialContextForFrame(clip: CodeMaterialTimedClip, timelineFrame: number, rate: VideoEditRatio, program: TimingProgram, host?: CodeMaterialHostSize): CodeMaterialContext {
  return contextForFrame(clip, timelineFrame, rate, program, false, host)
}
/** The domain validates both endpoints and real source handles before supplying this window. */
export function codeMaterialContextForTransitionFrame(clip: CodeMaterialTimedClip, timelineFrame: number, rate: VideoEditRatio, program: TimingProgram, window: { start: number; end: number }, host?: CodeMaterialHostSize): CodeMaterialContext {
  integer(window.start, '转场起点'); integer(window.end, '转场终点', window.start + 1)
  if (timelineFrame < window.start || timelineFrame >= window.end || window.end > Math.floor(videoEditFps(rate) * VIDEO_EDIT_MAX_SEQUENCE_SECONDS)) throw new CodeMaterialError('CONTEXT', '请求帧必须位于有效转场窗口内。')
  return contextForFrame(clip, timelineFrame, rate, program, true, host)
}
/** Pose-only subframe sampling, including fractional filter inputs; callers
 * explicitly provide transition handles rather than silently extending the clip. */
export function codeMaterialContextForSubframe(clip: CodeMaterialTimedClip, timelineFrame: number, offset: VideoEditFrameOffset, rate: VideoEditRatio, program: TimingProgram, window?: { start: number; end: number }, host?: CodeMaterialHostSize): { context: CodeMaterialContext; sourceTime: VideoEditSourceTime } {
  return contextForSubframe(clip, timelineFrame, offset, rate, program, window, false, host)!
}
function contextForSubframe(clip: CodeMaterialTimedClip, timelineFrame: number, offset: VideoEditFrameOffset, rate: VideoEditRatio, program: TimingProgram, window: { start: number; end: number } | undefined, transparent: boolean, host?: CodeMaterialHostSize): { context: CodeMaterialContext; sourceTime: VideoEditSourceTime } | null {
  const center = window ? codeMaterialContextForTransitionFrame(clip, timelineFrame, rate, program, window, host) : codeMaterialContextForFrame(clip, timelineFrame, rate, program, host)
  if (!Number.isSafeInteger(offset.numerator) || !Number.isSafeInteger(offset.denominator) || offset.denominator <= 0 || BigInt(Math.abs(offset.numerator)) > 2n * BigInt(offset.denominator)) throw new CodeMaterialError('CONTEXT', '快门子帧偏移须为两帧以内的有理数。')
  let divisor = BigInt(Math.abs(offset.numerator)), denominator = BigInt(offset.denominator)
  while (denominator) { const remainder = divisor % denominator; divisor = denominator; denominator = remainder }
  denominator = BigInt(offset.denominator) / divisor
  const centerFrame = videoEditFrameFraction(timelineFrame)
  const numerator = BigInt(offset.numerator) / divisor
  const frame = centerFrame.numerator * denominator + numerator * centerFrame.denominator
  denominator *= centerFrame.denominator
  const extent = window ?? { start: clip.start, end: clip.start + clip.duration }
  if (frame < BigInt(extent.start) * denominator || frame >= BigInt(extent.end) * denominator) throw new CodeMaterialError('CONTEXT', '快门子时刻超出可用片段或转场窗口。')
  const relative = frame - BigInt(clip.start) * denominator
  const sourceTime = videoEditClipMotionSourceTimeAt(clip, relative, denominator, rate, Boolean(window) && program.mode === 'static')
  if (!sourceTime) { if (transparent) return null; throw new CodeMaterialError('CONTEXT', '源入点不能早于素材开始。') }
  const time = videoEditSourceSeconds(sourceTime), tolerance = 4 * Number.EPSILON * Math.max(1, Math.abs(time), program.durationSeconds ?? 0)
  if (program.mode === 'dynamic' && program.durationSeconds !== undefined && time - program.durationSeconds > tolerance) { if (transparent) return null; throw new CodeMaterialError('CONTEXT', '快门源时刻超出动态代码素材声明时长。') }
  const delta = offset.numerator / offset.denominator
  return { sourceTime, context: { ...center, time, localTime: (timelineFrame - clip.start + delta) / center.fps, sequenceTime: (timelineFrame + delta) / center.fps, frame: timelineFrame + delta } }
}
function contextForFrame(clip: CodeMaterialTimedClip, timelineFrame: number, rate: VideoEditRatio, program: TimingProgram, transitionHandles = false, host?: CodeMaterialHostSize): CodeMaterialContext {
  integer(clip.start, '片段起点'); integer(clip.duration, '片段时长', 1)
  if (!Number.isFinite(timelineFrame) || timelineFrame < 0 || timelineFrame > Number.MAX_SAFE_INTEGER) throw new CodeMaterialError('CONTEXT', '序列请求帧必须是范围内的有限数值。')
  const end = clip.start + clip.duration; integer(end, '片段结束位置', 1)
  if (!transitionHandles && (timelineFrame < clip.start || timelineFrame >= end)) throw new CodeMaterialError('CONTEXT', '请求帧必须位于片段内部。')
  integer(rate.numerator, '帧率分子', 1, 1_000_000); integer(rate.denominator, '帧率分母', 1, 1_000_000)
  const fps = videoEditFps(rate)
  integer(clip.sourceInUs, '连续源入点')
  integer(clip.sourceRemainder.denominator, '源入点余数分母', 1, 1_000_000)
  integer(clip.sourceRemainder.numerator, '源入点余数分子', 0, clip.sourceRemainder.denominator - 1)
  const size = codeMaterialSize(program, host)
  if (program.durationSeconds !== undefined && (!Number.isFinite(program.durationSeconds) || program.durationSeconds <= 0) || (program.mode !== 'static' && program.mode !== 'dynamic')) throw new CodeMaterialError('CONTEXT', '代码素材模式或声明时长无效。')
  const relativeFrame = timelineFrame - clip.start
  const source = videoEditClipSourceTimeAt(clip, relativeFrame, rate, transitionHandles && program.mode === 'static')
  integer(source.sourceInUs, '求值连续源入点')
  const time = videoEditSourceSeconds(source)
  const tolerance = 4 * Number.EPSILON * Math.max(1, Math.abs(time), program.durationSeconds ?? 0)
  if (program.mode === 'dynamic' && program.durationSeconds !== undefined && time - program.durationSeconds > tolerance) throw new CodeMaterialError('CONTEXT', '请求源时间超出动态代码素材声明时长。')
  return { time, localTime: relativeFrame / fps, sequenceTime: timelineFrame / fps, frame: timelineFrame, fps, ...size }
}
