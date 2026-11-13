import { AudioCaptureSettingsForm } from '@/features/audioCapture'
import { PanelTrigger } from '@/components/ui'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatFrameRate } from '@/core/format/specFormat'
import { FolderOpen } from 'lucide-react'
import { Dropdown, UiButton, UiFormRow, UiGroup, UiInput, UiSegmented, UiSwitch } from '@/components/ui'
import { getPlatform } from '@/platform'
import type { AudioCaptureSettingsState } from '@/core/audioCapture/contracts'
import type { recordingDevices } from './tracks/devices'
import type { RecordingSetup } from './recordingSetupModel'
import { RecordingVideoParams } from './RecordingVideoParams'
import { RecordingRecoveryBanner } from './RecordingRecoveryBanner'

type RecordingDevice = Awaited<ReturnType<typeof recordingDevices>>[number]


export function RecordingSetupPanel({ value, devices, destination, onChange }: { value: RecordingSetup; devices: RecordingDevice[]; destination: boolean; onChange(patch: Partial<RecordingSetup>): void }): React.ReactElement {
  const { t } = useTranslation('ui')
  const deviceOptions = (kind: RecordingDevice['kind'], fallback: string) => [{ value: '', label: t('recording.defaultDevice') }, ...devices.filter(device => device.kind === kind && device.id).map(device => ({ value: device.id, label: device.label || fallback }))]
  const chooseFolder = async (): Promise<void> => {
    const selected = await getPlatform().system.dialog.open({ directory: true, multiple: false })
    const folder = Array.isArray(selected) ? selected[0] : selected
    if (folder) onChange({ saveDirectory: folder })
  }
  const quick = value.mode === 'quick'
  return <aside className="flex w-80 shrink-0 flex-col gap-6 overflow-auto border-l border-gap bg-panel p-4" aria-label={t('recording.options')}>
    <RecordingRecoveryBanner />
    <UiGroup title={t('recording.recordGroup')} titleTone="compact" labelWidth={96}>
      <UiFormRow label={t('recording.modeGroup')} info={t(quick ? 'recording.modeHint_quick' : 'recording.modeHint_full')} density="compact"><UiSegmented ariaLabel={t('recording.modeGroup')} size="sm" value={value.mode} onChange={mode => onChange({ mode })} options={[{ value: 'full', label: t('recording.mode_full') }, { value: 'quick', label: t('recording.mode_quick') }]} /></UiFormRow>
      {quick && <UiFormRow label={t('recording.saveTo')} density="compact">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs text-text2">{value.saveDirectory || t('recording.saveToDefault')}</span>
          <UiButton size="sm" onClick={() => { void chooseFolder() }}><FolderOpen />{t('recording.chooseFolder')}</UiButton>
        </div>
      </UiFormRow>}
    </UiGroup>
    <UiGroup title={t('recording.soundGroup')} titleTone="compact" labelWidth={96} divided>
      <RecordingSoundRows value={value} onChange={onChange} />
      {!quick && <UiFormRow label={t('recording.camera')} density="compact"><UiSwitch checked={value.camera} onCheckedChange={camera => onChange({ camera })} /></UiFormRow>}
      {!quick && value.camera && <UiFormRow label={t('recording.cameraDevice')} density="compact"><Dropdown size="sm" value={value.cameraId} options={deviceOptions('camera', t('recording.camera'))} onSelect={cameraId => onChange({ cameraId })} /></UiFormRow>}
    </UiGroup>
    <UiGroup title={t('recording.pictureGroup')} titleTone="compact" labelWidth={96} divided>
      <RecordingPictureRows value={value} onChange={onChange} />
      <RecordingVideoParams value={value} onChange={onChange} />
    </UiGroup>
    <UiGroup title={t('recording.sessionGroup')} titleTone="compact" labelWidth={96} divided>
      <UiFormRow label={t('recording.name')} density="compact"><UiInput size="sm" value={value.name} onChange={event => onChange({ name: event.target.value })} placeholder={t('recording.title')} /></UiFormRow>
      {destination && <UiFormRow label={t('recording.insert')} density="compact"><UiSwitch checked={value.insert} onCheckedChange={insert => onChange({ insert })} /></UiFormRow>}
    </UiGroup>
  </aside>
}

/** 麦克风、麦克风设备、系统声音三行：录制页与剪辑的录制样子共用。 */
export function RecordingSoundRows({ value, disabled, onChange }: { value: Pick<RecordingSetup, 'microphone' | 'systemAudio'>; disabled?: boolean; onChange(patch: Partial<RecordingSetup>): void }): React.ReactElement {
  const { t } = useTranslation('ui')
  // 打开过录音设置后，麦克风设备一行写当前设备名。不为显示名字提前读设备：那会拉起原生录音服务枚举设备
  const [microphoneName, setMicrophoneName] = useState<string>()
  const showMicrophone = (state: AudioCaptureSettingsState): void => setMicrophoneName(state.settings.deviceName || t('recording.defaultDevice'))
  return <>
    <UiFormRow label={t('recording.microphone')} density="compact"><UiSwitch checked={value.microphone} disabled={disabled} onCheckedChange={microphone => onChange({ microphone })} /></UiFormRow>
    {value.microphone && <UiFormRow label={t('recording.microphoneDevice')} density="compact"><PanelTrigger display={microphoneName ?? t('recording.audioSettings')} size="sm" disabled={disabled} panelSize="compact" panelPadding="content" renderPanel={() => <AudioCaptureSettingsForm onSettings={showMicrophone} />} /></UiFormRow>}
    <UiFormRow label={t('recording.systemAudio')} density="compact"><UiSwitch checked={value.systemAudio} disabled={disabled} onCheckedChange={systemAudio => onChange({ systemAudio })} /></UiFormRow>
  </>
}
/** 清晰度与帧率两行：录制页与剪辑的录制样子共用。 */
export function RecordingPictureRows({ value, disabled, onChange }: { value: Pick<RecordingSetup, 'quality' | 'fps'>; disabled?: boolean; onChange(patch: Partial<RecordingSetup>): void }): React.ReactElement {
  const { t } = useTranslation('ui')
  return <>
    <UiFormRow label={t('recording.quality')} density="compact"><UiSegmented ariaLabel={t('recording.quality')} size="sm" disabled={disabled} value={value.quality} onChange={quality => onChange({ quality })} options={[{ value: '1080p', label: '1080P' }, { value: '1440p', label: '2K' }, { value: '2160p', label: '4K' }]} /></UiFormRow>
    <UiFormRow label={t('recording.fps')} density="compact"><UiSegmented ariaLabel={t('recording.fps')} size="sm" disabled={disabled} value={value.fps} onChange={fps => onChange({ fps })} options={([30, 60] as const).map(fps => ({ value: fps, label: formatFrameRate(fps, 'compact') }))} /></UiFormRow>
  </>
}
