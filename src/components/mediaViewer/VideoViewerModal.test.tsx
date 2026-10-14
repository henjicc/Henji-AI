// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
vi.mock('@/commands/video', () => ({ readVideoInfo: async () => ({ hasAudio: true }) }))
vi.mock('./VideoViewerControls', () => ({ VideoViewerControls: (props: ComponentProps<typeof import('./VideoViewerControls').VideoViewerControls>) => (
  <div data-testid="controls" data-volume={props.volume} data-muted={props.muted} data-speed={props.playbackRate} data-loop={props.loop} data-time={props.currentTime} data-duration={props.videoDuration} data-playing={props.isVideoPlaying}>
    <span onClick={() => { props.updateVolume(0.3); props.setPlaybackRate(2); props.setLoop(true); props.setMuted(true) }}>change settings</span>
    <span onClick={props.togglePlay}>toggle playback</span>
  </div>
) }))
import { VideoViewerModal } from './VideoViewerModal'
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

const timeline = { duration: 12, segments: [
  { videoUrl: 'first.mp4', start: 0, end: 5, sourceStart: 0 },
  { videoUrl: 'second.mp4', start: 6, end: 12, sourceStart: 0 },
] }
it('内嵌完整时间线不注册模态，播放跨过首片与空档，第二片结束才停止', async () => {
  render(<VideoViewerModal open presentation="inline" videoUrl="first.mp4" timeline={timeline} onClose={vi.fn()} />)
  await act(async () => {})
  expect(document.querySelector('.z-viewer')).toBeNull()
  expect(document.body.style.overflow).not.toBe('hidden')
  const video = document.querySelector('video')!
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true })
  fireEvent.loadedMetadata(video)
  fireEvent.click(screen.getByText('toggle playback'))
  fireEvent.ended(video)
  expect(screen.getByTestId('controls').dataset).toMatchObject({ duration: '12', time: '5', playing: 'true' })
  expect(video.classList.contains('invisible')).toBe(true)
  act(() => vi.advanceTimersByTime(1200))
  expect(video.getAttribute('src')).toBe('second.mp4')
  fireEvent.loadedMetadata(video)
  expect(video.currentTime).toBe(0)
  expect(video.controls).toBe(false)
  fireEvent.ended(video)
  expect(screen.getByTestId('controls').dataset).toMatchObject({ duration: '12', time: '12', playing: 'false' })
})
it('标记定位跨片并保留同一全局时间；重复标记请求仍可再次定位', async () => {
  const props = { open: true, presentation: 'inline' as const, videoUrl: 'first.mp4', timeline, onClose: vi.fn() }
  const { rerender } = render(<VideoViewerModal {...props} />)
  await act(async () => {})
  const video = document.querySelector('video')!
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true })
  rerender(<VideoViewerModal {...props} seekRequest={{ seconds: 9.7, request: 1 }} />)
  expect(video.getAttribute('src')).toBe('second.mp4')
  fireEvent.loadedMetadata(video)
  expect(video.currentTime).toBeCloseTo(3.7)
  expect(screen.getByTestId('controls').dataset.time).toBe('9.7')
  video.currentTime = 1
  rerender(<VideoViewerModal {...props} seekRequest={{ seconds: 9.7, request: 2 }} />)
  expect(video.currentTime).toBeCloseTo(3.7)
  expect(screen.getByTestId('controls').dataset.playing).toBe('false')
})
it('同一文件中的暂停空档恢复到真实源时间，切轨和关闭停止旧播放', async () => {
  const split = { duration: 12, segments: [
    { videoUrl: 'first.mp4', start: 0, end: 5, sourceStart: 0 },
    { videoUrl: 'first.mp4', start: 6, end: 12, sourceStart: 6 },
  ] }
  const props = { open: true, presentation: 'inline' as const, videoUrl: 'first.mp4', onClose: vi.fn() }
  const { rerender } = render(<VideoViewerModal {...props} timeline={split} />)
  await act(async () => {})
  const video = document.querySelector('video')!
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true })
  fireEvent.loadedMetadata(video)
  fireEvent.click(screen.getByText('toggle playback'))
  fireEvent.ended(video)
  act(() => vi.advanceTimersByTime(1200))
  expect(video.currentTime).toBe(6)
  rerender(<VideoViewerModal {...props} timeline={timeline} />)
  expect(screen.getByTestId('controls').dataset.playing).toBe('false')
  fireEvent.click(screen.getByText('toggle playback'))
  rerender(<VideoViewerModal {...props} timeline={timeline} open={false} />)
  expect(document.querySelector('video')).toBeNull()
  const calls = vi.mocked(HTMLMediaElement.prototype.play).mock.calls.length
  act(() => vi.advanceTimersByTime(15000))
  expect(vi.mocked(HTMLMediaElement.prototype.play).mock.calls).toHaveLength(calls)
})
it('切轨后旧片的异步播放拒绝不能停止新轨播放', async () => {
  let rejectPrevious: (error: Error) => void = () => { throw new Error('旧播放尚未启动') }
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectPrevious = reject }))
  const props = { open: true, presentation: 'inline' as const, videoUrl: 'first.mp4', onClose: vi.fn() }
  const { rerender } = render(<VideoViewerModal {...props} timeline={timeline} />)
  await act(async () => {})
  const video = document.querySelector('video')!
  Object.defineProperty(video, 'readyState', { value: 4, configurable: true })
  fireEvent.loadedMetadata(video)
  fireEvent.click(screen.getByText('toggle playback'))
  rerender(<VideoViewerModal {...props} timeline={{ ...timeline, segments: [...timeline.segments] }} />)
  fireEvent.loadedMetadata(video)
  fireEvent.click(screen.getByText('toggle playback'))
  await act(async () => { rejectPrevious(new DOMException('source changed', 'AbortError')) })
  expect(screen.getByTestId('controls').dataset.playing).toBe('true')
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('打开期间切换视频源仍重新进场，播放器状态重置与画面同步', async () => {
  const props = { open: true, videoUrl: 'first.mp4', onClose: vi.fn() }
  const { rerender } = render(<VideoViewerModal {...props} />)
  await act(async () => {})
  act(() => vi.advanceTimersByTime(32))
  const root = document.querySelector('.z-viewer') as HTMLElement
  expect(root.style.opacity).toBe('1')
  rerender(<VideoViewerModal {...props} videoUrl="second.mp4" />)
  expect(root.style.opacity).toBe('0')
  act(() => vi.advanceTimersByTime(32))
  expect(root.style.opacity).toBe('1')
})
it.each(['same.mp4', 'another.mp4'])('常驻查看器重开 %s 只保留音量，控件与元素一致', async videoUrl => {
  const props = { open: true, videoUrl: 'same.mp4', onClose: vi.fn() }
  const { rerender } = render(<VideoViewerModal {...props} />)
  await act(async () => {})
  fireEvent.click(screen.getByText('change settings'))
  expect(document.querySelector('video')?.volume).toBe(0.3)
  rerender(<VideoViewerModal {...props} open={false} />)
  act(() => vi.advanceTimersByTime(500))
  expect(document.querySelector('video')).toBeNull()
  rerender(<VideoViewerModal {...props} videoUrl={videoUrl} />)
  await act(async () => {})
  const video = document.querySelector('video')!
  fireEvent.loadedMetadata(video)
  expect(video.volume).toBe(0.3)
  expect(video.muted).toBe(false)
  expect(video.playbackRate).toBe(1)
  expect(video.loop).toBe(false)
  expect(screen.getByTestId('controls').dataset).toMatchObject({ volume: '0.3', muted: 'false', speed: '1', loop: 'false' })
})
