// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { acquireSystemAudio, openTrackDevice } from './devices'
import { RecordingTracksClock } from './clock'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('Chromium回环仅转移音轨，立即释放不需要的视频轨', async () => {
  const video = { stop: vi.fn() }; const audio = { stop: vi.fn() }
  const stream = { getVideoTracks: () => [video], getAudioTracks: () => [audio], removeTrack: vi.fn() }
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn(async () => stream) } })
  expect(await acquireSystemAudio()).toBe(stream)
  expect(video.stop).toHaveBeenCalledTimes(1); expect(stream.removeTrack).toHaveBeenCalledWith(video)
  expect(audio.stop).not.toHaveBeenCalled()
})
it('摄像头停机等待正在编码的帧并释放reader与流；迟到帧不再编码，帧始终关闭', async () => {
  const track = Object.assign(new EventTarget(), { stop: vi.fn(), muted: false })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => ({ getVideoTracks: () => [track], getTracks: () => [track] })) } })
  let read!: (value: { value?: VideoFrame; done: boolean }) => void
  const reader = { read: vi.fn(() => new Promise<{ value?: VideoFrame; done: boolean }>(resolve => { read = resolve })), cancel: vi.fn(async () => { read({ done: true }) }), releaseLock: vi.fn() }
  vi.stubGlobal('MediaStreamTrackProcessor', class { readable = { getReader: () => reader } })
  let encoded!: () => void
  const frame = { timestamp: 2_000_000, duration: 33333, close: vi.fn() } as unknown as VideoFrame
  const video = vi.fn(async () => new Promise<void>(resolve => { encoded = resolve }))
  const failed = vi.fn()
  const clock = new RecordingTracksClock(0, async () => 0, failed); vi.spyOn(clock, 'nowUs').mockReturnValue(1_000_000)
  const capture = await openTrackDevice('camera', { systemAudio: false, camera: { width: 640, height: 480, frameRate: 30 } }, clock, { audio: vi.fn(), video, state: vi.fn(), failed }, new AbortController().signal)
  read({ value: frame, done: false })
  await vi.waitFor(() => { expect(failed).not.toHaveBeenCalled(); expect(video).toHaveBeenCalledTimes(1) })
  let stopped = false; const stop = capture.stop().then(() => { stopped = true })
  await Promise.resolve(); expect(stopped).toBe(false)
  encoded(); await stop
  expect(frame.close).toHaveBeenCalledTimes(1); expect(track.stop).toHaveBeenCalledTimes(1); expect(reader.releaseLock).toHaveBeenCalledTimes(1)
  expect(failed).not.toHaveBeenCalled()
})
it('摄像头权限等待中取消，迟到流必释放且不创建reader', async () => {
  let resolve!: (stream: { getTracks(): { stop(): void }[] }) => void
  const track = { stop: vi.fn() }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(async () => new Promise(value => { resolve = value })) } })
  const abort = new AbortController(); const failed = vi.fn()
  const capture = openTrackDevice('camera', { systemAudio: false, camera: { width: 640, height: 480, frameRate: 30 } }, new RecordingTracksClock(0, async () => 0, failed), { audio: vi.fn(), video: vi.fn(), state: vi.fn(), failed }, abort.signal)
  abort.abort(); resolve({ getTracks: () => [track] })
  await expect(capture).rejects.toThrow(); expect(track.stop).toHaveBeenCalledTimes(1)
})
