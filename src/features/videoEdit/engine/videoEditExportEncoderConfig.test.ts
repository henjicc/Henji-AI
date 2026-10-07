import { afterEach, expect, it, vi } from 'vitest'
import { AudioSample, AudioSampleSource, BufferTarget, Mp4OutputFormat, Output, VideoSample, VideoSampleSource } from 'mediabunny'
import { videoEditSequenceExportSettings } from '@/core/videoEdit/exportPresets'
import { adaptVideoEditExportPreset, assertVideoEditExportSupported, canEncodeVideoEditExport, canEncodeVideoEditExportAudio, probeVideoEditExport, videoEditExportAudioOptions, videoEditExportVideoOptions } from './videoEditExportEncoder'
import { videoEditExportVideoEncoderConfig } from './videoEditExportEncoderConfig'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it.each([
  ['avc', 1920, 1080, 30, 'avc1.640028'], ['avc', 1920, 1080, 60, 'avc1.64002a'],
  ['avc', 3840, 2160, 30, 'avc1.640033'], ['avc', 3840, 2160, 60, 'avc1.640034'],
  ['avc', 2160, 3840, 60, 'avc1.640034'], ['avc', 3840, 2160, 120, 'avc1.64003c'],
  ['avc', 7680, 4320, 30, 'avc1.64003c'], ['avc', 7680, 4320, 60, 'avc1.64003d'], ['avc', 7680, 4320, 120, 'avc1.64003e'],
  ['hevc', 3840, 2160, 30, 'hev1.1.6.L150.B0'], ['hevc', 3840, 2160, 60, 'hev1.1.6.L153.B0'],
  ['hevc', 3840, 2160, 120, 'hev1.1.6.L156.B0'], ['hevc', 7680, 4320, 60, 'hev1.1.6.L183.B0'], ['hevc', 7680, 4320, 120, 'hev1.1.6.L186.B0'],
] as const)('%s %i×%i@%i同时按画幅、码率与每秒处理量选择level', (codec, width, height, frameRate, expected) => {
  expect(videoEditExportVideoEncoderConfig({ codec, width, height, frameRate, bitrate: 12_000_000 }).codec).toBe(expected)
})

it.each([12, 45, 50])('4K60/%iMbps：适配、严格校验、真实Mediabunny configure配置逐字段相等', async videoBitrateMbps => {
  const settings = { ...videoEditSequenceExportSettings({ width: 3840, height: 2160, fps: 60, sampleRate: 44100, channels: 1 }), videoBitrateMbps }
  const nativeProbe = vi.fn(async (config: VideoEncoderConfig) => ({ config, supported: config.codec === 'avc1.640034' && config.hardwareAcceleration === 'prefer-software' }))
  const configure = vi.fn((_config: VideoEncoderConfig) => { throw new Error('native boundary reached') })
  vi.stubGlobal('VideoEncoder', class { static isConfigSupported = nativeProbe; configure = configure; state = 'unconfigured'; close() {} })
  vi.stubGlobal('AudioEncoder', { isConfigSupported: async (config: AudioEncoderConfig) => ({ config, supported: true }) })
  const adapted = await adaptVideoEditExportPreset(settings)
  expect(adapted).toMatchObject({ codec: 'avc', encoderPreference: 'software', bitrateMode: 'vbr', fps: 60, videoBitrateMbps })
  const accepted = nativeProbe.mock.calls.find(([config]) => config.hardwareAcceleration === 'prefer-software')![0]
  expect(accepted.codec).toBe('avc1.640034')
  expect(nativeProbe.mock.calls.every(([config]) => config.codec !== 'avc1.640033')).toBe(true)
  // Record the strict probe independently of the native support cache.
  const buildConfig = vi.spyOn(await import('./videoEditExportEncoderConfig'), 'videoEditExportVideoEncoderConfig')
  await expect(assertVideoEditExportSupported(adapted)).resolves.toBeUndefined()
  expect(buildConfig.mock.results.at(-1)?.value).toStrictEqual(accepted)
  buildConfig.mockRestore()
  const source = new VideoSampleSource(videoEditExportVideoOptions(adapted))
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  output.addVideoTrack(source, { frameRate: adapted.fps! })
  const sample = new VideoSample(new Uint8Array(adapted.width * adapted.height * 4), { format: 'RGBA', codedWidth: adapted.width, codedHeight: adapted.height, timestamp: 0, duration: 1 / adapted.fps! })
  try {
    await output.start()
    await expect(source.add(sample)).rejects.toThrow('native boundary reached')
    expect(nativeProbe.mock.calls.at(-1)![0]).toStrictEqual(accepted)
    expect(configure).toHaveBeenCalledOnce()
    expect(configure.mock.calls[0][0]).toStrictEqual(accepted)
  } finally { sample.close(); await output.cancel() }
  // 4K30 resolves a different level and must not reuse the accepted 4K60 result.
  await expect(probeVideoEditExport({ ...settings, fps: 30 })).resolves.toMatchObject({ supported: false })
})
// Keep Mediabunny real, stopping only at the native encoder boundary before any pixel encoding.
it.each([
  ['avc', 'hardware', 'vbr', 'auto'], ['avc', 'software', 'cbr', 2],
  ['hevc', 'hardware', 'cbr', 1], ['hevc', 'software', 'vbr', 'auto'],
] as const)('%s/%s/%s/%s探测配置与Mediabunny实际configure逐字段一致', async (codec, encoderPreference, bitrateMode, keyframeInterval) => {
  const settings = { ...videoEditSequenceExportSettings({ width: 3840, height: 2160, fps: 60, sampleRate: 48000, channels: 2 }), codec, encoderPreference, bitrateMode, keyframeInterval, videoBitrateMbps: 12.1234567 }
  const nativeProbe = vi.fn(async (config: VideoEncoderConfig) => ({ config, supported: true }))
  const configure = vi.fn((_config: VideoEncoderConfig) => { throw new Error('native boundary reached') })
  vi.stubGlobal('VideoEncoder', class { static isConfigSupported = nativeProbe; configure = configure; state = 'unconfigured'; close() {} })
  expect(await canEncodeVideoEditExport({ ...settings, frameRate: settings.fps!, bitrate: Math.round(settings.videoBitrateMbps * 1_000_000) })).toBe(true)
  const probed = nativeProbe.mock.calls[0][0]
  const source = new VideoSampleSource(videoEditExportVideoOptions(settings))
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  output.addVideoTrack(source, { frameRate: settings.fps! })
  const sample = new VideoSample(new Uint8Array(settings.width * settings.height * 4), { format: 'RGBA', codedWidth: settings.width, codedHeight: settings.height, timestamp: 0, duration: 1 / settings.fps! })
  try {
    await output.start()
    await expect(source.add(sample)).rejects.toThrow('native boundary reached')
    expect(nativeProbe).toHaveBeenCalledTimes(2)
    expect(nativeProbe.mock.calls[1][0]).toStrictEqual(probed)
    expect(configure).toHaveBeenCalledOnce()
    expect(configure.mock.calls[0][0]).toStrictEqual(probed)
    expect(probed).toMatchObject({ framerate: 60, bitrate: 12_123_457, latencyMode: 'quality', displayWidth: 3840, displayHeight: 2160 })
  } finally { sample.close(); await output.cancel() }
})
it.each([[44100, 1], [44100, 2], [48000, 1], [48000, 2]] as const)('AAC %iHz/%i声道探测配置与实际configure逐字段一致', async (sampleRate, channels) => {
  const nativeProbe = vi.fn(async (config: AudioEncoderConfig) => ({ config, supported: true }))
  const configure = vi.fn((_config: AudioEncoderConfig) => { throw new Error('native boundary reached') })
  vi.stubGlobal('AudioEncoder', class { static isConfigSupported = nativeProbe; configure = configure; state = 'unconfigured'; close() {} })
  const settings = { audioCodec: 'aac' as const, audioBitrateKbps: 192, sampleRate, channels }
  expect(await canEncodeVideoEditExportAudio({ codec: 'aac', sampleRate, numberOfChannels: channels, bitrate: 192000 })).toBe(true)
  const probed = nativeProbe.mock.calls[0][0]
  const source = new AudioSampleSource(videoEditExportAudioOptions(settings))
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
  output.addAudioTrack(source)
  const sample = new AudioSample({ data: new Float32Array(sampleRate * channels), format: 'f32', sampleRate, numberOfChannels: channels, timestamp: 0 })
  try {
    await output.start()
    // The audio transform can buffer until finalization even when rates already match.
    await expect((async () => { await source.add(sample); await output.finalize() })()).rejects.toThrow('native boundary reached')
    expect(nativeProbe).toHaveBeenCalledTimes(2)
    expect(nativeProbe.mock.calls[1][0]).toStrictEqual(probed)
    expect(configure).toHaveBeenCalledOnce()
    expect(configure.mock.calls[0][0]).toStrictEqual(probed)
  } finally { sample.close(); await output.cancel() }
})
