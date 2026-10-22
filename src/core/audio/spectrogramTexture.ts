import type { SpectrogramData } from './spectrogram'

export interface SpectrumLevel { offset: number; frames: number; bins: number }
export interface SpectrumTexture {
  width: number; height: number; layers: number; channelStride: number
  levels: SpectrumLevel[]; values: Uint8Array
}

/** 缩小时在 dB 上混合 65% 峰值与 35% 能量均值，保留瞬态且抑制孤立亮点。 */
export const SPECTRUM_PEAK_WEIGHT = 0.65
export const SPECTRUM_TIME_SAMPLES = 8
export const SPECTRUM_BIN_SAMPLES = 64
export const spectrumPower = (value: number): number => 10 ** ((value / 255 * 120 - 120) / 10)
export const spectrumDb = (power: number): number => Math.max(0, Math.min(255, (10 * Math.log10(Math.max(1e-12, power)) + 120) * 255 / 120))
const powers = Float64Array.from({ length: 256 }, (_, value) => spectrumPower(value))

/** 线性地址折叠进二维纹理页；帧数和频点数均不受单边纹理上限限制。 */
export function spectrumTexelAddress(index: number, width: number, height: number): [number, number, number] {
  return [index % width, Math.floor(index / width) % height, Math.floor(index / (width * height))]
}

/** 只沿时间降采样；RG 分别保存峰值与能量均值的 dB，避免反复混合放大孤立峰值。 */
export function buildSpectrumTexture(data: SpectrogramData, maxSize: number, maxLayers: number): SpectrumTexture {
  if (data.frameCount < 1 || data.binCount < 1 || data.channelCount < 1 || data.values.length !== data.frameCount * data.binCount * data.channelCount) throw new Error('频谱矩阵尺寸无效')
  const levels: SpectrumLevel[] = []
  let frames = data.frameCount, channelStride = 0
  const bins = data.binCount
  do {
    levels.push({ offset: channelStride, frames, bins })
    channelStride += frames * bins
    if (frames === 1) break
    frames = Math.ceil(frames / 2)
  } while (frames >= 1 && bins >= 1)
  if (levels.length > 32) throw new Error('频谱层级超出绘制上限')
  const count = channelStride * data.channelCount
  const width = Math.min(maxSize, count)
  const height = Math.min(maxSize, Math.ceil(count / width))
  const layers = Math.ceil(count / (width * height))
  if (layers > maxLayers) throw new Error('频谱数据超出显存纹理上限')
  const values = new Uint8Array(width * height * layers * 2)
  for (let channel = 0; channel < data.channelCount; channel++) {
    const base = channel * channelStride
    for (let i = 0; i < data.frameCount * bins; i++) {
      values[(base + i) * 2] = values[(base + i) * 2 + 1] = data.values[channel * data.frameCount * bins + i]
    }
    for (let level = 1; level < levels.length; level++) {
      const previous = levels[level - 1], current = levels[level]
      for (let frame = 0; frame < current.frames; frame++) for (let bin = 0; bin < current.bins; bin++) {
        let peak = 0, energy = 0, count = 0
        for (let x = frame * 2; x < Math.min(previous.frames, frame * 2 + 2); x++) {
          const at = (base + previous.offset + x * bins + bin) * 2
          const weight = Math.min(2 ** (level - 1), data.frameCount - x * 2 ** (level - 1))
          peak = Math.max(peak, values[at])
          energy += powers[values[at + 1]] * weight; count += weight
        }
        const at = (base + current.offset + frame * bins + bin) * 2
        values[at] = peak; values[at + 1] = Math.round(spectrumDb(energy / count))
      }
    }
  }
  return { width, height, layers, channelStride, levels, values }
}

/** 时间方向最多覆盖八个池化格，频率方向独立采样，不随时间层级变粗。 */
export function spectrumPoolLevel(frameSpan: number, levels: number): number {
  return Math.min(levels - 1, Math.max(0, Math.ceil(Math.log2(frameSpan / (SPECTRUM_TIME_SAMPLES - 1)))))
}

/** 与 GLSL 同一采样契约：放大插值 dB，缩小分别遍历时间格和频点覆盖区。 */
export function sampleSpectrum(texture: SpectrumTexture, channel: number, left: number, right: number, low: number, high: number, centerBin: number): number {
  const source = texture.levels[0]
  if (right <= 0 || left >= source.frames) return 0
  const timeSpan = right - left, binSpan = high - low
  const level = spectrumPoolLevel(timeSpan, texture.levels.length), divisor = 2 ** level
  const m = texture.levels[level]
  const read = (frame: number, bin: number, component: number): number => texture.values[(channel * texture.channelStride + m.offset + Math.max(0, Math.min(m.frames - 1, frame)) * m.bins + Math.max(0, Math.min(m.bins - 1, bin))) * 2 + component]
  const at = (frame: number, bin: number, component: number): number => {
    const x = Math.floor(frame), y = Math.floor(bin), tx = frame - x, ty = bin - y
    const a = read(x, y, component) * (1 - ty) + read(x, y + 1, component) * ty
    const b = read(x + 1, y, component) * (1 - ty) + read(x + 1, y + 1, component) * ty
    return a * (1 - tx) + b * tx
  }
  const first = Math.max(0, Math.floor(left / divisor))
  const last = Math.min(m.frames - 1, Math.ceil(right / divisor) - 1)
  const firstBin = Math.max(0, Math.min(m.bins - 1, Math.floor(low)))
  const lastBin = Math.max(firstBin, Math.min(m.bins - 1, high >= m.bins - 1 ? Math.floor(high) : Math.ceil(high) - 1))
  const binCount = Math.min(SPECTRUM_BIN_SAMPLES, lastBin - firstBin + 1)
  let peak = 0, energy = 0, weight = 0
  for (let t = 0; t < (timeSpan <= 1 ? 1 : last - first + 1); t++) {
    const frame = timeSpan <= 1 ? (left + right) / 2 - 0.5 : first + t
    const w = timeSpan <= 1 ? 1 : Math.max(0, Math.min(right, (frame + 1) * divisor, source.frames) - Math.max(left, frame * divisor))
    for (let b = 0; b < (binSpan <= 1 ? 1 : binCount); b++) {
      const bin = binSpan <= 1 ? centerBin : firstBin + Math.round(b * (lastBin - firstBin) / Math.max(1, binCount - 1))
      peak = Math.max(peak, at(frame, bin, 0))
      energy += spectrumPower(at(frame, bin, 1)) * w; weight += w
    }
  }
  return peak * SPECTRUM_PEAK_WEIGHT + spectrumDb(energy / Math.max(1e-12, weight)) * (1 - SPECTRUM_PEAK_WEIGHT)
}
