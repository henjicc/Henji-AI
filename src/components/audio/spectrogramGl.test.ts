import { expect, it, vi } from 'vitest'
import { createSpectrogramGl, SPECTRAL_GPU_SLOTS } from './spectrogramGl'
import { buildSpectrogramLut } from '@/core/audio/spectrogram'
import { SpectralTileStore } from '@/core/audio/spectralTiles'
import { SPECTRAL_HIGH_BINS, SPECTRAL_TILE_COLUMNS, spectralLowBins, type AudioEditSpectralTile } from '@/core/audioEdit/spectralPyramid'
import { SPECTROGRAM_COLORMAP_HEX } from '@/core/theme/colorTokens'

const SR = 48000, LOW = spectralLowBins(SR), BINS = LOW + SPECTRAL_HIGH_BINS
const tile = (level: number, index: number): AudioEditSpectralTile => ({ mode: 'source', revision: 0, level, tile: index, sampleRate: SR, channels: 2, durationFrames: SR * 600,
  lowBins: LOW, highBins: SPECTRAL_HIGH_BINS, columnStart: index * SPECTRAL_TILE_COLUMNS, columnCount: SPECTRAL_TILE_COLUMNS, complete: true, values: new Uint8Array(2 * SPECTRAL_TILE_COLUMNS * BINS * 2) })

it('连续平移缩放只改 uniform 与剪裁，块只在第一次用到或被替换时上传', () => {
  const calls = new Map<string, ReturnType<typeof vi.fn>>()
  const gl = new Proxy({}, { get(_target, property) {
    const name = String(property)
    if (name.toUpperCase() === name) return name
    if (!calls.has(name)) calls.set(name, vi.fn((..._args: unknown[]): unknown => {
      if (name === 'getError') return 'NO_ERROR'
      if (name === 'getShaderParameter' || name === 'getProgramParameter') return true
      if (name.startsWith('create') || name === 'getUniformLocation') return {}
      return undefined
    }))
    return calls.get(name)
  } }) as WebGL2RenderingContext
  const renderer = createSpectrogramGl(gl, buildSpectrogramLut(SPECTROGRAM_COLORMAP_HEX))
  const store = new SpectralTileStore()
  for (let index = 0; index < 4; index++) store.set(tile(0, index))
  // 每像素约 512 帧：目标层 0，屏幕跨 2–3 块。
  for (let frame = 0; frame < 120; frame++) {
    for (let channel = 0; channel < 2; channel++) renderer.draw(store, { channel, startFrame: frame * 512, endFrame: (frame + 2000) * 512, width: 2000, height: 300, minHz: 20, maxHz: 24000, scale: 'log' }, channel * 300)
  }
  expect(calls.get('texStorage3D')).toHaveBeenCalledOnce()
  expect(calls.get('texStorage3D')!.mock.calls[0]).toContain(SPECTRAL_GPU_SLOTS)
  const uploads = calls.get('texSubImage3D')!.mock.calls.length
  expect(uploads).toBeLessThanOrEqual(4 * 2)
  const draws = calls.get('drawArrays')!.mock.calls.length
  expect(draws).toBeGreaterThanOrEqual(240)
  expect(draws).toBeLessThanOrEqual(240 * 3)
  store.set({ ...tile(0, 0) })
  renderer.draw(store, { channel: 0, startFrame: 0, endFrame: 2000 * 512, width: 2000, height: 300, minHz: 20, maxHz: 24000, scale: 'log' }, 0)
  expect(calls.get('texSubImage3D')!.mock.calls.length).toBe(uploads + 1)
  renderer.dispose()
  expect(calls.get('deleteTexture')).toHaveBeenCalledTimes(2)
})
