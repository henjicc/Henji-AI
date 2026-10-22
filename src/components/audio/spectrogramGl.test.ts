import { expect, it, vi } from 'vitest'
import { createSpectrogramGl } from './spectrogramGl'
import { buildSpectrogramLut } from '@/core/audio/spectrogram'
import { SPECTROGRAM_COLORMAP_HEX } from '@/core/theme/colorTokens'

it('连续平移缩放只提交 uniform/viewport/draw，纹理只随数据身份上传', () => {
  const calls = new Map<string, ReturnType<typeof vi.fn>>()
  const gl = new Proxy({}, { get(_target, property) {
    const name = String(property)
    if (name.toUpperCase() === name) return name
    if (!calls.has(name)) calls.set(name, vi.fn((...args: unknown[]): unknown => {
      if (name === 'getParameter') return args[0] === 'MAX_TEXTURE_SIZE' ? 4096 : 256
      if (name === 'getError') return 'NO_ERROR'
      if (name === 'getShaderParameter' || name === 'getProgramParameter') return true
      if (name.startsWith('create') || name === 'getUniformLocation') return {}
      return undefined
    }))
    return calls.get(name)
  } }) as WebGL2RenderingContext
  const renderer = createSpectrogramGl(gl, buildSpectrogramLut(SPECTROGRAM_COLORMAP_HEX))
  const data = { sampleRate: 48000, fftSize: 2048, hop: 128, startFrame: 0, frameCount: 2400, binCount: 1025, channelCount: 2, values: new Uint8Array(2400 * 1025 * 2) }
  renderer.upload(data)
  const uploaded = calls.get('texImage3D')!.mock.calls.length
  // Node 不代表 GPU 实际帧耗时；此断言固定 2400×330×双声道的 CPU 热路径工作量。
  // 真机可在相同循环外用 performance.now() 取差；禁止每帧 readPixels/finish 干扰异步提交。
  for (let frame = 0; frame < 120; frame++) {
    renderer.upload(data)
    for (let channel = 0; channel < 2; channel++) renderer.draw({ channel, startFrame: frame * 128, endFrame: (frame + 2400) * 128, width: 2400, height: 330, minHz: 20, maxHz: 24000, scale: 'log' }, channel * 330)
  }
  expect(calls.get('texImage3D')).toHaveBeenCalledTimes(uploaded)
  expect(calls.get('drawArrays')).toHaveBeenCalledTimes(240)
  expect(calls.get('viewport')).toHaveBeenCalledTimes(240)
  expect(calls.get('uniform4f')).toHaveBeenCalledTimes(480)
  renderer.upload({ ...data })
  expect(calls.get('texImage3D')).toHaveBeenCalledTimes(uploaded + 1)
  renderer.dispose()
  expect(calls.get('deleteTexture')).toHaveBeenCalledTimes(2)
})
