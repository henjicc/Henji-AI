import type { SpectrogramData } from './spectrogram'

export interface SpectrumLevel { offset: number; frames: number; bins: number }
export interface SpectrumTexture {
  width: number; height: number; layers: number; channelStride: number
  levels: SpectrumLevel[]; values: Uint8Array
}

/** 线性地址折叠进二维纹理页；帧数和频点数均不受单边纹理上限限制。 */
export function spectrumTexelAddress(index: number, width: number, height: number): [number, number, number] {
  return [index % width, Math.floor(index / width) % height, Math.floor(index / (width * height))]
}

/** 只在数据变更时构建最大值层级，缩小时保住单个采样峰值，不用逐帧扫描矩阵。 */
export function buildSpectrumTexture(data: SpectrogramData, maxSize: number, maxLayers: number): SpectrumTexture {
  if (data.frameCount < 1 || data.binCount < 1 || data.channelCount < 1 || data.values.length !== data.frameCount * data.binCount * data.channelCount) throw new Error('频谱矩阵尺寸无效')
  const levels: SpectrumLevel[] = []
  let frames = data.frameCount, bins = data.binCount, channelStride = 0
  do {
    levels.push({ offset: channelStride, frames, bins })
    channelStride += frames * bins
    if (frames === 1 && bins === 1) break
    frames = Math.ceil(frames / 2); bins = Math.ceil(bins / 2)
  } while (frames >= 1 && bins >= 1)
  if (levels.length > 32) throw new Error('频谱层级超出绘制上限')
  const count = channelStride * data.channelCount
  const width = Math.min(maxSize, count)
  const height = Math.min(maxSize, Math.ceil(count / width))
  const layers = Math.ceil(count / (width * height))
  if (layers > maxLayers) throw new Error('频谱数据超出显存纹理上限')
  const values = new Uint8Array(width * height * layers)
  for (let channel = 0; channel < data.channelCount; channel++) {
    const base = channel * channelStride
    values.set(data.values.subarray(channel * data.frameCount * data.binCount, (channel + 1) * data.frameCount * data.binCount), base)
    for (let level = 1; level < levels.length; level++) {
      const previous = levels[level - 1], current = levels[level]
      for (let frame = 0; frame < current.frames; frame++) for (let bin = 0; bin < current.bins; bin++) {
        let peak = 0
        for (let x = frame * 2; x < Math.min(previous.frames, frame * 2 + 2); x++) for (let y = bin * 2; y < Math.min(previous.bins, bin * 2 + 2); y++) {
          peak = Math.max(peak, values[base + previous.offset + x * previous.bins + y])
        }
        values[base + current.offset + frame * current.bins + bin] = peak
      }
    }
  }
  return { width, height, layers, channelStride, levels, values }
}

/** 每个方向最多覆盖八个池化格，包含边界格；宁可略扩大峰值，也不漏掉短促瑕疵。 */
export function spectrumPoolLevel(frameSpan: number, binSpan: number, levels: number): number {
  return Math.min(levels - 1, Math.max(0, Math.ceil(Math.log2(Math.max(frameSpan, binSpan) / 7))))
}
