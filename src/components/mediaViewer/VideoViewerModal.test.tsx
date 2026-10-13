// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
vi.mock('@/commands/video', () => ({ readVideoInfo: async () => ({ hasAudio: true }) }))
vi.mock('./VideoViewerControls', () => ({ VideoViewerControls: (props: ComponentProps<typeof import('./VideoViewerControls').VideoViewerControls>) => (
  <div data-testid="controls" data-volume={props.volume} data-muted={props.muted} data-speed={props.playbackRate} data-loop={props.loop}>
    <span onClick={() => { props.updateVolume(0.3); props.setPlaybackRate(2); props.setLoop(true); props.setMuted(true) }}>change settings</span>
  </div>
) }))
import { VideoViewerModal } from './VideoViewerModal'
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
  vi.useFakeTimers()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
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
