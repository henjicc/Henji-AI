import { beforeEach, expect, it, vi } from 'vitest'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import { VideoEditBrowserFrames } from './videoEditBrowserFrames'

const boundary = vi.hoisted(() => ({ inputs: [] as string[], disposed: [] as string[], routes: [] as string[], codec: 'avc1.640033' as string | null, video: true }))
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  UrlSource: class { constructor(readonly path: string) {} },
  Input: class {
    readonly path: string
    constructor(options: { source: { path: string } }) { this.path = options.source.path; boundary.inputs.push(this.path) }
    async getPrimaryVideoTrack() { if (this.path.includes('missing')) throw new Error('404 Not Found'); return boundary.video ? { getDecoderConfig: async () => boundary.codec ? { codec: boundary.codec } : null } : null }
    async getPrimaryAudioTrack() { return null }
    dispose(): void { boundary.disposed.push(this.path) }
  },
  VideoSampleSink: class {
    async *samplesAtTimestamps(timestamps: number[]) { boundary.routes.push('samplesAtTimestamps'); for (const timestamp of timestamps) yield { timestamp } }
  },
  AudioSampleSink: class {},
}))
vi.mock('./videoEditPlaybackDecoder', () => ({ scheduledVideoSamples: async function* (_track: unknown, _options: unknown, timestamps: number[]) { boundary.routes.push('pump'); for (const timestamp of timestamps) yield { timestamp } } }))
vi.mock('./videoEditSeekDecoder', () => ({ VideoEditSeekDecoder: class {} }))

const media = (path: string, sourceRevision?: string): VideoEditMedia => ({ id: path, name: '素材', path, kind: 'video', width: 3840, height: 2160, durationSeconds: 2, ...(sourceRevision ? { sourceRevision } : {}) })
async function drain(generator: AsyncGenerator<unknown, void, unknown>): Promise<unknown[]> { const values: unknown[] = []; for await (const value of generator) values.push(value); return values }
beforeEach(() => {
  Object.assign(boundary, { inputs: [], disposed: [], routes: [], codec: 'avc1.640033', video: true })
  vi.stubGlobal('VideoDecoder', { isConfigSupported: async () => ({ supported: true }) })
})

it('同一文件同一版本共用一次解析，最后一个使用者释放时关闭；重新定位的版本单独打开', async () => {
  const frames = new VideoEditBrowserFrames()
  const first = frames.open(media('D:/A.mp4')); const second = frames.open(media('D:/A.mp4')); const relinked = frames.open(media('D:/A.mp4', 'relink'))
  await Promise.all([first.ready, second.ready, relinked.ready])
  expect(first.key).toBe(second.key); expect(relinked.key).not.toBe(first.key); expect(boundary.inputs).toEqual(['D:/A.mp4', 'D:/A.mp4'])
  frames.release(first.key); expect(boundary.disposed).toEqual([])
  frames.release(second.key); expect(boundary.disposed).toEqual(['D:/A.mp4'])
})

it('打开失败给出可操作提示且不缓存，文件恢复后重新读取', async () => {
  const frames = new VideoEditBrowserFrames()
  const failed = frames.open(media('D:/missing.mp4'))
  await expect(failed.ready).rejects.toThrow('重新定位源文件')
  await vi.waitFor(() => expect(boundary.disposed).toEqual(['D:/missing.mp4']))
  frames.release(failed.key)
  await expect(frames.open(media('D:/missing.mp4')).ready).rejects.toThrow(); expect(boundary.inputs).toHaveLength(2)
})

it('正向计划：H.264 走不 flush 的长期解码泵，其他编码走逐时间取样；无画面轨时计划为空', async () => {
  const frames = new VideoEditBrowserFrames()
  expect(await drain((await frames.open(media('D:/h264.mp4')).ready).schedule([0, 1 / 60]))).toEqual([{ timestamp: 0 }, { timestamp: 1 / 60 }])
  boundary.codec = 'vp09.00.10.08'
  const vp9 = await frames.open(media('D:/vp9.webm')).ready
  expect(vp9.codec).toBe('vp09.00.10.08'); await drain(vp9.schedule([0]))
  expect(boundary.routes).toEqual(['pump', 'samplesAtTimestamps'])
  boundary.video = false
  const audioOnly = await frames.open(media('D:/sound.m4a')).ready
  expect(audioOnly.clipFrames()).toBeUndefined(); expect(audioOnly.clipAudio()).toBeUndefined()
  expect(await drain(audioOnly.schedule([0]))).toEqual([]); expect(boundary.routes).toHaveLength(2)
})
