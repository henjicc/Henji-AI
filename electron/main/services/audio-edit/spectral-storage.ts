import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { spectralColumnCount, spectralLowBins, SPECTRAL_HIGH_BINS, SPECTRAL_MAX_LEVEL, SPECTRAL_TILE_COLUMNS, type AudioEditSpectralTile } from '../../../../src/core/audioEdit/spectralPyramid'

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const manifestSchema = z.object({
  format: z.literal('spectral-pyramid-v1'), sampleRate: integer.positive(), channels: integer.positive(),
  durationFrames: integer, lowBins: integer.positive(), highBins: z.literal(SPECTRAL_HIGH_BINS),
  available: z.array(integer).length(SPECTRAL_MAX_LEVEL + 1), coveredFrames: integer, done: z.boolean(),
}).strict()
export type SpectralManifest = z.infer<typeof manifestSchema>
export type SpectralMetadata = Pick<AudioEditSpectralTile, 'sampleRate' | 'channels' | 'durationFrames' | 'lowBins' | 'highBins'>

export async function readSpectralManifest(directory: string): Promise<SpectralManifest | undefined> {
  let bytes: string
  try { bytes = await fs.readFile(path.join(directory, 'manifest.json'), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  const value = manifestSchema.parse(JSON.parse(bytes))
  if (value.lowBins !== spectralLowBins(value.sampleRate) || value.coveredFrames > value.durationFrames) throw new Error('频谱缓存元数据无效')
  for (let level = 3; level <= SPECTRAL_MAX_LEVEL; level++) {
    const total = spectralColumnCount(level, value.durationFrames)
    if (value.available[level] > total || (value.done && value.available[level] !== total)) throw new Error('频谱缓存列数无效')
  }
  return value
}

/** 每层每声道的文件只追加；原子清单确定本次读快照的可读上限。 */
export async function readSpectralRange(directory: string, level: number, tile: number, expected: SpectralMetadata): Promise<Pick<AudioEditSpectralTile, 'values' | 'columnCount' | 'columnStart' | 'complete'>> {
  const manifest = await readSpectralManifest(directory)
  const columnStart = tile * SPECTRAL_TILE_COLUMNS
  const wanted = Math.min(SPECTRAL_TILE_COLUMNS, Math.max(0, spectralColumnCount(level, expected.durationFrames) - columnStart))
  if (!manifest) return { values: new Uint8Array(), columnStart, columnCount: 0, complete: wanted === 0 }
  for (const key of ['sampleRate', 'channels', 'durationFrames', 'lowBins', 'highBins'] as const) {
    if (manifest[key] !== expected[key]) throw new Error('频谱缓存与音频素材不匹配')
  }
  const columnCount = Math.min(wanted, Math.max(0, manifest.available[level] - columnStart))
  const rowBytes = (expected.lowBins + expected.highBins) * 2
  const planeBytes = columnCount * rowBytes
  const values = new Uint8Array(planeBytes * expected.channels)
  if (columnCount) await Promise.all(Array.from({ length: expected.channels }, async (_, channel) => {
    const file = await fs.open(path.join(directory, `level-${level}-channel-${channel}.rg`), 'r')
    try {
      let read = 0
      while (read < planeBytes) {
        const { bytesRead } = await file.read(values, channel * planeBytes + read, planeBytes - read, columnStart * rowBytes + read)
        if (!bytesRead) throw new Error('频谱缓存不完整')
        read += bytesRead
      }
    } finally { await file.close() }
  }))
  return { values, columnStart, columnCount, complete: columnCount === wanted }
}
