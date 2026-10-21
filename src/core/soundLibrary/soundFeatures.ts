import { videoEditFft } from '../videoEdit/fft'

/*
 * 音效的时间与听感测量（纯 DSP，不需要模型）。输入是 48 kHz 浮点 PCM（逐声道）。
 *
 * - 起音点：第一次进入整段采样峰值 -20 dB 以内的时刻。
 * - 击中点：20 ms 能量包络的峰值（比单个采样峰值稳），再在该窗内取采样峰值细化到采样精度。
 *   卡点时把击中点对齐到切点，而不是对齐文件开头。
 * - 响度：ITU-R BS.1770 K 加权的最大瞬时响度（400 ms 窗），短于 400 ms 的声音按补静音的一个窗计。
 *   整片“积分响度”有门限，短促音效常常测不出，所以音效之间比较用最大瞬时响度。
 * - 明暗：按幅度加权的平均频谱重心。
 */

export const SOUND_ANALYSIS_SAMPLE_RATE = 48_000

export interface SoundFeatures {
  durationSeconds: number
  attackSeconds: number
  hitSeconds: number
  /** 采样峰值 dBFS；全静音为 null。 */
  peakDbfs: number | null
  /** 最大瞬时响度 LUFS；全静音为 null。 */
  loudnessLufs: number | null
  /** 平均频谱重心（Hz）；全静音为 null。 */
  brightnessHz: number | null
}

const ENVELOPE_WINDOW = 960
const ENVELOPE_HOP = 240
const SILENCE = 1e-6

function mono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(channels[0].length)
  for (const channel of channels) for (let index = 0; index < out.length; index++) out[index] += channel[index] / channels.length
  return out
}

/** BS.1770 K 加权两级双二阶滤波（48 kHz 系数）。 */
function kWeighted(input: Float32Array): Float64Array {
  const stages = [
    { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [-1.69065929318241, 0.73248077421585] },
    { b: [1, -2, 1], a: [-1.99004745483398, 0.99007225036621] },
  ]
  let signal: ArrayLike<number> = input
  let out = new Float64Array(0)
  for (const { b, a } of stages) {
    out = new Float64Array(input.length)
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0
    for (let index = 0; index < signal.length; index++) {
      const x = signal[index]
      const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2
      x2 = x1; x1 = x; y2 = y1; y1 = y; out[index] = y
    }
    signal = out
  }
  return out
}

function maxMomentaryLoudness(channels: readonly Float32Array[]): number | null {
  const window = Math.round(0.4 * SOUND_ANALYSIS_SAMPLE_RATE), hop = Math.round(0.1 * SOUND_ANALYSIS_SAMPLE_RATE)
  const weighted = channels.map(kWeighted)
  const length = Math.max(window, weighted[0].length)
  // 逐声道平方的前缀和，任一 400 ms 窗的均方即两次查表。
  const prefix = weighted.map(signal => {
    const sums = new Float64Array(length + 1)
    for (let index = 0; index < length; index++) sums[index + 1] = sums[index] + (index < signal.length ? signal[index] * signal[index] : 0)
    return sums
  })
  let best = 0
  for (let start = 0; start + window <= length; start += hop) {
    let power = 0
    for (const sums of prefix) power += (sums[start + window] - sums[start]) / window
    best = Math.max(best, power)
  }
  return best > 1e-12 ? -0.691 + 10 * Math.log10(best) : null
}

function spectralCentroid(signal: Float32Array): number | null {
  const size = 2048, hop = 1024
  const real = new Float64Array(size), imaginary = new Float64Array(size)
  let weighted = 0, total = 0
  for (let start = 0; start < Math.max(1, signal.length - size + hop); start += hop) {
    real.fill(0); imaginary.fill(0)
    for (let index = 0; index < size; index++) {
      const sample = signal[start + index] ?? 0
      real[index] = sample * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / size))
    }
    videoEditFft(real, imaginary, -1)
    // 幅度加权（常规频谱重心）；功率加权会被低频隆隆声主导。20 Hz 以下不计。
    for (let bin = 1; bin <= size / 2; bin++) {
      const hz = bin * SOUND_ANALYSIS_SAMPLE_RATE / size
      if (hz < 20) continue
      const magnitude = Math.hypot(real[bin], imaginary[bin])
      weighted += magnitude * hz; total += magnitude
    }
  }
  return total > 1e-12 ? weighted / total : null
}

export function analyzeSoundPcm(channels: readonly Float32Array[]): SoundFeatures {
  if (!channels.length || !channels[0].length) throw new Error('声音为空。')
  const signal = mono(channels)
  const durationSeconds = signal.length / SOUND_ANALYSIS_SAMPLE_RATE
  let peak = 0
  for (let index = 0; index < signal.length; index++) peak = Math.max(peak, Math.abs(signal[index]))
  if (peak < SILENCE) return { durationSeconds, attackSeconds: 0, hitSeconds: 0, peakDbfs: null, loudnessLufs: null, brightnessHz: null }
  let attack = 0
  while (attack < signal.length && Math.abs(signal[attack]) < peak * 0.1) attack++
  // 20 ms 能量包络：短于一个窗的声音整体作为一个窗。
  let bestEnergy = -1, bestStart = 0
  for (let start = 0; start === 0 || start + ENVELOPE_WINDOW <= signal.length; start += ENVELOPE_HOP) {
    let energy = 0
    const end = Math.min(signal.length, start + ENVELOPE_WINDOW)
    for (let index = start; index < end; index++) energy += signal[index] * signal[index]
    if (energy > bestEnergy) { bestEnergy = energy; bestStart = start }
    if (end === signal.length) break
  }
  let hit = bestStart, hitLevel = 0
  for (let index = bestStart; index < Math.min(signal.length, bestStart + ENVELOPE_WINDOW); index++) {
    const level = Math.abs(signal[index])
    if (level > hitLevel) { hitLevel = level; hit = index }
  }
  return {
    durationSeconds, attackSeconds: attack / SOUND_ANALYSIS_SAMPLE_RATE, hitSeconds: Math.max(attack, hit) / SOUND_ANALYSIS_SAMPLE_RATE,
    peakDbfs: 20 * Math.log10(peak), loudnessLufs: maxMomentaryLoudness(channels), brightnessHz: spectralCentroid(signal),
  }
}

/** 明暗的用户语言分档。 */
export function soundBrightnessLabel(hz: number | null): 'dark' | 'neutral' | 'bright' | null {
  if (hz === null) return null
  return hz < 1500 ? 'dark' : hz < 4000 ? 'neutral' : 'bright'
}
