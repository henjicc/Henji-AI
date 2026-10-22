import { describe, expect, it } from 'vitest'
import { BLACK_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import { SPECTRAL_HIGH_BINS, SPECTRAL_TILE_COLUMNS, spectralHop, spectralLowBins, spectralOrigin, type AudioEditSpectralTile } from '@/core/audioEdit/spectralPyramid'
import { buildSpectrogramLut } from './spectrogram'
import { planSpectralDraws, rasterizeSpectralTiles, sampleSpectralPixel, spectralLowBandWeight, SpectralTileStore, type SpectralDraw } from './spectralTiles'

const SR = 48000, LOW = spectralLowBins(SR), BINS = LOW + SPECTRAL_HIGH_BINS
const lut = buildSpectrogramLut([BLACK_HEX, WHITE_HEX])

function tile(level: number, index: number, fill: (column: number, bin: number) => number = () => 0, options: { columnCount?: number; complete?: boolean; duration?: number } = {}): AudioEditSpectralTile {
  const columnCount = options.columnCount ?? SPECTRAL_TILE_COLUMNS, columnStart = index * SPECTRAL_TILE_COLUMNS
  const values = new Uint8Array(columnCount * BINS * 2)
  for (let c = 0; c < columnCount; c++) for (let b = 0; b < BINS; b++) values[(c * BINS + b) * 2] = values[(c * BINS + b) * 2 + 1] = fill(columnStart + c, b)
  return { mode: 'source', revision: 0, level, tile: index, sampleRate: SR, channels: 1, durationFrames: options.duration ?? 48000 * 600, lowBins: LOW, highBins: SPECTRAL_HIGH_BINS, columnStart, columnCount, complete: options.complete ?? true, values }
}
function storeOf(...tiles: AudioEditSpectralTile[]): SpectralTileStore {
  const store = new SpectralTileStore()
  tiles.forEach(value => store.set(value))
  return store
}
/** 某层第 c 列中心所在的源采样帧。 */
const centerOf = (level: number, column: number): number => spectralOrigin(level) + (column + 0.5) * spectralHop(level)
const pixelAt = (frame: number, framesWide: number, hz: number) => ({ startFrame: frame - framesWide / 2, endFrame: frame + framesWide / 2, lowHz: hz - 1, highHz: hz + 1, centerHz: hz })
const draw = (value: AudioEditSpectralTile, extra: Partial<SpectralDraw> = {}): SpectralDraw => ({ level: value.level, tile: value, x0: 0, x1: 1, lowWeight: 1, ...extra })

describe('频谱金字塔绘制规划', () => {
  const view = { startFrame: 0, endFrame: 512 * 1000, width: 1000 } // 每像素 512 帧 → 目标层 0

  it('目标层覆盖不全时先垫更粗的层，目标层最后画', () => {
    const overview = tile(5, 0), fine = tile(0, 0, undefined, { columnCount: 300, complete: false })
    const draws = planSpectralDraws(storeOf(overview, fine), view)
    expect(draws.map(item => item.level)).toEqual([5, 0])
    expect(draws[1].x1).toBeLessThan(view.width)
  })

  it('目标层已覆盖全屏就不再借粗层', () => {
    expect(planSpectralDraws(storeOf(tile(5, 0), tile(0, 0)), view).map(item => item.level)).toEqual([0])
  })

  it('更细的块最多借两层', () => {
    expect(planSpectralDraws(storeOf(tile(-2, 0), tile(-2, 1), tile(-2, 2), tile(-2, 3)), view).map(item => item.level)).toEqual([-2, -2, -2, -2])
    expect(planSpectralDraws(storeOf(tile(-3, 0)), view)).toEqual([])
  })
})

describe('频谱金字塔像素取值', () => {
  const highBin = 100, highHz = highBin * SR / 2048
  const lowBin = 50, lowHz = lowBin * SR / 8192

  it('列按契约的时间归属落位：亮列只出现在它自己的中心', () => {
    const source = tile(0, 0, (column, bin) => column === 10 && bin === LOW + highBin ? 255 : 0)
    expect(sampleSpectralPixel(draw(source), 0, pixelAt(centerOf(0, 10), 8, highHz))).toBeGreaterThan(250)
    expect(sampleSpectralPixel(draw(source), 0, pixelAt(centerOf(0, 12), 8, highHz))).toBeLessThan(1)
  })

  it('交叉区以下读 8192 窗低频段，以上读 2048 窗高频段', () => {
    const source = tile(0, 0, (_column, bin) => bin === lowBin ? 255 : 0)
    expect(sampleSpectralPixel(draw(source), 0, pixelAt(centerOf(0, 5), 8, lowHz))).toBeGreaterThan(250)
    const high = tile(0, 0, (_column, bin) => bin === LOW + highBin ? 255 : 0)
    expect(sampleSpectralPixel(draw(high), 0, pixelAt(centerOf(0, 5), 8, highHz))).toBeGreaterThan(250)
    // 低频段同一频率不受高频段影响。
    expect(sampleSpectralPixel(draw(high), 0, pixelAt(centerOf(0, 5), 8, lowHz))).toBeLessThan(1)
    // 放大到长窗占屏幕比例很大时，低频也改读短窗（时间更准）。
    expect(sampleSpectralPixel(draw(source, { lowWeight: 0 }), 0, pixelAt(centerOf(0, 5), 8, lowHz))).toBeLessThan(1)
  })

  it('长窗占可见时长越大，低频段权重越低', () => {
    expect(spectralLowBandWeight({ startFrame: 0, endFrame: 8192 * 100, width: 1000 })).toBe(1)
    expect(spectralLowBandWeight({ startFrame: 0, endFrame: 8192 * 4, width: 1000 })).toBe(0)
    const middle = spectralLowBandWeight({ startFrame: 0, endFrame: 8192 * 8, width: 1000 })
    expect(middle).toBeGreaterThan(0); expect(middle).toBeLessThan(1)
  })

  it('块边界用相邻块插值，没有相邻块时夹在边界', () => {
    const left = tile(0, 0), right = tile(0, 1, () => 200)
    const between = pixelAt(centerOf(0, 1023) + 256, 2, highHz)
    expect(sampleSpectralPixel(draw(left, { next: right }), 0, between)).toBeCloseTo(100, 0)
    expect(sampleSpectralPixel(draw(left), 0, between)).toBeLessThan(1)
  })

  it('一像素跨多列时用峰值保住单列瞬态', () => {
    const source = tile(0, 0, (column, bin) => column === 41 && bin === LOW + highBin ? 255 : 0)
    // 像素跨第 40..43 列（4 列）。
    const value = sampleSpectralPixel(draw(source), 0, { startFrame: spectralOrigin(0) + 40 * 512, endFrame: spectralOrigin(0) + 44 * 512, lowHz: highHz - 1, highHz: highHz + 1, centerHz: highHz })
    expect(value).toBeGreaterThan(255 * 0.65 - 1)
  })

  it('CPU 回退：文件之外画最暗色，块内按同一规则上色', () => {
    const tiles = storeOf(tile(0, 0, () => 255, { duration: 512 * 1024 }))
    const outside = rasterizeSpectralTiles(tiles, { channel: 0, startFrame: 512 * 2000, endFrame: 512 * 2010, width: 4, height: 2, minHz: 0, maxHz: 24000, scale: 'linear' }, lut)
    expect(Math.max(...outside.filter((_, index) => index % 4 !== 3))).toBe(0)
    const inside = rasterizeSpectralTiles(tiles, { channel: 0, startFrame: 0, endFrame: 512 * 10, width: 10, height: 4, minHz: 0, maxHz: 24000, scale: 'linear' }, lut)
    expect(inside[0]).toBeGreaterThan(250)
  })
})

describe('频谱块存储', () => {
  it('超出容量淘汰最久未用的块，正在需要的块不淘汰', () => {
    const one = tile(0, 0), bytes = one.values.byteLength
    const store = new SpectralTileStore(bytes * 2)
    store.set(one); store.set(tile(0, 1))
    store.pin(['0|0'])
    store.set(tile(0, 2))
    expect(store.has(0, 0)).toBe(true)
    expect(store.has(0, 1)).toBe(false)
    expect(store.has(0, 2)).toBe(true)
    expect(store.version).toBe(3)
  })
})
