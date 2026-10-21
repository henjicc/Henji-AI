import { videoEditFft } from '../videoEdit/fft'

/*
 * CLAP（laion/larger_clap_general）音频塔的输入：与 transformers `ClapFeatureExtractor`
 * （truncation=rand_trunc、padding=repeatpad，preprocessor_config.json）逐项一致的对数梅尔谱，
 * 形状 [1001, 64]，48 kHz 单声道、10 秒窗口。
 *
 * 唯一的差异是长于 10 秒的声音：官方随机截取一段，这里取以击中点为中心的 10 秒（不足时贴边），
 * 同一文件每次得到同一向量，缓存才可复用。
 *
 * 选型：transformers.js 也带这个提取器，但会连带 onnxruntime-web、sharp 与另一份 onnxruntime-node，
 * 且长音频同样随机截取；这里只需百余行纯计算，按 Python 参考向量做一致性测试。
 */

export const CLAP_SAMPLE_RATE = 48_000
export const CLAP_WINDOW_SAMPLES = 480_000
export const CLAP_FRAMES = 1001
export const CLAP_MEL_BINS = 64
const FFT_SIZE = 1024
const HOP = 480
const MIN_HZ = 50
const MAX_HZ = 14_000

function hertzToMel(hz: number): number {
  const linear = hz * 3 / 200
  return hz < 1000 ? linear : 15 + Math.log(hz / 1000) * 27 / Math.log(6.4)
}
function melToHertz(mel: number): number {
  return mel < 15 ? mel * 200 / 3 : 1000 * Math.exp(Math.log(6.4) / 27 * (mel - 15))
}

interface MelFilter { start: number; weights: Float64Array }
let filters: MelFilter[] | undefined
/** Slaney 刻度与 Slaney 面积归一的三角滤波器组（transformers `mel_filter_bank`）；只存非零频点，乘加量少两个数量级。 */
function melFilters(): MelFilter[] {
  if (filters) return filters
  const bins = FFT_SIZE / 2 + 1
  const low = hertzToMel(MIN_HZ), high = hertzToMel(MAX_HZ)
  const edges = Array.from({ length: CLAP_MEL_BINS + 2 }, (_, index) => melToHertz(low + (high - low) * index / (CLAP_MEL_BINS + 1)))
  filters = Array.from({ length: CLAP_MEL_BINS }, (_, mel) => {
    const weights = new Float64Array(bins)
    const norm = 2 / (edges[mel + 2] - edges[mel])
    for (let bin = 0; bin < bins; bin++) {
      const hz = bin * (CLAP_SAMPLE_RATE / 2) / (bins - 1)
      const down = (hz - edges[mel]) / (edges[mel + 1] - edges[mel])
      const up = (edges[mel + 2] - hz) / (edges[mel + 2] - edges[mel + 1])
      weights[bin] = Math.max(0, Math.min(down, up)) * norm
    }
    let start = 0, end = weights.length - 1
    while (start < weights.length && weights[start] <= 0) start++
    while (end > start && weights[end] <= 0) end--
    return { start, weights: weights.slice(start, end + 1) }
  })
  return filters
}

/** 取 10 秒窗口：短的按 repeatpad 重复再补零，长的以击中点为中心截取。 */
export function clapWindow(signal: Float32Array, hitSample = 0): Float32Array {
  if (!signal.length) throw new Error('声音为空。')
  if (signal.length > CLAP_WINDOW_SAMPLES) {
    const start = Math.max(0, Math.min(signal.length - CLAP_WINDOW_SAMPLES, Math.round(hitSample - CLAP_WINDOW_SAMPLES / 2)))
    return signal.slice(start, start + CLAP_WINDOW_SAMPLES)
  }
  const out = new Float32Array(CLAP_WINDOW_SAMPLES)
  const repeats = Math.floor(CLAP_WINDOW_SAMPLES / signal.length)
  for (let index = 0; index < repeats; index++) out.set(signal, index * signal.length)
  return out
}

/** 10 秒窗口 → [1001 × 64] 行优先的 dB 对数梅尔谱（center + reflect 填充、周期汉宁窗、功率谱）。 */
export function clapLogMel(window: Float32Array): Float32Array {
  if (window.length !== CLAP_WINDOW_SAMPLES) throw new Error('CLAP 输入必须是 10 秒窗口。')
  const half = FFT_SIZE / 2
  const padded = new Float64Array(window.length + FFT_SIZE)
  for (let index = 0; index < window.length; index++) padded[index + half] = window[index]
  for (let index = 1; index <= half; index++) { padded[half - index] = window[index]; padded[half + window.length - 1 + index] = window[window.length - 1 - index] }
  const hann = Float64Array.from({ length: FFT_SIZE }, (_, index) => 0.5 - 0.5 * Math.cos(2 * Math.PI * index / FFT_SIZE))
  const bank = melFilters()
  const out = new Float32Array(CLAP_FRAMES * CLAP_MEL_BINS)
  const real = new Float64Array(FFT_SIZE), imaginary = new Float64Array(FFT_SIZE), power = new Float64Array(half + 1)
  for (let frame = 0; frame < CLAP_FRAMES; frame++) {
    const offset = frame * HOP
    for (let index = 0; index < FFT_SIZE; index++) { real[index] = padded[offset + index] * hann[index]; imaginary[index] = 0 }
    videoEditFft(real, imaginary, -1)
    for (let bin = 0; bin <= half; bin++) power[bin] = real[bin] * real[bin] + imaginary[bin] * imaginary[bin]
    for (let mel = 0; mel < CLAP_MEL_BINS; mel++) {
      const { start, weights } = bank[mel]
      let energy = 0
      for (let index = 0; index < weights.length; index++) energy += weights[index] * power[start + index]
      out[frame * CLAP_MEL_BINS + mel] = 10 * Math.log10(Math.max(1e-10, energy))
    }
  }
  return out
}

/** L2 归一化（模型输出的向量比较前都要归一）。 */
export function normalizeEmbedding(values: ArrayLike<number>): Float32Array {
  let norm = 0
  for (let index = 0; index < values.length; index++) norm += values[index] * values[index]
  norm = Math.sqrt(norm) || 1
  return Float32Array.from(values, value => value / norm)
}

export function cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number {
  let dot = 0
  for (let index = 0; index < left.length; index++) dot += left[index] * right[index]
  return dot
}
