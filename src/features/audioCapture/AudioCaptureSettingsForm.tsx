import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { getAudioCaptureSession } from './captureApplicationService'
import { Dropdown, UiButton, UiError, UiFormRow, UiGroup, UiLoading, UiSegmented, UiSwitch } from '@/components/ui'
import type { AudioCaptureInventory, AudioCaptureSettings, AudioCaptureSettingsState } from '@/core/audioCapture/contracts'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import { captureBufferOptions, captureChannelOptions, captureDepthLabel, captureDevice, captureDeviceOptions, captureFormatSupported, captureHostOptions, captureRateLabel, captureRateOptions, captureSummary, type CaptureFormats } from './captureSettingsModel'

const logger = createLogger('features.audioCapture.settings')

/** 设置页与录音浮层共用；只有挂载期间持有设备监听，偏好始终以主进程读回为准。 */
export function AudioCaptureSettingsForm({ disabled = false, disabledReason = '录音中不能修改', onSettings }: {
  disabled?: boolean; disabledReason?: string; onSettings?: (state: AudioCaptureSettingsState) => void
}): JSX.Element {
  const sessionLocked = useStore(getAudioCaptureSession().store, current => current.busy || current.phase === 'recording' || current.phase === 'paused')
  disabled = disabled || sessionLocked
  const [state, setState] = useState<AudioCaptureSettingsState>()
  const [inventory, setInventory] = useState<AudioCaptureInventory>()
  const [formats, setFormats] = useState<CaptureFormats>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(false)
  const mounted = useRef(false)
  const writing = useRef(false)
  const refreshGeneration = useRef(0)
  const onSettingsRef = useRef(onSettings)
  onSettingsRef.current = onSettings
  const refresh = useCallback(async (devices?: AudioCaptureInventory) => {
    const generation = ++refreshGeneration.current
    const api = getPlatform().audioCapture
    try {
      const nextInventory = devices ?? await api.enumerate()
      const next = await api.getSettings()
      if (!mounted.current || generation !== refreshGeneration.current) return
      setInventory(nextInventory); setState(next); onSettingsRef.current?.(next)
    } catch (raw) {
      logger.warn('读取录音设置失败', { event: 'audio_capture.settings.read.failed', error: raw })
      if (mounted.current) setError(raw instanceof Error ? raw.message : '读取录音设备失败')
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    const release = getPlatform().audioCapture.onDevicesChanged(devices => { void refresh(devices) })
    void refresh()
    return () => { mounted.current = false; release() }
  }, [refresh])
  useEffect(() => {
    if (!state || !inventory || disabled) return
    let disposed = false
    setProbing(true); setFormats([])
    void getPlatform().audioCapture.probe(state.settings).then(result => { if (!disposed) setFormats(result.formats) }).catch((raw: unknown) => {
      logger.warn('检查录音格式失败', { event: 'audio_capture.settings.probe.failed', error: raw })
      if (!disposed) setError(raw instanceof Error ? raw.message : '检查录音格式失败')
    }).finally(() => { if (!disposed) setProbing(false) })
    return () => { disposed = true }
  }, [state, inventory, disabled])
  const write = async (patch: Partial<AudioCaptureSettings>): Promise<void> => {
    if (!state || disabled || writing.current) return
    writing.current = true; setSaving(true); setError(''); ++refreshGeneration.current
    logger.info('修改录音设置', { event: 'audio_capture.settings.write.start' })
    try {
      const next = await getPlatform().audioCapture.setSettings({ ...state.settings, ...patch }, state.revision)
      if (mounted.current) { setState(next); onSettingsRef.current?.(next) }
      logger.info('录音设置已读回', { event: 'audio_capture.settings.write.completed' })
    } catch (raw) {
      logger.warn('保存录音设置失败', { event: 'audio_capture.settings.write.failed', error: raw })
      if (mounted.current) setError(raw instanceof Error ? raw.message : '保存录音设置失败')
      // 冲突后刷新基线，但保留错误，不能把写失败伪装成成功。
      await refresh()
    } finally { writing.current = false; if (mounted.current) setSaving(false) }
  }
  if (!state || !inventory) return error ? <UiError message={error} onRetry={() => void refresh()} /> : <UiLoading message="正在读取录音设备…" />
  const settings = state.settings
  const device = captureDevice(inventory, settings)
  const host = settings.hostApi === 'default' ? device?.hostApi : settings.hostApi
  const asio = host === 'ASIO'
  const locked = disabled || saving
  const reason = disabled ? disabledReason : saving ? '正在保存录音设置' : undefined
  const rate = asio ? device?.defaultSampleRate ?? settings.sampleRate : settings.sampleRate
  const deviceOptions = captureDeviceOptions(inventory, settings)
  const selectedDevice = settings.deviceName ? JSON.stringify([settings.deviceName, settings.deviceOrdinal]) : ''
  return <div className="space-y-3" data-audio-capture-settings>
    <UiGroup labelWidth={96}>
      <UiFormRow density="compact" label="设备类型"><Dropdown value={settings.hostApi} options={captureHostOptions(inventory)} disabled={locked} disabledReason={reason} onSelect={hostApi => {
        const next = { ...settings, hostApi, deviceName: '', deviceOrdinal: 0, firstChannel: 0, exclusive: false }
        void write({ ...next, channels: captureDevice(inventory, next)?.maxInputChannels === 1 ? 1 : settings.channels })
      }} /></UiFormRow>
      <UiFormRow density="compact" label="输入设备"><Dropdown value={selectedDevice} display={deviceOptions.find(option => option.value === selectedDevice)?.label ?? `${settings.deviceName}（未连接）`} options={deviceOptions} disabled={locked} disabledReason={reason} onSelect={value => {
        const [deviceName, deviceOrdinal] = value ? JSON.parse(value) as [string, number] : ['', 0] as const
        const next = { ...settings, deviceName, deviceOrdinal, firstChannel: 0 }
        void write({ ...next, channels: captureDevice(inventory, next)?.maxInputChannels === 1 ? 1 : settings.channels })
      }} /></UiFormRow>
      <UiFormRow density="compact" label="输入通道"><Dropdown value={settings.firstChannel} display={settings.channels === 1 ? `输入 ${settings.firstChannel + 1}` : `输入 ${settings.firstChannel + 1}/${settings.firstChannel + 2}`} options={captureChannelOptions(device?.maxInputChannels ?? 0, settings.channels)} disabled={locked || !device} disabledReason={reason ?? (!device ? '没有可用输入设备' : undefined)} onSelect={firstChannel => void write({ firstChannel })} /></UiFormRow>
      <UiFormRow density="compact" label="声道"><UiSegmented ariaLabel="声道" value={settings.channels} disabled={locked} disabledReason={reason} options={[
        { value: 1, label: '单声道', title: reason }, { value: 2, label: '立体声', disabled: (device?.maxInputChannels ?? 0) < 2, disabledReason: reason ?? ((device?.maxInputChannels ?? 0) < 2 ? '设备只有一个输入通道' : undefined) },
      ]} onChange={channels => void write({ channels, firstChannel: 0 })} /></UiFormRow>
      <UiFormRow density="compact" label="采样率" hint={asio ? '在驱动面板中修改' : undefined}>
        {asio ? <span className="text-sm text-text1">{captureRateLabel(rate)}</span> : <Dropdown value={settings.sampleRate} options={captureRateOptions(formats, settings.bitDepth)} disabled={locked || probing} disabledReason={reason ?? (probing ? '正在检查设备支持的格式' : undefined)} onSelect={sampleRate => void write({ sampleRate })} />}
      </UiFormRow>
      <UiFormRow density="compact" label="位深"><UiSegmented ariaLabel="位深" value={settings.bitDepth} disabled={locked || probing} disabledReason={reason ?? (probing ? '正在检查设备支持的格式' : undefined)} options={([16, 24, 32] as const).map(value => ({ value, label: captureDepthLabel(value), disabled: !captureFormatSupported(formats, rate, value), title: reason ?? (!captureFormatSupported(formats, rate, value) ? '设备不支持' : captureDepthLabel(value)) }))} onChange={bitDepth => void write({ bitDepth })} /></UiFormRow>
      <UiFormRow density="compact" label="缓冲" hint={asio ? '以驱动设置为准' : undefined}>
        {asio ? <span className="text-xs text-text2">{device?.asioBuffers ? `首选 ${device.asioBuffers.preferred} 帧 · ${device.asioBuffers.min}–${device.asioBuffers.max} 帧` : '由驱动控制'}</span> : <Dropdown value={settings.bufferFrames} options={captureBufferOptions(rate)} disabled={locked} disabledReason={reason} onSelect={bufferFrames => void write({ bufferFrames })} />}
      </UiFormRow>
      {host === 'WASAPI' && <UiFormRow density="compact" label="独占模式" info={reason ?? '独占可获得更低延迟与原始格式，但录音期间其他程序无法使用该设备'}><UiSwitch checked={settings.exclusive} disabled={locked} aria-label={reason ? `独占模式：${reason}` : '独占模式'} onCheckedChange={exclusive => void write({ exclusive })} /></UiFormRow>}
      {asio && <UiFormRow density="compact" label=""><UiButton variant="secondary" disabled={locked} disabledReason={reason} onClick={() => {
        void getPlatform().audioCapture.openAsioPanel(settings).then(() => refresh()).catch((raw: unknown) => { setError(raw instanceof Error ? raw.message : '打开驱动面板失败'); logger.warn('打开驱动面板失败', { event: 'audio_capture.asio_panel.failed', error: raw }) })
      }}>打开 ASIO 控制面板</UiButton></UiFormRow>}
    </UiGroup>
    {(state.notice || JSON.stringify(settings) !== JSON.stringify(state.effectiveSettings)) && <p className="text-xs text-text2">{state.notice ? `${state.notice} ` : ''}实际使用：{captureSummary(state.effectiveSettings)}</p>}
    {error && <UiError message={error} onRetry={() => { setError(''); void refresh() }} />}
  </div>
}
