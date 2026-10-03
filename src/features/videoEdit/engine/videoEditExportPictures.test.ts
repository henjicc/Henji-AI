import { describe, expect, it, vi, type Mock } from 'vitest'
import { readVideoEditExportPicture, type VideoEditExportClipState } from './videoEditExportPictures'
import type { VideoEditClipFrames, VideoEditDecodedPicture } from './videoEditFrameSource'

const FPS = 30
type Picture = VideoEditDecodedPicture & { close: Mock }
const NAME = 'A.mov'

/**
 * A stream of pictures at the given frame positions (each 1/30s long), read the way the backends read it: the
 * sequential reader starts with the picture showing at its start; `frameAt` is the last picture starting at or before
 * the time. Options break one reader at a time (by the order readers are started).
 */
function stream(positions: number[], options: { skip?: number[]; endAfter?: Array<number | undefined>; failAt?: Array<number | undefined>; frameAt?: (time: number) => Promise<Picture | null> } = {}) {
  const delivered: Picture[] = []; const starts: number[] = []; const reads: number[] = []
  const make = (position: number): Picture => { const value = { timestamp: position / FPS, duration: 1 / FPS, close: vi.fn() } as unknown as Picture; delivered.push(value); return value }
  const showing = (time: number): number | undefined => positions.filter(position => position / FPS <= time + 1e-9).at(-1)
  const video: VideoEditClipFrames = {
    async *frames(start: number) {
      const reader = starts.push(start) - 1
      const first = showing(start) ?? positions[0]
      for (const position of positions.filter(position => position >= first)) {
        if (options.failAt?.[reader] === position) throw new Error('连续取帧失败')
        if (options.skip?.includes(position) && reader === 0) continue
        yield make(position)
        if (options.endAfter?.[reader] === position) return
      }
    },
    async frameAt(time: number) {
      reads.push(time)
      if (options.frameAt) return options.frameAt(time)
      const position = showing(time)
      return position === undefined ? null : make(position)
    },
  }
  return { video, delivered, starts, reads, make }
}

/** The renderer's use of the read: one call per exported frame, then the source time is recorded. */
async function exportFrames(video: VideoEditClipFrames, clip: VideoEditExportClipState, frames: number[]) {
  const shown: Array<number | null> = []; const singleFrameReads: number[] = []
  for (const frame of frames) {
    const time = frame / FPS
    const read = await readVideoEditExportPicture(clip, video, time, NAME)
    clip.previousTime = time
    expect(read.blank).toBe(!clip.current)
    shown.push(clip.current ? Math.round(clip.current.timestamp * FPS) : null)
    if (read.singleFrameRead) singleFrameReads.push(frame)
  }
  return { shown, singleFrameReads }
}

/** Drops the clip like the renderer does, then every picture went back exactly once. */
async function release(clip: VideoEditExportClipState, delivered: Picture[]) {
  clip.current?.close(); await clip.iterator?.return(undefined)
  for (const picture of delivered) expect(picture.close, `画面 ${picture.timestamp * FPS}`).toHaveBeenCalledOnce()
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, index) => from + index)

describe('导出逐帧取得准确画面（2.4）', () => {
  it('读取器的画面覆盖请求时间时直接使用，整段只开一个读取器、不做单帧读取', async () => {
    const { video, delivered, starts, reads } = stream(range(0, 10)); const clip: VideoEditExportClipState = { previousTime: -1 }
    expect(await exportFrames(video, clip, range(0, 8))).toEqual({ shown: range(0, 8), singleFrameReads: [] })
    expect(starts).toEqual([0]); expect(reads).toEqual([])
    await release(clip, delivered)
  })

  it('时间早于流的首个画面时该层透明（单帧读取确认没有画面），读取器提前给出的首个画面留到它自己的时间', async () => {
    const { video, delivered, starts, reads } = stream(range(3, 10)); const clip: VideoEditExportClipState = { previousTime: -1 }
    expect(await exportFrames(video, clip, range(0, 6))).toEqual({ shown: [null, null, null, 3, 4, 5], singleFrameReads: [0, 1, 2] })
    expect(starts).toEqual([0]); expect(reads).toEqual([0, 1 / FPS, 2 / FPS])
    await release(clip, delivered)
  })

  it('读取器跳过的画面（途中丢失或解码丢弃）由单帧读取补上，不重开读取器，读取器已给出的下一帧照常使用', async () => {
    const { video, delivered, starts, reads } = stream(range(0, 10), { skip: [2, 5] }); const clip: VideoEditExportClipState = { previousTime: -1 }
    expect(await exportFrames(video, clip, range(0, 8))).toEqual({ shown: range(0, 8), singleFrameReads: [2, 5] })
    expect(starts).toEqual([0]); expect(reads).toEqual([2 / FPS, 5 / FPS])
    await release(clip, delivered)
  })

  it('画面保持超过自身时长（可变帧率、流末尾）时经单帧读取确认后继续使用同一画面，不重复复制', async () => {
    const { video, delivered, starts } = stream([0, 1, 4, 5]); const clip: VideoEditExportClipState = { previousTime: -1 }
    const held: unknown[] = []
    const result = { shown: [] as Array<number | null>, singleFrameReads: [] as number[] }
    for (const frame of range(0, 8)) {
      const part = await exportFrames(video, clip, [frame])
      result.shown.push(...part.shown); result.singleFrameReads.push(...part.singleFrameReads); held.push(clip.current)
    }
    expect(result).toEqual({ shown: [0, 1, 1, 1, 4, 5, 5, 5], singleFrameReads: [2, 3, 6, 7] })
    // Frames 1-3 and 5-7 keep one picture object each (the renderer's copy is reused); the confirming reads go back.
    expect(new Set(held.slice(1, 4)).size).toBe(1); expect(new Set(held.slice(5, 8)).size).toBe(1)
    expect(starts).toEqual([0])
    await release(clip, delivered)
  })

  it('读取器提前结束（末尾的帧途中丢失）时由单帧读取补上，下一帧从该时间重开读取器', async () => {
    const { video, delivered, starts, reads } = stream(range(0, 10), { endAfter: [3] }); const clip: VideoEditExportClipState = { previousTime: -1 }
    expect(await exportFrames(video, clip, range(0, 8))).toEqual({ shown: range(0, 8), singleFrameReads: [4] })
    expect(starts).toEqual([0, 5 / FPS]); expect(reads).toEqual([4 / FPS])
    await release(clip, delivered)
  })

  it('读取器失败时由单帧读取决定这一帧，下一帧重开读取器', async () => {
    const { video, delivered, starts, reads } = stream(range(0, 10), { failAt: [2] }); const clip: VideoEditExportClipState = { previousTime: -1 }
    expect(await exportFrames(video, clip, range(0, 6))).toEqual({ shown: range(0, 6), singleFrameReads: [2] })
    expect(starts).toEqual([0, 3 / FPS]); expect(reads).toEqual([2 / FPS])
    await release(clip, delivered)
  })

  it('单帧读取也失败时以用户语言报错：后端原因只带一次素材名，原始解码错误换成可操作的说明并保留在 cause', async () => {
    for (const [failure, message] of [
      [new Error('素材「A.mov」解码失败，请确认文件可用，或在项目素材中重新定位源文件。'), '素材「A.mov」取不到准确的画面：解码失败，请确认文件可用，或在项目素材中重新定位源文件。'],
      [new Error('找不到素材「A.mov」的源文件，请在项目素材中右键该素材，选择“重新定位源文件”。'), '素材「A.mov」取不到准确的画面：找不到素材「A.mov」的源文件，请在项目素材中右键该素材，选择“重新定位源文件”。'],
      [new Error('素材「A.mov」的解码暂时中断，请稍后重试；如果一直出现，请重启软件。'), '素材「A.mov」取不到准确的画面：解码暂时中断，请稍后重试；如果一直出现，请重启软件。'],
      [new DOMException('Decoding error.', 'EncodingError'), '素材「A.mov」取不到准确的画面：解码失败，请确认文件可用，或在项目素材中重新定位源文件。'],
    ] as const) {
      const { video, delivered } = stream(range(0, 10), { failAt: [1], frameAt: async () => { throw failure } }); const clip: VideoEditExportClipState = { previousTime: -1 }
      await exportFrames(video, clip, [0])
      const error = await readVideoEditExportPicture(clip, video, 1 / FPS, NAME).then(() => undefined, (reason: Error) => reason)
      expect(error?.message).toBe(message); expect(error?.cause).toBe(failure)
      await release(clip, delivered)
    }
  })

  it('单帧读取给出晚于请求时间的画面时拒绝并交回该画面，不当作准确画面', async () => {
    let late: Picture | undefined
    const { video, delivered, make } = stream(range(0, 10), { skip: [2], frameAt: async () => (late = make(3)) }); const clip: VideoEditExportClipState = { previousTime: -1 }
    await exportFrames(video, clip, [0, 1])
    await expect(readVideoEditExportPicture(clip, video, 2 / FPS, NAME)).rejects.toThrow('素材「A.mov」取不到准确的画面：读取到的画面时间不对，请重新导出。')
    expect(late?.close).toHaveBeenCalledOnce()
    await release(clip, delivered.filter(picture => picture !== late))
  })

  it('向后或向前跳过两秒以上时重开读取器，交回旧读取器提前给出的画面', async () => {
    const { video, delivered, starts } = stream(range(0, 200), { skip: [] }); const clip: VideoEditExportClipState = { previousTime: -1 }
    expect((await exportFrames(video, clip, [0, 1, 100, 101, 10])).shown).toEqual([0, 1, 100, 101, 10])
    expect(starts).toEqual([0, 100 / FPS, 10 / FPS])
    await release(clip, delivered)
  })
})
