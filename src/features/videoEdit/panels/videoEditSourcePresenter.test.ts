// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import { createVideoEditSourcePresenter } from './videoEditSourcePresenter'

vi.mock('@/services/imageSource', () => ({ resolveImageDisplayUrl: (path: string) => `media:${path}` }))
const media: VideoEditMedia = { id: 'media', kind: 'video', name: '原视频', path: 'D:/source.mp4', durationSeconds: 7, width: 3840, height: 2160 }
let host: HTMLDivElement
let frameCallbacks: Map<number, VideoFrameRequestCallback>
let nextFrame: number
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); frameCallbacks = new Map(); nextFrame = 0
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { Object.defineProperty(this, 'paused', { value: true, configurable: true }) })
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) { Object.defineProperty(this, 'paused', { value: false, configurable: true }); return Promise.resolve() })
  Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { configurable: true, value: vi.fn((callback: VideoFrameRequestCallback) => { frameCallbacks.set(++nextFrame, callback); return nextFrame }) })
  Object.defineProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', { configurable: true, value: vi.fn((id: number) => frameCallbacks.delete(id)) })
})
afterEach(() => { host.remove(); vi.restoreAllMocks(); delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).requestVideoFrameCallback; delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).cancelVideoFrameCallback })

async function loadVideo(): Promise<HTMLVideoElement> {
  const video = host.querySelector('video')!
  video.dispatchEvent(new Event('loadedmetadata')); await Promise.resolve(); await Promise.resolve()
  return video
}
function presentFrame(time: number): void {
  const [id, callback] = [...frameCallbacks.entries()][0]
  frameCallbacks.delete(id)
  callback(0, { mediaTime: time } as VideoFrameCallbackMetadata)
}

it('指定时刻必须等真实视频帧确认，停止和关闭释放原路径媒体', async () => {
  const observe = vi.fn()
  const presenter = createVideoEditSourcePresenter(host, () => media, observe)
  let complete = false
  const request = presenter.present({ itemId: 'item', timeUs: 2_000_000, playing: false, volume: 1 }, new AbortController().signal).then(value => { complete = true; return value })
  const video = await loadVideo()
  expect(video.currentTime).toBe(2); expect(complete).toBe(false)
  presentFrame(1.983333)
  expect(await request).toEqual({ timeUs: 2_000_000, presentedTimeUs: 1_983_333, playing: false, volume: 1 })
  const playing = await presenter.present({ itemId: 'item', timeUs: 2_000_000, playing: true, volume: 1 }, new AbortController().signal)
  expect(playing.playing).toBe(true)
  video.currentTime = 2.2; presentFrame(2.183333)
  expect(observe).toHaveBeenLastCalledWith('item', { timeUs: 2_200_000, presentedTimeUs: 2_183_333, playing: true, volume: 1 })
  await presenter.present({ itemId: '', timeUs: 0, playing: false, volume: 1 }, new AbortController().signal)
  expect(host.children).toHaveLength(0); expect(video.getAttribute('src')).toBeNull(); expect(frameCallbacks.size).toBe(0)
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalled()
  presenter.dispose()
})

it('取消未完成定位会释放资源，旧帧回调不能回填新源请求', async () => {
  const presenter = createVideoEditSourcePresenter(host, () => media, vi.fn())
  const abort = new AbortController()
  const first = presenter.present({ itemId: 'old', timeUs: 1_000_000, playing: false, volume: 1 }, abort.signal)
  const rejected = expect(first).rejects.toThrow('更新')
  await loadVideo()
  const stale = [...frameCallbacks.values()][0]
  abort.abort(new Error('更新'))
  await rejected
  expect(host.children).toHaveLength(0); expect(frameCallbacks.size).toBe(0)
  const second = presenter.present({ itemId: 'new', timeUs: 3_000_000, playing: false, volume: 1 }, new AbortController().signal)
  await loadVideo()
  stale(0, { mediaTime: 1 } as VideoFrameCallbackMetadata)
  expect(frameCallbacks.size).toBe(1)
  presentFrame(3)
  expect(await second).toEqual({ timeUs: 3_000_000, presentedTimeUs: 3_000_000, playing: false, volume: 1 })
  presenter.dispose()
})

it('源音频通过同一个实际媒体元素确认定位和音量，关闭释放且迟到事件不回填', async () => {
  const observe = vi.fn()
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, kind: 'audio', path: 'D:/source.wav' }), observe)
  const request = presenter.present({ itemId: 'audio', timeUs: 2_000_000, playing: false, volume: 0.35 }, new AbortController().signal)
  const audio = host.querySelector('audio')!
  audio.dispatchEvent(new Event('loadedmetadata')); await Promise.resolve(); await Promise.resolve()
  audio.dispatchEvent(new Event('seeked'))
  expect(await request).toEqual({ timeUs: 2_000_000, presentedTimeUs: 2_000_000, playing: false, volume: 0.35 })
  expect(host.querySelectorAll('audio')).toHaveLength(1); expect(audio.controls).toBe(false)
  const playing = await presenter.present({ itemId: 'audio', timeUs: 2_000_000, playing: true, volume: 0.6 }, new AbortController().signal)
  expect(playing).toMatchObject({ playing: true, volume: 0.6 })
  audio.currentTime = 2.3; audio.dispatchEvent(new Event('timeupdate'))
  expect(observe).toHaveBeenLastCalledWith('audio', { timeUs: 2_300_000, presentedTimeUs: 2_300_000, playing: true, volume: 0.6 })
  presenter.release(); observe.mockClear(); audio.dispatchEvent(new Event('timeupdate'))
  expect(observe).not.toHaveBeenCalled(); expect(host.children).toHaveLength(0); expect(audio.getAttribute('src')).toBeNull()
  presenter.dispose()
})
