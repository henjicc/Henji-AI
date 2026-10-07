import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { adaptVideoEditExportPreset, assertVideoEditExportSupported, assertVideoEditExportAudioSupported, canEncodeVideoEditExport, canEncodeVideoEditExportAudio, probeVideoEditExport, probeVideoEditExportAudioBitrates, selectVideoEditExportEncoder, videoEditExportAudioUserError, videoEditExportProbeKey, videoEditExportVideoOptions } from './videoEditExportEncoder'
import { resolveVideoEditExportSettings, videoEditSequenceExportSettings, type VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
const diagnostics = vi.hoisted(() => ({ debug: vi.fn(), warn: vi.fn() }))
vi.mock('@/core/logging', () => ({ createLogger: () => diagnostics }))
const video = vi.fn(async (_config: VideoEncoderConfig): Promise<boolean> => true)
const audio = vi.fn(async (_config: AudioEncoderConfig): Promise<boolean> => true)
const spec = { width: 7680, height: 4320, frameRate: 120, bitrate: 80_000_000 }
const fourK = (): VideoEditExportSettings => videoEditSequenceExportSettings({ width: 3840, height: 2160, fps: 60, sampleRate: 48000, channels: 2 })
beforeEach(() => {
  diagnostics.debug.mockClear(); diagnostics.warn.mockClear()
  video.mockReset().mockResolvedValue(true); audio.mockReset().mockResolvedValue(true)
  vi.stubGlobal('VideoEncoder', { isConfigSupported: async (config: VideoEncoderConfig) => ({ config, supported: await video(config) }) })
  vi.stubGlobal('AudioEncoder', { isConfigSupported: async (config: AudioEncoderConfig) => ({ config, supported: await audio(config) }) })
})
afterEach(() => { vi.unstubAllGlobals() })
it('8K/120与竖屏优先HEVC，探测实际原生尺寸、帧率、码率', async () => {
  expect(await selectVideoEditExportEncoder(spec)).toBe('hevc')
  expect(video).toHaveBeenCalledWith(expect.objectContaining({ codec: expect.stringMatching(/^hev1\./), width: 7680, height: 4320, displayWidth: 7680, displayHeight: 4320, framerate: 120, bitrate: 80_000_000, latencyMode: 'quality', hardwareAcceleration: 'prefer-hardware' }))
  expect(await selectVideoEditExportEncoder({ ...spec, width: 4320, height: 7680 })).toBe('hevc')
})
it('普通规格H264优先，不支持才试HEVC；显式编码不静默替换', async () => {
  video.mockImplementation(async config => config.codec.startsWith('hev1'))
  expect(await selectVideoEditExportEncoder({ ...spec, width: 1920, height: 1080 })).toBe('hevc')
  expect(video.mock.calls.map(([config]) => config.codec.split('.')[0])).toEqual(['avc1', 'hev1'])
  await expect(selectVideoEditExportEncoder({ ...spec, codec: 'avc', bitrateMode: 'cbr', encoderPreference: 'software' })).rejects.toThrow('HEVC')
  expect(video).toHaveBeenLastCalledWith(expect.objectContaining({ bitrateMode: 'constant', hardwareAcceleration: 'prefer-software' }))
})
it('两种编码都不支持时说明规格与恢复方式；奇数尺寸拒绝', async () => {
  video.mockResolvedValue(false)
  await expect(selectVideoEditExportEncoder(spec)).rejects.toThrow('当前设备无法导出 7680 × 4320 · 120 帧视频。请降低导出分辨率或帧率后重试。')
  expect(await canEncodeVideoEditExport({ ...spec, width: 1921, codec: 'avc' })).toBe(false)
})
it('硬件不支持、软件支持时4K60预设回落H264软件，严格校验与实际选项一致', async () => {
  video.mockImplementation(async config => config.codec === 'avc1.640034' && config.hardwareAcceleration === 'prefer-software')
  const input = { ...fourK(), videoBitrateMbps: 12, sampleRate: 44100 as const, channels: 1 as const }
  await expect(assertVideoEditExportSupported(input)).rejects.toThrow('当前设备不支持所选编码设置')
  const adapted = await adaptVideoEditExportPreset(input)
  expect(adapted).toMatchObject({ codec: 'avc', encoderPreference: 'software', videoBitrateMbps: 12, bitrateMode: 'vbr' })
  await expect(assertVideoEditExportSupported(adapted)).resolves.toBeUndefined()
  expect(videoEditExportVideoOptions(adapted)).toMatchObject({ hardwareAcceleration: 'prefer-software', fullCodecString: 'avc1.640034', latencyMode: 'quality' })
  expect(video.mock.calls.every(([config]) => config.codec !== 'avc1.640033')).toBe(true)
  const logs = diagnostics.debug.mock.calls.map(([, value]) => value)
  const adaptedProbe = logs.find(value => value.context.phase === 'adapt' && value.context.configuration?.hardwareAcceleration === 'prefer-software')
  const strictProbe = logs.find(value => value.context.phase === 'strict' && value.context.configuration?.hardwareAcceleration === 'prefer-software')
  expect(adaptedProbe.context).toMatchObject({ cacheHit: false, supported: true })
  expect(strictProbe.context).toMatchObject({ cacheHit: true, supported: true })
  expect(strictProbe.context.configuration).toStrictEqual(adaptedProbe.context.configuration)
  expect(strictProbe.context.candidateKey).toBe(adaptedProbe.context.candidateKey)
})
it('按H264硬件/软件、HEVC硬件/软件尝试VBR/CBR，再尝试推荐码率', async () => {
  video.mockImplementation(async config => Number(config.bitrate) <= 45_000_000 && config.bitrateMode === 'constant' && config.hardwareAcceleration === 'prefer-software')
  expect(await adaptVideoEditExportPreset(fourK())).toMatchObject({ codec: 'avc', encoderPreference: 'software', bitrateMode: 'cbr', videoBitrateMbps: 45 })
  expect(video.mock.calls.slice(0, 8).map(([config]) => [config.codec.split('.')[0], config.hardwareAcceleration, config.bitrateMode])).toEqual([
    ['avc1', 'prefer-hardware', 'variable'], ['avc1', 'prefer-hardware', 'constant'], ['avc1', 'prefer-software', 'variable'], ['avc1', 'prefer-software', 'constant'],
    ['hev1', 'prefer-hardware', 'variable'], ['hev1', 'prefer-hardware', 'constant'], ['hev1', 'prefer-software', 'variable'], ['hev1', 'prefer-software', 'constant'],
  ])
  expect(video.mock.calls.slice(0, 8).every(([config]) => config.bitrate === 50_000_000)).toBe(true)
})
it('面板4K30硬件缓存不污染4K60适配；相同settings入队解析前后配置不变', async () => {
  video.mockImplementation(async config => (config.codec === 'avc1.640033' && config.framerate === 30) || (config.codec === 'avc1.640034' && config.hardwareAcceleration === 'prefer-software'))
  expect((await probeVideoEditExport({ ...fourK(), fps: 30 })).supported).toBe(true)
  const adapted = await adaptVideoEditExportPreset(fourK())
  expect(adapted.encoderPreference).toBe('software')
  const resolved = resolveVideoEditExportSettings(adapted, { width: 3840, height: 2160, fps: 60, sampleRate: 48000, channels: 2 })
  expect(videoEditExportProbeKey(resolved)).toBe(videoEditExportProbeKey(adapted))
  await expect(assertVideoEditExportSupported(resolved)).resolves.toBeUndefined()
  expect(video.mock.calls.filter(([config]) => config.codec === 'avc1.640034' && config.hardwareAcceleration === 'prefer-hardware').length).toBeGreaterThan(0)
})
it('严格拒绝H264，预设可适配HEVC；全部不可用保持失败', async () => {
  video.mockImplementation(async config => config.codec.startsWith('hev1'))
  await expect(assertVideoEditExportSupported(fourK())).rejects.toThrow('当前设备不支持所选编码设置')
  expect(await adaptVideoEditExportPreset(fourK())).toMatchObject({ codec: 'hevc', encoderPreference: 'hardware' })
  // A new native implementation represents a fresh device/cache.
  vi.stubGlobal('VideoEncoder', { isConfigSupported: async () => ({ supported: false }) })
  await expect(adaptVideoEditExportPreset(fourK())).rejects.toThrow('3840 × 2160')
})
it('缓存完整配置并合并并发；每个编码字段改变均重新探测，关键帧只由调度器处理', async () => {
  const input = { ...spec, codec: 'avc' as const }
  expect(await Promise.all([canEncodeVideoEditExport(input), canEncodeVideoEditExport(input)])).toEqual([true, true])
  expect(video).toHaveBeenCalledOnce()
  for (const patch of [{ width: 3840 }, { height: 2160 }, { frameRate: 60 }, { bitrate: 12_000_000 }, { codec: 'hevc' as const }, { encoderPreference: 'software' as const }, { bitrateMode: 'cbr' as const }]) await canEncodeVideoEditExport({ ...input, ...patch })
  expect(video).toHaveBeenCalledTimes(8)
  await canEncodeVideoEditExport({ ...input, keyframeInterval: 2 })
  expect(video).toHaveBeenCalledTimes(8)
  expect(videoEditExportVideoOptions({ ...fourK(), keyframeInterval: 2 })).toMatchObject({ keyFrameInterval: 2 })
  expect(video.mock.calls.every(([config]) => !('keyFrameInterval' in config))).toBe(true)
})
it('AAC缓存包含码率、采样率与声道，PCM不需要WebCodecs', async () => {
  const input = { codec: 'aac' as const, sampleRate: 48000, numberOfChannels: 2, bitrate: 320000 }
  await Promise.all([canEncodeVideoEditExportAudio(input), canEncodeVideoEditExportAudio(input)])
  expect(audio).toHaveBeenCalledOnce()
  for (const patch of [{ bitrate: 192000 }, { sampleRate: 44100 }, { numberOfChannels: 1 }]) await canEncodeVideoEditExportAudio({ ...input, ...patch })
  expect(audio).toHaveBeenCalledTimes(4)
  expect(await canEncodeVideoEditExportAudio({ ...input, codec: 'pcm-s24', bitrate: undefined })).toBe(true)
  expect(audio).toHaveBeenCalledTimes(4)
})
it.each([44100, 48000] as const)('AAC %iHz单/双声道：96/128/160/192可用，64/256/320禁用', async sampleRate => {
  audio.mockImplementation(async config => [96000, 128000, 160000, 192000].includes(config.bitrate!))
  for (const channels of [1, 2] as const) {
    const settings = { audioEnabled: true, audioCodec: 'aac' as const, audioBitrateKbps: 320, sampleRate, channels }
    expect(await probeVideoEditExportAudioBitrates(settings)).toEqual({ 64: false, 96: true, 128: true, 160: true, 192: true, 256: false, 320: false })
    await expect(assertVideoEditExportAudioSupported(settings)).rejects.toThrow('请改用 192 kbps 或更低。')
    await expect(assertVideoEditExportAudioSupported({ ...settings, audioBitrateKbps: 192 })).resolves.toBeUndefined()
    await expect(assertVideoEditExportAudioSupported({ ...settings, audioCodec: 'wav' })).resolves.toBeUndefined()
  }
})
it('完整快照键包含所有设置，音视频严格探测与舍入码率一致', async () => {
  const settings = { ...fourK(), videoBitrateMbps: 50.1234567, keyframeInterval: 2 as const }
  const key = videoEditExportProbeKey(settings)
  const patches: Partial<VideoEditExportSettings>[] = [
    { codec: 'hevc' }, { width: 1920 }, { height: 1080 }, { fps: 30 }, { videoBitrateMbps: 45 }, { bitrateMode: 'cbr' }, { keyframeInterval: 'auto' }, { encoderPreference: 'software' },
    { audioEnabled: false }, { audioCodec: 'wav' }, { sampleRate: 44100 }, { channels: 1 }, { audioBitrateKbps: 128 }, { videoEnabled: false }, { format: 'wav' },
  ]
  for (const patch of patches) expect(videoEditExportProbeKey({ ...settings, ...patch })).not.toBe(key)
  expect((await probeVideoEditExport(settings)).supported).toBe(true)
  expect(video).toHaveBeenCalledWith(expect.objectContaining({ bitrate: 50_123_457, framerate: 60 }))
  expect(audio).toHaveBeenCalledWith({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000, bitrateMode: undefined, aac: { format: 'aac' } })
})
it('原生探测异常不向用户露英文，失败不缓存可重试；底层AAC拒绝保留cause', async () => {
  const error = new Error('mp4a.40.2 is not supported')
  const settings = { audioEnabled: true, audioCodec: 'aac' as const, audioBitrateKbps: 320, sampleRate: 48000 as const, channels: 2 as const }
  audio.mockRejectedValueOnce(error)
  await expect(assertVideoEditExportAudioSupported(settings)).rejects.toThrow('无法检查此设备的音频编码支持')
  await expect(assertVideoEditExportAudioSupported(settings)).resolves.toBeUndefined()
  expect(videoEditExportAudioUserError(error, settings)).toMatchObject({ message: expect.stringContaining('此设备的 AAC 编码不支持 320 kbps'), cause: error })
  const other = new Error('disk refused'); expect(videoEditExportAudioUserError(other, settings)).toBe(other)
  audio.mockClear()
  await assertVideoEditExportAudioSupported({ ...settings, audioEnabled: false })
  expect(audio).not.toHaveBeenCalled()
})
