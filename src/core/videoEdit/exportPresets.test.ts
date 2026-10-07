import { expect, it } from 'vitest'
import { VIDEO_EDIT_EXPORT_PRESETS, patchVideoEditExportSettings, resolveVideoEditExportSettings, videoEditExportEstimatedBytes, videoEditSequenceExportSettings, videoEditExportEncoding, videoEditExportGeometry, videoEditExportSettingsSchema } from './exportPresets'

it('导出沿共享序列边界接受8192单边，保持8K总像素上限与120帧支持', () => {
  const settings = VIDEO_EDIT_EXPORT_PRESETS[0].settings
  expect(videoEditExportSettingsSchema.safeParse({ ...settings, width: 8192, height: 4000, fps: 120 }).success).toBe(true)
  expect(videoEditExportSettingsSchema.safeParse({ ...settings, width: 4000, height: 8192, fps: 120 }).success).toBe(true)
  expect(videoEditExportSettingsSchema.safeParse({ ...settings, width: 8194 }).success).toBe(false)
  expect(videoEditExportSettingsSchema.safeParse({ ...settings, width: 6000, height: 6000 }).success).toBe(false)
})

it('平台预设包含画幅、帧率、码率与响度；编码单位准确，母版与WAV保持原始声音', () => {
  for (const value of VIDEO_EDIT_EXPORT_PRESETS) expect(videoEditExportSettingsSchema.safeParse(value.settings).success).toBe(true)
  expect(videoEditExportEncoding(VIDEO_EDIT_EXPORT_PRESETS.find(value => value.id === 'builtin:douyin')!.settings, 60)).toEqual({ fps: 30, videoBitrate: 12000000, audioBitrate: 192000, audioCodec: 'aac' })
  const master = VIDEO_EDIT_EXPORT_PRESETS.find(value => value.id === 'builtin:master')!.settings
  expect(master).toMatchObject({ followSequence: { resolution: true, fps: true }, fps: null, loudness: null })
  expect(videoEditExportEncoding(master, 30000 / 1001).fps).toBe(30000 / 1001)
  expect(videoEditExportEncoding(VIDEO_EDIT_EXPORT_PRESETS.find(value => value.id === 'builtin:wav')!.settings, 30).audioCodec).toBe('pcm-s24')
})
it('横版到竖版：适合与黑边完整缩放；填充按中心裁切且保持比例', () => {
  const settings = VIDEO_EDIT_EXPORT_PRESETS.find(value => value.id === 'builtin:douyin')!.settings
  const fit = videoEditExportGeometry(1920, 1080, settings)
  expect(fit.source).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  expect(fit.destination).toEqual({ x: 0, y: 656.25, width: 1080, height: 607.5 })
  expect(videoEditExportGeometry(1920, 1080, { ...settings, fit: 'letterbox' })).toEqual(fit)
  const fill = videoEditExportGeometry(1920, 1080, { ...settings, fit: 'fill' })
  expect(fill.destination).toEqual({ x: 0, y: 0, width: 1080, height: 1920 })
  expect(fill.source.height).toBe(1080); expect(fill.source.width).toBeCloseTo(607.5); expect(fill.source.x).toBeCloseTo(656.25)
})

it('默认与序列一致：4K60和声音规格跟随；每条锁链解锁后保留自己的值', () => {
  const sequence = { width: 3840, height: 2160, fps: 60, sampleRate: 44100, channels: 1 }
  const settings = videoEditSequenceExportSettings(sequence)
  expect(settings).toMatchObject({ width: 3840, height: 2160, fps: 60, sampleRate: 44100, channels: 1, codec: 'avc', videoBitrateMbps: 50, addToLibrary: true })
  const changed = { width: 1920, height: 1080, fps: 24, sampleRate: 48000, channels: 2 }
  expect(resolveVideoEditExportSettings(settings, changed)).toMatchObject(changed)
  for (const key of ['resolution', 'fps', 'sampleRate', 'channels'] as const) {
    const unlocked = resolveVideoEditExportSettings({ ...settings, followSequence: { ...settings.followSequence, [key]: false } }, changed)
    if (key === 'resolution') expect([unlocked.width, unlocked.height]).toEqual([3840, 2160])
    else expect(unlocked[key]).toBe(settings[key])
  }
})
it('音视频开关统一格式与声音编码，禁止空输出和音频烧录', () => {
  const settings = VIDEO_EDIT_EXPORT_PRESETS[0].settings
  expect(patchVideoEditExportSettings(settings, { videoEnabled: false })).toMatchObject({ format: 'aac', videoEnabled: false, audioEnabled: true })
  const sound = patchVideoEditExportSettings(settings, { format: 'wav' })
  expect(sound).toMatchObject({ format: 'wav', videoEnabled: false, audioCodec: 'wav' })
  expect(patchVideoEditExportSettings(sound, { videoEnabled: true })).toMatchObject({ format: 'mp4', videoEnabled: true })
  expect(patchVideoEditExportSettings(settings, { audioEnabled: false })).toMatchObject({ videoEnabled: true, audioEnabled: false })
  expect(videoEditExportSettingsSchema.safeParse({ ...settings, audioEnabled: false, videoEnabled: false }).success).toBe(false)
  expect(videoEditExportSettingsSchema.safeParse({ ...sound, captionMode: 'burn' }).success).toBe(false)
})
it('预计大小按音视频合计码率乘时长，PCM按采样率声道24位计算', () => {
  const settings = { ...VIDEO_EDIT_EXPORT_PRESETS[0].settings, videoBitrateMbps: 50, audioBitrateKbps: 320 }
  expect(videoEditExportEstimatedBytes(settings, 60)).toBe((50_000_000 + 320_000) * 60 / 8)
  expect(videoEditExportEstimatedBytes({ ...settings, audioEnabled: false }, 60)).toBe(50_000_000 * 60 / 8)
  expect(videoEditExportEstimatedBytes({ ...settings, videoEnabled: false, audioCodec: 'wav', sampleRate: 48000, channels: 2 }, 60)).toBe(48000 * 2 * 24 * 60 / 8)
})
it('竖版转横版与相同画幅保持比例，拒绝奇数和无效尺寸', () => {
  const settings = VIDEO_EDIT_EXPORT_PRESETS.find(value => value.id === 'builtin:bilibili')!.settings
  const fill = videoEditExportGeometry(1080, 1920, { ...settings, fit: 'fill' })
  expect(fill.source).toEqual({ x: 0, y: 656.25, width: 1080, height: 607.5 })
  expect(videoEditExportGeometry(1920, 1080, settings).destination).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  expect(() => videoEditExportGeometry(0, 1080, settings)).toThrow('画幅')
  expect(videoEditExportSettingsSchema.safeParse({ ...settings, width: 1079 }).success).toBe(false)
})
