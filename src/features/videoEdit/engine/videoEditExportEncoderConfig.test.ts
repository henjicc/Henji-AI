import { afterEach, expect, it, vi } from 'vitest'
import { AudioSample, AudioSampleSource, BufferTarget, Mp4OutputFormat, Output, VideoSample, VideoSampleSource } from 'mediabunny'
import { videoEditSequenceExportSettings } from '@/core/videoEdit/exportPresets'
import { canEncodeVideoEditExport, canEncodeVideoEditExportAudio, videoEditExportAudioOptions, videoEditExportVideoOptions } from './videoEditExportEncoder'

afterEach(() => { vi.unstubAllGlobals() })
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
