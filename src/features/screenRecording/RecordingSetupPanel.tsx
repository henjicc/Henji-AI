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
  const encoderLabels: Record<RecordingEncoder, string> = { auto: '自动', nvidia: 'NVIDIA', intel: 'Intel', amd: 'AMD', apple: 'Apple', software: '软件' }
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
      {value.microphone && <UiFormRow label={t('recording.microphoneDevice')} density="compact"><PanelTrigger display="录音设置" size="sm" panelSize="wide" renderPanel={() => <AudioCaptureSettingsForm />} /></UiFormRow>}
      <UiFormRow label={t('recording.systemAudio')} density="compact"><UiSwitch checked={value.systemAudio} onCheckedChange={systemAudio => onChange({ systemAudio })} /></UiFormRow>
      {!quick && <UiFormRow label={t('recording.camera')} density="compact"><UiSwitch checked={value.camera} onCheckedChange={camera => onChange({ camera })} /></UiFormRow>}
      {!quick && value.camera && <UiFormRow label={t('recording.cameraDevice')} density="compact"><Dropdown size="sm" value={value.cameraId} options={deviceOptions('camera', t('recording.camera'))} onSelect={cameraId => onChange({ cameraId })} /></UiFormRow>}
    </UiGroup>
    <UiGroup title={t('recording.pictureGroup')} titleTone="compact" labelWidth={96}>
      <UiFormRow label={t('recording.quality')} density="compact"><UiSegmented ariaLabel={t('recording.quality')} size="sm" value={value.quality} onChange={quality => onChange({ quality })} options={[{ value: '1080p', label: '1080p' }, { value: '1440p', label: '2K' }, { value: '2160p', label: '4K' }]} /></UiFormRow>
      <UiFormRow label={t('recording.fps')} density="compact"><UiSegmented ariaLabel={t('recording.fps')} size="sm" value={value.fps} onChange={fps => onChange({ fps })} options={[{ value: 30, label: '30' }, { value: 60, label: '60' }]} /></UiFormRow>
      <UiButton size="sm" aria-expanded={videoExpanded} onClick={() => setVideoExpanded(!videoExpanded)}>{videoExpanded ? <ChevronDown /> : <ChevronRight />}视频参数</UiButton>
      {videoExpanded && <>
        <UiFormRow label="码率模式" info="画质优先按画面复杂度分配码率；可变码率围绕目标分配；固定码率便于估算文件大小。" density="compact"><UiSegmented ariaLabel="码率模式" size="sm" value={output.rateControl} onChange={rateControl => onChange({ rateControl })} options={[{ value: 'quality', label: '画质优先' }, { value: 'vbr', label: '可变码率' }, { value: 'cbr', label: '固定码率' }]} /></UiFormRow>
        <UiFormRow label="码率" info="码率越高，细节通常越清晰、文件越大。画质优先时作为上限；恢复默认会随分辨率、帧率和格式自动调整。" density="compact"><div className="flex min-w-0 flex-wrap items-center gap-1"><NumberInput size="sm" value={output.bitrate / 1_000_000} min={1} max={100} step={.1} onChange={bitrate => onChange({ bitrate: Math.round(bitrate * 1_000_000) })} /><span className="text-xs text-text2">Mbps</span><UiButton size="sm" onClick={() => onChange({ bitrate: undefined })}>恢复默认</UiButton></div></UiFormRow>
        <UiFormRow label="关键帧间隔" info="越短剪辑拖动越快、文件越大。按帧数设置，秒数随帧率换算。" density="compact"><Dropdown size="sm" value={String(output.keyframeFrames)} options={([10, 15, 30, 60, 120] as const).map(frames => ({ value: String(frames), label: `${frames} 帧（${Number((frames / value.fps).toFixed(2))} 秒）` }))} onSelect={frames => onChange({ keyframeFrames: Number(frames) as NonNullable<RecordingSetup['keyframeFrames']> })} /></UiFormRow>
        <UiFormRow label="编码格式" info="H.264 兼容性更广；H.265 同等画质下文件更小，播放和剪辑需要设备支持。" density="compact"><UiSegmented ariaLabel="编码格式" size="sm" value={output.codec} onChange={codec => onChange({ codec })} options={[{ value: 'h264', label: 'H.264' }, { value: 'hevc', label: 'H.265' }]} /></UiFormRow>
        <UiFormRow label="编码器" info="自动优先使用可用硬件。软件编码占用更多处理器资源，高分辨率录制推荐硬件。" density="compact"><UiSegmented ariaLabel="编码器" size="sm" value={encoders.includes(output.encoder) ? output.encoder : 'auto'} onChange={encoder => onChange({ encoder })} options={encoders.map(encoder => ({ value: encoder, label: encoderLabels[encoder] }))} /></UiFormRow>
      </>}
    </UiGroup>
    <UiGroup title={t('recording.sessionGroup')} titleTone="compact" labelWidth={96}>
      <UiFormRow label={t('recording.name')} density="compact"><UiInput size="sm" value={value.name} onChange={event => onChange({ name: event.target.value })} placeholder={t('recording.title')} /></UiFormRow>
      {destination && <UiFormRow label={t('recording.insert')} density="compact"><UiSwitch checked={value.insert} onCheckedChange={insert => onChange({ insert })} /></UiFormRow>}
    </UiGroup>
  </aside>
}
