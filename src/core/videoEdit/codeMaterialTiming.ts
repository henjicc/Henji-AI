import { CodeMaterialError } from './codeMaterial/contract'
import type { CodeMaterialContext, CodeMaterialProgram } from './codeMaterial/contract'
import { offsetVideoEditSource, videoEditFps, videoEditSourceSeconds } from './time'
import type { VideoEditRatio, VideoEditSourceTime } from './time'

export type CodeMaterialTimedClip = VideoEditSourceTime & { start: number; duration: number }
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
  if (timelineFrame < window.start || timelineFrame >= window.end || window.end > Math.floor(videoEditFps(rate) * 1800)) throw new CodeMaterialError('CONTEXT', '请求帧必须位于有效转场窗口内。')
  return contextForFrame(clip, timelineFrame, rate, program, true)
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
  if (!Number.isFinite(program.durationSeconds) || program.durationSeconds <= 0 || program.durationSeconds > 1800 || (program.mode !== 'static' && program.mode !== 'dynamic')) throw new CodeMaterialError('CONTEXT', '代码素材模式或声明时长无效。')
  const relativeFrame = timelineFrame - clip.start
  const source = offsetVideoEditSource(clip, relativeFrame, rate, transitionHandles && program.mode === 'static')
  integer(source.sourceInUs, '求值连续源入点')
  const time = videoEditSourceSeconds(source)
  const tolerance = 4 * Number.EPSILON * Math.max(1, Math.abs(time), program.durationSeconds)
  if (program.mode === 'dynamic' && time > program.durationSeconds && time - program.durationSeconds > tolerance) throw new CodeMaterialError('CONTEXT', '请求源时间超出动态代码素材声明时长。')
  return { time, localTime: relativeFrame / fps, sequenceTime: timelineFrame / fps, frame: timelineFrame, fps, width: program.width, height: program.height }
}
