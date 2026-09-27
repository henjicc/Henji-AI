// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AudioPlayer from './AudioPlayer'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useAudioWaveform', () => ({ useAudioWaveform: () => ({ waveform: null, waveDuration: undefined }) }))
vi.mock('@/utils/save', () => ({ downloadAudioFile: vi.fn(), saveAudioFromUrl: vi.fn() }))
vi.mock('@/components/ui', () => ({
  UI_PANEL_SURFACE_CLASS: '',
  UiIconButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.createElement('button', props),
  UiRangeInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', props),
}))
beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('重新挂载恢复暂停位置和音量，切换媒体仍从头开始', () => {
  const view = render(<AudioPlayer src="media:a" initialPlaybackState={{ currentTime: 23, volume: 0.35 }} />)
  const audio = view.container.querySelector('audio')!
  Object.defineProperty(audio, 'duration', { value: 120, configurable: true })
  fireEvent.loadedMetadata(audio)
  expect(audio.currentTime).toBe(23)
  expect(audio.volume).toBe(0.35)
  expect(view.getByText('0:23')).toBeTruthy()
  view.rerender(<AudioPlayer src="media:b" initialPlaybackState={{ currentTime: 23, volume: 0.35 }} />)
  expect(audio.currentTime).toBe(0)
  view.rerender(<AudioPlayer src="media:a" initialPlaybackState={{ currentTime: 23, volume: 0.35 }} />)
  fireEvent.loadedMetadata(audio)
  expect(audio.currentTime).toBe(0)
  expect(audio.play).not.toHaveBeenCalled()
})

it('离开视口后继续播放但停止逐帧绘制，返回后恢复最新播放位置', async () => {
  let intersect: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof intersect) { intersect = callback }
    observe() {} disconnect() {}
  })
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const activity = vi.fn()
  const view = render(<AudioPlayer src="media:a" onActivityChange={activity} />)
  const audio = view.container.querySelector('audio')!
  await act(async () => fireEvent.click(view.getByTitle('ui:audioPlayer.playPause')))
  expect(activity).toHaveBeenLastCalledWith(true)
  expect(frames.size).toBe(1)
  vi.mocked(audio.pause).mockClear()
  act(() => intersect?.([{ isIntersecting: false }]))
  expect(frames.size).toBe(0)
  audio.currentTime = 17
  fireEvent.timeUpdate(audio)
  expect(view.queryByText('0:17')).toBeNull()
  expect(audio.pause).not.toHaveBeenCalled()
  act(() => intersect?.([{ isIntersecting: true }]))
  expect(view.getByText('0:17')).toBeTruthy()
  expect(frames.size).toBe(1)
})

it('未提供恢复状态的现有消费者仍从零开始、默认音量不变', () => {
  const view = render(<AudioPlayer src="media:a" />)
  const audio = view.container.querySelector('audio')!
  expect(audio.currentTime).toBe(0)
  expect(audio.volume).toBe(1)
  expect(audio.play).not.toHaveBeenCalled()
})
