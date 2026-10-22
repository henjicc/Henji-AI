import { createSpectrogramGl } from '../../src/components/audio/spectrogramGl'
import { rasterizeSpectralTiles, SpectralTileStore, type SpectralRasterRequest } from '../../src/core/audio/spectralTiles'
import { SPECTRAL_HIGH_BINS, SPECTRAL_TILE_COLUMNS, spectralLowBins, type AudioEditSpectralTile } from '../../src/core/audioEdit/spectralPyramid'

/** 仅由 Reality 在真实 Electron 内执行，比较实际 GLSL 输出与 CPU 回退（同一批块、同一绘制规划）。 */
export function verifySpectrogramGpuParity(): { cases: number; maxError: number } {
  const canvas = document.createElement('canvas')
  canvas.width = 73; canvas.height = 47
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true })
  if (!gl) throw new Error('频谱一致性验证需要 WebGL2')
  const lut = new Uint8ClampedArray(1024)
  for (let v = 0; v < 256; v++) { lut.fill(v, v * 4, v * 4 + 3); lut[v * 4 + 3] = 255 }
  const renderer = createSpectrogramGl(gl, lut)
  const sampleRate = 48000, lowBins = spectralLowBins(sampleRate), bins = lowBins + SPECTRAL_HIGH_BINS
  const tile = (level: number, index: number, columnCount = SPECTRAL_TILE_COLUMNS): AudioEditSpectralTile => {
    const values = new Uint8Array(2 * columnCount * bins * 2)
    for (let c = 0; c < 2; c++) for (let t = 0; t < columnCount; t++) for (let b = 0; b < bins; b++) {
      const at = ((c * columnCount + t) * bins + b) * 2, column = index * SPECTRAL_TILE_COLUMNS + t
      values[at] = 60 + (column * 37 + b * 19 + c * 83 + level * 11) % 190
      values[at + 1] = Math.max(0, values[at] - (column + b) % 23)
    }
    return { mode: 'source', revision: 0, level, tile: index, sampleRate, channels: 2, durationFrames: sampleRate * 120, lowBins, highBins: SPECTRAL_HIGH_BINS,
      columnStart: index * SPECTRAL_TILE_COLUMNS, columnCount, complete: columnCount === SPECTRAL_TILE_COLUMNS, values }
  }
  const store = new SpectralTileStore()
  // 目标层 0 只有两块（第二块不完整），其余区间由层 4 垫底；另有更细的层 -1 一块。
  for (const value of [tile(4, 0), tile(0, 0), tile(0, 1, 600), tile(-1, 3)]) store.set(value)
  let cases = 0, maxError = 0
  try {
    for (const channel of [0, 1]) for (const scale of ['linear', 'log'] as const) for (const [startFrame, endFrame, minHz, maxHz] of [
      [0, 73 * 512, 20, 24000], [500_000, 500_000 + 73 * 512, 100, 3000], [512 * 1000, 512 * 1100, 20, 24000],
      [1_200_000, 1_200_000 + 73 * 4096, 0, 24000], [600 * 128, 600 * 128 + 73 * 64, 200, 1500], [-2048, 70 * 512, 20, 24000],
    ]) {
      const request: SpectralRasterRequest = { channel, scale, startFrame, endFrame, minHz, maxHz, width: canvas.width, height: canvas.height, boost: 3 }
      const cpu = rasterizeSpectralTiles(store, request, lut)
      renderer.draw(store, request, 0)
      const gpu = new Uint8Array(cpu.length)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, gpu)
      if (gl.getError() !== gl.NO_ERROR) throw new Error('频谱一致性验证遇到 GL 错误')
      let mismatch = 0, first = ''
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const a = cpu[(y * canvas.width + x) * 4], b = gpu[((canvas.height - y - 1) * canvas.width + x) * 4]
        const error = Math.abs(a - b)
        maxError = Math.max(maxError, error)
        // GPU 线性过滤只有 8 位小数精度，允许 2 级误差。
        if (error > 2) { mismatch++; if (!first) first = `${x},${y}: CPU=${a},GPU=${b}` }
      }
      if (mismatch) throw new Error(`频谱 CPU/GPU 不一致 ${JSON.stringify(request)}: ${mismatch} 像素，首处 ${first}`)
      cases++
    }
    return { cases, maxError }
  } finally {
    renderer.dispose()
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
