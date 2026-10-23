import { AUDIO_CAPTURE_RATES, audioCaptureSettingsSchema, type AudioCaptureInventory, type AudioCaptureSettings } from '@/core/audioCapture/contracts'
import type { DropdownOption } from '@/components/ui/Dropdown'

export const captureHostLabel = (host: string): string => host === 'default' ? '系统默认' : host === 'CoreAudio' ? 'Core Audio' : host
export const captureRateLabel = (rate: number): string => `${rate / 1000} kHz`
export const captureDepthLabel = (depth: number): string => depth === 32 ? '32 位浮点' : `${depth} 位`
export function captureSummary(settings: Omit<AudioCaptureSettings, 'sampleRate'> & { sampleRate: number }): string {
  return [captureHostLabel(settings.hostApi), settings.deviceName || '系统默认输入', captureRateLabel(settings.sampleRate), captureDepthLabel(settings.bitDepth), settings.channels === 1 ? '单声道' : '立体声'].join(' · ')
}
export function captureHostOptions(inventory: AudioCaptureInventory): DropdownOption<AudioCaptureSettings['hostApi']>[] {
  return [{ value: 'default', label: '系统默认' }, ...inventory.hostApis.flatMap(host => {
    const value = audioCaptureSettingsSchema.shape.hostApi.safeParse(host.id)
    return value.success && value.data !== 'default' && (value.data !== 'ASIO' || inventory.asioCompiled) ? [{ value: value.data, label: captureHostLabel(value.data) }] : []
  })]
}
export function captureDevices(inventory: AudioCaptureInventory, settings: AudioCaptureSettings): AudioCaptureInventory['devices'] {
  const host = settings.hostApi === 'default' ? inventory.devices.find(device => device.index === inventory.defaultInputDevice)?.hostApi : settings.hostApi
  return inventory.devices.filter(device => device.hostApi === host && device.maxInputChannels > 0)
}
export function captureDevice(inventory: AudioCaptureInventory, settings: AudioCaptureSettings): AudioCaptureInventory['devices'][number] | undefined {
  const devices = captureDevices(inventory, settings)
  if (settings.deviceName) return devices.filter(device => device.name === settings.deviceName)[settings.deviceOrdinal]
  const index = inventory.hostApis.find(host => host.id === settings.hostApi)?.defaultInputDevice ?? inventory.defaultInputDevice
  return devices.find(device => device.index === index) ?? devices[0]
}
export function captureDeviceOptions(inventory: AudioCaptureInventory, settings: AudioCaptureSettings): DropdownOption<string>[] {
  const devices = captureDevices(inventory, settings)
  return [{ value: '', label: '系统默认输入' }, ...devices.map(device => {
    const same = devices.filter(other => other.name === device.name)
    const ordinal = same.indexOf(device)
    return { value: JSON.stringify([device.name, ordinal]), label: same.length > 1 ? `${device.name}（${ordinal + 1}）` : device.name }
  })]
}
export function captureChannelOptions(maxChannels: number, channels: number): DropdownOption<number>[] {
  const count = maxChannels <= 2 ? Math.min(1, Math.floor(maxChannels / channels)) : Math.floor(maxChannels / channels)
  return Array.from({ length: count }, (_, index) => ({ value: index * channels, label: channels === 1 ? `输入 ${index + 1}` : `输入 ${index * 2 + 1}/${index * 2 + 2}` }))
}
export type CaptureFormats = { sampleRate: number; bitDepth: number; supported: boolean }[]
export function captureFormatSupported(formats: CaptureFormats, sampleRate: number, bitDepth: number): boolean {
  return formats.some(format => format.sampleRate === sampleRate && format.bitDepth === bitDepth && format.supported)
}
export function captureRateOptions(formats: CaptureFormats, depth: number): DropdownOption<AudioCaptureSettings['sampleRate']>[] {
  return AUDIO_CAPTURE_RATES.map(value => {
    const disabled = !captureFormatSupported(formats, value, depth)
    const unsupported = formats.length > 0 && disabled
    return { value, label: `${captureRateLabel(value)}${unsupported ? ' · 设备不支持' : ''}`, disabled, tooltip: unsupported ? '设备不支持' : undefined }
  })
}
export function captureBufferOptions(rate: number): DropdownOption<number>[] {
  return [0, 64, 128, 256, 512, 1024, 2048].map(value => ({ value, label: value ? `${value} 帧 · ${(value * 1000 / rate).toFixed(1)} 毫秒` : '自动' }))
}
