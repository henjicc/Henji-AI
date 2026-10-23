import { audioCaptureSettingsEnvelopeSchema, audioCaptureSettingsSchema, DEFAULT_AUDIO_CAPTURE_SETTINGS, type AudioCaptureInventory, type AudioCaptureSettings, type AudioCaptureSettingsState } from '../../../../src/core/audioCapture/contracts'
import { getSettingsStore } from '../settings/store'
import { AudioCaptureError } from './protocol'

export const AUDIO_CAPTURE_SETTINGS_KEY = 'audio_capture.settings'
export interface CaptureSettingsStore { get(key: string): string | null; set(key: string, value: string, type: 'json'): void }
/** 不静默清除损坏/较新版本的设置；读取不会改写数据库。 */
export class AudioCaptureSettingsService {
  private revision = 0
  constructor(private readonly store: () => CaptureSettingsStore = getSettingsStore) {}
  read(): { settings: AudioCaptureSettings; revision: number } {
    const raw = this.store().get(AUDIO_CAPTURE_SETTINGS_KEY)
    if (!raw) return { settings: { ...DEFAULT_AUDIO_CAPTURE_SETTINGS }, revision: this.revision }
    const envelope: unknown = JSON.parse(raw)
    if (typeof envelope === 'object' && envelope !== null && 'version' in envelope && envelope.version !== 1) throw new AudioCaptureError('SETTINGS_VERSION', '录音设置来自更新版本，请升级后再修改')
    return { settings: audioCaptureSettingsEnvelopeSchema.parse(envelope).settings, revision: this.revision }
  }
  write(settings: AudioCaptureSettings, expectedRevision: number): { settings: AudioCaptureSettings; revision: number } {
    const current = this.read()
    if (current.revision !== expectedRevision) throw new AudioCaptureError('REVISION_CONFLICT', '录音设置已改变，请重新读取后修改')
    const next = audioCaptureSettingsSchema.parse(settings)
    this.store().set(AUDIO_CAPTURE_SETTINGS_KEY, JSON.stringify({ version: 1, minReaderVersion: 1, settings: next }), 'json')
    this.revision += 1
    return { settings: next, revision: this.revision }
  }
}
export function resolveCaptureSettings(settings: AudioCaptureSettings, inventory: AudioCaptureInventory): { device: number; effectiveSettings: AudioCaptureSettings; notice: string | null } {
  const candidates = inventory.devices.filter(d => d.maxInputChannels > 0 && (settings.hostApi === 'default' || d.hostApi === settings.hostApi))
  const preferred = settings.deviceName ? candidates.filter(d => d.name === settings.deviceName)[settings.deviceOrdinal] : candidates.find(d => d.index === (inventory.hostApis.find(h => h.id === settings.hostApi)?.defaultInputDevice ?? inventory.defaultInputDevice)) ?? candidates[0]
  const device = preferred ?? inventory.devices.find(d => d.index === inventory.defaultInputDevice && d.maxInputChannels > 0) ?? inventory.devices.find(d => d.maxInputChannels > 0)
  if (!device) throw new AudioCaptureError('NO_INPUT_DEVICE', '没有可用录音输入，请连接麦克风并允许系统麦克风访问')
  const fallback = !preferred || settings.firstChannel + settings.channels > device.maxInputChannels
  const effectiveSettings = audioCaptureSettingsSchema.parse({ ...settings, hostApi: device.hostApi, deviceName: device.name,
    deviceOrdinal: inventory.devices.filter(d => d.hostApi === device.hostApi && d.name === device.name).findIndex(d => d.index === device.index),
    ...(fallback ? { firstChannel: 0, channels: Math.min(settings.channels, device.maxInputChannels), exclusive: false } : {}),
  })
  return { device: device.index, effectiveSettings, notice: fallback ? `原录音设备或通道不可用，已临时使用“${device.name}”；原设置保留，可重新选择。` : null }
}
export function captureSettingsState(service: AudioCaptureSettingsService, inventory: AudioCaptureInventory): AudioCaptureSettingsState {
  const { settings, revision } = service.read()
  if (!inventory.devices.some(d => d.maxInputChannels > 0)) return { settings, revision, effectiveSettings: settings, notice: '没有可用录音输入，请连接设备；已保存的录音偏好保留。' }
  return { settings, revision, ...resolveCaptureSettings(settings, inventory) }
}
