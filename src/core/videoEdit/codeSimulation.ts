import { sampleVideoEditSourceFraction, type VideoEditSourceTime } from './time'
import { renderFingerprintHash } from './renderFingerprint'

import { CODE_AUTHOR_SIMULATION_MIN_API_VERSION } from './codeAuthorVersions'
export { CODE_AUTHOR_SIMULATION_MIN_API_VERSION }
export const CODE_SIMULATION_RATE = 120
export const CODE_SIMULATION_SNAPSHOT_EVERY = 120
export const CODE_SIMULATION_CACHE_BYTES = 64 * 1024 ** 2

export type SimulationData = null | boolean | number | string | SimulationData[] | { [key: string]: SimulationData } | ArrayBuffer | ArrayBufferView
export interface AuthorSimulationInfo { readonly step: number; readonly time: number; readonly dt: number; readonly random: () => number }
export interface AuthorSimulation<S extends SimulationData = SimulationData, V extends SimulationData = SimulationData> {
  step(params: Readonly<Record<string, unknown>>, info: AuthorSimulationInfo): void
  snapshot(): S
  restore(snapshot: S): void
  read(): V
  interpolate?(left: Readonly<V>, right: Readonly<V>, alpha: number): V
  dispose(): void
}
export interface AuthorSimulationDeclaration { rate?: number; snapshotEvery?: number; seed?: number }
export interface AuthorSimulationSampler { at(sourceSeconds: number): Readonly<SimulationData> }
export interface CodeSimulationInput {
  /** 包含全部参数曲线和结构化数据；只在内存中传递，不进入作者 info。 */
  identity: string
  owner?: { sequenceId: string; clipId: string; effectId?: string }
  parametersAt(step: number, rate: number): Readonly<Record<string, unknown>>
  sourceTime?: VideoEditSourceTime
  sourceOrigin?: VideoEditSourceTime
  sourceDirection?: 1 | -1
  signal?: AbortSignal
  assertCurrent?(): void
}

export function codeSimulationDeclaration(value: AuthorSimulationDeclaration = {}): Required<AuthorSimulationDeclaration> {
  const result = { rate: value.rate ?? CODE_SIMULATION_RATE, snapshotEvery: value.snapshotEvery ?? CODE_SIMULATION_SNAPSHOT_EVERY, seed: value.seed ?? 0 }
  for (const key of ['rate', 'snapshotEvery'] as const) if (!Number.isSafeInteger(result[key]) || result[key] <= 0) throw new Error(`simulation.${key} 必须为正安全整数。`)
  if (!Number.isInteger(result.seed) || result.seed < 0 || result.seed > 0xffffffff) throw new Error('simulation.seed 必须为 uint32。')
  return result
}

/** 与代码参数曲线使用同一微秒有理数，不通过累加 dt 建立时间。 */
export function codeSimulationSourceTime(step: number, rate: number): VideoEditSourceTime {
  const numerator = BigInt(step) * 1_000_000n, denominator = BigInt(rate)
  const whole = numerator / denominator
  if (whole > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('模拟时刻超出精确整数范围。')
  return { sourceInUs: Number(whole), sourceRemainder: { numerator: Number(numerator % denominator), denominator: rate } }
}

/** 滤镜从片段首帧源入点起算；保持有理数精度，曝光越过起点时保持初始状态。 */
export function codeSimulationRelativeTime(time: VideoEditSourceTime, origin: VideoEditSourceTime, direction = 1): VideoEditSourceTime {
  const [left, right] = direction === 1 ? [time, origin] : [origin, time]
  return sampleVideoEditSourceFraction(left, -(BigInt(right.sourceInUs) * BigInt(right.sourceRemainder.denominator) + BigInt(right.sourceRemainder.numerator)), BigInt(right.sourceRemainder.denominator), { numerator: 1_000_000, denominator: 1 }, true)!
}

export function codeSimulationPosition(time: number | VideoEditSourceTime, rate: number): { step: number; alpha: number } {
  let step: number, alpha: number
  if (typeof time !== 'number') {
    const denominator = BigInt(time.sourceRemainder.denominator) * 1_000_000n
    const numerator = (BigInt(time.sourceInUs) * BigInt(time.sourceRemainder.denominator) + BigInt(time.sourceRemainder.numerator)) * BigInt(rate)
    step = Number(numerator / denominator); alpha = Number(numerator % denominator) / Number(denominator)
  } else {
    if (!Number.isFinite(time)) throw new Error('模拟取样时刻必须是有限数。')
    const scaled = Math.max(0, time) * rate, nearest = Math.round(scaled)
    const normalized = Math.abs(scaled - nearest) <= Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8 ? nearest : scaled
    step = Math.floor(normalized); alpha = normalized - step
  }
  if (!Number.isSafeInteger(step) || step < 0 || !Number.isSafeInteger(step + 1)) throw new Error('模拟步号超出精确整数范围。')
  return { step, alpha }
}

/** 输入已经由正式参数求值层规范化；完整源码及库 pin 不能按 frameKey 的 dataFiles 裁剪。 */
export function codeSimulationIdentity(source: unknown, input: unknown, size: { width: number; height: number }, declaration?: AuthorSimulationDeclaration): string {
  return renderFingerprintHash(JSON.stringify(['simulation:1', CODE_AUTHOR_SIMULATION_MIN_API_VERSION, source, input, size.width, size.height, codeSimulationDeclaration(declaration)]))
}

/** 估算值只用于检查点软预算，二进制按实际字节数计算。 */
export function simulationDataBytes(value: SimulationData): number {
  let bytes = 0
  const seen = new Set<object>(), pending: unknown[] = [value]
  while (pending.length) {
    const item = pending.pop()
    if (item === null || typeof item === 'boolean') { bytes += 4; continue }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('模拟状态不能包含 NaN 或 Infinity。')
      bytes += 8; continue
    }
    if (item === undefined) throw new Error('模拟状态不能包含 undefined。')
    if (typeof item === 'string') { bytes += 16 + item.length * 2; continue }
    if (!item || typeof item !== 'object' || seen.has(item)) throw new Error('模拟状态必须是无共享引用的普通数据树或数值缓冲。')
    seen.add(item)
    if (item instanceof ArrayBuffer || ArrayBuffer.isView(item)) {
      if (ArrayBuffer.isView(item) && !(item.buffer instanceof ArrayBuffer)) throw new Error('模拟状态不能包含共享内存。')
      bytes += 32 + item.byteLength; continue
    }
    const prototype = Object.getPrototypeOf(item)
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw new Error('模拟状态中的类实例需要先序列化。')
    if (Object.getOwnPropertySymbols(item).length) throw new Error('模拟状态不能包含 symbol。')
    bytes += 32
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
      if (Array.isArray(item) && key === 'length') continue
      if (!('value' in descriptor)) throw new Error('模拟状态不能包含访问器。')
      bytes += 16 + key.length * 2; pending.push(descriptor.value)
    }
  }
  return bytes
}

export function copySimulationData<T extends SimulationData>(value: T): T {
  simulationDataBytes(value)
  return structuredClone(value)
}

export function simulationView(value: SimulationData): Readonly<SimulationData> {
  const copy = copySimulationData(value), pending: SimulationData[] = [copy]
  while (pending.length) {
    const item = pending.pop()
    if (!item || typeof item !== 'object' || item instanceof ArrayBuffer || ArrayBuffer.isView(item)) continue
    for (const child of Object.values(item)) pending.push(child)
    Object.freeze(item)
  }
  return copy
}
