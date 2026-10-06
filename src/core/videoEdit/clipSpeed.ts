import { offsetVideoEditSource, videoEditRatioSchema, videoEditSourceSeconds, type VideoEditRatio, type VideoEditSourceTime } from './time'

/**
 * 片段速度（4.13，PR 的“速度/持续时间”与比率拉伸工具 R）：源时间与时间线时长的换算全部在这里，时间线编辑、修剪、
 * 过渡余量、匹配帧、渲染取帧与混音都调这些函数，不在各处自己乘除速度。
 *
 * 约定：
 * - `speed` 是倍率（有理数，缺省 1），`reverse` 为倒放。时间线上一帧对应源素材 `speed / fps` 秒。
 * - `sourceIn` 永远是片段**开头**（时间线起点）那一刻的源时间。正放时内容随时间线向后推进，倒放时向前倒退，
 *   所以倒放片段用到的源范围是 `[sourceIn - 跨度, sourceIn]`。这样修剪出点从来不改源入点，修剪入点、拆分右段、
 *   外滑都是“沿播放方向前进若干帧”（`advanceVideoEditClipSource`），正放倒放同一套编辑代码。
 * - 画面按“帧采样”取（PR 默认）：时间线第 k 帧显示这一帧所覆盖源区间的起点处的画面——正放是
 *   `sourceIn + k·speed/fps`，倒放是 `sourceIn - (k+1)·speed/fps`（倒放一帧覆盖的区间的较早一端），
 *   高倍速时跳过中间的源画面，不做帧混合。
 * - 声音按连续时间换算（`videoEditClipSourceSecondsAtTime`），变速由混音按位置重采样。
 */
export const VIDEO_EDIT_SPEED_MIN = 0.01
export const VIDEO_EDIT_SPEED_MAX = 100
/** 速度精度：0.01%（PR 的速度框同样到小数点后两位）。 */
const SPEED_RESOLUTION = 10_000
/** 能改速度的片段：有连续源时间的音视频与代码素材（图片、文字、图形、调整图层没有可变速的源时间）。 */
export const VIDEO_EDIT_SPEED_KINDS = ['video', 'audio', 'code', 'sequence'] as const
export function videoEditClipSpeedSupported(kind: string): boolean { return (VIDEO_EDIT_SPEED_KINDS as readonly string[]).includes(kind) }
export const videoEditClipSpeedSchema = videoEditRatioSchema.refine(ratio => ratio.numerator / ratio.denominator >= VIDEO_EDIT_SPEED_MIN - 1e-12 && ratio.numerator / ratio.denominator <= VIDEO_EDIT_SPEED_MAX + 1e-12, '速度须在 1% 到 10000% 之间。')

export interface VideoEditClipTiming extends VideoEditSourceTime { start: number; duration: number; speed?: VideoEditRatio; reverse?: boolean }
const ONE: VideoEditRatio = { numerator: 1, denominator: 1 }
function gcd(left: number, right: number): number { while (right) [left, right] = [right, left % right]; return left }
function reduce(numerator: number, denominator: number): VideoEditRatio { const divisor = gcd(numerator, denominator); return { numerator: numerator / divisor, denominator: denominator / divisor } }

/** 速度倍率（如 2 表示 200%）转成存储用的有理数，精度 0.01%。 */
export function videoEditSpeedRatio(value: number): VideoEditRatio {
  if (!Number.isFinite(value) || value < VIDEO_EDIT_SPEED_MIN - 1e-9 || value > VIDEO_EDIT_SPEED_MAX + 1e-9) throw new Error('速度须在 1% 到 10000% 之间。')
  return reduce(Math.max(1, Math.round(value * SPEED_RESOLUTION)), SPEED_RESOLUTION)
}
export function videoEditClipSpeed(clip: Pick<VideoEditClipTiming, 'speed'>): VideoEditRatio { return clip.speed ?? ONE }
export function videoEditClipSpeedValue(clip: Pick<VideoEditClipTiming, 'speed'>): number { const speed = videoEditClipSpeed(clip); return speed.numerator / speed.denominator }
/** 速度百分比（显示用，保留两位小数）。 */
export function videoEditClipSpeedPercent(clip: Pick<VideoEditClipTiming, 'speed'>): number { return Math.round(videoEditClipSpeedValue(clip) * 10_000) / 100 }
/** 片段是否改过速度或倒放（时间线上的速度标记、渲染换算路径据此区分）。 */
export function videoEditClipRetimed(clip: Pick<VideoEditClipTiming, 'speed' | 'reverse'>): boolean {
  return Boolean(clip.reverse) || (clip.speed !== undefined && clip.speed.numerator !== clip.speed.denominator)
}
/** 速度为 1 时去掉字段（旧文件与未变速片段保持原样）。 */
function speedFields(speed: VideoEditRatio): { speed?: VideoEditRatio } { return speed.numerator === speed.denominator ? {} : { speed } }

/** 时间线一帧在源素材里走多远：等效“帧率” = 序列帧率 / 速度。 */
function sourceStep(rate: VideoEditRatio, speed: VideoEditRatio): VideoEditRatio {
  return { numerator: rate.numerator * speed.denominator, denominator: rate.denominator * speed.numerator }
}
/**
 * 沿播放方向前进 `frames` 个时间线帧后的源时间（负数后退）：正放向后、倒放向前。修剪入点、拆分出的右段、
 * 外滑、覆盖切出的后半段都用它。`holdBeforeZero` 同 `offsetVideoEditSource`（只给静态绘制的过渡余量用）。
 */
export function advanceVideoEditClipSource(clip: VideoEditClipTiming, frames: number, rate: VideoEditRatio, holdBeforeZero = false): VideoEditSourceTime {
  if (!frames) return { sourceInUs: clip.sourceInUs, sourceRemainder: clip.sourceRemainder }
  const source = { sourceInUs: clip.sourceInUs, sourceRemainder: clip.sourceRemainder }
  return offsetVideoEditSource(source, clip.reverse ? -frames : frames, sourceStep(rate, videoEditClipSpeed(clip)), holdBeforeZero)
}
/** 时间线上片段第 `offset` 帧（相对片段起点，可以在片段外：过渡余量）显示的源时间，精确有理数。 */
export function videoEditClipSourceTimeAt(clip: VideoEditClipTiming, offset: number, rate: VideoEditRatio, holdBeforeZero = false): VideoEditSourceTime {
  return advanceVideoEditClipSource(clip, clip.reverse ? offset + 1 : offset, rate, holdBeforeZero)
}
/** 同上，浮点秒；`frame` 是序列帧号。 */
export function videoEditClipSourceSecondsAt(clip: VideoEditClipTiming, frame: number, fps: number): number {
  const offset = frame - clip.start; const step = videoEditClipSpeedValue(clip) / fps
  return clip.reverse ? videoEditSourceSeconds(clip) - (offset + 1) * step : videoEditSourceSeconds(clip) + offset * step
}
/** 时间线一帧所覆盖源区间的中点（秒）：取参考画面时落在源帧中间，避免解码成前一帧。 */
export function videoEditClipSourceMidSecondsAt(clip: VideoEditClipTiming, frame: number, fps: number): number {
  return videoEditClipSourceSecondsAt(clip, frame, fps) + 0.5 * videoEditClipSpeedValue(clip) / fps
}
/** 连续时间（声音）：序列时间 `seconds` 对应的源时间；倒放时随序列时间减小。 */
export function videoEditClipSourceSecondsAtTime(clip: VideoEditClipTiming, seconds: number, fps: number): number {
  const elapsed = (seconds - clip.start / fps) * videoEditClipSpeedValue(clip)
  return clip.reverse ? videoEditSourceSeconds(clip) - elapsed : videoEditSourceSeconds(clip) + elapsed
}
/** 片段用掉的源时长（秒）。 */
export function videoEditClipSourceSpanSeconds(clip: Pick<VideoEditClipTiming, 'duration' | 'speed'>, fps: number): number { return clip.duration * videoEditClipSpeedValue(clip) / fps }
/** 片段用到的源范围 [较早, 较晚]（秒）。 */
export function videoEditClipSourceRange(clip: VideoEditClipTiming, fps: number): { from: number; to: number } {
  const head = videoEditSourceSeconds(clip); const span = videoEditClipSourceSpanSeconds(clip, fps)
  return clip.reverse ? { from: head - span, to: head } : { from: head, to: head + span }
}
/** 一段源时长（秒）在这个片段的速度下占多少个完整时间线帧。 */
function sourceToFrames(clip: Pick<VideoEditClipTiming, 'speed'>, seconds: number, fps: number): number {
  return Math.max(0, Math.floor(seconds * fps / videoEditClipSpeedValue(clip) + 1e-6))
}
/**
 * 片段开头之前还能露出多少帧源内容（向左延长入点、过渡余量）：正放是源入点之前的素材，倒放是源入点之后的素材。
 * `sourceDurationSeconds` 缺省（图片、静态代码等没有源时长）时倒放视为不受限。
 */
export function videoEditClipHeadRoom(clip: VideoEditClipTiming, fps: number, sourceDurationSeconds?: number): number {
  if (!clip.reverse) return sourceToFrames(clip, videoEditSourceSeconds(clip), fps)
  return sourceDurationSeconds === undefined ? Infinity : sourceToFrames(clip, sourceDurationSeconds - videoEditSourceSeconds(clip), fps)
}
/** 片段结尾之后还能露出多少帧（向右延长出点、过渡余量）；没有源时长时正放不受限。 */
export function videoEditClipTailRoom(clip: VideoEditClipTiming, fps: number, sourceDurationSeconds?: number): number {
  const range = videoEditClipSourceRange(clip, fps)
  if (clip.reverse) return sourceToFrames(clip, range.from, fps)
  return sourceDurationSeconds === undefined ? Infinity : sourceToFrames(clip, sourceDurationSeconds - range.to, fps)
}
/** 片段开头之前能露出的源内容按秒计（声音在入点前余量不足的部分静音）。 */
export function videoEditClipHeadRoomSeconds(clip: VideoEditClipTiming, sourceDurationSeconds?: number): number {
  const head = videoEditSourceSeconds(clip)
  if (!clip.reverse) return head / videoEditClipSpeedValue(clip)
  return sourceDurationSeconds === undefined ? Infinity : Math.max(0, sourceDurationSeconds - head) / videoEditClipSpeedValue(clip)
}
/** 源范围是否落在素材内（`tolerance` 为允许超出的秒数）。 */
export function videoEditClipWithinSource(clip: VideoEditClipTiming, fps: number, sourceDurationSeconds: number, tolerance: number): boolean {
  const range = videoEditClipSourceRange(clip, fps)
  return range.from >= -tolerance && range.to <= sourceDurationSeconds + tolerance
}
/**
 * 同步锚点：源时间 0 落在时间线哪一帧（链接音画失步判断、标注随内容移动）。正放 `start - 源入点·fps/速度`，
 * 倒放 `start + 源入点·fps/速度`；两个状态锚点之差就是内容在时间线上的位移。
 */
export function videoEditClipSourceAnchor(clip: VideoEditClipTiming, fps: number): number {
  const frames = videoEditSourceSeconds(clip) * fps / videoEditClipSpeedValue(clip)
  return clip.reverse ? clip.start + frames : clip.start - frames
}
/** 编辑前后片段内容在时间线上的位移（帧）：标注、标记、字幕跟着内容走。 */
export function videoEditClipContentShift(previous: VideoEditClipTiming, current: VideoEditClipTiming, fps: number): number {
  return Math.round(videoEditClipSourceAnchor(current, fps) - videoEditClipSourceAnchor(previous, fps))
}
/** 源时间 `seconds` 在片段里显示于哪一帧（序列帧号）；片段没用到这一刻时为 undefined（反向匹配帧）。 */
export function videoEditClipFrameAtSource(clip: VideoEditClipTiming, seconds: number, fps: number): number | undefined {
  const step = videoEditClipSpeedValue(clip) / fps
  const offset = clip.reverse ? Math.ceil((videoEditSourceSeconds(clip) - seconds) / step - 1e-6) - 1 : Math.floor((seconds - videoEditSourceSeconds(clip)) / step + 1e-6)
  const range = videoEditClipSourceRange(clip, fps)
  // 半开区间：用到的范围末端那一刻不属于片段。
  if (seconds < range.from - 1e-6 || seconds >= range.to - 1e-9) return undefined
  return clip.start + Math.max(0, Math.min(clip.duration - 1, offset))
}
/** Continuous boundary mapping for source intervals (text editing); unlike frame sampling this has no reverse-frame offset. */
export function videoEditClipFrameBoundaryAtSource(clip: VideoEditClipTiming, seconds: number, fps: number): number {
  const elapsed = (seconds - videoEditSourceSeconds(clip)) * fps / videoEditClipSpeedValue(clip)
  return clip.start + (clip.reverse ? -elapsed : elapsed)
}
/** 拆分：左段保持源入点，右段从拆分处沿播放方向前进 `left` 帧。 */
export function splitVideoEditClipSource(clip: VideoEditClipTiming, left: number, rate: VideoEditRatio): VideoEditSourceTime { return advanceVideoEditClipSource(clip, left, rate) }

/** 比率拉伸（R）的时长范围：拉伸后速度须在 1%–10000% 之间。 */
export function videoEditStretchDurationLimits(clip: Pick<VideoEditClipTiming, 'duration' | 'speed'>): { min: number; max: number } {
  const work = clip.duration * videoEditClipSpeedValue(clip)
  return { min: Math.max(1, Math.ceil(work / VIDEO_EDIT_SPEED_MAX - 1e-9)), max: Math.max(1, Math.floor(work / VIDEO_EDIT_SPEED_MIN + 1e-9)) }
}
/**
 * 比率拉伸：用到的源内容不变，时长改成 `duration`，速度随之变化（PR 比率拉伸工具）。能精确表示时用精确比值，
 * 否则向下取到 0.01%（源跨度只会略短，不会越过素材）。时长超出范围时收紧。
 */
export function stretchVideoEditClip<T extends VideoEditClipTiming>(clip: T, duration: number): T {
  const limits = videoEditStretchDurationLimits(clip)
  const target = Math.max(limits.min, Math.min(limits.max, Math.round(duration)))
  const speed = videoEditClipSpeed(clip)
  let next = reduce(speed.numerator * clip.duration, speed.denominator * target)
  if (next.numerator > 1_000_000 || next.denominator > 1_000_000) next = reduce(Math.max(1, Math.floor(next.numerator / next.denominator * SPEED_RESOLUTION + 1e-9)), SPEED_RESOLUTION)
  const value = next.numerator / next.denominator
  if (value < VIDEO_EDIT_SPEED_MIN) next = videoEditSpeedRatio(VIDEO_EDIT_SPEED_MIN)
  else if (value > VIDEO_EDIT_SPEED_MAX) next = videoEditSpeedRatio(VIDEO_EDIT_SPEED_MAX)
  const result = { ...clip, duration: target, ...speedFields(next) }
  if (!speedFields(next).speed) delete result.speed
  return result
}
/**
 * 改速度（“速度/持续时间”对话框）：开头的源内容不动，时长按新速度换算（时长 × 旧速度 / 新速度），
 * 不超过素材在播放方向上剩下的内容（`sourceDurationSeconds`）与 `maxDuration`（后面片段让出的空间）。
 */
export function changeVideoEditClipSpeed<T extends VideoEditClipTiming>(clip: T, speed: VideoEditRatio, fps: number, options: { sourceDurationSeconds?: number; maxDuration?: number } = {}): T {
  const value = speed.numerator / speed.denominator
  if (!(value >= VIDEO_EDIT_SPEED_MIN - 1e-12 && value <= VIDEO_EDIT_SPEED_MAX + 1e-12)) throw new Error('速度须在 1% 到 10000% 之间。')
  const retimed = { ...clip, ...speedFields(speed) }
  if (!speedFields(speed).speed) delete retimed.speed
  const ideal = Math.max(1, Math.round(clip.duration * videoEditClipSpeedValue(clip) / value))
  const head = videoEditSourceSeconds(clip)
  const available = clip.reverse ? head : options.sourceDurationSeconds === undefined ? Infinity : options.sourceDurationSeconds - head
  const fit = Number.isFinite(available) ? Math.floor(available * fps / value + 1e-6) : Infinity
  return { ...retimed, duration: Math.max(1, Math.min(ideal, fit, options.maxDuration ?? Infinity)) }
}
/** 切换倒放：用到的源范围不变，只换播放方向（源入点移到范围的另一端）。 */
export function setVideoEditClipReverse<T extends VideoEditClipTiming>(clip: T, reverse: boolean, rate: VideoEditRatio): T {
  if (Boolean(clip.reverse) === reverse) return clip
  const head = advanceVideoEditClipSource(clip, clip.duration, rate)
  const next = { ...clip, ...head, ...(reverse ? { reverse: true } : {}) }
  if (!reverse) delete next.reverse
  return next
}
