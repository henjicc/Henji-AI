import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../settings/store', () => ({ getSettingsStore: vi.fn() }))
import { AudioCaptureSettingsService, resolveCaptureSettings, captureSettingsState } from './settings'
import { DEFAULT_AUDIO_CAPTURE_SETTINGS, audioCaptureSettingsEnvelopeSchema, type AudioCaptureInventory } from '../../../../src/core/audioCapture/contracts'
const inventory: AudioCaptureInventory = { asioCompiled: false, hostApis: [{ id: 'WASAPI', name: 'WASAPI', defaultInputDevice: 2 }], defaultInputDevice: 2, devices: [{ index: 2, hostApi: 'WASAPI', name: '麦克风', maxInputChannels: 2, maxOutputChannels: 0, defaultSampleRate: 48000, defaultLowInputLatency: .01, defaultHighInputLatency: .1, defaultLowOutputLatency: 0, defaultHighOutputLatency: 0, asioBuffers: null }] }
describe('录音本机设置持久化与回退', () => {
  let raw: string | null; let service: AudioCaptureSettingsService
  beforeEach(() => { raw = null; service = new AudioCaptureSettingsService(() => ({ get: () => raw, set: (_key, value) => { raw = value } })) })
  it('保存并回读真实值，过期 revision 和非法格式不产生写入', () => {
    const settings = { ...DEFAULT_AUDIO_CAPTURE_SETTINGS, bitDepth: 32 as const }
    service.write(settings, 0)
    expect(audioCaptureSettingsEnvelopeSchema.parse(JSON.parse(raw!)).settings).toEqual(settings)
    expect(service.read().settings).toEqual(settings)
    expect(() => service.write(DEFAULT_AUDIO_CAPTURE_SETTINGS, 0)).toThrow('已改变')
    expect(() => service.write({ ...settings, bitDepth: 20 } as unknown as typeof settings, 1)).toThrow()
    expect(service.read().settings).toEqual(settings)
  })
  it('设备缺失回退默认，偏好和无设备状态保持可读', () => {
    const original = { ...DEFAULT_AUDIO_CAPTURE_SETTINGS, hostApi: 'ASIO' as const, deviceName: '已拔出', firstChannel: 2 }
    service.write(original, 0)
    expect(resolveCaptureSettings(original, inventory)).toMatchObject({ device: 2, effectiveSettings: { hostApi: 'WASAPI', firstChannel: 0 }, notice: expect.stringContaining('临时使用') })
    expect(captureSettingsState(service, { ...inventory, devices: [] }).notice).toContain('没有可用')
    expect(service.read().settings).toEqual(original)
    raw = JSON.stringify({ version: 2, settings: original })
    expect(() => service.write(original, 1)).toThrow('更新版本')
  })
})
