import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { canEncodeAudio, canEncodeVideo } from 'mediabunny'
import { assertVideoEditExportAudioSupported, canEncodeVideoEditExportAudio, selectVideoEditExportEncoder, videoEditExportAudioUserError, videoEditExportVideoOptions } from './videoEditExportEncoder'
vi.mock('mediabunny', () => ({ canEncodeAudio: vi.fn(), canEncodeVideo: vi.fn() }))
const spec = { width: 7680, height: 4320, frameRate: 120, bitrate: 80_000_000 }
beforeEach(() => { vi.mocked(canEncodeVideo).mockReset(); vi.mocked(canEncodeAudio).mockReset() })
afterEach(() => { vi.unstubAllGlobals() })
it('8K/120与竖屏优先探测HEVC并使用实际尺寸、帧率、码率', async () => {
  vi.mocked(canEncodeVideo).mockResolvedValue(true)
  expect(await selectVideoEditExportEncoder(spec)).toBe('hevc')
  expect(canEncodeVideo).toHaveBeenCalledWith('hevc', spec)
  expect(await selectVideoEditExportEncoder({ ...spec, width: 4320, height: 7680 })).toBe('hevc')
})
it('普通规格保留H.264优先，设备不支持时尝试HEVC', async () => {
  vi.mocked(canEncodeVideo).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
  expect(await selectVideoEditExportEncoder({ ...spec, width: 1920, height: 1080 })).toBe('hevc')
  expect(vi.mocked(canEncodeVideo).mock.calls.map(call => call[0])).toEqual(['avc', 'hevc'])
})
it('两种编码都不支持时说明不可用规格与恢复方式', async () => {
  vi.mocked(canEncodeVideo).mockResolvedValue(false)
  await expect(selectVideoEditExportEncoder(spec)).rejects.toThrow('当前设备无法导出 7680 × 4320 · 120 帧视频。请降低导出分辨率或帧率后重试。')
})

it('显式选H264不自动换HEVC，探测完整CBR/软件配置；关键帧秒数进入编码选项', async () => {
  vi.mocked(canEncodeVideo).mockResolvedValue(false)
  await expect(selectVideoEditExportEncoder({ ...spec, codec: 'avc', bitrateMode: 'cbr', encoderPreference: 'software' })).rejects.toThrow('HEVC')
  expect(canEncodeVideo).toHaveBeenCalledOnce(); expect(canEncodeVideo).toHaveBeenCalledWith('avc', { ...spec, bitrateMode: 'constant', hardwareAcceleration: 'prefer-software' })
  expect(videoEditExportVideoOptions({ codec: 'hevc', videoBitrateMbps: 50, bitrateMode: 'cbr', encoderPreference: 'software', keyframeInterval: 2 })).toEqual({ codec: 'hevc', bitrate: 50_000_000, bitrateMode: 'constant', hardwareAcceleration: 'prefer-software', keyFrameInterval: 2 })
})

it('复用Mediabunny完整音频配置缓存，合并并发探测；采样率、声道、码率和编码分别判断', async () => {
  const actual = await vi.importActual<typeof import('mediabunny')>('mediabunny')
  vi.mocked(canEncodeAudio).mockImplementation(actual.canEncodeAudio)
  const nativeProbe = vi.fn(async (config: AudioEncoderConfig) => ({ supported: config.bitrate! <= 192000, config }))
  vi.stubGlobal('AudioEncoder', { isConfigSupported: nativeProbe })
  const audio = { codec: 'aac' as const, sampleRate: 48000, numberOfChannels: 2, bitrate: 320000 }
  expect(await Promise.all([canEncodeVideoEditExportAudio(audio), canEncodeVideoEditExportAudio(audio)])).toEqual([false, false])
  expect(await canEncodeVideoEditExportAudio(audio)).toBe(false)
  expect(nativeProbe).toHaveBeenCalledOnce()
  expect(nativeProbe).toHaveBeenCalledWith(expect.objectContaining({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 320000 }))
  expect(await canEncodeVideoEditExportAudio({ ...audio, bitrate: 192000 })).toBe(true)
  await canEncodeVideoEditExportAudio({ ...audio, sampleRate: 44100 })
  await canEncodeVideoEditExportAudio({ ...audio, numberOfChannels: 1 })
  expect(nativeProbe).toHaveBeenCalledTimes(4)
  expect(await canEncodeVideoEditExportAudio({ ...audio, codec: 'pcm-s24', bitrate: undefined })).toBe(true)
  expect(nativeProbe).toHaveBeenCalledTimes(4)
})

it('不支持的AAC提交返回中文与已探测的低码率建议，PCM与无声视频不受AAC限制', async () => {
  vi.mocked(canEncodeAudio).mockImplementation(async (codec, options) => codec === 'pcm-s24' || Number(options?.bitrate) <= 192000)
  const settings = { audioEnabled: true, audioCodec: 'aac' as const, audioBitrateKbps: 320, sampleRate: 44100 as const, channels: 1 as const }
  await expect(assertVideoEditExportAudioSupported(settings)).rejects.toThrow('此设备的 AAC 编码不支持 320 kbps（44.1 kHz，单声道），请改用 192 kbps 或更低。')
  await expect(assertVideoEditExportAudioSupported({ ...settings, audioBitrateKbps: 192 })).resolves.toBeUndefined()
  await expect(assertVideoEditExportAudioSupported({ ...settings, audioCodec: 'wav' })).resolves.toBeUndefined()
  vi.mocked(canEncodeAudio).mockClear()
  await expect(assertVideoEditExportAudioSupported({ ...settings, audioEnabled: false })).resolves.toBeUndefined()
  expect(canEncodeAudio).not.toHaveBeenCalled()
})

it('探测异常与底层AAC拒绝不向用户暴露英文，保留原始cause；其他错误保持原样', async () => {
  const nativeError = new Error('This specific encoder configuration (mp4a.40.2, 320000 bps, 2 channels, 48000 Hz) is not supported in this environment.')
  const settings = { audioEnabled: true, audioCodec: 'aac' as const, audioBitrateKbps: 320, sampleRate: 48000 as const, channels: 2 as const }
  vi.mocked(canEncodeAudio).mockRejectedValue(nativeError)
  await expect(assertVideoEditExportAudioSupported(settings)).rejects.toThrow('无法检查此设备的音频编码支持')
  expect(videoEditExportAudioUserError(nativeError, settings)).toMatchObject({ message: expect.stringContaining('此设备的 AAC 编码不支持 320 kbps'), cause: nativeError })
  const other = new Error('disk refused'); expect(videoEditExportAudioUserError(other, settings)).toBe(other)
})
