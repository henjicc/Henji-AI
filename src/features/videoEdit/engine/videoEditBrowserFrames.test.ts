import { beforeEach, expect, it, vi } from 'vitest'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import { VIDEO_EDIT_AUDIO_PREROLL_SECONDS, VideoEditBrowserFrames } from './videoEditBrowserFrames'

const boundary = vi.hoisted(() => ({ inputs: [] as string[], disposed: [] as string[], routes: [] as string[], reads: [] as [string, number, number][], closed: [] as number[], codec: 'avc1.640033' as string | null, video: true }))
vi.mock('mediabunny', () => ({
  ALL_FORMATS: [],
  UrlSource: class { constructor(readonly path: string) {} },
  Input: class {
    readonly path: string
    constructor(options: { source: { path: string } }) { this.path = options.source.path; boundary.inputs.push(this.path) }
    async getPrimaryVideoTrack() { if (this.path.includes('missing')) throw new Error('404 Not Found'); return boundary.video ? { getDecoderConfig: async () => boundary.codec ? { codec: boundary.codec } : null } : null }
    async getPrimaryAudioTrack() { return null }
    async getAudioTracks() { boundary.routes.push('audioTracks'); return [{ id: 'first' }, { id: 'second' }] }
    dispose(): void { boundary.disposed.push(this.path) }
  },
  VideoSampleSink: class {
    async *samplesAtTimestamps(timestamps: number[]) { boundary.routes.push('samplesAtTimestamps'); for (const timestamp of timestamps) yield { timestamp } }
  },
  // AAC-like blocks of 1024 samples at 48kHz from the block holding `start`, like mediabunny's range iterator.
  AudioSampleSink: class {
    constructor(readonly track: { id: string }) {}
    async *samples(start: number, end: number) {
      boundary.reads.push([this.track.id, start, end])
      const block = 1024 / 48000
      for (let index = Math.max(0, Math.floor(start / block)); index * block < end; index++) {
        const sample = { track: this.track.id, timestamp: index * block, duration: block, close: () => boundary.closed.push(index) }
        yield sample
      }
    }
  },
}))
vi.mock('./videoEditPlaybackDecoder', () => ({ scheduledVideoSamples: async function* (_track: unknown, _options: unknown, timestamps: number[]) { boundary.routes.push('pump'); for (const timestamp of timestamps) yield { timestamp } } }))
vi.mock('./videoEditSeekDecoder', () => ({ VideoEditSeekDecoder: class {} }))

const media = (path: string, sourceRevision?: string): VideoEditMedia => ({ id: path, name: '素材', path, kind: 'video', width: 3840, height: 2160, durationSeconds: 2, ...(sourceRevision ? { sourceRevision } : {}) })
async function drain(generator: AsyncGenerator<unknown, void, unknown>): Promise<unknown[]> { const values: unknown[] = []; for await (const value of generator) values.push(value); return values }
beforeEach(() => {
  Object.assign(boundary, { inputs: [], disposed: [], routes: [], reads: [], closed: [], codec: 'avc1.640033', video: true })
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

it('按声音流序号读取（2.6）：首次读取才查找该流并复用同一读取器，文件没有这条流时为静音；不带序号仍读首选声音轨', async () => {
  const frames = new VideoEditBrowserFrames()
  const opened = frames.open(media('D:/OBS.mp4'))
  const source = await opened.ready
  expect(source.clipAudio()).toBeUndefined()
  const second = source.clipAudio(1)!
  expect(boundary.routes).toEqual([])
  const tracks = async (generator: AsyncGenerator<unknown, void, unknown>) => [...new Set((await drain(generator)).map(block => (block as { track: string }).track))]
  expect(await tracks(second.chunks(1, 2))).toEqual(['second'])
  expect(await tracks(second.chunks(2, 3))).toEqual(['second'])
  expect(boundary.routes).toEqual(['audioTracks'])
  expect(await drain(source.clipAudio(5)!.chunks(0, 1))).toEqual([])
  frames.release(opened.key)
})

it('混音块从起点前预滚解码（2.10）：预热块丢弃并关闭，交出的块覆盖起点且首块含起点前一个样本', async () => {
  const frames = new VideoEditBrowserFrames()
  const opened = frames.open(media('D:/OBS.mp4'))
  const source = await opened.ready
  const block = 1024 / 48000
  for (const reader of [source.clipAudio(0)!, source.clipAudio(1)!]) {
    boundary.reads = []; boundary.closed = []
    const blocks = await drain(reader.chunks(0.5, 1)) as { timestamp: number; duration: number }[]
    // 解码从起点前 0.1 秒开始：起点所在的帧有了上一帧的重叠。
    expect(boundary.reads).toEqual([[expect.any(String), 0.5 - VIDEO_EDIT_AUDIO_PREROLL_SECONDS, 1]])
    expect(blocks[0].timestamp).toBeLessThanOrEqual(0.5); expect(blocks[0].timestamp + blocks[0].duration).toBeGreaterThan(0.5)
    expect(blocks.at(-1)!.timestamp + blocks.at(-1)!.duration).toBeGreaterThanOrEqual(1)
    // 起点之前的预热块（第 18–22 帧，0.4–0.48 秒）在交给混音前关闭。
    expect(boundary.closed).toEqual([18, 19, 20, 21, 22])
    expect(blocks.every((value, index) => index === 0 || Math.abs(value.timestamp - blocks[index - 1].timestamp - block) < 1e-9)).toBe(true)
  }
  // 起点恰在帧边界：结束于起点的前一帧保留（混音取起点前一个样本），更早的丢弃。
  boundary.closed = []
  const aligned = await drain(source.clipAudio(1)!.chunks(24 * block, 30 * block)) as { timestamp: number }[]
  expect(aligned[0].timestamp).toBeCloseTo(23 * block, 9); expect(boundary.closed).toEqual([19, 20, 21, 22])
  frames.release(opened.key)
})
