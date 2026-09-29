// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useAudioWaveform } from './useAudioWaveform'
vi.mock('@/platform/desktopApi', () => ({ nativeFetch: vi.fn(), readFile: vi.fn() }))
afterEach(() => { cleanup(); delete window.henjiNative; vi.unstubAllGlobals() })

it('首次等待真实采样，再挂载首帧命中波形和时长，切换音频不残留旧波形', async () => {
  const sample = { rms: [0, 0.2, 0.8], peak: [0, 0.4, 1], durationSeconds: 12 }
  let finish!: (value: typeof sample) => void
  const extractSamples = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
  window.henjiNative = { audio: { extractSamples } }
  const first = renderHook(({ src }) => useAudioWaveform(src, undefined, { width: 300 }), { initialProps: { src: 'first' } })
  expect(first.result.current.waveform).toBeNull()
  await act(async () => { finish(sample) })
  const expected = first.result.current
  expect(expected.waveform).toHaveLength(3)
  first.unmount()
  const frames: Array<ReturnType<typeof useAudioWaveform>> = []
  const next = renderHook(({ src }) => {
    const value = useAudioWaveform(src, undefined, { width: 300 }); frames.push(value); return value
  }, { initialProps: { src: 'first' } })
  expect(frames[0]).toEqual(expected)
  expect(extractSamples).toHaveBeenCalledTimes(1)
  next.rerender({ src: 'second' })
  expect(next.result.current.waveform).toBeNull()
  expect(next.result.current.waveDuration).toBeNull()
})

it('解码失败不生成伪造波形', async () => {
  window.henjiNative = { audio: { extractSamples: vi.fn().mockRejectedValue(new Error('bad audio')) } }
  const fetchMock = vi.fn().mockRejectedValue(new Error('bad audio'))
  vi.stubGlobal('fetch', fetchMock)
  const view = renderHook(() => useAudioWaveform('blob:broken', undefined, { width: 300 }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  expect(view.result.current.waveform).toBeNull()
})
