import { describe, expect, it, vi } from 'vitest'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoEditDecodedPicture, VideoEditFrameBackend, VideoEditFrameReadOptions } from './videoEditFrameSource'
import type { VideoEditGpuFrame } from './videoEditGpuFrame'
import { VideoEditJumpPreview, type VideoEditJumpPreviewWindow } from './videoEditJumpPreview'

const media = (key: string): VideoEditMedia => ({ id: key, name: '预渲染', path: `cache/${key}.mp4`, kind: 'video', width: 3840, height: 2160, durationSeconds: 3, hasAudio: false })
const window = (key: string, startFrame: number, endFrame: number): VideoEditJumpPreviewWindow => ({ key, startFrame, endFrame, fps: 60, media: media(key) })

function setup(budget = 1024, failing = new Set<string>()) {
  const reads: Array<{ path: string; time: number; options?: VideoEditFrameReadOptions }> = []
  const closedReaders: string[] = []
  const released: string[] = []
  const pictures: Array<{ time: number; close: ReturnType<typeof vi.fn> }> = []
  const frames = {
    open: (item: VideoEditMedia) => ({
      key: item.path,
      ready: Promise.resolve({
        clipFrames: () => ({
          frames: async function* () {},
          frameAt: async (time: number, options?: VideoEditFrameReadOptions) => {
            reads.push({ path: item.path, time, options })
            if (failing.has(item.path)) throw new Error('文件已被清理')
            return { timestamp: Math.floor(time), close: vi.fn() } as unknown as VideoEditDecodedPicture
          },
          close: () => { closedReaders.push(item.path) },
        }),
        clipAudio: () => undefined,
        schedule: async function* () {},
      }),
    }),
    release: (key: string) => { released.push(key) },
    seeker: () => { throw new Error('unused') },
  } as unknown as VideoEditFrameBackend
  const snapshot = async (decoded: VideoEditDecodedPicture): Promise<VideoEditGpuFrame> => {
    const picture = { time: decoded.timestamp, close: vi.fn() }
    pictures.push(picture)
    return { allocationSize: () => 100, close: picture.close } as unknown as VideoEditGpuFrame
  }
  return { preview: new VideoEditJumpPreview(frames, snapshot, budget), reads, closedReaders, released, pictures }
}

async function fill(preview: VideoEditJumpPreview, around: number, steps = 50): Promise<void> {
  for (let step = 0; step < steps; step++) if (!await preview.fillStep(around, () => true)) return
}

describe('VideoEditJumpPreview', () => {
  it('reads only the key frames of each pre-rendered file, nearest window first', async () => {
    const { preview, reads, closedReaders, released } = setup()
    preview.setWindows([window('a', 0, 150), window('b', 150, 300)])
    await fill(preview, 200)
    // Window b (around frame 200) first, one key frame per second, each a key-frame-only read.
    expect(reads.map(read => `${read.path}@${read.time.toFixed(4)}`)).toEqual(['cache/b.mp4@0.0001', 'cache/b.mp4@1.0001', 'cache/b.mp4@2.0001', 'cache/a.mp4@0.0001', 'cache/a.mp4@1.0001', 'cache/a.mp4@2.0001'])
    expect(reads.every(read => read.options?.keyFrame && read.options.speculative)).toBe(true)
    expect(closedReaders).toEqual(['cache/b.mp4', 'cache/a.mp4'])
    expect(released).toEqual(['cache/b.mp4', 'cache/a.mp4'])
    expect(preview.pictureCount).toBe(6)
    expect(await preview.fillStep(200, () => true)).toBe(false)
  })

  it('picks the last key frame at or before the frame, at most one key interval earlier', async () => {
    const { preview } = setup()
    preview.setWindows([window('a', 600, 750)])
    expect(preview.pick('a', 600, 610)).toBeUndefined()
    await fill(preview, 600)
    expect(preview.pick('a', 600, 600)).toBe(preview.pick('a', 600, 659))
    expect(preview.pick('a', 600, 660)).not.toBe(preview.pick('a', 600, 659))
    // The same file at another place of the sequence (a repeated section) maps from its own start.
    expect(preview.pick('a', 900, 960)).toBe(preview.pick('a', 600, 660))
    expect(preview.pick('b', 600, 610)).toBeUndefined()
  })

  it('pauses on an empty list, then drops the windows the next list no longer has, after the drawing frames completed', async () => {
    const { preview, pictures } = setup()
    preview.setWindows([window('a', 0, 120), window('b', 120, 240)])
    await fill(preview, 0)
    preview.setWindows([])
    expect(preview.pick('a', 0, 10)).toBeUndefined()
    preview.setWindows([window('a', 0, 120), window('b', 120, 240)])
    expect(preview.pick('a', 0, 10)).toBeDefined()
    const release = preview.lease()
    preview.setWindows([window('b', 120, 240)])
    expect(preview.pick('a', 0, 10)).toBeUndefined()
    expect(pictures.filter(picture => picture.close.mock.calls.length)).toHaveLength(0)
    release()
    expect(pictures.filter(picture => picture.close.mock.calls.length)).toHaveLength(2)
    expect(preview.pictureCount).toBe(2)
  })

  it('makes room for nearer windows by dropping the farthest one, and stops when only nearer ones are kept', async () => {
    const { preview } = setup(300)
    preview.setWindows([window('a', 0, 180), window('b', 1800, 1980)])
    await fill(preview, 0)
    expect(preview.pictureBytes).toBe(300)
    expect(preview.pick('a', 0, 10)).toBeDefined()
    expect(preview.pick('b', 1800, 1810)).toBeUndefined()
    await fill(preview, 1900)
    expect(preview.pick('b', 1800, 1810)).toBeDefined()
    expect(preview.pick('a', 0, 10)).toBeUndefined()
  })

  it('reads exact pictures on a reader of its own, one file at a time, and gives it back when the program rests', async () => {
    const { preview, reads, closedReaders } = setup()
    preview.setWindows([window('a', 0, 120), window('b', 120, 240)])
    const snapshot = vi.fn(async (decoded: VideoEditDecodedPicture) => ({ time: decoded.timestamp, allocationSize: () => 400, close: vi.fn() }) as unknown as VideoEditGpuFrame)
    const first = await preview.exactPicture('a', media('a'), 0.5, snapshot)
    const second = await preview.exactPicture('a', media('a'), 0.6, snapshot)
    expect(first).toBeDefined(); expect(second).toBeDefined()
    expect(reads.map(read => [read.path, read.time, read.options?.keyFrame ?? false])).toEqual([['cache/a.mp4', 0.5, false], ['cache/a.mp4', 0.6, false]])
    expect(closedReaders).toEqual([])
    await preview.exactPicture('b', media('b'), 0.25, snapshot)
    expect(closedReaders).toEqual(['cache/a.mp4'])
    // Unknown windows are not read; the exact pictures never join the resident key frames.
    expect(await preview.exactPicture('c', media('c'), 0, snapshot)).toBeUndefined()
    expect(preview.pictureCount).toBe(0)
    await preview.fillStep(0, () => true)
    expect(closedReaders).toEqual(['cache/a.mp4', 'cache/b.mp4'])
  })

  it('a newer jump abandons the exact picture still being read: the old one gets nothing, the reader stays and reads the new one', async () => {
    const reads: Array<{ time: number; signal?: AbortSignal }> = []
    const closed: string[] = []
    const frames = {
      open: (item: VideoEditMedia) => ({ key: item.path, ready: Promise.resolve({
        clipFrames: () => ({
          frames: async function* () {},
          // The first read decodes until abandoned, like a long-GOP seek on the native backend.
          frameAt: (time: number, options?: VideoEditFrameReadOptions) => {
            reads.push({ time, signal: options?.signal })
            if (reads.length > 1) return Promise.resolve({ timestamp: time, close: vi.fn() } as unknown as VideoEditDecodedPicture)
            return new Promise<never>((_, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('取帧已取消。', 'AbortError'))))
          },
          close: () => { closed.push(item.path) },
        }),
        clipAudio: () => undefined,
        schedule: async function* () {},
      }) }),
      release: () => {},
      seeker: () => { throw new Error('unused') },
    } as unknown as VideoEditFrameBackend
    const preview = new VideoEditJumpPreview(frames, async () => { throw new Error('unused') })
    preview.setWindows([window('a', 0, 120)])
    const snapshot = vi.fn(async (decoded: VideoEditDecodedPicture) => ({ time: decoded.timestamp, allocationSize: () => 400, close: vi.fn() }) as unknown as VideoEditGpuFrame)
    const first = preview.exactPicture('a', media('a'), 1.9, snapshot)
    await vi.waitFor(() => expect(reads).toHaveLength(1))
    const second = preview.exactPicture('a', media('a'), 0.4, snapshot)
    expect(reads[0].signal?.aborted).toBe(true)
    expect(await first).toBeUndefined()
    expect(await second).toBeDefined()
    expect(reads.map(read => read.time)).toEqual([1.9, 0.4])
    expect(snapshot).toHaveBeenCalledOnce()
    expect(closed).toEqual([])
  })

  it('backs off after a failed read and never starts a step while the program is busy', async () => {
    const { preview, reads } = setup(1024, new Set(['cache/a.mp4']))
    preview.setWindows([window('a', 0, 120)])
    expect(await preview.fillStep(0, () => false)).toBe(false)
    expect(reads).toHaveLength(0)
    await fill(preview, 0)
    expect(reads).toHaveLength(1)
    expect(await preview.fillStep(0, () => true)).toBe(false)
    expect(reads).toHaveLength(1)
  })
})
