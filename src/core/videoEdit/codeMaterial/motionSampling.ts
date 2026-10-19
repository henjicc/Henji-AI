import { CodeMaterialError } from './contract'
import type { CodeMatrix } from './contract'
import type { VideoEditFrameOffset } from '../time'

/** Transient renderer data, not an author-language or persistence format. */
export interface CodeMotionPose { matrix: CodeMatrix; opacity: number }
export interface CodeMotionSample { offset: VideoEditFrameOffset; pose: CodeMotionPose | null; weight: number }
export interface CodeMotionInterval { start: VideoEditFrameOffset; end: VideoEditFrameOffset }
type Fraction = { n: bigint; d: bigint }
const PROBES = 16
const MAX_SAMPLES = 64

/** One budget is shared by all layers in a frame, including probes and cache misses. */
export class CodeMotionSamplingBudget {
  private remaining: number
  constructor(limit = 4096) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 65536) throw new CodeMaterialError('BUDGET', '运动位姿采样预算须为 1–65536 的整数。')
    this.remaining = limit
  }
  charge(): void {
    if (this.remaining <= 0) throw new CodeMaterialError('BUDGET', '本帧运动位姿采样超出预算，请减少运动层或采样数。')
    this.remaining--
  }
}

function fraction(value: VideoEditFrameOffset, shutter = true): Fraction {
  if (!Number.isSafeInteger(value.numerator) || !Number.isSafeInteger(value.denominator) || value.denominator <= 0) throw new CodeMaterialError('CONTEXT', '快门时刻需要安全整数分子及正分母。')
  const n = BigInt(value.numerator), d = BigInt(value.denominator)
  if (shutter && (n < -2n * d || n > 2n * d)) throw new CodeMaterialError('CONTEXT', '快门时刻须在中心前后两帧以内。')
  return { n, d }
}
const compare = (a: Fraction, b: Fraction): bigint => a.n * b.d - b.n * a.d
function reduced(n: bigint, d: bigint): VideoEditFrameOffset {
  let a = n < 0n ? -n : n, b = d
  while (b) { const remainder = a % b; a = b; b = remainder }
  n /= a; d /= a
  if (n < BigInt(Number.MIN_SAFE_INTEGER) || n > BigInt(Number.MAX_SAFE_INTEGER) || d > BigInt(Number.MAX_SAFE_INTEGER)) throw new CodeMaterialError('CONTEXT', '快门时刻超出精确整数范围，请降低时间分母。')
  return { numerator: Number(n), denominator: Number(d) }
}
function midpoint(start: Fraction, end: Fraction, index: number, count: number): VideoEditFrameOffset {
  const slots = BigInt(count * 2), slot = BigInt(index * 2 + 1)
  return reduced(start.n * end.d * slots + (end.n * start.d - start.n * end.d) * slot, start.d * end.d * slots)
}
function checkedPose(value: CodeMotionPose | null): CodeMotionPose | null {
  if (value === null) return null
  if (!value || !Array.isArray(value.matrix) || value.matrix.length !== 6 || !value.matrix.every(Number.isFinite) || !Number.isFinite(value.opacity)) throw new CodeMaterialError('NON_FINITE', '运动位姿需要有限仿射矩阵和不透明度。')
  if (value.opacity < 0 || value.opacity > 1) throw new CodeMaterialError('TYPE', '运动位姿不透明度须在 0 到 1 之间。')
  // A singular layer contributes transparent exposure, never an invalid inverse.
  const determinant = value.matrix[0] * value.matrix[3] - value.matrix[1] * value.matrix[2]
  if (!Number.isFinite(determinant)) throw new CodeMaterialError('NON_FINITE', '运动位姿矩阵超出有限范围。')
  return determinant === 0 || value.opacity === 0 ? null : { matrix: [...value.matrix], opacity: value.opacity }
}

/**
 * Content is rasterized once by the caller; this evaluates only its placement.
 * Exposure is intersected with the caller's valid half-open clip/source window.
 * Midpoints never evaluate the excluded end. Retained exposure is normalized;
 * an empty intersection is transparent. Disabled blur samples the center only.
 */
export function sampleCodeMotion(options: {
  bounds: { x: number; y: number; width: number; height: number }
  shutter: CodeMotionInterval
  available: CodeMotionInterval
  maxSamples: number
  enabled?: boolean
  budget: CodeMotionSamplingBudget
  poseAt(offset: VideoEditFrameOffset): CodeMotionPose | null
}): CodeMotionSample[] {
  const { bounds, maxSamples } = options
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 1 || maxSamples > MAX_SAMPLES) throw new CodeMaterialError('BUDGET', '运动模糊采样数须为 1–64 的整数。')
  if (![bounds.x, bounds.y, bounds.width, bounds.height, bounds.x + bounds.width, bounds.y + bounds.height].every(Number.isFinite) || bounds.width < 0 || bounds.height < 0) throw new CodeMaterialError('CONTEXT', '运动层内容范围须为有限非负尺寸。')
  const shutterStart = fraction(options.shutter.start), shutterEnd = fraction(options.shutter.end)
  const availableStart = fraction(options.available.start, false), availableEnd = fraction(options.available.end, false)
  if (compare(shutterStart, shutterEnd) > 0n || compare(availableStart, availableEnd) >= 0n || availableStart.n > 0n || availableEnd.n <= 0n) throw new CodeMaterialError('CONTEXT', '运动采样窗口无效或未包含中心帧。')
  const cache = new Map<string, CodeMotionPose | null>()
  const at = (offset: VideoEditFrameOffset): CodeMotionPose | null => {
    const key = `${offset.numerator}/${offset.denominator}`
    if (cache.has(key)) return cache.get(key)!
    options.budget.charge()
    const pose = checkedPose(options.poseAt(offset)); cache.set(key, pose); return pose
  }
  if (options.enabled === false || compare(shutterStart, shutterEnd) === 0n) {
    const offset = { numerator: 0, denominator: 1 }
    return [{ offset, pose: at(offset), weight: 1 }]
  }
  const start = compare(shutterStart, availableStart) < 0n ? availableStart : shutterStart
  const end = compare(shutterEnd, availableEnd) > 0n ? availableEnd : shutterEnd
  if (compare(start, end) >= 0n) return []
  const probes = Array.from({ length: PROBES }, (_, index) => at(midpoint(start, end, index, PROBES)))
  const first = probes[0]
  const unchanged = probes.every(pose => pose === null ? first === null : first !== null && pose.opacity === first.opacity && pose.matrix.every((value, index) => value === first.matrix[index]))
  let count = 1
  if (!unchanged) {
    let longest = 0
    for (const [x, y] of [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]]) {
      let length = 0, previous: [number, number] | undefined
      for (const pose of probes) {
        if (!pose) { previous = undefined; continue }
        const m = pose.matrix
        const point: [number, number] = [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
        if (!point.every(Number.isFinite)) throw new CodeMaterialError('NON_FINITE', '运动层边界变换超出有限范围。')
        if (previous) length += Math.hypot(point[0] - previous[0], point[1] - previous[1])
        previous = point
      }
      // Probes are bin midpoints, so account for their missing edge half-bins.
      longest = Math.max(longest, length * PROBES / (PROBES - 1))
    }
    const fading = probes.some(pose => pose?.opacity !== first?.opacity)
    count = Math.min(maxSamples, Math.max(fading ? 4 : 2, Math.ceil(longest)))
  }
  return Array.from({ length: count }, (_, index) => {
    const offset = midpoint(start, end, index, count)
    return { offset, pose: at(offset), weight: 1 / count }
  })
}
