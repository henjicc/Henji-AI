import { AudioCaptureSettingsForm } from '@/features/audioCapture'
import { PanelTrigger } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { useEffect, useState } from 'react'
import { recordingOutput } from '@/services/recordingSetupModel'
import type { RecordingEncoder } from '@/core/screenRecording/encoding'
import { createLogger } from '@/core/logging'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react'
import { Dropdown, UiButton, UiFormRow, UiGroup, UiInput, UiSegmented, UiSwitch } from '@/components/ui'
import { getPlatform } from '@/platform'
import type { recordingDevices } from './tracks/devices'
import type { RecordingSetup } from './recordingSetupModel'

type RecordingDevice = Awaited<ReturnType<typeof recordingDevices>>[number]

export function RecordingSetupPanel({ value, devices, destination, onChange }: { value: RecordingSetup; devices: RecordingDevice[]; destination: boolean; onChange(patch: Partial<RecordingSetup>): void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const deviceOptions = (kind: RecordingDevice['kind'], fallback: string) => [{ value: '', label: t('recording.defaultDevice') }, ...devices.filter(device => device.kind === kind && device.id).map(device => ({ value: device.id, label: device.label || fallback }))]
  const chooseFolder = async (): Promise<void> => {
    const selected = await getPlatform().system.dialog.open({ directory: true, multiple: false })
    const folder = Array.isArray(selected) ? selected[0] : selected
    if (folder) onChange({ saveDirectory: folder })
  }
  const [videoExpanded, setVideoExpanded] = useState(false)
  const [encoders, setEncoders] = useState<RecordingEncoder[]>(['auto', 'software'])
  useEffect(() => {
    let active = true
    void getPlatform().screenRecording.capture({ operation: 'encoders', codec: value.codec ?? 'h264' }).then(result => {
      if (active) setEncoders(result as RecordingEncoder[])
    }).catch(error => createLogger('features.screenRecording.setup').warn('编码器列表读取失败', { event: 'recording.encoders.read.failed', error }))
    return () => { active = false }
  }, [value.codec])
  const output = recordingOutput(value)
  const encoderLabels: Record<RecordingEncoder, string> = { auto: t('recording.encoder_auto'), nvidia: 'NVIDIA', intel: 'Intel', amd: 'AMD', apple: 'Apple', software: t('recording.encoder_software') }
  const quick = value.mode === 'quick'
  return <aside className="flex w-80 shrink-0 flex-col gap-6 overflow-auto border-l border-gap bg-panel p-4" aria-label={t('recording.options')}>
    <UiGroup titleTone="compact" labelWidth={96}>
      <UiFormRow label={t('recording.modeGroup')} density="compact"><UiSegmented ariaLabel={t('recording.modeGroup')} size="sm" value={value.mode} onChange={mode => onChange({ mode })} options={[{ value: 'full', label: t('recording.mode_full') }, { value: 'quick', label: t('recording.mode_quick') }]} /></UiFormRow>
      <p className="text-xs text-text2">{t(quick ? 'recording.modeHint_quick' : 'recording.modeHint_full')}</p>
      {quick && <UiFormRow label={t('recording.saveTo')} density="compact">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-text2">{value.saveDirectory || t('recording.saveToDefault')}</span>
          <UiButton size="sm" onClick={() => { void chooseFolder() }}><FolderOpen />{t('recording.chooseFolder')}</UiButton>
        </div>
      </UiFormRow>}
    </UiGroup>
    <UiGroup title={t('recording.soundGroup')} titleTone="compact" labelWidth={96}>
      <UiFormRow label={t('recording.microphone')} density="compact"><UiSwitch checked={value.microphone} onCheckedChange={microphone => onChange({ microphone })} /></UiFormRow>
      {value.microphone && <UiFormRow label={t('recording.microphoneDevice')} density="compact"><PanelTrigger display={t('recording.audioSettings')} size="sm" panelSize="compact" panelPadding="content" renderPanel={() => <AudioCaptureSettingsForm />} /></UiFormRow>}
      <UiFormRow label={t('recording.systemAudio')} density="compact"><UiSwitch checked={value.systemAudio} onCheckedChange={systemAudio => onChange({ systemAudio })} /></UiFormRow>
      {!quick && <UiFormRow label={t('recording.camera')} density="compact"><UiSwitch checked={value.camera} onCheckedChange={camera => onChange({ camera })} /></UiFormRow>}
      {!quick && value.camera && <UiFormRow label={t('recording.cameraDevice')} density="compact"><Dropdown size="sm" value={value.cameraId} options={deviceOptions('camera', t('recording.camera'))} onSelect={cameraId => onChange({ cameraId })} /></UiFormRow>}
    </UiGroup>
    <UiGroup title={t('recording.pictureGroup')} titleTone="compact" labelWidth={96}>
      <UiFormRow label={t('recording.quality')} density="compact"><UiSegmented ariaLabel={t('recording.quality')} size="sm" value={value.quality} onChange={quality => onChange({ quality })} options={[{ value: '1080p', label: '1080p' }, { value: '1440p', label: '2K' }, { value: '2160p', label: '4K' }]} /></UiFormRow>
      <UiFormRow label={t('recording.fps')} density="compact"><UiSegmented ariaLabel={t('recording.fps')} size="sm" value={value.fps} onChange={fps => onChange({ fps })} options={[{ value: 30, label: '30' }, { value: 60, label: '60' }]} /></UiFormRow>
      <UiButton size="sm" aria-expanded={videoExpanded} onClick={() => setVideoExpanded(!videoExpanded)}>{videoExpanded ? <ChevronDown /> : <ChevronRight />}{t('recording.videoParams')}</UiButton>
      {videoExpanded && <>
        <UiFormRow label={t('recording.rateControl')} info={t('recording.rateControlInfo')} density="compact"><UiSegmented ariaLabel={t('recording.rateControl')} size="sm" value={output.rateControl} onChange={rateControl => onChange({ rateControl })} options={(['quality', 'vbr', 'cbr'] as const).map(mode => ({ value: mode, label: t(`recording.rate_${mode}`) }))} /></UiFormRow>
        <UiFormRow label={t('recording.bitrate')} info={t('recording.bitrateInfo')} density="compact"><div className="flex min-w-0 flex-wrap items-center gap-1"><NumberInput size="sm" value={output.bitrate / 1_000_000} min={1} max={100} step={.1} onChange={bitrate => onChange({ bitrate: Math.round(bitrate * 1_000_000) })} /><span className="text-xs text-text2">Mbps</span><UiButton size="sm" onClick={() => onChange({ bitrate: undefined })}>{t('recording.resetDefault')}</UiButton></div></UiFormRow>
        <UiFormRow label={t('recording.keyframes')} info={t('recording.keyframesInfo')} density="compact"><Dropdown size="sm" value={String(output.keyframeFrames ?? 'auto')} options={[{ value: 'auto', label: t('recording.keyframes_auto') }, ...([10, 15, 30, 60, 120] as const).map(frames => ({ value: String(frames), label: t('recording.keyframes_frames', { frames, seconds: Number((frames / value.fps).toFixed(2)) }) }))]} onSelect={frames => onChange({ keyframeFrames: frames === 'auto' ? undefined : Number(frames) as NonNullable<RecordingSetup['keyframeFrames']> })} /></UiFormRow>
        <UiFormRow label={t('recording.codec')} info={t('recording.codecInfo')} density="compact"><UiSegmented ariaLabel={t('recording.codec')} size="sm" value={output.codec} onChange={codec => onChange({ codec })} options={[{ value: 'h264', label: 'H.264' }, { value: 'hevc', label: 'H.265' }]} /></UiFormRow>
        <UiFormRow label={t('recording.encoder')} info={t('recording.encoderInfo')} density="compact"><UiSegmented ariaLabel={t('recording.encoder')} size="sm" value={encoders.includes(output.encoder) ? output.encoder : 'auto'} onChange={encoder => onChange({ encoder })} options={encoders.map(encoder => ({ value: encoder, label: encoderLabels[encoder] }))} /></UiFormRow>
      </>}
    </UiGroup>
    <UiGroup title={t('recording.sessionGroup')} titleTone="compact" labelWidth={96}>
      <UiFormRow label={t('recording.name')} density="compact"><UiInput size="sm" value={value.name} onChange={event => onChange({ name: event.target.value })} placeholder={t('recording.title')} /></UiFormRow>
      {destination && <UiFormRow label={t('recording.insert')} density="compact"><UiSwitch checked={value.insert} onCheckedChange={insert => onChange({ insert })} /></UiFormRow>}
    </UiGroup>
  </aside>
}
