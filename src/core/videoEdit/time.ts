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
  return Number((numerator * 2n + denominator) / (denominator * 2n))
}
export interface VideoEditSourceTime { sourceInUs: number; sourceRemainder: VideoEditRatio }
function gcd(left: bigint, right: bigint): bigint { while (right) { const remainder = left % right; left = right; right = remainder } return left }
/** Fractional microseconds survive trims/splits, including repeated NTSC boundaries. */
export function offsetVideoEditSource(time: VideoEditSourceTime, frames: number, rate: VideoEditRatio, holdBeforeZero = false): VideoEditSourceTime {
  const denominator = BigInt(time.sourceRemainder.denominator) * BigInt(rate.numerator)
  const numerator = (BigInt(time.sourceInUs) * BigInt(time.sourceRemainder.denominator) + BigInt(time.sourceRemainder.numerator)) * BigInt(rate.numerator) + BigInt(frames) * 1_000_000n * BigInt(rate.denominator) * BigInt(time.sourceRemainder.denominator)
  if (numerator < 0n) {
    // Only timeless drawings use first-point hold in a validated transition handle.
    if (holdBeforeZero) return { sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
    throw new Error('源入点不能早于素材开始。')
  }
  const whole = numerator / denominator
  const remainder = numerator % denominator
  const divisor = gcd(remainder, denominator)
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
