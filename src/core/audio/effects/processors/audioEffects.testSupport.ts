/** 音频效果测试的公共工具：构造效果、信号，跑效果链，量电平与频响。只给测试用。 */
import { expect } from 'vitest'
import { sampleDifference } from '../../../../../scripts/lib/sampleDifference'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
import { normalizeVideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { AudioEffectChain } from '../audioEffectChain'
import { audioBiquadCoefficients, type BiquadSpec } from './shared'

export const RATE = 48000
export function expectSamples(actual: ArrayLike<number>, expected: ArrayLike<number> | ((index: number) => number), precision?: number): void {
  expect(sampleDifference(actual, expected, precision)).toEqual({ differences: 0, first: -1, maximumError: 0, lengthDifference: 0 })
}
export function effect(builtinId: string, params: Record<string, unknown> = {}, amount = 1, id = builtinId): VideoEditBuiltinEffect {
  return { id, name: builtinId, enabled: true, amount, builtin: { id: builtinId, params: normalizeVideoEditBuiltinParams(builtinId, params) } }
}
export const sine = (frequency: number, amplitude: number, length: number, phase = 0): Float32Array => Float32Array.from({ length }, (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / RATE + phase))
export const stereo = (left: Float32Array, right = left): Float32Array[] => [Float32Array.from(left), Float32Array.from(right)]
/** 可复现的白噪声（线性同余）。 */
export function noise(length: number, amplitude: number, seed = 7): Float32Array {
  let state = seed
  return Float32Array.from({ length }, () => { state = (state * 1103515245 + 12345) % 2147483648; return (state / 2147483648 * 2 - 1) * amplitude })
}
/** 跑一条效果链（一次处理全部样本）；`locate` 给出第一个样本在片段内的位置。 */
export async function run(effects: VideoEditBuiltinEffect[], input: Float32Array[], locate?: number): Promise<{ output: Float32Array[]; latency: number }> {
  const chain = new AudioEffectChain(RATE, input.length)
  await chain.sync(effects)
  if (locate !== undefined) chain.locate(locate)
  const output = input.map(channel => Float32Array.from(channel))
  chain.process(output, output[0].length)
  const latency = chain.latency; chain.dispose()
  return { output, latency }
}
/** 按给定块长依次处理（块长序列循环使用），拼回整段。 */
export async function runChunked(effects: VideoEditBuiltinEffect[], input: Float32Array[], sizes: readonly number[]): Promise<Float32Array[]> {
  const chain = new AudioEffectChain(RATE, input.length)
  await chain.sync(effects)
  const output = input.map(channel => Float32Array.from(channel))
  for (let start = 0, turn = 0; start < output[0].length; turn++) {
    const size = Math.min(sizes[turn % sizes.length], output[0].length - start)
    const block = output.map(channel => channel.slice(start, start + size))
    chain.process(block, size)
    block.forEach((data, channel) => output[channel].set(data, start))
    start += size
  }
  chain.dispose()
  return output
}
export const peak = (data: ArrayLike<number>, from = 0, to = data.length): number => { let value = 0; for (let index = from; index < to; index++) value = Math.max(value, Math.abs(data[index])); return value }
export const rms = (data: ArrayLike<number>, from = 0, to = data.length): number => { let sum = 0; for (let index = from; index < to; index++) sum += data[index] ** 2; return Math.sqrt(sum / (to - from)) }
export const db = (ratio: number): number => 20 * Math.log10(ratio)
/** 稳态（默认跳过前 0.25 秒）的增益，dB。 */
export const steadyGain = (output: ArrayLike<number>, input: ArrayLike<number>, from = RATE / 4): number => db(rms(output, from) / rms(input, from))
/** 一串双二阶段在频率 `frequency` 处的理论幅频响应，dB。 */
export function cascadeResponse(specs: readonly BiquadSpec[], frequency: number): number {
  const w = 2 * Math.PI * frequency / RATE
  return specs.reduce((sum, spec) => {
    const { b0, b1, b2, a1, a2 } = audioBiquadCoefficients(spec, RATE)
    const re = (c0: number, c1: number, c2: number): number => c0 + c1 * Math.cos(w) + c2 * Math.cos(2 * w)
    const im = (c1: number, c2: number): number => -c1 * Math.sin(w) - c2 * Math.sin(2 * w)
    const magnitude = Math.hypot(re(b0, b1, b2), im(b1, b2)) / Math.hypot(re(1, a1, a2), im(a1, a2))
    return sum + db(magnitude)
  }, 0)
}
/** 单个频率分量的幅度（Goertzel），用于看谐波。 */
export function toneAmplitude(data: ArrayLike<number>, frequency: number, from: number, length: number): number {
  const w = 2 * Math.PI * frequency / RATE; const coefficient = 2 * Math.cos(w)
  let previous = 0; let before = 0
  for (let index = from; index < from + length; index++) { const value = data[index] + coefficient * previous - before; before = previous; previous = value }
  return 2 * Math.sqrt(previous * previous + before * before - coefficient * previous * before) / length
}
export const isFiniteSignal = (channels: readonly Float32Array[]): boolean => channels.every(data => data.every(Number.isFinite))
