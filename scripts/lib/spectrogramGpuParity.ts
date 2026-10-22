import { createSpectrogramGl } from '../../src/components/audio/spectrogramGl'
import { rasterizeSpectrogram, type SpectrogramRasterRequest } from '../../src/core/audio/spectrogram'

/** 仅由 Reality 在真实 Electron 内执行，比较实际 GLSL 输出与 CPU 回退。 */
export function verifySpectrogramGpuParity(): { cases: number; maxError: number } {
  const canvas = document.createElement('canvas')
  canvas.width = 73; canvas.height = 47
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true })
  if (!gl) throw new Error('频谱一致性验证需要 WebGL2')
  const lut = new Uint8ClampedArray(1024)
  for (let v = 0; v < 256; v++) { lut.fill(v, v * 4, v * 4 + 3); lut[v * 4 + 3] = 255 }
  const renderer = createSpectrogramGl(gl, lut)
  const data = { sampleRate: 48000, fftSize: 512, hop: 16, startFrame: -8, frameCount: 1031, binCount: 257, channelCount: 2, values: new Uint8Array(1031 * 257 * 2) }
  for (let c = 0; c < 2; c++) for (let t = 0; t < data.frameCount; t++) for (let b = 0; b < data.binCount; b++) {
    data.values[(c * data.frameCount + t) * data.binCount + b] = 40 + (t * 37 + b * 19 + c * 83) % 200
  }
  data.values[777 * data.binCount + 3] = 255
  renderer.upload(data)
  let cases = 0, maxError = 0
  try {
    for (const channel of [0, 1]) for (const scale of ['linear', 'log'] as const) for (const [startFrame, endFrame, minHz, maxHz] of [
      [16, 48, 100, 300], [0, 16496, 20, 500], [15.3, 500.7, 0, 24000], [-32, 40, 20, 24000], [16480, 16600, 20, 24000],
    ]) {
      const request: SpectrogramRasterRequest = { channel, scale, startFrame, endFrame, minHz, maxHz, width: canvas.width, height: canvas.height, boost: 3 }
      const cpu = rasterizeSpectrogram(data, request, lut)
      renderer.draw(request, 0)
      const gpu = new Uint8Array(cpu.length)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, gpu)
      if (gl.getError() !== gl.NO_ERROR) throw new Error('频谱一致性验证遇到 GL 错误')
      let mismatch = 0, first = ''
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const a = cpu[(y * canvas.width + x) * 4], b = gpu[((canvas.height - y - 1) * canvas.width + x) * 4]
        const error = Math.abs(a - b)
        maxError = Math.max(maxError, error)
        if (error > 1) { mismatch++; if (!first) first = `${x},${y}: CPU=${a},GPU=${b}` }
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
