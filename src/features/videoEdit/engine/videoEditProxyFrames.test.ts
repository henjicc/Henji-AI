import { expect, it, vi } from 'vitest'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditDecodeSource, type VideoProxyResult } from '@/core/videoEdit/proxy'
import type { VideoEditFrameBackend, VideoEditFrameSource } from './videoEditFrameSource'
import { VideoEditProxyFrames } from './videoEditProxyFrames'

const media: VideoEditMedia = { id: 'm', kind: 'video', path: 'original.mov', name: '4K', width: 3840, height: 2160, durationSeconds: 3, hasAudio: true, frameRate: { numerator: 30000, denominator: 1001 } }
const proxy: VideoProxyResult = { path: 'cache.mp4', key: 'a'.repeat(64), contentIdentity: 'b'.repeat(64), preset: '720p', width: 1280, height: 720, bytes: 100 }
it('唯一源选择：开代理读缓存、关代理/导出/分析读原片，原媒体时长尺寸帧率不变', () => {
  expect(videoEditDecodeSource(media, proxy, true, 'playback')).toEqual({ ...media, path: proxy.path })
  for (const purpose of ['export', 'analysis'] as const) expect(videoEditDecodeSource(media, proxy, true, purpose)).toBe(media)
  expect(videoEditDecodeSource(media, proxy, false, 'playback')).toBe(media)
  expect(videoEditDecodeSource(media, undefined, true, 'playback')).toBe(media)
})
it('原生/WebCodecs共用选择：图片读取与跳转时间不变，声音按原片音轨与采样率读取；释放两源', async () => {
  const read = vi.fn(async () => null); const audio = vi.fn(); const schedule = vi.fn()
  const source: VideoEditFrameSource = { clipFrames: () => ({ frameAt: read, frames: async function* () { yield* [] } }), clipAudio: stream => ({ chunks: async function* (start, end, rate) { audio(stream, start, end, rate); yield* [] } }), schedule: async function* (times) { schedule(times); for (const _time of times) yield null } }
  const backend: VideoEditFrameBackend = { open: vi.fn(value => ({ key: value.path, ready: Promise.resolve(source) })), release: vi.fn(), seeker: vi.fn() }
  const routed = new VideoEditProxyFrames(backend, new Map([[media.id, proxy]])); const opened = routed.open(media); const file = await opened.ready
  expect(backend.open).toHaveBeenCalledOnce(); expect(backend.open).toHaveBeenCalledWith({ ...media, path: proxy.path })
  await file.clipFrames()!.frameAt(1.234567)
  for await (const _frame of file.schedule([.523, .556367, 1.234567])) { /* consume */ }
  for await (const _chunk of file.clipAudio(2)!.chunks(.523, 1.5, 48000)) { /* consume */ }
  expect(read).toHaveBeenCalledWith(1.234567); expect(schedule).toHaveBeenCalledWith([.523, .556367, 1.234567])
  expect(backend.open).toHaveBeenLastCalledWith(media); expect(audio).toHaveBeenCalledWith(2, .523, 1.5, 48000)
  routed.release(opened.key); expect(backend.release).toHaveBeenCalledWith(media.path); expect(backend.release).toHaveBeenCalledWith(proxy.path)
})

it('切换代理释放会话后，迟到的原片声音不会继续输出', async () => {
  let finish: (source: VideoEditFrameSource) => void = () => undefined
  const clipAudio = vi.fn(() => undefined)
  const original = new Promise<VideoEditFrameSource>(resolve => { finish = resolve })
  const schedule: VideoEditFrameSource['schedule'] = async function* (times) { for (const _time of times) yield null }
  const backend: VideoEditFrameBackend = { open: vi.fn(value => ({ key: value.path, ready: value.path === media.path ? original : Promise.resolve({ clipFrames: () => undefined, clipAudio: () => undefined, schedule }) })), release: vi.fn(), seeker: vi.fn() }
  const routed = new VideoEditProxyFrames(backend, new Map([[media.id, proxy]]))
  const opened = routed.open(media); const source = await opened.ready
  const next = source.clipAudio()!.chunks(0, 1)[Symbol.asyncIterator]().next()
  routed.release(opened.key); finish({ clipFrames: () => undefined, clipAudio, schedule })
  await expect(next).rejects.toThrow('已关闭')
  expect(clipAudio).not.toHaveBeenCalled()
})
