// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AudioPlayer from './AudioPlayer'
import { useWaveformData } from '@/hooks/useWaveformData'

vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useWaveformData', () => ({ useWaveformData: vi.fn(() => ({ status: 'idle' })) }))
vi.mock('@/components/waveform/WaveformView', () => ({ WaveformView: () => null }))
vi.mock('@/utils/save', () => ({ downloadAudioFile: vi.fn(), saveAudioFromUrl: vi.fn() }))
vi.mock('@/components/ui', () => ({
  UI_PANEL_SURFACE_CLASS: '',
  UI_TEXT_TIMECODE_CLASS: '',
  UiIconButton: ({ size: _size, tone: _tone, on: _on, shape: _shape, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { size?: string; tone?: string; on?: boolean; shape?: string }) => React.createElement('button', props),
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

it('宿主受控模式只发送播放、定位和音量命令，无第二媒体元素、全音频分析或乐观播放状态', async () => {
  const onTogglePlay = vi.fn(); const onSeek = vi.fn(); const onVolume = vi.fn()
  const controlled = { currentTime: 12, duration: 120, playing: false, volume: 0.4, onTogglePlay, onSeek, onVolume }
  const view = render(<AudioPlayer src="media:source" filePath="D:/source.wav" compact controlledPlayback={controlled} />)
  expect(view.container.querySelector('audio')).toBeNull()
  expect(useWaveformData).toHaveBeenLastCalledWith(null)
  expect(view.getByText('0:12')).toBeTruthy(); expect(view.getByText('2:00')).toBeTruthy()
  await act(async () => fireEvent.click(view.getByTitle('ui:audioPlayer.playPause')))
  expect(onTogglePlay).toHaveBeenCalledTimes(1); expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  fireEvent.change(view.getByLabelText('音频播放位置'), { target: { value: '31.5' } })
  expect(onSeek).toHaveBeenLastCalledWith(31.5)
  expect(view.getByText('0:12')).toBeTruthy()
  fireEvent.click(view.getByTitle('ui:audioPlayer.volume'))
  const volume = view.container.querySelector('input[max="1"]')!
  fireEvent.change(volume, { target: { value: '0.65' } })
  expect(onVolume).toHaveBeenLastCalledWith(0.65)
  expect((volume as HTMLInputElement).value).toBe('0.4')
  view.rerender(<AudioPlayer src="media:source" compact controlledPlayback={{ ...controlled, currentTime: 31.5, playing: true, volume: 0.65 }} />)
  expect(view.getByText('0:31')).toBeTruthy(); expect(view.container.querySelector('audio')).toBeNull()
})

it('宿主尚未确认或面板隐藏时，受控控件不发出新播放命令', () => {
  const onTogglePlay = vi.fn()
  const controlled = { currentTime: 0, duration: 3, playing: false, volume: 1, disabled: true, onTogglePlay, onSeek: vi.fn(), onVolume: vi.fn() }
  const view = render(<AudioPlayer src="media:source" controlledPlayback={controlled} />)
  fireEvent.keyDown(view.container.firstChild!, { key: ' ' })
  fireEvent.click(view.getByTitle('ui:audioPlayer.playPause'))
  expect(onTogglePlay).not.toHaveBeenCalled()
  view.rerender(<AudioPlayer src="media:source" active={false} controlledPlayback={{ ...controlled, disabled: false }} />)
  fireEvent.keyDown(view.container.firstChild!, { key: ' ' })
  expect(onTogglePlay).not.toHaveBeenCalled()
})

it('列表行内排布：一行内播放、时间读数与音量，复用同一媒体元素与恢复状态，不重复提供下载', () => {
  const view = render(<AudioPlayer layout="inline" surface="plain" src="media:a" initialPlaybackState={{ currentTime: 12, volume: 0.5 }} />)
  const audio = view.container.querySelector('audio')!
  Object.defineProperty(audio, 'duration', { value: 30, configurable: true })
  fireEvent.loadedMetadata(audio)
  expect(audio.currentTime).toBe(12)
  expect(view.getByText('0:12 / 0:30')).toBeTruthy()
  expect(view.getByTitle('ui:audioPlayer.playPause')).toBeTruthy()
  expect(view.getByTitle('ui:audioPlayer.volume')).toBeTruthy()
  expect(view.queryByTitle('common:actions.download')).toBeNull()
})
