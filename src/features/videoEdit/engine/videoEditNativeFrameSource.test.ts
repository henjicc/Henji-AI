import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoFrameDecoderInfo, VideoFrameRequestTag, VideoFrameScheduleEvent, VideoFrameStreamEndedPayload } from '@/platform/contracts/videoFrames'
import { VideoEditFrameCache } from './videoEditFrameCache'
import { VideoEditGpuFrame } from './videoEditGpuFrame'
import { VideoEditNativeFrames, type VideoEditNativeChannel } from './videoEditNativeFrameSource'
import { VideoEditNativePicture, videoEditNativeRotation } from './videoEditNativePicture'
import type { NativeVideoFrame } from './videoEditNativeFrames'

type Method = Parameters<VideoEditNativeChannel['call']>[0]

/** The worker's frame channel with the native service behind it replaced by scripted answers. */
class FakeChannel implements VideoEditNativeChannel {
  readonly calls: Array<{ method: Method; params: Record<string, unknown> }> = []
  readonly released: number[] = []
  readonly answers: Partial<Record<Method, (params: Record<string, unknown>) => unknown>> = {}
  private readonly frameHandlers = new Map<string, (frame: NativeVideoFrame) => void>()
  private readonly scheduleHandlers = new Map<string, (event: VideoFrameScheduleEvent) => void>()
  private readonly endedHandlers = new Map<string, (payload: VideoFrameStreamEndedPayload) => void>()
  private nextStream = 0
  intraOnly = false

  call = (async (method: Method, params: Record<string, unknown>) => {
    this.calls.push({ method, params })
    await Promise.resolve()
    const answer = this.answers[method]
    if (answer) return answer(params)
    if (method === 'openDecoder') return this.info(`vf-${++this.nextStream}`)
    if (method === 'frameAt') return { ticket: params.ticket, found: false, seeked: false, decodeMs: 1 }
    if (method === 'schedule') return { scheduleId: params.scheduleId, count: null }
    return true
  }) as VideoEditNativeChannel['call']

  subscribe(streamId: string, handler: (frame: NativeVideoFrame) => void): () => void { this.frameHandlers.set(streamId, handler); return () => this.frameHandlers.delete(streamId) }
  subscribeSchedule(streamId: string, handler: (event: VideoFrameScheduleEvent) => void): () => void { this.scheduleHandlers.set(streamId, handler); return () => this.scheduleHandlers.delete(streamId) }
  subscribeEnded(streamId: string, handler: (payload: VideoFrameStreamEndedPayload) => void): () => void { this.endedHandlers.set(streamId, handler); return () => this.endedHandlers.delete(streamId) }

  info(streamId: string): VideoFrameDecoderInfo {
    return {
      streamId, route: 'r', format: 'nv12', codedSize: { width: 3840, height: 2160 }, visibleRect: { x: 0, y: 0, width: 3840, height: 2160 }, colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'limited' }, fps: 60, poolSize: 8,
      decoder: { codec: 'h264', decoderName: 'h264', hardware: true, hardwareRequested: true, pixelFormat: 'nv12', bitDepth: 8, chromaLog2: [1, 1], hasAlpha: false, path: 'copy_nv12', intraOnly: this.intraOnly },
      timeBase: { num: 1, den: 15360 }, startSeconds: 0, endSeconds: 7, firstFramePtsUs: 0, rotationDegrees: null, purpose: 'seek', color: { matrix: 'bt709', primaries: 'bt709', transfer: 'bt709', range: 'limited', hdrAsSdr: false },
    }
  }

  frame(streamId: string, request: VideoFrameRequestTag | undefined, ptsUs: number, durationUs = 16_667): NativeVideoFrame {
    const native: NativeVideoFrame = {
      frame: { codedWidth: 3840, codedHeight: 2160, visibleRect: { width: 3840, height: 2160 }, format: 'NV12' } as unknown as VideoFrame,
      meta: { route: 'r', streamId, frameIndex: 0, timestampUs: ptsUs, ptsUs, durationUs, ...(request ? { request } : {}) },
      receivedAt: 0,
      release: vi.fn(() => { this.released.push(ptsUs) }),
    }
    const handler = this.frameHandlers.get(streamId)
    if (handler) handler(native); else native.release()
    return native
  }
  event(event: Omit<Extract<VideoFrameScheduleEvent, { type: 'frame_missing' }>, 'route'> | Omit<Extract<VideoFrameScheduleEvent, { type: 'schedule_done' }>, 'route'>): void {
    this.scheduleHandlers.get(event.streamId)?.({ ...event, route: 'r' } as VideoFrameScheduleEvent)
  }
  end(streamId: string): void { this.endedHandlers.get(streamId)?.({ streamId, route: 'r', reason: 'error', message: '解码器崩溃' }) }
  last(method: Method): Record<string, unknown> { return this.calls.filter(call => call.method === method).at(-1)!.params }
}

const media = (overrides: Partial<VideoEditMedia> = {}): VideoEditMedia => ({ id: 'm', name: '专业素材', path: 'henji-media://local/D%3A%2Fa.mov', kind: 'video', width: 3840, height: 2160, durationSeconds: 7, ...overrides })
const flush = async (rounds = 10): Promise<void> => { for (let index = 0; index < rounds; index++) await Promise.resolve() }
function backend(channel: FakeChannel, options: { maxSessions?: number; sound?: boolean; onFailure?: (media: VideoEditMedia, error: unknown) => void } = {}): VideoEditNativeFrames {
  return new VideoEditNativeFrames({ channel, localPath: item => item.path.includes('remote') ? undefined : 'D:/a.mov', ...options })
}

afterEach(() => { vi.useRealTimers() })

describe('原生帧源：连续计划', () => {
  it('每个时间恰好一帧或空，按请求顺序交付；帧与缺帧事件乱序到达也按序号对齐；计划外的帧立即交回', async () => {
    const channel = new FakeChannel()
    const source = await backend(channel).open(media()).ready
    const schedule = source.schedule([0, 1 / 60, 2 / 60, 3 / 60])
    const first = schedule.next()
    await flush()
    const { streamId, scheduleId } = channel.last('schedule') as { streamId: string; scheduleId: string }
    expect(channel.last('openDecoder')).toEqual({ path: 'D:/a.mov', purpose: 'playback' })
    expect(channel.last('schedule')).toMatchObject({ times: [0, 1 / 60, 2 / 60, 3 / 60] })
    channel.frame(streamId, { kind: 'schedule', id: scheduleId, index: 2 }, 33_333)
    channel.event({ type: 'frame_missing', streamId, scheduleId, index: 1, reason: 'no_picture' })
    channel.frame(streamId, { kind: 'schedule', id: 'old-plan', index: 0 }, 99)
    channel.frame(streamId, { kind: 'schedule', id: scheduleId, index: 0 }, 0)
    channel.frame(streamId, { kind: 'schedule', id: scheduleId, index: 3 }, 50_000)
    channel.event({ type: 'schedule_done', streamId, scheduleId, reason: 'completed', message: null, delivered: 3 })
    const pictures = [(await first).value, (await schedule.next()).value, (await schedule.next()).value, (await schedule.next()).value]
    expect(pictures.map(picture => picture instanceof VideoEditNativePicture ? picture.timestamp : picture)).toEqual([0, null, 0.033333, 0.05])
    expect((await schedule.next()).done).toBe(true)
    expect(channel.released).toEqual([99])
    for (const picture of pictures) picture?.close()
    await flush()
    expect(channel.released.sort((a, b) => a - b)).toEqual([0, 99, 33_333, 50_000])
  })

  it('提前结束（时间线切换、停止播放）取消原生计划并交回已到达未取走的帧；同一文件的播放会话复用', async () => {
    const channel = new FakeChannel()
    const frames = backend(channel); const opened = frames.open(media())
    const source = await opened.ready
    const schedule = source.schedule([0, 1 / 60, 2 / 60])
    const first = schedule.next(); await flush()
    const { streamId, scheduleId } = channel.last('schedule') as { streamId: string; scheduleId: string }
    channel.frame(streamId, { kind: 'schedule', id: scheduleId, index: 0 }, 0)
    channel.frame(streamId, { kind: 'schedule', id: scheduleId, index: 1 }, 16_667)
    ;(await first).value?.close()
    await schedule.return()
    await flush()
    expect(channel.calls.filter(call => call.method === 'cancelSchedule')).toEqual([{ method: 'cancelSchedule', params: { streamId, scheduleId } }])
    expect(channel.released).toContain(16_667)
    channel.frame(streamId, { kind: 'schedule', id: scheduleId, index: 2 }, 33_333)
    expect(channel.released).toContain(33_333)
    const again = source.schedule([1]); const waiting = again.next(); await flush()
    expect(channel.calls.filter(call => call.method === 'openDecoder')).toHaveLength(1)
    // Releasing the file closes its sessions; a read still waiting for a frame ends instead of hanging.
    frames.release(opened.key); await frames.settled()
    expect((await waiting).value).toBeNull()
    await again.return()
  })

  it('帧丢失（后面的帧已到）不会卡住播放：宽限期后按缺帧处理；计划失败后剩余各项只等一次宽限', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    const channel = new FakeChannel()
    const source = await backend(channel).open(media()).ready
    const schedule = source.schedule([0, 1 / 60, 2 / 60, 3 / 60])
    const first = schedule.next(); await vi.advanceTimersByTimeAsync(0)
    const { streamId, scheduleId } = channel.last('schedule') as { streamId: string; scheduleId: string }
    channel.frame(streamId, { kind: 'schedule', id: scheduleId, index: 1 }, 16_667)
    await vi.advanceTimersByTimeAsync(999)
    let settled = false; void first.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(0); expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect((await first).value).toBeNull()
    expect((await schedule.next()).value).toBeInstanceOf(VideoEditNativePicture)
    channel.event({ type: 'schedule_done', streamId, scheduleId, reason: 'error', message: '解码失败', delivered: 1 })
    const rest = Promise.all([schedule.next(), schedule.next()])
    await vi.advanceTimersByTimeAsync(1001)
    expect((await rest).map(result => result.value)).toEqual([null, null])
  })

  it('区间计划按计划交付的帧数结束，即使结束事件先于最后的帧到达', async () => {
    const channel = new FakeChannel()
    const clip = (await backend(channel).open(media()).ready).clipFrames()!
    const frames = clip.frames(1)
    const first = frames.next(); await flush()
    const { streamId, scheduleId } = channel.last('schedule') as { streamId: string; scheduleId: string }
    expect(channel.last('schedule')).toMatchObject({ range: { from: 1 } })
    channel.event({ type: 'schedule_done', streamId, scheduleId, reason: 'completed', message: null, delivered: 2 })
    channel.frame(streamId, { kind: 'schedule', id: scheduleId, index: 0 }, 1_000_000)
    expect((await first).value?.timestamp).toBe(1)
    const second = frames.next()
    channel.frame(streamId, { kind: 'schedule', id: scheduleId, index: 1 }, 1_016_667)
    expect((await second).value?.timestamp).toBeCloseTo(1.016667, 6)
    expect((await frames.next()).done).toBe(true)
    await flush()
    expect(channel.calls.filter(call => call.method === 'closeStream')).toEqual([{ method: 'closeStream', params: { streamId } }])
  })

  it('原生流异常结束：等待中的读取立即失败并给出用户语言，不会一直等帧', async () => {
    const channel = new FakeChannel()
    const clip = (await backend(channel).open(media()).ready).clipFrames()!
    const frames = clip.frames(0)
    const pending = frames.next(); await flush()
    channel.end((channel.last('schedule') as { streamId: string }).streamId)
    await expect(pending).rejects.toThrow('素材「专业素材」解码失败')
  })
})

describe('原生帧源：单帧与会话', () => {
  it('按时间取单帧：命中时等帧到达再交付（帧与响应经不同通道），未命中为空，放弃的帧交回', async () => {
    const channel = new FakeChannel()
    const clip = (await backend(channel).open(media()).ready).clipFrames()!
    channel.answers.frameAt = params => { setTimeout(() => channel.frame('vf-1', { kind: 'frame_at', id: params.ticket as string }, 500_000, 0), 5); return { ticket: params.ticket, found: true, ptsUs: 500_000, seeked: true, decodeMs: 3 } }
    const picture = await clip.frameAt(0.5)
    expect(channel.last('openDecoder')).toEqual({ path: 'D:/a.mov', purpose: 'seek' })
    expect(picture).toMatchObject({ timestamp: 0.5, duration: 1 / 60, displayWidth: 3840, displayHeight: 2160, rotation: 0, format: 'NV12' })
    channel.answers.frameAt = params => { channel.frame('vf-1', { kind: 'frame_at', id: params.ticket as string }, 600_000); return { ticket: params.ticket, found: false, seeked: false, decodeMs: 1 } }
    expect(await clip.frameAt(9)).toBeNull()
    await flush()
    expect(channel.released).toEqual([600_000])
  })

  it('同一文件同一版本共用一个文件源；释放到最后一个使用者时关闭全部会话；没有本地路径给出可操作提示', async () => {
    const channel = new FakeChannel()
    const frames = backend(channel)
    const first = frames.open(media()); const second = frames.open(media())
    expect(await first.ready).toBe(await second.ready)
    const source = await first.ready
    await source.clipFrames()!.frameAt(1)
    void source.schedule([0]).next(); await flush()
    expect(frames.openSessions).toBe(2)
    frames.release(first.key); await frames.settled(); expect(channel.calls.some(call => call.method === 'closeStream')).toBe(false)
    frames.release(second.key); await frames.settled()
    expect(channel.calls.filter(call => call.method === 'closeStream').map(call => call.params.streamId).sort()).toEqual(['vf-1', 'vf-2'])
    expect(frames.openSessions).toBe(0)
    await expect(frames.open(media({ path: 'remote' })).ready).rejects.toThrow('重新定位源文件')
  })

  it('会话数达到上限时给出用户语言提示；打开失败转为可操作提示并通知路由层，失败不占用会话名额', async () => {
    const channel = new FakeChannel(); const onFailure = vi.fn()
    const frames = backend(channel, { maxSessions: 1, onFailure })
    const source = await frames.open(media()).ready
    await source.clipFrames()!.frameAt(0)
    await expect(source.clipFrames()!.frames(0).next()).rejects.toThrow('同时读取的视频素材过多')
    const other = await frames.open(media({ path: 'henji-media://local/b', sourceRevision: 'r2' })).ready
    channel.answers.openDecoder = () => { throw new Error('OPEN_FAILED: 无法打开文件') }
    const relaxed = backend(channel, { onFailure })
    await expect((await relaxed.open(media()).ready).clipFrames()!.frameAt(0)).rejects.toThrow('素材「专业素材」无法读取')
    expect(onFailure).toHaveBeenCalledOnce(); expect(relaxed.openSessions).toBe(0)
    // A moved or deleted file gets the same relink hint as on the browser backend.
    channel.answers.openDecoder = () => { throw new Error('无法打开文件：No such file or directory') }
    await expect((await backend(channel).open(media({ sourceRevision: 'moved' })).ready).clipFrames()!.frameAt(0)).rejects.toThrow('找不到素材「专业素材」的源文件')
    // Sound sessions are separate from picture sessions: the limit does not apply to them.
    expect(other.clipAudio()).toBeDefined()
  })

  it('无画面的文件没有画面读取器，计划为空，但有声音读取器（原生声音已接通）', async () => {
    const source = await backend(new FakeChannel()).open(media({ kind: 'audio' })).ready
    expect(source.clipFrames()).toBeUndefined(); expect(source.clipAudio()).toBeDefined()
    expect((await source.schedule([0]).next()).done).toBe(true)
  })
})

describe('原生帧：借用与方向', () => {
  it('显示旋转按 FFmpeg 显示矩阵取反为顺时针，与浏览器后端一致', () => {
    expect([null, 0, -90, 90, 180, -180, 270].map(videoEditNativeRotation)).toEqual([0, 0, 90, 270, 180, 180, 90])
  })

  it('画面关闭时等 GPU 读取完成再交回，只交回一次，交回后不能再取帧', async () => {
    const release = vi.fn()
    const native = { frame: { codedWidth: 1920, codedHeight: 1088, visibleRect: { width: 1920, height: 1080 }, format: null }, meta: { route: 'r', streamId: 's', frameIndex: 0, timestampUs: 2_000_000, ptsUs: 2_000_000 }, receivedAt: 0, release } as unknown as NativeVideoFrame
    const picture = new VideoEditNativePicture(native, 90, 1 / 30)
    expect(picture).toMatchObject({ timestamp: 2, duration: 1 / 30, displayWidth: 1080, displayHeight: 1920, codedHeight: 1088, format: null })
    let finish!: () => void
    picture.holdUntil(new Promise<void>(resolve => { finish = resolve }))
    picture.close(); picture.close()
    await flush(); expect(release).not.toHaveBeenCalled()
    finish(); await flush(); expect(release).toHaveBeenCalledOnce()
    expect(() => picture.frame).toThrow('预览帧已释放')
  })
})

describe('原生定位器', () => {
  const owned = (picture: { timestamp: number; duration: number }): VideoEditGpuFrame => new VideoEditGpuFrame({ timestamp: picture.timestamp, duration: picture.duration, displayWidth: 3840, displayHeight: 2160, rotation: 0, flip: false }, {} as never, undefined, 100, () => {})
  const snapshot = vi.fn(async (picture: { timestamp: number; duration: number }) => owned(picture))

  it('帧内编码素材直接取目标帧，复制后交回并放进共享缓存，再次定位命中缓存', async () => {
    const channel = new FakeChannel(); channel.intraOnly = true
    channel.answers.frameAt = params => { channel.frame('vf-1', { kind: 'frame_at', id: params.ticket as string }, 2_000_000); return { ticket: params.ticket, found: true, seeked: true, decodeMs: 2 } }
    const cache = new VideoEditFrameCache(1024 ** 3)
    const seeker = backend(channel).seeker(media(), cache, snapshot)
    const result = await seeker.sample(2.005, 0)
    expect(result.hit).toBe(false); expect(result.sample?.timestamp).toBe(2)
    expect(channel.calls.filter(call => call.method === 'schedule')).toHaveLength(0)
    await flush(); expect(channel.released).toEqual([2_000_000])
    expect((await seeker.sample(2.01, 1)).hit).toBe(true)
    await seeker.dispose(); expect(cache.bytes).toBe(0)
  })

  it('长 GOP 素材按一秒窗口整段解码进缓存：等待者拿到目标帧，同窗口后续定位命中缓存；拖动方向预取相邻窗口，前台定位优先', async () => {
    const channel = new FakeChannel()
    const cache = new VideoEditFrameCache(1024 ** 3)
    const seeker = backend(channel).seeker(media(), cache, snapshot)
    const target = seeker.sample(3.5, 0)
    await flush()
    const first = channel.last('schedule') as { streamId: string; scheduleId: string; range: unknown }
    expect(first.range).toEqual({ from: 3, to: 4 })
    for (let index = 0; index < 60; index++) channel.frame(first.streamId, { kind: 'schedule', id: first.scheduleId, index }, Math.round((3 + index / 60) * 1e6))
    channel.event({ type: 'schedule_done', streamId: first.streamId, scheduleId: first.scheduleId, reason: 'completed', message: null, delivered: 60 })
    expect((await target).sample?.timestamp).toBe(3.5)
    await flush(400)
    expect((await seeker.sample(3.9, -1)).hit).toBe(true)
    await flush(40)
    const prefetch = channel.last('schedule') as { scheduleId: string; range: unknown }
    expect(prefetch.range).toEqual({ from: 2, to: 3 })
    // A jump elsewhere cancels the speculative window before decoding the requested one.
    const jump = seeker.sample(6.2, 0)
    await flush(); await flush()
    expect(channel.calls.filter(call => call.method === 'cancelSchedule').map(call => call.params.scheduleId)).toContain(prefetch.scheduleId)
    const foreground = channel.last('schedule') as { streamId: string; scheduleId: string; range: unknown }
    expect(foreground.range).toEqual({ from: 6, to: 7 })
    channel.frame(foreground.streamId, { kind: 'schedule', id: foreground.scheduleId, index: 0 }, 6_200_000, 40_000)
    channel.event({ type: 'schedule_done', streamId: foreground.streamId, scheduleId: foreground.scheduleId, reason: 'completed', message: null, delivered: 1 })
    expect((await jump).sample?.timestamp).toBe(6.2)
    await seeker.dispose()
    expect(cache.bytes).toBe(0)
  })
})

describe('原生声音', () => {
  it('片段声音读取器经同一通道打开声音会话（按混音采样率），读完关闭；不占画面会话名额', async () => {
    const channel = new FakeChannel()
    channel.answers.openAudio = () => ({ found: true, audioId: 'va-1', route: 'r', audioStream: 0, streamIndex: 1, codec: 'pcm_s24le', decoderName: 'pcm_s24le', sampleRate: 48000, sourceSampleRate: 48000, channels: 1, channelLayout: 'mono', resampler: 'none', startSeconds: 0, endSeconds: 3 })
    channel.answers.readAudio = params => ({ audioId: 'va-1', startFrame: params.startFrame, frames: params.frames, channels: 1, data: new Float32Array(params.frames as number).fill(.5).buffer, seeked: false, decodeMs: 0 })
    const frames = backend(channel, { sound: true, maxSessions: 1 })
    const { key, ready } = frames.open(media({ kind: 'audio' }))
    const source = await ready
    expect(source.clipFrames()).toBeUndefined()
    const audio = source.clipAudio()!
    expect(channel.calls).toEqual([])
    const chunks = []
    for await (const chunk of audio.chunks(1, 1.1, 48000)) chunks.push(chunk)
    expect(chunks).toHaveLength(1); expect(chunks[0].sampleRate).toBe(48000)
    expect(channel.last('openAudio')).toEqual({ path: 'D:/a.mov', sampleRate: 48000 })
    expect(frames.openSessions).toBe(0)
    audio.close?.(); await flush()
    expect(channel.last('closeAudio')).toEqual({ audioId: 'va-1' })
    frames.release(key)
  })

  it('原生声音未就绪、明确无声的视频、图片都没有声音读取器；打开失败通知路由层并给出用户语言提示', async () => {
    const channel = new FakeChannel()
    expect((await backend(channel, { sound: false }).open(media()).ready).clipAudio()).toBeUndefined()
    expect((await backend(channel).open(media()).ready).clipAudio()).toBeDefined()
    expect((await backend(channel, { sound: true }).open(media({ hasAudio: false })).ready).clipAudio()).toBeUndefined()
    const failures: unknown[] = []
    channel.answers.openAudio = () => { throw new Error('No such file or directory') }
    const audio = (await backend(channel, { sound: true, onFailure: (_media, error) => failures.push(error) }).open(media({ path: 'henji-media://local/D%3A%2Fmissing.mov' })).ready).clipAudio()!
    const drained = (async () => { for await (const chunk of audio.chunks(0, .1, 48000)) void chunk })()
    await expect(drained).rejects.toThrow('找不到素材「专业素材」的源文件')
    expect(failures).toHaveLength(1)
  })
})
