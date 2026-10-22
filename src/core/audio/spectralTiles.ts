import {
  SPECTRAL_CROSSOVER_END_HZ, SPECTRAL_CROSSOVER_START_HZ, SPECTRAL_LONG_WINDOW, SPECTRAL_MAX_LEVEL, SPECTRAL_MIN_LEVEL, SPECTRAL_SHORT_WINDOW,
  SPECTRAL_TILE_COLUMNS, spectralHop, spectralLevelForFramesPerPixel, spectralOrigin, type AudioEditSpectralTile,
} from '@/core/audioEdit/spectralPyramid'
import { spectrogramHzAt, type SpectrogramScale } from './spectrogram'

/*
 * 频谱金字塔在显示端的纯计算：块存储、每次绘制用哪些块、单个像素怎么取值。
 * GPU 着色器（components/audio/spectrogramGl.ts）与 CPU 回退逐条对应这里的规则；改一边必须同步另一边。
 */

/** 缩小时在 dB 上混合 65% 峰值与 35% 能量均值，保留瞬态且抑制孤立亮点。 */
export const SPECTRAL_PEAK_WEIGHT = 0.65
/** 每像素在时间、频率方向各自最多取几个样本；其余靠层级与汇总保证不漏峰值。 */
export const SPECTRAL_TIME_SAMPLES = 4
export const SPECTRAL_BIN_SAMPLES = 8
/** 比目标层更细的块最多往下借两层（每像素最多 4 列），再细的不画。 */
export const SPECTRAL_FINER_FALLBACK = 2

export interface SpectralTileSet {
  sampleRate: number; channels: number; durationFrames: number; lowBins: number; highBins: number
  /** 有块加入或替换就递增，绘制方据此判断是否需要重画。 */
  version: number
  get(level: number, tile: number): AudioEditSpectralTile | undefined
}

export const spectralTileKey = (level: number, tile: number): string => `${level}|${tile}`
const tileBytes = (tile: AudioEditSpectralTile): number => tile.values.byteLength

/** 按字节淘汰最久未用的块；正在需要的块（pin）不淘汰。 */
export class SpectralTileStore implements SpectralTileSet {
  sampleRate = 0; channels = 0; durationFrames = 0; lowBins = 0; highBins = 0; version = 0
  private readonly entries = new Map<string, AudioEditSpectralTile>()
  private pinned = new Set<string>()
  private bytes = 0
  constructor(private readonly maxBytes = 256 * 1024 * 1024) {}
  get(level: number, tile: number): AudioEditSpectralTile | undefined { return this.entries.get(spectralTileKey(level, tile)) }
  has(level: number, tile: number): boolean { return this.entries.has(spectralTileKey(level, tile)) }
  pin(keys: Iterable<string>): void { this.pinned = new Set(keys) }
  set(tile: AudioEditSpectralTile): void {
    const key = spectralTileKey(tile.level, tile.tile)
    const previous = this.entries.get(key)
    if (previous) { this.entries.delete(key); this.bytes -= tileBytes(previous) }
    if (!this.version) Object.assign(this, { sampleRate: tile.sampleRate, channels: tile.channels, durationFrames: tile.durationFrames, lowBins: tile.lowBins, highBins: tile.highBins })
    this.entries.set(key, tile); this.bytes += tileBytes(tile); this.version++
    for (const [oldest, value] of this.entries) {
      if (this.bytes <= this.maxBytes) break
      if (this.pinned.has(oldest) || oldest === key) continue
      this.entries.delete(oldest); this.bytes -= tileBytes(value)
    }
  }
  /** 触碰一次，表示刚被用到（LRU 顺序后移）。 */
  touch(level: number, tile: number): void {
    const key = spectralTileKey(level, tile), value = this.entries.get(key)
    if (value) { this.entries.delete(key); this.entries.set(key, value) }
  }
}

/** 某层第 c 列拥有的源采样帧区间起点。 */
export const spectralColumnFrame = (level: number, column: number): number => spectralOrigin(level) + column * spectralHop(level)

export interface SpectralView { startFrame: number; endFrame: number; width: number }
export interface SpectralDraw {
  level: number; tile: AudioEditSpectralTile
  /** 同层相邻块，用于跨块边界插值；没有就在边界夹住。 */
  previous?: AudioEditSpectralTile; next?: AudioEditSpectralTile
  /** 本块负责的屏幕像素列 [x0, x1)。 */
  x0: number; x1: number
  /** 低频段（长窗）权重：放大到长窗占屏幕比例较大时让位给短窗，避免起止被抹宽。 */
  lowWeight: number
}

/** 长窗不超过可见时长的 5% 时低频全用长窗，超过 20% 时全用短窗，中间平滑过渡。 */
export function spectralLowBandWeight(view: SpectralView): number {
  return 1 - smoothStep(0.05, 0.2, SPECTRAL_LONG_WINDOW / Math.max(1, view.endFrame - view.startFrame))
}

export function spectralDesiredLevel(view: SpectralView): number {
  return spectralLevelForFramesPerPixel((view.endFrame - view.startFrame) / Math.max(1, view.width))
}

/** 绘制优先级从高到低：目标层 → 逐级更粗 → 最多两级更细。 */
export function spectralLevelPriority(desired: number): number[] {
  const levels: number[] = []
  for (let level = desired; level <= SPECTRAL_MAX_LEVEL; level++) levels.push(level)
  for (let step = 1; step <= SPECTRAL_FINER_FALLBACK && desired - step >= SPECTRAL_MIN_LEVEL; step++) levels.push(desired - step)
  return levels
}

/**
 * 每次绘制要画哪些块，按“先画低优先级、后画高优先级覆盖”的顺序返回。
 * 只要可见区间还有没被更高优先级覆盖的像素，才继续往下一级借块。
 */
export function planSpectralDraws(tiles: SpectralTileSet, view: SpectralView): SpectralDraw[] {
  const span = view.endFrame - view.startFrame
  if (!(span > 0) || view.width <= 0 || tiles.durationFrames <= 0) return []
  const toX = (frame: number): number => (frame - view.startFrame) / span * view.width
  const visibleStart = Math.max(0, view.startFrame), visibleEnd = Math.min(tiles.durationFrames, view.endFrame)
  if (!(visibleEnd > visibleStart)) return []
  let uncovered: Array<[number, number]> = [[Math.max(0, Math.floor(toX(visibleStart))), Math.min(view.width, Math.ceil(toX(visibleEnd)))]]
  const draws: SpectralDraw[] = [], lowWeight = spectralLowBandWeight(view)
  for (const level of spectralLevelPriority(spectralDesiredLevel(view))) {
    if (!uncovered.length) break
    const hop = spectralHop(level), origin = spectralOrigin(level), tileSpan = hop * SPECTRAL_TILE_COLUMNS
    const first = Math.max(0, Math.floor((visibleStart - origin) / tileSpan)), last = Math.floor((visibleEnd - 1 - origin) / tileSpan)
    for (let index = first; index <= last; index++) {
      const tile = tiles.get(level, index)
      if (!tile || tile.columnCount <= 0) continue
      const from = Math.max(visibleStart, origin + tile.columnStart * hop), to = Math.min(visibleEnd, origin + (tile.columnStart + tile.columnCount) * hop)
      const x0 = Math.max(0, Math.floor(toX(from))), x1 = Math.min(view.width, Math.ceil(toX(to)))
      if (x1 <= x0 || !uncovered.some(([a, b]) => a < x1 && b > x0)) continue
      const previous = tiles.get(level, index - 1), next = tiles.get(level, index + 1)
      draws.push({ level, tile, x0, x1, lowWeight, ...(previous?.complete ? { previous } : {}), ...(next && next.columnCount > 0 ? { next } : {}) })
      uncovered = uncovered.flatMap(([a, b]): Array<[number, number]> => b <= x0 || a >= x1 ? [[a, b]] : [...(a < x0 ? [[a, x0] as [number, number]] : []), ...(b > x1 ? [[x1, b] as [number, number]] : [])])
    }
  }
  return draws.reverse()
}

/** 当前视口是否已全部由目标层画出（exact），还是有部分借用了别的层（fallback），或什么都没有（empty）。 */
export function spectralCoverage(tiles: SpectralTileSet, view: SpectralView): 'exact' | 'fallback' | 'empty' {
  const draws = planSpectralDraws(tiles, view)
  if (!draws.length) return 'empty'
  const desired = spectralDesiredLevel(view)
  return draws.every(draw => draw.level === desired && draw.tile.complete) ? 'exact' : 'fallback'
}

export const spectralPower =(value: number): number => 10 ** ((value / 255 * 120 - 120) / 10)
export const spectralDb = (power: number): number => Math.max(0, Math.min(255, (10 * Math.log10(Math.max(1e-12, power)) + 120) * 255 / 120))
export const smoothStep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

interface Band { first: number; bins: number; binHz: number }
export function spectralBands(sampleRate: number, lowBins: number, highBins: number): { low: Band; high: Band } {
  return { low: { first: 0, bins: lowBins, binHz: sampleRate / SPECTRAL_LONG_WINDOW }, high: { first: lowBins, bins: highBins, binHz: sampleRate / SPECTRAL_SHORT_WINDOW } }
}

/** 读某块某声道的一个（列, 频点）的 R/G；列号是全局列号，超出已有列时夹到边界。 */
function readColumn(draw: SpectralDraw, channel: number, column: number, bin: number, component: 0 | 1): number {
  const { tile, previous, next } = draw
  const firstAvailable = previous ? previous.columnStart : tile.columnStart
  const endAvailable = tile.columnStart + tile.columnCount + (next ? next.columnCount : 0)
  const c = Math.max(firstAvailable, Math.min(endAvailable - 1, column))
  const source = c < tile.columnStart ? previous! : c >= tile.columnStart + tile.columnCount ? next! : tile
  const binsPerColumn = source.lowBins + source.highBins
  return source.values[((channel * source.columnCount + (c - source.columnStart)) * binsPerColumn + bin) * 2 + component]
}

/** 在列坐标 y（列中心 = 整数）、某频段坐标 x（频点中心 = 整数）处双线性取值；x 夹在频段内，不跨段插值。 */
function bilinear(draw: SpectralDraw, channel: number, y: number, band: Band, x: number, component: 0 | 1): number {
  const cx = Math.max(0, Math.min(band.bins - 1, x)), x0 = Math.floor(cx), x1 = Math.min(band.bins - 1, x0 + 1), tx = cx - x0
  const y0 = Math.floor(y), ty = y - y0
  const at = (column: number): number => readColumn(draw, channel, column, band.first + x0, component) * (1 - tx) + readColumn(draw, channel, column, band.first + x1, component) * tx
  return at(y0) * (1 - ty) + at(y0 + 1) * ty
}

/** 一个频段在 [lowHz, highHz) 内的峰值与能量（时间位置已给定）。 */
function bandSample(draw: SpectralDraw, channel: number, times: readonly number[], band: Band, lowHz: number, highHz: number, centerHz: number): { peak: number; energy: number; weight: number } {
  const x0 = lowHz / band.binHz, x1 = highHz / band.binHz
  const count = x1 - x0 <= 1 ? 1 : Math.min(SPECTRAL_BIN_SAMPLES, Math.ceil(x1 - x0))
  let peak = 0, energy = 0, weight = 0
  for (const y of times) for (let b = 0; b < count; b++) {
    const x = count === 1 ? centerHz / band.binHz : x0 + (b + 0.5) * (x1 - x0) / count
    peak = Math.max(peak, bilinear(draw, channel, y, band, x, 0))
    energy += spectralPower(bilinear(draw, channel, y, band, x, 1)); weight++
  }
  return { peak, energy, weight }
}

export interface SpectralPixel { startFrame: number; endFrame: number; lowHz: number; highHz: number; centerHz: number }
/** 一个像素的显示读数（0..255 浮点，未加亮度补偿）。 */
export function sampleSpectralPixel(draw: SpectralDraw, channel: number, pixel: SpectralPixel): number {
  const hop = spectralHop(draw.level), origin = spectralOrigin(draw.level)
  const u0 = (pixel.startFrame - origin) / hop, u1 = (pixel.endFrame - origin) / hop
  const count = u1 - u0 <= 1 ? 1 : Math.min(SPECTRAL_TIME_SAMPLES, Math.ceil(u1 - u0))
  // 列 c 的中心在列坐标 c + 0.5；插值坐标以列中心为整数，所以减 0.5。
  const times = Array.from({ length: count }, (_, i) => (count === 1 ? (u0 + u1) / 2 : u0 + (i + 0.5) * (u1 - u0) / count) - 0.5)
  const { low, high } = spectralBands(draw.tile.sampleRate, draw.tile.lowBins, draw.tile.highBins)
  const mix = 1 - (1 - smoothStep(SPECTRAL_CROSSOVER_START_HZ, SPECTRAL_CROSSOVER_END_HZ, pixel.centerHz)) * draw.lowWeight
  const value = (band: Band): number => {
    const sample = bandSample(draw, channel, times, band, pixel.lowHz, pixel.highHz, pixel.centerHz)
    return spectralDb(sample.energy / sample.weight) * (1 - SPECTRAL_PEAK_WEIGHT) + sample.peak * SPECTRAL_PEAK_WEIGHT
  }
  if (mix <= 0) return value(low)
  if (mix >= 1) return value(high)
  return value(low) * (1 - mix) + value(high) * mix
}

export interface SpectralRasterRequest {
  channel: number; startFrame: number; endFrame: number; width: number; height: number
  minHz: number; maxHz: number; scale: SpectrogramScale; boost?: number
}

/** CPU 回退：与着色器同一套绘制规划与像素取值，按低到高优先级覆盖。 */
export function rasterizeSpectralTiles(tiles: SpectralTileSet, request: SpectralRasterRequest, lut: Uint8ClampedArray, out?: Uint8ClampedArray): Uint8ClampedArray {
  const { width, height } = request
  const pixels = out && out.length === width * height * 4 ? out : new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) { pixels[i * 4] = lut[0]; pixels[i * 4 + 1] = lut[1]; pixels[i * 4 + 2] = lut[2]; pixels[i * 4 + 3] = 255 }
  const channel = Math.min(Math.max(0, request.channel), Math.max(0, tiles.channels - 1))
  const span = request.endFrame - request.startFrame, boost = Math.round(request.boost ?? 0)
  const hz = (p: number): number => spectrogramHzAt(p, request.minHz, request.maxHz, request.scale)
  const rows = Array.from({ length: height }, (_, row) => ({ lowHz: hz(1 - (row + 1) / height), highHz: hz(1 - row / height), centerHz: hz(1 - (row + 0.5) / height) }))
  for (const draw of planSpectralDraws(tiles, request)) {
    for (let x = draw.x0; x < draw.x1; x++) {
      const startFrame = request.startFrame + span * x / width, endFrame = request.startFrame + span * (x + 1) / width
      for (let row = 0; row < height; row++) {
        const value = sampleSpectralPixel(draw, channel, { startFrame, endFrame, ...rows[row] })
        const index = Math.min(255, Math.max(0, Math.round(value) + boost)) * 4, at = (row * width + x) * 4
        pixels[at] = lut[index]; pixels[at + 1] = lut[index + 1]; pixels[at + 2] = lut[index + 2]
      }
    }
  }
  return pixels
}
