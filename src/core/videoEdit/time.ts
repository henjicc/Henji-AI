import { z } from 'zod'

/** Shared numeric timeline domain: 24 hours at every supported frame rate, with integer microseconds well below MAX_SAFE_INTEGER. No whole-timeline allocation may depend on this value. */
export const VIDEO_EDIT_MAX_SEQUENCE_SECONDS = 24 * 60 * 60
export const VIDEO_EDIT_MAX_SEQUENCE_FRAMES = VIDEO_EDIT_MAX_SEQUENCE_SECONDS * 120

export const videoEditRatioSchema = z.object({ numerator: z.number().int().positive().max(1_000_000), denominator: z.number().int().positive().max(1_000_000) }).strict()
export type VideoEditRatio = z.infer<typeof videoEditRatioSchema>
export const VIDEO_EDIT_FRAME_RATES: VideoEditRatio[] = [
  { numerator: 24000, denominator: 1001 }, { numerator: 24, denominator: 1 },
  { numerator: 25, denominator: 1 }, { numerator: 30000, denominator: 1001 },
  { numerator: 30, denominator: 1 }, { numerator: 48, denominator: 1 },
  { numerator: 50, denominator: 1 }, { numerator: 60000, denominator: 1001 },
  { numerator: 60, denominator: 1 }, { numerator: 100, denominator: 1 },
  { numerator: 120000, denominator: 1001 }, { numerator: 120, denominator: 1 },
]
export function videoEditFps(rate: VideoEditRatio): number { return rate.numerator / rate.denominator }
/** Round once from an absolute boundary; never accumulate rounded frame durations. */
export function rescaleVideoEditFrame(frame: number, from: VideoEditRatio, to: VideoEditRatio): number {
  const numerator = BigInt(frame) * BigInt(from.denominator) * BigInt(to.numerator)
  const denominator = BigInt(from.numerator) * BigInt(to.denominator)
  const rounded = numerator * 2n + denominator; const divisor = denominator * 2n
  return Number(rounded / divisor - (rounded % divisor < 0n ? 1n : 0n))
}
export interface VideoEditSourceTime { sourceInUs: number; sourceRemainder: VideoEditRatio }
/** A transient signed frame displacement; unlike a stored rate, zero and negative numerators are valid. */
export interface VideoEditFrameOffset { numerator: number; denominator: number }
function gcd(left: bigint, right: bigint): bigint { while (right) { const remainder = left % right; left = right; right = remainder } return left }
/** Fractional microseconds survive trims/splits, including repeated NTSC boundaries. */
export function offsetVideoEditSource(time: VideoEditSourceTime, frames: number, rate: VideoEditRatio, holdBeforeZero = false): VideoEditSourceTime {
  return offsetSourceFraction(time, BigInt(frames), 1n, rate, holdBeforeZero)!
}
/** Transient subframe clocks, never rounded to a source microsecond or saved as clip timing. */
export function offsetVideoEditSourceFraction(time: VideoEditSourceTime, frames: VideoEditFrameOffset, rate: VideoEditRatio, holdBeforeZero = false): VideoEditSourceTime {
  if (!Number.isSafeInteger(frames.numerator) || !Number.isSafeInteger(frames.denominator) || frames.denominator <= 0) throw new Error('子帧偏移需要安全整数分子及正分母。')
  validateExactSource(time, rate)
  return offsetSourceFraction(time, BigInt(frames.numerator), BigInt(frames.denominator), rate, holdBeforeZero, true)!
}
function validateExactSource(time: VideoEditSourceTime, rate: VideoEditRatio): void {
  if (![time.sourceInUs, time.sourceRemainder.numerator, time.sourceRemainder.denominator, rate.numerator, rate.denominator].every(Number.isSafeInteger)
    || time.sourceInUs < 0 || time.sourceRemainder.denominator <= 0 || time.sourceRemainder.numerator < 0 || time.sourceRemainder.numerator >= time.sourceRemainder.denominator || rate.numerator <= 0 || rate.denominator <= 0) throw new Error('子帧源时间和帧率必须是有效的精确有理数。')
}
/** Internal motion clocks keep a large frame numerator in BigInt until source
 * reduction. Absence means the requested exposure predates the actual source. */
export function sampleVideoEditSourceFraction(time: VideoEditSourceTime, frames: bigint, frameDenominator: bigint, rate: VideoEditRatio, holdBeforeZero = false): VideoEditSourceTime | undefined {
  validateExactSource(time, rate)
  if (frameDenominator <= 0n || frameDenominator > BigInt(Number.MAX_SAFE_INTEGER) || frames < BigInt(Number.MIN_SAFE_INTEGER) * frameDenominator || frames > BigInt(Number.MAX_SAFE_INTEGER) * frameDenominator) throw new Error('子帧偏移超出精确整数范围。')
  return offsetSourceFraction(time, frames, frameDenominator, rate, holdBeforeZero, true, true)
}
function offsetSourceFraction(time: VideoEditSourceTime, frames: bigint, frameDenominator: bigint, rate: VideoEditRatio, holdBeforeZero: boolean, exact = false, transparent = false): VideoEditSourceTime | undefined {
  const rateNumerator = frameDenominator === 1n ? BigInt(rate.numerator) : BigInt(rate.numerator) * frameDenominator
  const denominator = BigInt(time.sourceRemainder.denominator) * rateNumerator
  const numerator = (BigInt(time.sourceInUs) * BigInt(time.sourceRemainder.denominator) + BigInt(time.sourceRemainder.numerator)) * rateNumerator + frames * 1_000_000n * BigInt(rate.denominator) * BigInt(time.sourceRemainder.denominator)
  if (numerator < 0n) {
    // Only timeless drawings use first-point hold in a validated transition handle.
    if (holdBeforeZero) return { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
    if (transparent) return undefined
    throw new Error('源入点不能早于素材开始。')
  }
  const whole = numerator / denominator
  const remainder = numerator % denominator
  const divisor = gcd(remainder, denominator)
  if (exact && [whole, remainder / divisor, denominator / divisor].some(value => value > BigInt(Number.MAX_SAFE_INTEGER))) throw new Error('子帧源时间超过精确整数范围，请降低采样分母。')
  return { sourceInUs: Number(whole), sourceRemainder: { numerator: Number(remainder / divisor), denominator: Number(denominator / divisor) } }
}
export function videoEditSourceSeconds(time: VideoEditSourceTime): number { return (time.sourceInUs + time.sourceRemainder.numerator / time.sourceRemainder.denominator) / 1e6 }
/**
 * Container timestamp rounding tolerance (task 3.2, defect D3). Matroska and WebM store picture times in whole
 * milliseconds rounded to nearest, so at 60, 59.94 or 29.97fps a picture can start up to 0.5ms after its true time
 * (60fps frame 91: 1.516667s stored as 1.517s); "the last picture starting at or before the time" then shows the
 * previous picture for a third of the frames. Every picture lookup (preview, source monitor, reverse steps, export's
 * exact-picture reads) asks for the picture at `videoEditPictureSeconds(time)`, the time plus this tolerance, so a
 * picture rounded up by the container is still the one shown at its frame. 0.6ms covers the 0.5ms maximum with margin
 * and stays far below any frame interval (240fps is 4.2ms); a variable-frame-rate picture starting less than 0.6ms
 * after the time shows that much early. Containers with time bases coarser than 1ms are not covered.
 */
export const VIDEO_EDIT_CONTAINER_TIMESTAMP_TOLERANCE_SECONDS = 0.0006
/** The time at which to look up the picture shown at source time `seconds` (see the tolerance above). */
export function videoEditPictureSeconds(seconds: number): number { return seconds + VIDEO_EDIT_CONTAINER_TIMESTAMP_TOLERANCE_SECONDS }
