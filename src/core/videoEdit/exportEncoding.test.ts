import { expect, it } from 'vitest'
import { VIDEO_EDIT_EXPORT_PRESETS, resolveVideoEditExportSettings, patchVideoEditExportSettings, videoEditExportSettingsSchema } from './exportPresets'
import { applyVideoEditExportQuality, videoEditExportQualityOf, videoEditExportPresetModified, videoEditExportChangedFields, videoEditExportIntermediateSettings, videoEditExportEncodingSchema, type VideoEditExportCapabilities } from './exportEncoding'

const capabilities: VideoEditExportCapabilities = { cuda: true, encoders: { h264_nvenc: { supported: true, tenBit: false }, hevc_nvenc: { supported: true, tenBit: true }, libx264: { supported: true, tenBit: true }, libx265: { supported: true, tenBit: true } } }
it('指定码率移除压制设置，母版直接导出；目标码率只保存在顶层', () => {
  const settings = VIDEO_EDIT_EXPORT_PRESETS[0].settings
  expect(applyVideoEditExportQuality(settings, 'bitrate', capabilities)).toEqual({ ...settings, encoding: undefined })
  const master = VIDEO_EDIT_EXPORT_PRESETS.find(preset => preset.id === 'builtin:master')!.settings
  expect(master.encoding).toBeUndefined()
  expect(videoEditExportQualityOf(master)).toBe('bitrate')
  expect(videoEditExportIntermediateSettings(master)).toBe(master)
  expect(videoEditExportEncodingSchema.safeParse({ ...settings.encoding, bitrateMbps: 40 }).success).toBe(false)
  expect(videoEditExportSettingsSchema.safeParse({ ...settings, videoBitrateMbps: 40, encoding: { ...settings.encoding, rateControl: 'vbr', maxBitrateMbps: 30 } }).success).toBe(false)
})
it('HEVC 拒绝不存在的级别，切换视频格式时回到自动', () => {
  const settings = { ...VIDEO_EDIT_EXPORT_PRESETS[0].settings, encoding: { ...VIDEO_EDIT_EXPORT_PRESETS[0].settings.encoding!, level: '4.2' as const } }
  const hevc = patchVideoEditExportSettings(settings, { codec: 'hevc' })
  expect(hevc.encoding?.level).toBe('auto')
  expect(videoEditExportSettingsSchema.safeParse(hevc).success).toBe(true)
  expect(videoEditExportSettingsSchema.safeParse({ ...hevc, encoding: { ...hevc.encoding, level: '3.2' } }).success).toBe(false)
  expect(videoEditExportIntermediateSettings(hevc).codec).toBe('avc')
})
it('画质档能从参数反推，设备回退保持格式，修改任何有效编码参数成为自定义', () => {
  const settings = VIDEO_EDIT_EXPORT_PRESETS[0].settings
  for (const codec of ['avc', 'hevc'] as const) for (const tier of ['visually_lossless', 'high', 'standard'] as const) {
    const result = applyVideoEditExportQuality({ ...settings, codec }, tier, capabilities)
    expect(videoEditExportQualityOf(result)).toBe(tier)
    expect(result.encoding?.encoder).toBe(codec === 'avc' ? 'h264_nvenc' : 'hevc_nvenc')
    expect(videoEditExportQualityOf({ ...result, encoding: { ...result.encoding!, keyframeSeconds: 3 } })).toBe('custom')
  }
  const software = applyVideoEditExportQuality(settings, 'visually_lossless', { ...capabilities, encoders: { ...capabilities.encoders, h264_nvenc: { supported: false, tenBit: false } } })
  expect(software.encoding?.encoder).toBe('libx264')
  expect(videoEditExportQualityOf(software)).toBe('visually_lossless')
  expect(videoEditExportIntermediateSettings({ ...settings, fps: 30 }).videoBitrateMbps).toBeCloseTo(186.624)
  expect(videoEditExportIntermediateSettings({ ...settings, encoding: undefined })).toEqual({ ...settings, encoding: undefined })
})
it('预设完整比较规范化可选默认值，高级变化列表只列实际变化字段', () => {
  const preset = VIDEO_EDIT_EXPORT_PRESETS[0]
  expect(videoEditExportPresetModified({ ...preset.settings, renderAtOutputResolution: true }, preset)).toBe(false)
  const settings = { ...preset.settings, encoding: { ...preset.settings.encoding!, bFrames: 0 }, importToProject: true }
  expect(videoEditExportPresetModified(settings, preset)).toBe(true)
  expect(videoEditExportChangedFields(settings, preset)).toEqual(['bFrames'])
  expect(resolveVideoEditExportSettings(settings, { width: 1920, height: 1080, fps: 30, sampleRate: 48000, channels: 2 }).encoding).toEqual(settings.encoding)
  expect(videoEditExportEncodingSchema.safeParse({ ...preset.settings.encoding!, temporalAq: true }).success).toBe(false)
  const nvenc = applyVideoEditExportQuality(preset.settings, 'high', capabilities).encoding!
  expect(videoEditExportEncodingSchema.safeParse({ ...nvenc, spatialAq: true, temporalAq: true }).success).toBe(true)
})
it('按宽高选择硬件或软件，NVENC 画质 0 无效而软件 CRF 0 合法', () => {
  const settings = VIDEO_EDIT_EXPORT_PRESETS[0].settings
  for (const [codec, maximum, hardware, software] of [['avc', 4096, 'h264_nvenc', 'libx264'], ['hevc', 8192, 'hevc_nvenc', 'libx265']] as const) {
    expect(applyVideoEditExportQuality({ ...settings, codec, width: maximum, height: 2160 }, 'high', capabilities).encoding?.encoder).toBe(hardware)
    for (const size of [{ width: maximum + 2, height: 2160 }, { width: 2160, height: maximum + 2 }]) {
      expect(applyVideoEditExportQuality({ ...settings, codec, ...size }, 'high', capabilities).encoding?.encoder).toBe(software)
    }
    const encoding = applyVideoEditExportQuality({ ...settings, codec }, 'high', capabilities).encoding!
    expect(videoEditExportEncodingSchema.safeParse({ ...encoding, quality: 0 }).success).toBe(false)
    expect(videoEditExportEncodingSchema.safeParse({ ...encoding, quality: 1 }).success).toBe(true)
  }
  expect(videoEditExportEncodingSchema.safeParse({ ...settings.encoding, quality: 0 }).success).toBe(true)
})
