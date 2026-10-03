// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import { createVideoEditSourcePresenter } from './videoEditSourcePresenter'

vi.mock('@/services/imageSource', () => ({ resolveImageDisplayUrl: (path: string) => `media:${path}` }))
const gpu = vi.hoisted(() => ({ blocked: false, calls: [] as number[], requests: [] as Array<() => void>, invalidates: vi.fn(), closes: vi.fn(), created: 0, closing: undefined as Promise<void> | undefined, timestamp: undefined as ((timeUs: number) => number) | undefined, backend: 'browser' as 'browser' | 'native', plays: [] as Array<[number, number | undefined]> }))
vi.mock('../engine/videoEditSourceFrames', () => ({ videoEditSourceBackend: async () => gpu.backend, VideoEditSourceFrames: class {
  private revision = 0
  constructor(private readonly media: VideoEditMedia) { gpu.created++ }
  async present(timeUs: number) {
    const revision = this.revision; gpu.calls.push(timeUs)
    if (gpu.blocked) await new Promise<void>(resolve => gpu.requests.push(resolve))
    if (revision !== this.revision) throw new Error('旧GPU请求已取消')
    const fps = this.media.frameRate ? this.media.frameRate.numerator / this.media.frameRate.denominator : 30
    return { timeUs, presentedTimeUs: gpu.timestamp?.(timeUs) ?? Math.round(Math.floor(timeUs / 1e6 * fps) / fps * 1e6), decodeMs: 1, gpuMs: 2, cacheHits: 1, cacheBytes: 100 }
  }
  get frameCount() { return Math.ceil(this.media.durationSeconds * (this.media.frameRate ? this.media.frameRate.numerator / this.media.frameRate.denominator : 30) - 1e-6) }
  async playFrame(frame: number, deadline?: number) {
    const revision = this.revision; gpu.plays.push([frame, deadline])
    if (gpu.blocked) await new Promise<void>(resolve => gpu.requests.push(resolve))
    if (revision !== this.revision) throw new Error('旧GPU请求已取消')
    const fps = this.media.frameRate ? this.media.frameRate.numerator / this.media.frameRate.denominator : 30
    return { timeUs: Math.round(frame / fps * 1e6), presentedTimeUs: Math.round(frame / fps * 1e6), decodeMs: 1, gpuMs: 2, cacheHits: 0, cacheBytes: 100 }
  }
  invalidate() { this.revision++; gpu.invalidates() }
  async dispose() { this.invalidate(); gpu.closes(); await gpu.closing }
} }))
const sound = vi.hoisted(() => ({ players: [] as Array<{ media: VideoEditMedia; calls: Array<[string, ...unknown[]]>; disposed: boolean }>, fail: undefined as Error | undefined }))
vi.mock('../engine/videoEditSourceSound', () => ({ VideoEditSourceSoundPlayer: class {
  readonly record: { media: VideoEditMedia; calls: Array<[string, ...unknown[]]>; disposed: boolean }
  constructor(media: VideoEditMedia) { this.record = { media, calls: [], disposed: false }; sound.players.push(this.record) }
  async prepare(volume: number) { this.record.calls.push(['prepare', volume]) }
  start(seconds: number, at: number) { this.record.calls.push(['start', seconds, at]) }
  pump(seconds: number, _current: () => boolean, onError: (error: unknown) => void) { this.record.calls.push(['pump', seconds]); if (sound.fail) onError(sound.fail) }
  levels() { return [{ peak: .5, rms: .25 }, { peak: .5, rms: .25 }] }
  stop() { this.record.calls.push(['stop']) }
  async dispose() { this.record.disposed = true }
} }))
const media: VideoEditMedia = { id: 'media', kind: 'video', name: '原视频', path: 'D:/source.mp4', durationSeconds: 7, width: 3840, height: 2160, frameRateMode: 'sampled-constant' }
let host: HTMLDivElement
let frameCallbacks: Map<number, VideoFrameRequestCallback>
let nextFrame: number
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); frameCallbacks = new Map(); nextFrame = 0
  gpu.blocked = false; gpu.calls = []; gpu.requests = []; gpu.invalidates.mockClear(); gpu.closes.mockClear(); gpu.created = 0; gpu.closing = undefined; gpu.timestamp = undefined; gpu.backend = 'browser'; gpu.plays = []; sound.players = []; sound.fail = undefined
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) { Object.defineProperty(this, 'paused', { value: true, configurable: true }) })
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) { Object.defineProperty(this, 'paused', { value: false, configurable: true }); return Promise.resolve() })
  Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { configurable: true, value: vi.fn((callback: VideoFrameRequestCallback) => { frameCallbacks.set(++nextFrame, callback); return nextFrame }) })
  Object.defineProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', { configurable: true, value: vi.fn((id: number) => frameCallbacks.delete(id)) })
})
afterEach(() => { host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).requestVideoFrameCallback; delete (HTMLVideoElement.prototype as Partial<HTMLVideoElement>).cancelVideoFrameCallback })

async function loadVideo(): Promise<HTMLVideoElement> {
  const video = host.querySelector('video')!
  // The backend choice settles alongside the element's metadata (a few more microtasks than the metadata event alone).
  video.dispatchEvent(new Event('loadedmetadata')); for (let tick = 0; tick < 8; tick++) await Promise.resolve()
  return video
}
function presentFrame(time: number): void {
  const [id, callback] = [...frameCallbacks.entries()][0]
  frameCallbacks.delete(id)
  callback(0, { mediaTime: time } as VideoFrameCallbackMetadata)
}
function presentRequestedPicture(video: HTMLVideoElement, fps: number): void {
  expect(frameCallbacks.size).toBe(1)
  // A paused seek inside a frame returns its start timestamp, not the seek clock.
  presentFrame(Math.floor(video.currentTime * fps) / fps)
}
it('反向静音逐帧等待同源GPU完成，停止确认原生同帧并取消在途合成', async () => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  const observe = vi.fn(); const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, frameRate: { numerator: 60, denominator: 1 } }), observe)
  const reverse = presenter.present({ itemId: 'item', timeUs: 2_000_000, playing: true, volume: .7, playbackDirection: -1 }, new AbortController().signal)
  const video = await loadVideo(); presentFrame(2)
  expect(await reverse).toMatchObject({ playing: true, playbackDirection: -1 }); expect(video.paused).toBe(true); expect(video.muted).toBe(true)
  expect(host.querySelector('canvas')?.width).toBe(3840); expect(video.className).toBe('hidden')
  gpu.blocked = true
  await vi.advanceTimersByTimeAsync(17)
  expect(gpu.calls.at(-1)).toBe(Math.round(119.5 / 60 * 1e6)); expect(observe.mock.calls.filter(([, observation]) => observation.playing)).toHaveLength(0)
  gpu.requests.shift()!(); await vi.advanceTimersByTimeAsync(0)
  expect(observe).toHaveBeenLastCalledWith('item', expect.objectContaining({ presentedTimeUs: 1_983_333, playing: true, playbackDirection: -1 }))
  await vi.advanceTimersByTimeAsync(17); expect(gpu.requests).toHaveLength(1); expect(frameCallbacks.size).toBe(0)
  const stopped = presenter.present({ itemId: 'item', timeUs: Math.round(119.5 / 60 * 1e6), playing: false, volume: .7, playbackDirection: 1 }, new AbortController().signal)
  await Promise.resolve(); expect(frameCallbacks.size).toBe(1); presentRequestedPicture(video, 60)
  expect(await stopped).toMatchObject({ playing: false, presentedTimeUs: 1_983_333 }); expect(video.muted).toBe(false)
  gpu.requests.shift()!(); await vi.advanceTimersByTimeAsync(0)
  expect(gpu.closes).toHaveBeenCalledOnce(); expect(host.querySelector('canvas')).toBeNull()
  const count = observe.mock.calls.filter(([, observation]) => observation.playing).length; await vi.advanceTimersByTimeAsync(500)
  expect(observe.mock.calls.filter(([, observation]) => observation.playing)).toHaveLength(count); expect(frameCallbacks.size).toBe(0)
  presenter.dispose(); expect(host.children).toHaveLength(0); expect(video.getAttribute('src')).toBeNull(); expect(vi.getTimerCount()).toBe(0)
})

it.each([{ numerator: 60, denominator: 1 }, { numerator: 60000, denominator: 1001 }])('反向第一步从实际呈现帧后退，不重复较晚的媒体时钟帧（%j）', async frameRate => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  const fps = frameRate.numerator / frameRate.denominator; const observe = vi.fn()
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, frameRate }), observe)
  try {
    const request = presenter.present({ itemId: 'item', timeUs: 2_000_000, playing: true, volume: .7, playbackDirection: -1 }, new AbortController().signal)
    const video = await loadVideo(); presentFrame(119 / fps)
    const actualUs = Math.round(119 / fps * 1e6)
    expect(await request).toMatchObject({ timeUs: 2_000_000, presentedTimeUs: actualUs, playing: true, playbackDirection: -1 })
    expect(gpu.calls).toEqual([Math.round(actualUs - 500_000 / fps), actualUs + 1])
    gpu.blocked = true
    await vi.advanceTimersByTimeAsync(17)
    expect(gpu.calls.at(-1)).toBe(Math.round(118.5 / fps * 1e6)); expect(frameCallbacks.size).toBe(0)
    expect(observe.mock.calls.filter(([, observation]) => observation.playing)).toHaveLength(0)
    gpu.requests.shift()!(); await vi.advanceTimersByTimeAsync(0)
    expect(observe).toHaveBeenLastCalledWith('item', expect.objectContaining({ presentedTimeUs: Math.round(118 / fps * 1e6), playing: true, playbackDirection: -1 }))
    expect(video.paused).toBe(true); expect(video.muted).toBe(true)
  } finally { presenter.dispose() }
  expect(host.children).toHaveLength(0); expect(frameCallbacks.size).toBe(0); expect(vi.getTimerCount()).toBe(0)
})
it('反向帧中心开始后立即停止可复用同一真实native帧，不等待不会出现的回调', async () => {
  vi.useFakeTimers()
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, frameRate: { numerator: 60, denominator: 1 } }), vi.fn())
  const timeUs = Math.round(120.5 / 60 * 1e6)
  const started = presenter.present({ itemId: 'item', timeUs, playing: true, playbackDirection: -1, volume: 1 }, new AbortController().signal)
  await loadVideo(); presentFrame(2); await started
  const stopped = await presenter.present({ itemId: 'item', timeUs, playing: false, volume: 1 }, new AbortController().signal)
  expect(stopped).toMatchObject({ timeUs, presentedTimeUs: 2_000_000, playing: false })
  expect(frameCallbacks.size).toBe(0); expect(gpu.closes).toHaveBeenCalledOnce()
  presenter.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('同元素正向旧帧回调被取消后不能污染GPU确认和停止交接', async () => {
  vi.useFakeTimers()
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, frameRate: { numerator: 60, denominator: 1 } }), vi.fn())
  const timeUs = Math.round(120.5 / 60 * 1e6)
  const initial = presenter.present({ itemId: 'item', timeUs, playing: true, volume: 1 }, new AbortController().signal)
  await loadVideo(); presentFrame(2); await initial
  const stale = [...frameCallbacks.values()][0]
  const reverse = await presenter.present({ itemId: 'item', timeUs, playing: true, playbackDirection: -1, volume: 1 }, new AbortController().signal)
  expect(reverse.presentedTimeUs).toBe(2_000_000)
  stale(0, { mediaTime: 5 } as VideoFrameCallbackMetadata)
  expect(await presenter.present({ itemId: 'item', timeUs, playing: false, volume: 1 }, new AbortController().signal)).toMatchObject({ presentedTimeUs: 2_000_000 })
  presenter.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('面板销毁重建等待旧GPU释放屏障，不能叠加反向缓存owner', async () => {
  vi.useFakeTimers()
  const oldHost = host; const resolver = () => ({ ...media, frameRate: { numerator: 60, denominator: 1 } })
  const old = createVideoEditSourcePresenter(oldHost, resolver, vi.fn())
  const first = old.present({ itemId: 'item', timeUs: 2_000_000, playing: true, playbackDirection: -1, volume: 1 }, new AbortController().signal)
  await loadVideo(); presentFrame(2); await first
  let finish!: () => void; gpu.closing = new Promise(resolve => { finish = resolve })
  old.dispose()
  host = document.createElement('div'); document.body.append(host)
  const fresh = createVideoEditSourcePresenter(host, resolver, vi.fn())
  try {
    const next = fresh.present({ itemId: 'item', timeUs: 2_000_000, playing: true, playbackDirection: -1, volume: 1 }, new AbortController().signal)
    await loadVideo(); presentFrame(2)
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
    expect(gpu.created).toBe(1)
    finish(); expect((await next).playing).toBe(true); expect(gpu.created).toBe(2)
  } finally { finish(); gpu.closing = undefined; fresh.dispose(); oldHost.remove() }
  expect(vi.getTimerCount()).toBe(0)
})
it('VFR定位不能按标称帧率复用邻近帧，切GPU保留精确实际PTS', async () => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  const observe = vi.fn()
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, frameRate: { numerator: 30, denominator: 1 }, frameRateMode: 'variable' }), observe)
  const initial = presenter.present({ itemId: 'item', timeUs: 1_005_000, playing: false, volume: 1 }, new AbortController().signal)
  await loadVideo(); presentFrame(1); await initial
  let completed = false
  const next = presenter.present({ itemId: 'item', timeUs: 1_020_000, playing: false, volume: 1 }, new AbortController().signal).then(value => { completed = true; return value })
  host.querySelector('video')!.dispatchEvent(new Event('seeked')); await Promise.resolve()
  expect(completed).toBe(false); expect(frameCallbacks.size).toBe(1)
  presentFrame(1.01); expect((await next).presentedTimeUs).toBe(1_010_000)
  gpu.timestamp = timeUs => timeUs >= 1_010_000 ? 1_010_000 : 1_000_000
  const reverse = await presenter.present({ itemId: 'item', timeUs: 1_020_000, playing: true, playbackDirection: -1, volume: 1 }, new AbortController().signal)
  expect(reverse.presentedTimeUs).toBe(1_010_000); expect(gpu.calls.at(-1)).toBe(1_010_001)
  gpu.blocked = true; await vi.advanceTimersByTimeAsync(34)
  // Reverse steps aim below the shown picture by 1µs plus the container timestamp tolerance (task 3.2, D3).
  expect(gpu.calls.at(-1)).toBe(1_010_000 - 1 - 600)
  gpu.requests.shift()!(); await vi.advanceTimersByTimeAsync(0)
  expect(observe).toHaveBeenLastCalledWith('item', expect.objectContaining({ presentedTimeUs: 1_000_000, playing: true }))
  presenter.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('真实帧边界前十微秒仍须确认前一画面，不能用浮点填充吞掉定位差', async () => {
  vi.useFakeTimers()
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, frameRate: { numerator: 60, denominator: 1 } }), vi.fn())
  const initial = presenter.present({ itemId: 'item', timeUs: 2_000_000, playing: false, volume: 1 }, new AbortController().signal)
  await loadVideo(); presentFrame(2); await initial
  const previous = presenter.present({ itemId: 'item', timeUs: 1_999_990, playing: false, volume: 1 }, new AbortController().signal)
  expect(frameCallbacks.size).toBe(1); presentFrame(119 / 60)
  expect((await previous).presentedTimeUs).toBe(1_983_333)
  presenter.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('恒定帧率的非零PTS相位按真实帧区间判断，不能套零起点网格', async () => {
  vi.useFakeTimers()
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, frameRate: { numerator: 60, denominator: 1 } }), vi.fn())
  const initial = presenter.present({ itemId: 'item', timeUs: 1_010_000, playing: false, volume: 1 }, new AbortController().signal)
  await loadVideo(); presentFrame(1.005); await initial
  const previous = presenter.present({ itemId: 'item', timeUs: 1_004_000, playing: false, volume: 1 }, new AbortController().signal)
  expect(frameCallbacks.size).toBe(1); presentFrame(1.005 - 1 / 60)
  expect((await previous).presentedTimeUs).toBe(988_333)
  presenter.dispose(); expect(vi.getTimerCount()).toBe(0)
})

it.each([{ numerator: 60, denominator: 1 }, { numerator: 60000, denominator: 1001 }])('同一已呈现帧内定位只确认时钟，跨帧仍等待新画面（%j）', async frameRate => {
  vi.useFakeTimers()
  const fps = frameRate.numerator / frameRate.denominator
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, frameRate }), vi.fn())
  try {
    const initial = presenter.present({ itemId: 'item', timeUs: Math.round(119.5 / fps * 1e6), playing: false, volume: 1 }, new AbortController().signal)
    const video = await loadVideo(); presentRequestedPicture(video, fps)
    expect(await initial).toMatchObject({ presentedTimeUs: Math.round(119 / fps * 1e6) })
    let complete = false
    const sameTimeUs = Math.round(119.75 / fps * 1e6)
    const same = presenter.present({ itemId: 'item', timeUs: sameTimeUs, playing: false, volume: 1 }, new AbortController().signal).then(value => { complete = true; return value })
    await Promise.resolve()
    expect(complete).toBe(false); expect(frameCallbacks.size).toBe(0)
    expect(HTMLVideoElement.prototype.requestVideoFrameCallback).toHaveBeenCalledTimes(1)
    video.dispatchEvent(new Event('seeked'))
    expect(await same).toMatchObject({ timeUs: sameTimeUs, presentedTimeUs: Math.round(119 / fps * 1e6) })
    complete = false
    const next = presenter.present({ itemId: 'item', timeUs: Math.round(120.5 / fps * 1e6), playing: false, volume: 1 }, new AbortController().signal).then(value => { complete = true; return value })
    video.dispatchEvent(new Event('seeked')); await Promise.resolve(); await Promise.resolve()
    expect(complete).toBe(false); expect(frameCallbacks.size).toBe(1)
    presentRequestedPicture(video, fps)
    expect(await next).toMatchObject({ presentedTimeUs: Math.round(120 / fps * 1e6) })
  } finally { presenter.dispose() }
  expect(host.children).toHaveLength(0); expect(frameCallbacks.size).toBe(0); expect(vi.getTimerCount()).toBe(0)
})

it('取消同一画面内的时钟定位会清理等待，旧媒体事件不完成新源请求', async () => {
  vi.useFakeTimers()
  const observe = vi.fn()
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, frameRate: { numerator: 60, denominator: 1 } }), observe)
  try {
    const initial = presenter.present({ itemId: 'old', timeUs: Math.round(120.5 / 60 * 1e6), playing: false, volume: 1 }, new AbortController().signal)
    const oldVideo = await loadVideo(); presentRequestedPicture(oldVideo, 60); await initial
    const abort = new AbortController()
    const cancelled = presenter.present({ itemId: 'old', timeUs: Math.round(120.75 / 60 * 1e6), playing: false, volume: 1 }, abort.signal)
    const rejected = expect(cancelled).rejects.toThrow('取消定位')
    expect(frameCallbacks.size).toBe(0)
    abort.abort(new Error('取消定位')); await rejected
    expect(host.children).toHaveLength(0); expect(oldVideo.getAttribute('src')).toBeNull(); expect(vi.getTimerCount()).toBe(0)
    observe.mockClear()
    let complete = false
    const next = presenter.present({ itemId: 'new', timeUs: Math.round(180.5 / 60 * 1e6), playing: false, volume: 1 }, new AbortController().signal).then(value => { complete = true; return value })
    const newVideo = await loadVideo()
    oldVideo.dispatchEvent(new Event('seeked')); oldVideo.dispatchEvent(new Event('timeupdate')); await Promise.resolve(); await Promise.resolve()
    expect(complete).toBe(false); expect(observe).not.toHaveBeenCalled(); expect(frameCallbacks.size).toBe(1)
    presentRequestedPicture(newVideo, 60)
    expect(await next).toMatchObject({ presentedTimeUs: 3_000_000 })
  } finally { presenter.dispose() }
  expect(host.children).toHaveLength(0); expect(frameCallbacks.size).toBe(0); expect(vi.getTimerCount()).toBe(0)
})

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
  // The backend is decided while the element loads (audio items too), so the seek starts a few ticks later.
  audio.dispatchEvent(new Event('loadedmetadata')); for (let tick = 0; tick < 8; tick++) await Promise.resolve()
  audio.dispatchEvent(new Event('seeked'))
  expect(await request).toEqual({ timeUs: 2_000_000, presentedTimeUs: 2_000_000, playing: false, volume: 0.35 })
  expect(sound.players).toEqual([])
  expect(host.querySelectorAll('audio')).toHaveLength(1); expect(audio.controls).toBe(false)
  const playing = await presenter.present({ itemId: 'audio', timeUs: 2_000_000, playing: true, volume: 0.6 }, new AbortController().signal)
  expect(playing).toMatchObject({ playing: true, volume: 0.6 })
  audio.currentTime = 2.3; audio.dispatchEvent(new Event('timeupdate'))
  expect(observe).toHaveBeenLastCalledWith('audio', { timeUs: 2_300_000, presentedTimeUs: 2_300_000, playing: true, volume: 0.6 })
  presenter.release(); observe.mockClear(); audio.dispatchEvent(new Event('timeupdate'))
  expect(observe).not.toHaveBeenCalled(); expect(host.children).toHaveLength(0); expect(audio.getAttribute('src')).toBeNull()
  presenter.dispose()
})

it('只有原生能解的视频不用媒体元素：渲染会话确认定位画面，正向按连续帧节拍播放到结尾停止，反向按真实时间戳后退；静音；释放会话', async () => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  gpu.backend = 'native'
  const observe = vi.fn(); const levels = vi.fn()
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, path: 'D:/prores.mov', durationSeconds: 0.1, frameRate: { numerator: 60, denominator: 1 } }), observe, levels)
  const paused = presenter.present({ itemId: 'item', timeUs: 45_000, playing: false, volume: .5 }, new AbortController().signal)
  for (let tick = 0; tick < 8; tick++) await Promise.resolve()
  host.querySelector('video')?.dispatchEvent(new Event('error'))
  expect(await paused).toEqual({ timeUs: 45_000, presentedTimeUs: 33_333, playing: false, volume: .5 })
  expect(host.querySelector('video')).toBeNull(); expect(host.querySelectorAll('canvas')).toHaveLength(1)
  expect(host.querySelector('canvas')?.dataset).toMatchObject({ videoEditSourceMedia: 'video', presentedTimeUs: '33333' }); expect(gpu.calls).toEqual([45_000])
  const playing = await presenter.present({ itemId: 'item', timeUs: 45_000, playing: true, volume: .5 }, new AbortController().signal)
  expect(playing).toMatchObject({ playing: true, timeUs: 45_000 }); expect(playing.playbackDirection).toBeUndefined()
  await vi.advanceTimersByTimeAsync(200)
  expect(gpu.plays.map(([frame]) => frame)).toEqual([3, 4, 5])
  // The first picture of the run is presented unpaced (it opens the scheduled path); the rest follow it at 60fps.
  const [warm, second, third] = gpu.plays.map(([, deadline]) => deadline)
  expect(warm).toBeUndefined()
  expect(third! - second!).toBeCloseTo(1000 / 60, 2)
  expect(observe).toHaveBeenLastCalledWith('item', { timeUs: 100_000, presentedTimeUs: 83_333, playing: false, volume: .5 })
  expect(levels).toHaveBeenCalledWith([])
  const reverse = await presenter.present({ itemId: 'item', timeUs: 45_000, playing: true, volume: .5, playbackDirection: -1 }, new AbortController().signal)
  expect(reverse).toMatchObject({ playing: true, playbackDirection: -1 })
  await vi.advanceTimersByTimeAsync(200)
  // Steps aim 1µs + the container timestamp tolerance (600µs) below each shown picture (task 3.2, D3).
  expect(gpu.calls.slice(-3)).toEqual([45_000, 33_333 - 601, 16_667 - 601])
  expect(observe).toHaveBeenLastCalledWith('item', expect.objectContaining({ timeUs: 0, playing: false }))
  presenter.release(); expect(gpu.closes).toHaveBeenCalledOnce(); expect(host.children).toHaveLength(0)
  presenter.dispose()
})

it('只有原生能解的视频有声：正向播放先启动音频时钟，再把下一帧与它的声音放在同一时刻；反向不出声；释放关闭声音', async () => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  gpu.backend = 'native'
  const observe = vi.fn(); const levels = vi.fn()
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, path: 'D:/prores.mov', durationSeconds: 0.5, frameRate: { numerator: 60, denominator: 1 } }), observe, levels)
  const paused = presenter.present({ itemId: 'item', timeUs: 45_000, playing: false, volume: .5 }, new AbortController().signal)
  for (let tick = 0; tick < 8; tick++) await Promise.resolve()
  host.querySelector('video')?.dispatchEvent(new Event('error'))
  await paused
  expect(sound.players).toHaveLength(1)
  const [player] = sound.players
  await presenter.present({ itemId: 'item', timeUs: 45_000, playing: true, volume: .7 }, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(60)
  // present() first stops any earlier run; the run then prepares the audio clock before anything is placed.
  const run = player.calls.slice(player.calls.findIndex(([kind]) => kind === 'prepare'))
  expect(run[0]).toEqual(['prepare', .7])
  const start = run[1] as [string, number, number]
  // Frame 3 (source 0.05s) is presented first (unpaced) and the sound of 0.05s is anchored at that moment; frame 4
  // follows one frame later.
  expect(start[0]).toBe('start'); expect(start[1]).toBeCloseTo(3 / 60, 9)
  expect(gpu.plays[0]).toEqual([3, undefined])
  expect(gpu.plays[1][0]).toBe(4); expect(gpu.plays[1][1]).toBeCloseTo(performance.timeOrigin + start[2] + 1000 / 60, 3)
  // Sound is requested along the picture clock: before every paced frame (and at the end), never going back.
  const pumps = player.calls.filter(([kind]) => kind === 'pump').map(([, seconds]) => seconds as number)
  expect(pumps.length).toBe(gpu.plays.length); expect(pumps.every((value, index) => index === 0 || value >= pumps[index - 1])).toBe(true)
  await vi.advanceTimersByTimeAsync(600)
  expect(player.calls.at(-1)).toEqual(['stop'])
  const before = player.calls.length
  await presenter.present({ itemId: 'item', timeUs: 45_000, playing: true, volume: .7, playbackDirection: -1 }, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(200)
  expect(player.calls.slice(before).some(([kind]) => kind === 'prepare' || kind === 'pump')).toBe(false)
  presenter.release()
  await vi.advanceTimersByTimeAsync(0)
  expect(player.disposed).toBe(true)
  presenter.dispose()
})

it('只有原生能解的声音素材：不用媒体元素，定位只移动时钟，正向播放按时钟推进并出声直到结尾，电平来自声音；声音失败时停止并报告', async () => {
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  gpu.backend = 'native'
  const observe = vi.fn(); const levels = vi.fn()
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, kind: 'audio', path: 'D:/dialog.mxf', durationSeconds: 0.3 }), observe, levels)
  const paused = presenter.present({ itemId: 'audio', timeUs: 100_000, playing: false, volume: 1 }, new AbortController().signal)
  for (let tick = 0; tick < 8; tick++) await Promise.resolve()
  host.querySelector('audio')?.dispatchEvent(new Event('error'))
  expect(await paused).toEqual({ timeUs: 100_000, presentedTimeUs: 100_000, playing: false, volume: 1 })
  expect(host.querySelector('audio')).toBeNull(); expect(gpu.created).toBe(0)
  expect(host.querySelector('[data-video-edit-source-sound]')).not.toBeNull()
  const [player] = sound.players
  await presenter.present({ itemId: 'audio', timeUs: 100_000, playing: true, volume: 1 }, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(120)
  const start = player.calls.find(([kind]) => kind === 'start') as [string, number, number]
  expect(start[1]).toBeCloseTo(.1, 9)
  const last = observe.mock.calls.at(-1)![1] as { timeUs: number; playing: boolean }
  expect(last.playing).toBe(true); expect(last.timeUs).toBeGreaterThan(100_000)
  expect(levels).toHaveBeenCalledWith([{ peak: .5, rms: .25 }, { peak: .5, rms: .25 }])
  expect(player.calls.filter(([kind]) => kind === 'pump').length).toBeGreaterThan(1)
  await vi.advanceTimersByTimeAsync(400)
  expect(observe).toHaveBeenLastCalledWith('audio', { timeUs: 300_000, presentedTimeUs: 300_000, playing: false, volume: 1 })
  sound.fail = new Error('素材「原视频」的声音读取失败，请确认文件可用，或在项目素材中重新定位源文件。')
  await presenter.present({ itemId: 'audio', timeUs: 0, playing: true, volume: 1 }, new AbortController().signal)
  await vi.advanceTimersByTimeAsync(100)
  expect(observe).toHaveBeenLastCalledWith('audio', expect.objectContaining({ playing: false, error: sound.fail.message }))
  presenter.dispose()
})

it('原生视图暂停在同一时钟时（设入出点、改音量）沿用已确认画面不重新渲染；时钟改变或刚停止播放时重新确认', async () => {
  gpu.backend = 'native'
  const observe = vi.fn()
  const presenter = createVideoEditSourcePresenter(host, () => ({ ...media, path: 'D:/prores.mov', frameRate: { numerator: 60, denominator: 1 } }), observe)
  const first = presenter.present({ itemId: 'item', timeUs: 500_000, playing: false, volume: 1 }, new AbortController().signal)
  for (let tick = 0; tick < 8; tick++) await Promise.resolve()
  host.querySelector('video')?.dispatchEvent(new Event('error'))
  await first
  expect(gpu.calls).toEqual([500_000])
  expect(await presenter.present({ itemId: 'item', timeUs: 500_000, playing: false, volume: .4, inUs: 500_000 }, new AbortController().signal)).toMatchObject({ timeUs: 500_000, presentedTimeUs: 500_000, volume: .4 })
  expect(gpu.calls).toEqual([500_000])
  await presenter.present({ itemId: 'item', timeUs: 1_233_334, playing: false, volume: .4 }, new AbortController().signal)
  expect(gpu.calls).toEqual([500_000, 1_233_334])
  presenter.dispose()
})
