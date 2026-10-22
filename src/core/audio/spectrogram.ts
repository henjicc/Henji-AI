import { buildSpectrumTexture, sampleSpectrum, type SpectrumTexture } from './spectrogramTexture'

/*
 * 频谱图的纯计算：色表、频率轴映射与栅格化。数据来自音频 Worker 的 spectrogram 命令
 * （每声道每帧每频点一个 u8，0..255 对应 -120..0 dB），这里只负责把它画成像素，不做 FFT。
 */

export interface SpectrogramData {
  sampleRate: number
  fftSize: number
  hop: number
  /** 第一列左边界对应的源采样帧；STFT 中心位于 startFrame + hop / 2。 */
  startFrame: number
  frameCount: number
  binCount: number
  channelCount: number
  /** 声道优先、帧次之、频点最后（低频到高频）。 */
  values: Uint8Array
}

export type SpectrogramScale = 'log' | 'linear'

/** 对数轴的下限；低于它的频率在对数轴上没有意义（直流附近）。 */
export const SPECTROGRAM_MIN_LOG_HZ = 20

export function spectrogramNyquist(data: Pick<SpectrogramData, 'sampleRate'>): number { return data.sampleRate / 2 }

/** 0..1 的纵向位置（0 = 底部）对应的频率。 */
export function spectrogramHzAt(position: number, minHz: number, maxHz: number, scale: SpectrogramScale): number {
  const t = Math.min(1, Math.max(0, position))
  if (scale === 'linear') return minHz + (maxHz - minHz) * t
  const low = Math.max(SPECTROGRAM_MIN_LOG_HZ, minHz)
  const high = Math.max(low * 1.0001, maxHz)
  // exp(log(high)) 可能略小于 high；上端取精确值，防止栅格化漏掉 Nyquist 频点。
  if (t === 0) return low
  if (t === 1) return high
  return Math.exp(Math.log(low) + (Math.log(high) - Math.log(low)) * t)
}

/** 频率对应的 0..1 纵向位置（0 = 底部），超出范围时夹到边界。 */
export function spectrogramPositionOf(hz: number, minHz: number, maxHz: number, scale: SpectrogramScale): number {
  if (scale === 'linear') return Math.min(1, Math.max(0, (hz - minHz) / Math.max(1e-9, maxHz - minHz)))
  const low = Math.max(SPECTROGRAM_MIN_LOG_HZ, minHz)
  const high = Math.max(low * 1.0001, maxHz)
  return Math.min(1, Math.max(0, (Math.log(Math.max(low, hz)) - Math.log(low)) / (Math.log(high) - Math.log(low))))
}

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** 256 级 RGBA 色表，按色标均匀插值。 */
export function buildSpectrogramLut(stops: readonly string[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4)
  const colors = stops.map(hexToRgb)
  for (let level = 0; level < 256; level++) {
    const at = level / 255 * (colors.length - 1)
    const index = Math.min(colors.length - 2, Math.floor(at))
    const t = at - index
    const [a, b] = [colors[index], colors[index + 1]]
    lut[level * 4] = a[0] + (b[0] - a[0]) * t
    lut[level * 4 + 1] = a[1] + (b[1] - a[1]) * t
    lut[level * 4 + 2] = a[2] + (b[2] - a[2]) * t
    lut[level * 4 + 3] = 255
  }
  return lut
}

export interface SpectrogramRasterRequest {
  channel: number
  /** 可见区间（源采样帧）。 */
  startFrame: number
  endFrame: number
  width: number
  height: number
  minHz: number
  maxHz: number
  scale: SpectrogramScale
  /** 亮度补偿：把 u8 读数整体抬高（正数更亮），用来让安静的素材也看得清。 */
  boost?: number
}

const rasterTextures = new WeakMap<SpectrogramData, SpectrumTexture>()

/** CPU 回退与 GPU 使用同一时间金字塔、插值坐标和峰值/能量混合规则。 */
export function rasterizeSpectrogram(data: SpectrogramData, request: SpectrogramRasterRequest, lut: Uint8ClampedArray, out?: Uint8ClampedArray): Uint8ClampedArray {
  const { width, height } = request
  const pixels = out && out.length === width * height * 4 ? out : new Uint8ClampedArray(width * height * 4)
  let texture = rasterTextures.get(data)
  if (!texture) { texture = buildSpectrumTexture(data, 4096, 2048); rasterTextures.set(data, texture) }
  const channel = Math.min(Math.max(0, request.channel), data.channelCount - 1)
  const binHz = data.sampleRate / data.fftSize
  const span = Math.max(1e-9, request.endFrame - request.startFrame)
  const boost = Math.round(request.boost ?? 0)
  const rows = Array.from({ length: height }, (_, row) => {
    const hz = (p: number): number => spectrogramHzAt(p, request.minHz, request.maxHz, request.scale) / binHz
    return { low: hz(1 - (row + 1) / height), high: hz(1 - row / height), center: hz(1 - (row + 0.5) / height) }
  })
  for (let column = 0; column < width; column++) {
    const left = (request.startFrame - data.startFrame + span * column / width) / data.hop
    const right = (request.startFrame - data.startFrame + span * (column + 1) / width) / data.hop
    for (let row = 0; row < height; row++) {
      const frequency = rows[row]
      const value = sampleSpectrum(texture, channel, left, right, frequency.low, frequency.high, frequency.center)
      const index = (right <= 0 || left >= data.frameCount ? 0 : Math.min(255, Math.max(0, Math.round(value) + boost))) * 4
      const at = (row * width + column) * 4
      pixels[at] = lut[index]; pixels[at + 1] = lut[index + 1]; pixels[at + 2] = lut[index + 2]; pixels[at + 3] = 255
    }
  }
  return pixels
}

/** 频率刻度：在可见频率范围内取约 count 个整齐的刻度值（对数轴取 1-2-5 序列）。 */
export function spectrogramTicks(minHz: number, maxHz: number, scale: SpectrogramScale, count = 6): number[] {
  if (scale === 'linear') {
    const raw = (maxHz - minHz) / Math.max(1, count)
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, raw)))
    const step = [1, 2, 5, 10].map(value => value * magnitude).find(value => value >= raw) ?? magnitude * 10
    const ticks: number[] = []
    for (let hz = Math.ceil(minHz / step) * step; hz <= maxHz; hz += step) ticks.push(hz)
    return ticks
  }
  const ticks: number[] = []
  for (let decade = 10; decade <= maxHz * 10; decade *= 10) for (const factor of [1, 2, 5]) {
    const hz = decade * factor / 10
    if (hz >= Math.max(SPECTROGRAM_MIN_LOG_HZ, minHz) && hz <= maxHz) ticks.push(hz)
  }
  return ticks
}

export function formatSpectrogramHz(hz: number): string {
  return hz >= 1000 ? `${Number((hz / 1000).toFixed(hz >= 10000 ? 0 : 1))}k` : `${Math.round(hz)}`
}
