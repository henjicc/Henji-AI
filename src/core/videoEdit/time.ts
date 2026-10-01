import { z } from 'zod'

export const videoEditRatioSchema = z.object({ numerator: z.number().int().positive().max(1_000_000), denominator: z.number().int().positive().max(1_000_000) }).strict()
export type VideoEditRatio = z.infer<typeof videoEditRatioSchema>
export const VIDEO_EDIT_FRAME_RATES: VideoEditRatio[] = [
  { numerator: 24, denominator: 1 }, { numerator: 24000, denominator: 1001 },
  { numerator: 25, denominator: 1 }, { numerator: 30, denominator: 1 },
  { numerator: 30000, denominator: 1001 }, { numerator: 50, denominator: 1 },
  { numerator: 60, denominator: 1 }, { numerator: 60000, denominator: 1001 },
]
export function videoEditFps(rate: VideoEditRatio): number { return rate.numerator / rate.denominator }
/** Round once from an absolute boundary; never accumulate rounded frame durations. */
export function rescaleVideoEditFrame(frame: number, from: VideoEditRatio, to: VideoEditRatio): number {
  const numerator = BigInt(frame) * BigInt(from.denominator) * BigInt(to.numerator)
  const denominator = BigInt(from.numerator) * BigInt(to.denominator)
  return Number((numerator * 2n + denominator) / (denominator * 2n))
}
export function videoEditFrameSample(frame: number, rate: VideoEditRatio, sampleRate: number): number {
  return Number(BigInt(frame) * BigInt(rate.denominator) * BigInt(sampleRate) / BigInt(rate.numerator))
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
