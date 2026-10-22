import { z } from 'zod'

/**
 * 频谱金字塔：渲染层与主进程、音频处理程序共用的唯一契约。
 *
 * 每列同时含两段频率（多分辨率，参照 iZotope RX）：
 * - 低频段：8192 点 Hann 窗，只保留 0 .. lowBins-1 频点（约 1.2 kHz 以下），频率真分辨率约 6 Hz；
 * - 高频段：2048 点 Hann 窗，0 .. 1024 全部频点，时间分辨率约 43 ms。
 * 两段都按窗相干增益校正为单边幅度 dBFS，量化 u8 = round(clamp((dB + 120) / 120, 0, 1) * 255)，与旧 HJSP 相同。
 * 两窗中心对齐在同一采样帧；文件外采样按 0 处理，块边界以整个文件为上下文，不得当作文件边界补零。
 *
 * 层级 level（整数）：hop = 512 * 2^level，level 取 MIN_LEVEL..MAX_LEVEL。
 * - level < 0（hop 16..256）：每列一次 STFT，不汇总；按需计算。
 * - level 0（hop 512）：基础层，每列一次 STFT；按需计算。
 * - level > 0：由基础层每 2^level 列汇总：R = 峰值 dB 取最大，G = 能量（功率）按基础列数加权平均后的 dB；
 *   基础层与 level < 0 的列 R = G。level >= PERSISTED_MIN_LEVEL 在整文件后台一遍算完并落盘（只做一次 FFT 遍历），
 *   更低层按块即时计算并进磁盘块缓存。
 *
 * 列的时间归属（统一公式）：第 c 列拥有源采样帧 [origin + c * hop, origin + (c + 1) * hop)，
 * 列中心在 origin + (c + 0.5) * hop。level >= 0 时 origin = -256（基础列 i 以 i * 512 为中心，汇总列正好覆盖其基础列）；
 * level < 0 时 origin = -hop / 2（第 c 列以 c * hop 为中心）。
 */
export const SPECTRAL_SHORT_WINDOW = 2048
export const SPECTRAL_LONG_WINDOW = 8192
export const SPECTRAL_HIGH_BINS = SPECTRAL_SHORT_WINDOW / 2 + 1
/** 低频段上限；两段在 CROSSOVER 区间内由显示端混合。 */
export const SPECTRAL_LOW_BAND_MAX_HZ = 1200
export const SPECTRAL_CROSSOVER_START_HZ = 700
export const SPECTRAL_CROSSOVER_END_HZ = 1100
export const SPECTRAL_BASE_HOP = 512
export const SPECTRAL_MIN_LEVEL = -5
export const SPECTRAL_MAX_LEVEL = 15
export const SPECTRAL_PERSISTED_MIN_LEVEL = 3
export const SPECTRAL_TILE_COLUMNS = 1024

export function spectralLowBins(sampleRate: number): number {
  return Math.floor(SPECTRAL_LOW_BAND_MAX_HZ * SPECTRAL_LONG_WINDOW / sampleRate) + 1
}
export function spectralBinsPerColumn(sampleRate: number): number {
  return spectralLowBins(sampleRate) + SPECTRAL_HIGH_BINS
}
export function spectralHop(level: number): number {
  return SPECTRAL_BASE_HOP * 2 ** level
}
export function spectralOrigin(level: number): number {
  return level >= 0 ? -SPECTRAL_BASE_HOP / 2 : -spectralHop(level) / 2
}
/** 覆盖 [0, durationFrames) 所需的列数。 */
export function spectralColumnCount(level: number, durationFrames: number): number {
  if (durationFrames <= 0) return 0
  if (level >= 0) {
    const base = Math.floor((durationFrames - 1 + SPECTRAL_BASE_HOP / 2) / SPECTRAL_BASE_HOP) + 1
    return Math.ceil(base / 2 ** level)
  }
  const hop = spectralHop(level)
  return Math.floor((durationFrames - 1 + hop / 2) / hop) + 1
}
export function spectralTileCount(level: number, durationFrames: number): number {
  return Math.ceil(spectralColumnCount(level, durationFrames) / SPECTRAL_TILE_COLUMNS)
}
/** 每屏像素对应多少源采样帧时该用哪一层：取 hop 不超过一个像素的最粗层，放大到底就是最细层。 */
export function spectralLevelForFramesPerPixel(framesPerPixel: number): number {
  const level = Math.floor(Math.log2(Math.max(1, framesPerPixel) / SPECTRAL_BASE_HOP))
  return Math.max(SPECTRAL_MIN_LEVEL, Math.min(SPECTRAL_MAX_LEVEL, level))
}

export const audioEditSpectralTileRequestSchema = z.object({
  projectId: z.string().min(1),
  mode: z.enum(['source', 'edited']),
  level: z.number().int().min(SPECTRAL_MIN_LEVEL).max(SPECTRAL_MAX_LEVEL),
  tile: z.number().int().nonnegative(),
  /** 用于取消；同一 requestId 只对应一次请求。 */
  requestId: z.string().min(1).max(200),
}).strict()
export type AudioEditSpectralTileRequest = z.infer<typeof audioEditSpectralTileRequestSchema>

export interface AudioEditSpectralTile {
  mode: 'source' | 'edited'
  /** 生成该块所用的作品版本（source 模式恒为 0）；渲染层据此丢弃过期结果。 */
  revision: number
  level: number; tile: number
  sampleRate: number; channels: number; durationFrames: number
  lowBins: number; highBins: number
  /** 本块第一列的全局列号（= tile * SPECTRAL_TILE_COLUMNS）与实际列数。 */
  columnStart: number; columnCount: number
  /** 落盘层在后台整文件计算完成前可能只返回已算好的前若干列（可能为 0），此时为 false，进度事件到来后再取。 */
  complete: boolean
  /**
   * 布局：[channel][column][bin][R, G]，bin 先低频段 lowBins 个（8192 窗），再高频段 highBins 个（2048 窗），
   * 每段内频率升序。长度 = channels * columnCount * (lowBins + highBins) * 2。
   */
  values: Uint8Array
}

/** 主进程广播：后台整文件计算的进度，渲染层据此重取 complete = false 的块。 */
export interface AudioEditSpectralProgress {
  projectId: string; mode: 'source' | 'edited'; revision: number
  /** 已算到的源采样帧（落盘层第 c 列在 origin + (c + 1) * hop <= coveredFrames 时已完整）。 */
  coveredFrames: number; durationFrames: number; done: boolean
}
