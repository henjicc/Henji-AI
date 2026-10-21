/*
 * 频谱图的纯计算：色表、频率轴映射与栅格化。数据来自音频 Worker 的 spectrogram 命令
 * （每声道每帧每频点一个 u8，0..255 对应 -120..0 dB），这里只负责把它画成像素，不做 FFT。
 */

export interface SpectrogramData {
  sampleRate: number
  fftSize: number
  hop: number
  /** 第一帧对应的源采样帧。 */
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
  return Math.exp(Math.log(low) + (Math.log(Math.max(low * 1.0001, maxHz)) - Math.log(low)) * t)
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

/**
 * 把一个声道的可见区间栅格化为 RGBA。横向每列取最近的 STFT 帧（放大时块状、缩小时取该列覆盖帧里的最大值，
 * 保证短促的瑕疵不会在缩小时消失）；纵向每行按频率轴映射到频点，跨多个频点时同样取最大值。
 */
export function rasterizeSpectrogram(data: SpectrogramData, request: SpectrogramRasterRequest, lut: Uint8ClampedArray, out?: Uint8ClampedArray): Uint8ClampedArray {
  const { width, height } = request
  const pixels = out && out.length === width * height * 4 ? out : new Uint8ClampedArray(width * height * 4)
  const channel = Math.min(Math.max(0, request.channel), data.channelCount - 1)
  const channelOffset = channel * data.frameCount * data.binCount
  const binHz = data.sampleRate / data.fftSize
  const span = Math.max(1e-9, request.endFrame - request.startFrame)
  const boost = Math.round(request.boost ?? 0)
  // 每行对应的频点区间（含），自上而下。
  const rowLow = new Int32Array(height)
  const rowHigh = new Int32Array(height)
  for (let row = 0; row < height; row++) {
    const top = spectrogramHzAt(1 - row / height, request.minHz, request.maxHz, request.scale)
    const bottom = spectrogramHzAt(1 - (row + 1) / height, request.minHz, request.maxHz, request.scale)
    const low = Math.min(data.binCount - 1, Math.max(0, Math.floor(bottom / binHz)))
    rowLow[row] = low
    // 行与行之间不重叠：上沿按开区间取，最上一行包含奈奎斯特频点。
    rowHigh[row] = Math.min(data.binCount - 1, Math.max(low, row === 0 ? Math.floor(top / binHz) : Math.ceil(top / binHz) - 1))
  }
  for (let column = 0; column < width; column++) {
    const frameStart = request.startFrame + span * column / width
    const frameEnd = request.startFrame + span * (column + 1) / width
    let first = Math.floor((frameStart - data.startFrame) / data.hop)
    let last = Math.ceil((frameEnd - data.startFrame) / data.hop) - 1
    if (last < first) last = first
    if (last < 0 || first >= data.frameCount) {
      for (let row = 0; row < height; row++) { const at = (row * width + column) * 4; pixels[at] = lut[0]; pixels[at + 1] = lut[1]; pixels[at + 2] = lut[2]; pixels[at + 3] = 255 }
      continue
    }
    first = Math.max(0, first); last = Math.min(data.frameCount - 1, last)
    for (let row = 0; row < height; row++) {
      let level = 0
      for (let frame = first; frame <= last; frame++) {
        const base = channelOffset + frame * data.binCount
        for (let bin = rowLow[row]; bin <= rowHigh[row]; bin++) { const value = data.values[base + bin]; if (value > level) level = value }
      }
      const index = Math.min(255, Math.max(0, level + boost)) * 4
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
