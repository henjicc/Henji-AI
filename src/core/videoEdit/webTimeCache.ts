import { videoEditFrameFraction, type VideoEditRatio, type VideoEditSourceTime } from './time'

/** 页面时钟独立于剪辑时间线；相位保存为精确秒数，避免 NTSC 切点累积漂移。 */
export interface WebTimeGrid {
  rate: VideoEditRatio
  phase: { numerator: string; denominator: string }
}

function reduced(numerator: bigint, denominator: bigint): { numerator: bigint; denominator: bigint } {
  let a = numerator, b = denominator
  while (b) { const next = a % b; a = b; b = next }
  return { numerator: numerator / a, denominator: denominator / a }
}

export function webTimeGrid(rate: VideoEditRatio, origin: VideoEditSourceTime): WebTimeGrid {
  const { sourceInUs, sourceRemainder } = origin
  if (![rate.numerator, rate.denominator, sourceInUs, sourceRemainder.numerator, sourceRemainder.denominator].every(Number.isSafeInteger)
    || rate.numerator <= 0 || rate.denominator <= 0 || sourceInUs < 0 || sourceRemainder.numerator < 0
    || sourceRemainder.denominator <= 0 || sourceRemainder.numerator >= sourceRemainder.denominator) throw new Error('网页缓存需要有效的有理帧率与源时间')
  const timeN = BigInt(sourceInUs) * BigInt(sourceRemainder.denominator) + BigInt(sourceRemainder.numerator)
  const timeD = 1_000_000n * BigInt(sourceRemainder.denominator)
  return webTimeGridFromFraction(rate, { numerator: timeN, denominator: timeD })
}

/** 瞬时采样按有理数传播，时间表倍率及子帧不能先落成浮点秒再生成相位键。 */
export function webTimeGridFromFraction(rate: VideoEditRatio, time: { numerator: bigint; denominator: bigint }): WebTimeGrid {
  if (![rate.numerator, rate.denominator].every(value => Number.isSafeInteger(value) && value > 0) || time.denominator <= 0n) throw new Error('网页缓存采样网格无效')
  const normalized = reduced(BigInt(rate.numerator), BigInt(rate.denominator))
  const modulus = time.denominator * normalized.denominator
  const phaseN = ((time.numerator * normalized.numerator) % modulus + modulus) % modulus
  const phase = reduced(phaseN, time.denominator * normalized.numerator)
  return { rate: { numerator: Number(normalized.numerator), denominator: Number(normalized.denominator) },
    phase: { numerator: String(phase.numerator), denominator: String(phase.denominator) } }
}

export function webTimeAtFrame(grid: WebTimeGrid, frame: number): number {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new Error('网页缓存帧号需要非负安全整数')
  const n = BigInt(grid.phase.numerator) * BigInt(grid.rate.numerator) + BigInt(frame) * BigInt(grid.rate.denominator) * BigInt(grid.phase.denominator)
  const d = BigInt(grid.phase.denominator) * BigInt(grid.rate.numerator)
  return Number(n) / Number(d)
}

/** 精确消费只命中网格；预览可取不晚于请求的一帧，数值容差仅覆盖浮点运算误差。 */
export function webTimeFrameAt(grid: WebTimeGrid, seconds: number, mode: 'exact' | 'previous' = 'exact'): number | undefined {
  if (!Number.isFinite(seconds) || seconds < 0) return undefined
  const phase = Number(grid.phase.numerator) / Number(grid.phase.denominator)
  const position = (seconds - phase) * grid.rate.numerator / grid.rate.denominator
  const nearest = Math.round(position)
  const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(position), Math.abs(seconds * grid.rate.numerator / grid.rate.denominator))
  const onGrid = Math.abs(position - nearest) <= tolerance
  const frame = onGrid ? nearest : mode === 'previous' ? Math.floor(position) : undefined
  return frame !== undefined && frame >= 0 && Number.isSafeInteger(frame) ? frame : undefined
}

export interface WebTimeSegment {
  index: number
  firstFrame: number
  frameCount: number
}

/** 未知时长只生成被请求的段；已知时长的端点不编码，继续由实时网页解释。 */
export function webTimeSegment(grid: WebTimeGrid, index: number, duration: number | null): WebTimeSegment | undefined {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('网页缓存段号无效')
  const count = Math.max(1, Math.round(2 * grid.rate.numerator / grid.rate.denominator))
  const firstFrame = index * count
  if (!Number.isSafeInteger(firstFrame + count)) throw new Error('网页缓存段超出精确帧号范围')
  if (duration === null) return { index, firstFrame, frameCount: count }
  if (!Number.isFinite(duration) || duration < 0) throw new Error('网页时长无效')
  const time = videoEditFrameFraction(duration)
  const phaseN = BigInt(grid.phase.numerator), phaseD = BigInt(grid.phase.denominator)
  const n = (time.numerator * phaseD - phaseN * time.denominator) * BigInt(grid.rate.numerator)
  const d = time.denominator * phaseD * BigInt(grid.rate.denominator)
  const endpoint = webTimeFrameAt(grid, duration)
  const total = endpoint !== undefined ? BigInt(endpoint) : n <= 0n ? 0n : (n + d - 1n) / d
  const remaining = total - BigInt(firstFrame)
  if (remaining <= 0n) return undefined
  return { index, firstFrame, frameCount: Number(remaining < BigInt(count) ? remaining : BigInt(count)) }
}
