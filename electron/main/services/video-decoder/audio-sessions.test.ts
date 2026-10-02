import { describe, expect, it, vi } from 'vitest'
import { parseVideoAudioOpenRequest, parseVideoAudioReadRequest, VideoAudioSessions, type VideoAudioSessionService } from './audio-sessions'
import type { VideoDecoderLifecycleEvent } from './client'
import type { VideoFrameTarget } from './texture-bridge'

function target(id: number) {
  const gone = new Set<(reason: string) => void>()
  const value = {
    id, destroyed: false,
    isDestroyed: () => value.destroyed,
    mainFrame: {} as VideoFrameTarget['mainFrame'],
    send: vi.fn(),
    onGone: vi.fn((listener: (reason: string) => void) => { gone.add(listener); return () => gone.delete(listener) }),
    gone: (reason: string) => { for (const listener of [...gone]) listener(reason) },
    listeners: () => gone.size,
  }
  return value
}

function harness(options: { channels?: number; found?: boolean; maxSessionsPerTarget?: number } = {}) {
  const lifecycle = new Set<(event: VideoDecoderLifecycleEvent) => void>()
  const closed: string[] = []
  const service = {
    openAudio: vi.fn(async (request: { audioId: string; audioStream?: number; sampleRate?: number }) => options.found === false
      ? { found: false as const, audioStream: request.audioStream ?? 0 }
      : { found: true as const, audioId: request.audioId, audioStream: request.audioStream ?? 0, streamIndex: 1, codec: 'aac', decoderName: 'aac', sampleRate: request.sampleRate ?? 44100, sourceSampleRate: 44100, channels: options.channels ?? 2, channelLayout: 'stereo', resampler: request.sampleRate && request.sampleRate !== 44100 ? 'soxr' as const : 'none' as const, startSeconds: 0, endSeconds: 2, setupMs: 3 }),
    readAudio: vi.fn(async (audioId: string, startFrame: number, frames: number) => ({ audioId, startFrame, frames, channels: options.channels ?? 2, data: Buffer.alloc(frames * (options.channels ?? 2) * 4), seeked: false, decodeMs: 0 })),
    closeAudio: vi.fn(async (audioId: string) => { closed.push(audioId); return { closed: true } }),
    onLifecycle: (listener: (event: VideoDecoderLifecycleEvent) => void) => { lifecycle.add(listener); return () => lifecycle.delete(listener) },
  } satisfies VideoAudioSessionService
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const sessions = new VideoAudioSessions({ service, logger, maxSessionsPerTarget: options.maxSessionsPerTarget })
  return { sessions, service, closed, logger, exit: () => { for (const listener of lifecycle) listener({ type: 'exited', pid: 1 }) } }
}

describe('VideoAudioSessions', () => {
  it('校验打开与读取参数', () => {
    expect(parseVideoAudioOpenRequest({ route: 'vf-route-1', path: 'D:\\a.mxf', audioStream: 2, sampleRate: 48000 })).toEqual({ route: 'vf-route-1', path: 'D:\\a.mxf', audioStream: 2, sampleRate: 48000 })
    expect(() => parseVideoAudioOpenRequest({ route: 'vf-route-1', path: 'D:\\a.mxf', sampleRate: 48000.5 })).toThrow('sampleRate')
    expect(() => parseVideoAudioOpenRequest({ route: 'a b', path: 'D:\\a.mxf' })).toThrow('route')
    expect(parseVideoAudioReadRequest({ audioId: 'va-3', startFrame: -1, frames: 96003 })).toEqual({ audioId: 'va-3', startFrame: -1, frames: 96003 })
    expect(() => parseVideoAudioReadRequest({ audioId: 'va-3', startFrame: 0, frames: 0 })).toThrow('frames')
    expect(() => parseVideoAudioReadRequest({ audioId: 'va-3', startFrame: 0.5, frames: 1 })).toThrow('startFrame')
    expect(() => parseVideoAudioReadRequest({ audioId: 'vf-1', startFrame: 0, frames: 1 })).toThrow('audioId')
  })

  it('会话归属打开它的窗口与通道；读取校验数据长度；没有这条声音流时不登记会话', async () => {
    const { sessions, service, closed } = harness()
    const owner = target(1)
    const info = await sessions.open(owner, { route: 'r1', path: 'D:\\a.mov', sampleRate: 48000 })
    expect(info).toMatchObject({ found: true, route: 'r1', sampleRate: 48000, sourceSampleRate: 44100, resampler: 'soxr', channels: 2 })
    expect(info).not.toHaveProperty('setupMs')
    const audioId = info.found ? info.audioId : ''
    const read = await sessions.read(1, { audioId, startFrame: -1, frames: 10 })
    expect(read).toMatchObject({ audioId, startFrame: -1, frames: 10, channels: 2 })
    expect(read.data.byteLength).toBe(80)
    await expect(sessions.read(2, { audioId, startFrame: 0, frames: 10 })).rejects.toThrow('不属于当前窗口')
    expect(await sessions.close(audioId, 2)).toBe(false)
    service.readAudio.mockResolvedValueOnce({ audioId, startFrame: 0, frames: 10, channels: 2, data: Buffer.alloc(79), seeked: false, decodeMs: 0 })
    await expect(sessions.read(1, { audioId, startFrame: 0, frames: 10 })).rejects.toThrow('与请求不符')
    expect(await sessions.close(audioId, 1)).toBe(true)
    expect(closed).toEqual([audioId])
    await expect(sessions.read(1, { audioId, startFrame: 0, frames: 10 })).rejects.toThrow('不存在')
    const silent = harness({ found: false })
    expect(await silent.sessions.open(owner, { route: 'r1', path: 'D:\\a.mov', audioStream: 3 })).toEqual({ found: false, audioStream: 3 })
    expect(silent.sessions.size).toBe(0)
  })

  it('通道断开、窗口失效、服务退出都清理会话；每个窗口只登记一个失效监听；超出上限拒绝', async () => {
    const { sessions, closed, exit } = harness({ maxSessionsPerTarget: 3 })
    const window = target(1)
    const ids: string[] = []
    for (const route of ['r1', 'r1', 'r2']) { const info = await sessions.open(window, { route, path: 'D:\\a.mov' }); if (info.found) ids.push(info.audioId) }
    expect(window.onGone).toHaveBeenCalledTimes(1)
    await expect(sessions.open(window, { route: 'r2', path: 'D:\\a.mov' })).rejects.toThrow('最多 3 路')
    expect(await sessions.closeRoute(1, 'r1')).toBe(2)
    expect(closed).toEqual(ids.slice(0, 2))
    window.gone('destroyed')
    await vi.waitFor(() => expect(closed).toEqual(ids))
    expect(sessions.size).toBe(0); expect(window.listeners()).toBe(0)
    const again = await sessions.open(window, { route: 'r3', path: 'D:\\a.mov' })
    expect(again.found).toBe(true)
    exit()
    expect(sessions.size).toBe(0); expect(window.listeners()).toBe(0)
  })
})
