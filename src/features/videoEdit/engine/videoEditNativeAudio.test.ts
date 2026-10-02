import { expect, it, vi } from 'vitest'
import { createVideoEditNativeClipAudio, openVideoEditNativePcm, videoEditPcmReadRange, type VideoEditNativeSoundChannel, type VideoEditPcmSession } from './videoEditNativeAudio'
import type { VideoEditAudioChunk } from './videoEditFrameSource'

/** A fake native stream: sound only in [startFrame, endFrame); channel c of sample n is c + n / 1e6. */
function fakeSession(sampleRate: number, channels: number, startFrame: number, endFrame: number): VideoEditPcmSession & { reads: Array<[number, number]>; closed: number } {
  const session = {
    sampleRate, channels, reads: [] as Array<[number, number]>, closed: 0,
    async read(first: number, frames: number) {
      session.reads.push([first, frames])
      return Array.from({ length: channels }, (_, channel) => Float32Array.from({ length: frames }, (_, index) => {
        const sample = first + index
        return sample >= startFrame && sample < endFrame ? channel + sample / 1e6 : 0
      }))
    },
    close() { session.closed++ },
  }
  return session
}
async function collect(chunks: AsyncGenerator<VideoEditAudioChunk, void, unknown>): Promise<VideoEditAudioChunk[]> {
  const result: VideoEditAudioChunk[] = []
  for await (const chunk of chunks) result.push(chunk)
  return result
}
function plane(chunk: VideoEditAudioChunk, planeIndex: number): Float32Array {
  const data = new Float32Array(chunk.numberOfFrames); chunk.copyTo(data, { planeIndex, format: 'f32-planar' }); return data
}

it('读取范围按绝对采样边界换算，含前后保护样本与插值所需的下一个样本', () => {
  expect(videoEditPcmReadRange(1, 1.5, 48000)).toEqual({ first: 47999, last: 72002 })
  // Arbitrary microsecond in-point at 44.1kHz: the range still starts at or before the first needed sample.
  const { first, last } = videoEditPcmReadRange(1.2345671, 1.7345671, 44100)
  expect(first).toBeLessThanOrEqual(Math.floor(1.2345671 * 44100)); expect(last).toBeGreaterThan(Math.ceil(1.7345671 * 44100))
  expect(videoEditPcmReadRange(2, 2, 48000)).toEqual({ first: 0, last: 0 })
  expect(() => videoEditPcmReadRange(Number.NaN, 1, 48000)).toThrow('声音读取范围无效。')
  expect(() => videoEditPcmReadRange(0, 1, 44100.5)).toThrow('声音读取范围无效。')
})

it('任意起点读出的块落在源采样网格上，数据与时间一一对应', async () => {
  const session = fakeSession(44100, 2, 0, 44100 * 10)
  const audio = createVideoEditNativeClipAudio(async () => session)
  const [chunk, ...rest] = await collect(audio.chunks(1.2345671, 1.7345671))
  expect(rest).toEqual([])
  const firstFrame = Math.round(chunk.timestamp * 44100)
  expect(chunk.timestamp).toBeCloseTo(firstFrame / 44100, 12); expect(chunk.timestamp).toBeLessThanOrEqual(1.2345671)
  expect(chunk.timestamp + chunk.duration).toBeGreaterThan(1.7345671)
  expect(chunk.duration).toBeCloseTo(chunk.numberOfFrames / 44100, 12)
  expect(chunk.numberOfChannels).toBe(2); expect(chunk.sampleRate).toBe(44100)
  const left = plane(chunk, 0); const right = plane(chunk, 1)
  for (const index of [0, 1, chunk.numberOfFrames - 1]) {
    expect(left[index]).toBeCloseTo((firstFrame + index) / 1e6, 6); expect(right[index]).toBeCloseTo(1 + (firstFrame + index) / 1e6, 6)
  }
  expect(session.reads).toEqual([[firstFrame, chunk.numberOfFrames]])
})

it('长范围拆成连续不重叠的读取，跨块后数据连续', async () => {
  const session = fakeSession(48000, 1, 0, 48000 * 10)
  const chunks = await collect(createVideoEditNativeClipAudio(async () => session).chunks(0.5, 5.5))
  expect(chunks.length).toBe(3)
  for (let index = 1; index < chunks.length; index++) expect(Math.round(chunks[index].timestamp * 48000)).toBe(Math.round((chunks[index - 1].timestamp + chunks[index - 1].duration) * 48000))
  expect(session.reads.map(([, frames]) => frames)).toEqual([96000, 96000, 48003])
  const joined = chunks.flatMap(chunk => [...plane(chunk, 0)])
  const firstFrame = session.reads[0][0]
  expect(joined.every((value, index) => Math.abs(value - (firstFrame + index) / 1e6) < 1e-6)).toBe(true)
})

it('流开始前与结束后由会话补零；负起点照常请求', async () => {
  const session = fakeSession(48000, 2, 24000, 48000)
  const [chunk] = await collect(createVideoEditNativeClipAudio(async () => session).chunks(0, 1.5))
  expect(session.reads[0][0]).toBe(-1)
  const data = plane(chunk, 0)
  expect(data[0]).toBe(0); expect(data[24000]).toBe(0)
  expect(data[24001]).toBeCloseTo(24000 / 1e6, 6)
  expect(data.subarray(48001).every(value => value === 0)).toBe(true)
})

it('多声道按原顺序交付，声道越界、格式错误与释放后读取都报错', async () => {
  const session = fakeSession(48000, 6, 0, 48000)
  const [chunk] = await collect(createVideoEditNativeClipAudio(async () => session).chunks(0, .01))
  expect(chunk.numberOfChannels).toBe(6)
  for (let channel = 0; channel < 6; channel++) expect(plane(chunk, channel)[1]).toBeCloseTo(channel, 5)
  expect(() => plane(chunk, 6)).toThrow('声道序号超出范围。')
  expect(() => chunk.copyTo(new Float32Array(1), { planeIndex: 0, format: 'f32-planar' })).toThrow('声音数据目标空间不足。')
  expect(() => chunk.copyTo(new Float32Array(chunk.numberOfFrames), { planeIndex: 0, format: 'f32' as 'f32-planar' })).toThrow('声音数据只支持平面浮点格式。')
  chunk.close()
  expect(() => plane(chunk, 0)).toThrow('声音数据已释放。')
})

it('会话在首次读取时才打开，失败不缓存；关闭只释放一次，打开中关闭也会释放', async () => {
  const open = vi.fn<[], Promise<VideoEditPcmSession>>()
  const audio = createVideoEditNativeClipAudio(open)
  expect(open).not.toHaveBeenCalled()
  open.mockRejectedValueOnce(new Error('无法读取此声音。'))
  await expect(collect(audio.chunks(0, .1))).rejects.toThrow('无法读取此声音。')
  const session = fakeSession(48000, 2, 0, 48000); open.mockResolvedValue(session)
  expect(await collect(audio.chunks(0, .1))).toHaveLength(1)
  await collect(audio.chunks(.1, .2))
  expect(open).toHaveBeenCalledTimes(2)
  audio.close(); audio.close(); await Promise.resolve()
  expect(session.closed).toBe(1)
  await expect(collect(audio.chunks(0, .1))).rejects.toThrow('声音读取已关闭。')

  let resolve!: (session: VideoEditPcmSession) => void
  const late = fakeSession(48000, 2, 0, 48000)
  const pending = createVideoEditNativeClipAudio(() => new Promise(done => { resolve = done }))
  const reading = collect(pending.chunks(0, .1))
  pending.close(); resolve(late)
  await expect(reading).rejects.toThrow('声音读取已关闭。')
  expect(late.closed).toBe(1)
})

it('会话返回的数据长度或声道数不符、采样率无效时拒绝并释放', async () => {
  const short = { ...fakeSession(48000, 2, 0, 48000), read: async (_first: number, frames: number) => [new Float32Array(frames), new Float32Array(frames - 1)] }
  await expect(collect(createVideoEditNativeClipAudio(async () => short).chunks(0, .1))).rejects.toThrow('原生声音数据不完整。')
  const invalid = fakeSession(0, 2, 0, 0)
  await expect(collect(createVideoEditNativeClipAudio(async () => invalid).chunks(0, .1))).rejects.toThrow('原生声音流的采样率或声道数无效。')
  expect(invalid.closed).toBe(1)
})

it('按混音给的采样率打开会话，采样率改变时关闭旧会话重开；没有这条声音流时无声且不报错', async () => {
  const sessions: Array<VideoEditPcmSession & { closed: number }> = []
  const open = vi.fn(async (rate: number | undefined) => { const session = fakeSession(rate ?? 44100, 2, 0, 1e9); sessions.push(session); return session })
  const audio = createVideoEditNativeClipAudio(open)
  const [first] = await collect(audio.chunks(0, .1, 48000))
  await collect(audio.chunks(.1, .2, 48000))
  expect(first.sampleRate).toBe(48000)
  const [second] = await collect(audio.chunks(.2, .3, 44100))
  expect(second.sampleRate).toBe(44100)
  expect(open.mock.calls.map(([rate]) => rate)).toEqual([48000, 44100])
  await Promise.resolve()
  expect(sessions.map(session => session.closed)).toEqual([1, 0])
  const silent = createVideoEditNativeClipAudio(async () => null)
  expect(await collect(silent.chunks(0, 1, 48000))).toEqual([])
})

it('读取失败丢弃会话，下一次读取重新打开（服务重启或文件恢复后继续出声）', async () => {
  const broken = fakeSession(48000, 1, 0, 48000)
  broken.read = vi.fn(async () => { throw new Error('声音会话不存在或不属于当前窗口') })
  const healthy = fakeSession(48000, 1, 0, 48000)
  const open = vi.fn<[number | undefined], Promise<VideoEditPcmSession>>().mockResolvedValueOnce(broken).mockResolvedValueOnce(healthy)
  const audio = createVideoEditNativeClipAudio(open)
  await expect(collect(audio.chunks(0, .1, 48000))).rejects.toThrow('声音会话不存在')
  await Promise.resolve()
  expect(broken.closed).toBe(1)
  expect(await collect(audio.chunks(0, .1, 48000))).toHaveLength(1)
  expect(open).toHaveBeenCalledTimes(2)
})

it('端口声音会话：按序列采样率打开，读出的缓冲按声道切成平面，错误转为用户语言，只关一次', async () => {
  const pcm = new Float32Array([1, 2, 3, -1, -2, -3])
  const calls: Array<[string, unknown]> = []
  const channel = {
    call: vi.fn(async (method: string, params: unknown) => {
      calls.push([method, params])
      if (method === 'openAudio') return (params as { path: string }).path.includes('silent') ? { found: false, audioStream: 0 } : { found: true, audioId: 'va-1', route: 'r', audioStream: 0, streamIndex: 1, codec: 'pcm_s24le', decoderName: 'pcm_s24le', sampleRate: 48000, sourceSampleRate: 96000, channels: 2, channelLayout: 'stereo', resampler: 'soxr', startSeconds: 0, endSeconds: 1 }
      if (method === 'readAudio') { const { frames } = params as { frames: number }; if (frames === 1) throw new Error('原生视频解码服务异常退出'); return { audioId: 'va-1', startFrame: -1, frames, channels: 2, data: pcm.buffer.slice(0), seeked: false, decodeMs: 0 } }
      return true
    }),
  } as unknown as VideoEditNativeSoundChannel
  expect(await openVideoEditNativePcm(channel, 'D:/silent.mov', '无声', { sampleRate: 48000 })).toBeNull()
  const session = (await openVideoEditNativePcm(channel, 'D:/a.mxf', 'A', { sampleRate: 48000 }))!
  expect(calls[1]).toEqual(['openAudio', { path: 'D:/a.mxf', sampleRate: 48000 }])
  expect(session.sampleRate).toBe(48000); expect(session.channels).toBe(2)
  const planes = await session.read(-1, 3)
  expect(planes.map(plane => [...plane])).toEqual([[1, 2, 3], [-1, -2, -3]])
  await expect(session.read(0, 1)).rejects.toThrow('素材「A」的声音读取失败')
  await expect(session.read(0, 2)).rejects.toThrow('原生声音数据不完整。')
  session.close(); session.close()
  expect(calls.filter(([method]) => method === 'closeAudio')).toEqual([['closeAudio', { audioId: 'va-1' }]])
  const failing = { call: vi.fn(async () => { throw new Error('素材所在目录尚未授权读取') }) } as unknown as VideoEditNativeSoundChannel
  await expect(openVideoEditNativePcm(failing, 'D:/b.mxf', 'B', {})).rejects.toThrow('B')
})
