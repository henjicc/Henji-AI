import { describe, expect, it, vi } from 'vitest'
import { nativeStreamDecodable, nativeVideoDecoderStatus, probeNativeMedia, videoDecoderForcedBackend, type MediaProbeService } from './media-probe'
import { VideoDecoderError, type VideoDecoderErrorCode, type VideoDecoderHello, type VideoDecoderProbeResult } from './protocol'

const hello = { ffmpeg: { videoDecoders: ['h264', 'prores', 'dnxhd', 'mpeg2video', 'libdav1d'], audioDecoders: ['aac', 'pcm_s24le', 'mp2', 'mp3float'] } } as unknown as VideoDecoderHello
const result: VideoDecoderProbeResult = {
  path: 'D:\\a.mxf',
  container: { formatName: 'mxf', formatLongName: 'MXF', durationSeconds: 3.003, startTimeSeconds: 0, bitRate: 1 },
  primaryVideoStreamIndex: 0,
  primaryAudioStreamIndex: 1,
  streams: [
    { index: 0, kind: 'video', codec: 'dnxhd', codecLongName: 'VC3', profile: 'DNXHR HQ', codecTag: null, timeBase: null, startTimeSeconds: 0, durationSeconds: 3.003, frameCount: 180, bitRate: null, isDefault: true, isAttachedPicture: false,
      video: { width: 1920, height: 1080, pixelFormat: 'yuv422p', bitDepth: 8, chromaSubsampling: '4:2:2', isRgb: false, hasAlpha: false, avgFrameRate: { num: 60, den: 1 }, realFrameRate: { num: 60, den: 1 }, frameRate: 60, sampleAspectRatio: null, fieldOrder: 'progressive', rotationDegrees: null, color: { range: 'tv', primaries: null, transfer: null, matrix: null, chromaLocation: null }, hdr: false } },
    { index: 1, kind: 'audio', codec: 'pcm_s24le', codecLongName: 'PCM', profile: null, codecTag: null, timeBase: null, startTimeSeconds: 0, durationSeconds: 3.003, frameCount: null, bitRate: null, isDefault: true, isAttachedPicture: false,
      audio: { sampleRate: 48000, channels: 1, channelLayout: null, sampleFormat: 's32', bitsPerSample: 24 } },
    { index: 2, kind: 'data', codec: null, codecLongName: null, profile: null, codecTag: null, timeBase: null, startTimeSeconds: null, durationSeconds: null, frameCount: null, bitRate: null, isDefault: false, isAttachedPicture: false },
  ],
}
const logger = () => ({ warn: vi.fn(), debug: vi.fn() })

describe('原生素材探测', () => {
  it('按握手解码器清单判断可解码，编码名与解码器名不同时按别名', () => {
    expect(nativeStreamDecodable('prores', 'video', hello)).toBe(true)
    expect(nativeStreamDecodable('av1', 'video', hello)).toBe(true)
    expect(nativeStreamDecodable('mp3', 'audio', hello)).toBe(true)
    expect(nativeStreamDecodable('cfhd', 'video', hello)).toBe(false)
    expect(nativeStreamDecodable('aac', 'video', hello)).toBe(false)
    expect(nativeStreamDecodable(null, 'data', hello)).toBe(false)
  })

  it('探测成功映射为渲染层契约，只带剪辑需要的字段', async () => {
    const service: MediaProbeService = { ensureStarted: async () => hello, probe: async () => result }
    const outcome = await probeNativeMedia(service, 'D:\\a.mxf', logger())
    expect(outcome.status).toBe('probed')
    if (outcome.status !== 'probed') return
    expect(outcome.probe.container).toEqual({ formatName: 'mxf', startTimeSeconds: 0, durationSeconds: 3.003 })
    expect(outcome.probe.streams.map((stream) => [stream.kind, stream.codec, stream.decodable])).toEqual([['video', 'dnxhd', true], ['audio', 'pcm_s24le', true], ['data', null, false]])
    expect(outcome.probe.streams[0].video).toEqual({ width: 1920, height: 1080, bitDepth: 8, chromaSubsampling: '4:2:2', hasAlpha: false, avgFrameRate: { num: 60, den: 1 }, realFrameRate: { num: 60, den: 1 }, rotationDegrees: null })
    expect(outcome.probe.streams[1].audio).toEqual({ sampleRate: 48000, channels: 1 })
  })

  it.each<[VideoDecoderErrorCode, 'unreadable' | 'unavailable']>([
    ['OPEN_FAILED', 'unreadable'], ['STREAM_INFO_FAILED', 'unreadable'], ['INVALID_REQUEST', 'unreadable'],
    ['UNAVAILABLE', 'unavailable'], ['START_FAILED', 'unavailable'], ['HANDSHAKE_FAILED', 'unavailable'], ['PROCESS_EXITED', 'unavailable'],
    ['TIMEOUT', 'unavailable'], ['PROTOCOL_ERROR', 'unavailable'], ['STOPPED', 'unavailable'], ['CANCELLED', 'unavailable'],
  ])('服务错误 %s 映射为 %s，不抛给渲染层', async (code, status) => {
    const log = logger()
    const service: MediaProbeService = { ensureStarted: async () => hello, probe: async () => { throw new VideoDecoderError(code, '失败') } }
    expect((await probeNativeMedia(service, 'D:\\a.mov', log)).status).toBe(status)
    expect(log.warn).toHaveBeenCalledTimes(status === 'unavailable' && code !== 'CANCELLED' ? 1 : 0)
  })

  it('启动失败（未安装、其他平台）按不可用处理；状态查询不抛错', async () => {
    const probe = vi.fn()
    const service: MediaProbeService = { ensureStarted: async () => { throw new VideoDecoderError('UNAVAILABLE', '未安装') }, probe }
    expect(await probeNativeMedia(service, 'D:\\a.mov', logger())).toEqual({ status: 'unavailable' })
    expect(probe).not.toHaveBeenCalled()
    expect(await nativeVideoDecoderStatus(service, 'browser')).toEqual({ available: false, forcedBackend: 'browser' })
    expect(await nativeVideoDecoderStatus({ ensureStarted: async () => hello }, null)).toEqual({ available: true, forcedBackend: null })
  })

  it('诊断变量只认 native/browser，无效值记警告并按自动处理', () => {
    const log = logger()
    expect(videoDecoderForcedBackend({}, log)).toBeNull()
    expect(videoDecoderForcedBackend({ HENJI_VIDEO_DECODER: 'Native' }, log)).toBe('native')
    expect(videoDecoderForcedBackend({ HENJI_VIDEO_DECODER: 'browser' }, log)).toBe('browser')
    expect(videoDecoderForcedBackend({ HENJI_VIDEO_DECODER: 'gpu' }, log)).toBeNull()
    expect(log.warn).toHaveBeenCalledOnce()
  })
})
