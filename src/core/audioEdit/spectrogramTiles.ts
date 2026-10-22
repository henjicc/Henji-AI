import type { AudioEditSpectrogramChunk } from './regions'

export const SPECTROGRAM_WINDOW_SIZE = 2048
export const SPECTROGRAM_FFT_SIZE = SPECTROGRAM_WINDOW_SIZE * 4
export const SPECTROGRAM_MAX_BYTES = 8 * 1024 * 1024
export const SPECTROGRAM_TILE_COLUMNS = 1024
export interface SpectrogramTile { index: number; startFrame: number; endFrame: number }

/** 普通双声道每块 1024 列；高声道数仍保证单块不超过 IPC 的数据预算。 */
export function spectrogramTileColumns(channels: number, fftSize: number): number {
  return Math.max(1, Math.min(SPECTROGRAM_TILE_COLUMNS, Math.floor(SPECTROGRAM_MAX_BYTES / channels / (fftSize / 2 + 1))))
}
export function planSpectrogramTiles(start: number, end: number, duration: number, hop: number, columns = SPECTROGRAM_TILE_COLUMNS): SpectrogramTile[] {
  const span = hop * columns
  const tiles: SpectrogramTile[] = []
  for (let index = Math.floor(Math.max(0, start) / span); index * span < Math.min(end, duration); index++) {
    tiles.push({ index, startFrame: index * span, endFrame: Math.min(duration, (index + 1) * span) })
  }
  return tiles
}
export function spectrogramOverviewHop(duration: number): number {
  return Math.min(1 << 24, Math.max(128, 2 ** Math.ceil(Math.log2(Math.max(1, duration / SPECTROGRAM_TILE_COLUMNS)))))
}
export function joinSpectrogramChunks(chunks: readonly AudioEditSpectrogramChunk[]): AudioEditSpectrogramChunk {
  const first = chunks[0]
  if (!first) throw new Error('频谱数据为空')
  if (chunks.length === 1) return first
  const timeBins = chunks.reduce((total, chunk) => total + chunk.timeBins, 0)
  const values = new Uint8Array(first.channels * timeBins * first.frequencyBins)
  let offset = 0
  for (const chunk of chunks) {
    if (chunk.hop !== first.hop || chunk.fftSize !== first.fftSize || chunk.sampleRate !== first.sampleRate || chunk.channels !== first.channels || chunk.frequencyBins !== first.frequencyBins || chunk.startFrame !== first.startFrame + offset * first.hop) throw new Error('频谱块不连续或格式不一致')
    for (let channel = 0; channel < first.channels; channel++) {
      const size = chunk.timeBins * chunk.frequencyBins
      values.set(chunk.values.subarray(channel * size, (channel + 1) * size), channel * timeBins * first.frequencyBins + offset * first.frequencyBins)
    }
    offset += chunk.timeBins
  }
  return { ...first, endFrame: chunks[chunks.length - 1].endFrame, timeBins, values }
}

/** 按字节限额淘汰最久未使用的块，避免长素材平移后一直占用内存。 */
export class SpectrogramTileLru {
  private readonly entries = new Map<string, AudioEditSpectrogramChunk>()
  private bytes = 0
  constructor(private readonly maxBytes = 32 * 1024 * 1024) {}
  get(key: string): AudioEditSpectrogramChunk | undefined {
    const value = this.entries.get(key)
    if (value) { this.entries.delete(key); this.entries.set(key, value) }
    return value
  }
  set(key: string, value: AudioEditSpectrogramChunk): void {
    const previous = this.entries.get(key)
    if (previous) { this.entries.delete(key); this.bytes -= previous.values.byteLength }
    if (value.values.byteLength > this.maxBytes) return
    this.entries.set(key, value); this.bytes += value.values.byteLength
    while (this.bytes > this.maxBytes) {
      const oldest = this.entries.entries().next().value
      if (!oldest) break
      this.entries.delete(oldest[0]); this.bytes -= oldest[1].values.byteLength
    }
  }
}
